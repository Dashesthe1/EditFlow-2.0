"""Read-only video copy retrieval. Source timestamps always come from decoded PTS.

SSCD proposes locations; SIFT geometry and temporal consistency test the evidence.
No returned measurement selects footage or changes an editing assignment.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import queue
import re
import subprocess
import threading
import time
from fractions import Fraction
from pathlib import Path

import av
import cv2
import numpy as np

VERSION = "source-match-v1.6.2"
INDEX_VERSION = "source-match-v1.0.0"  # Reuse compatible deployed descriptor caches.
ENGINE_SHA256 = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()


class BudgetExpired(Exception):
    pass


def atomic_json(file, value):
    file = Path(file)
    file.parent.mkdir(parents=True, exist_ok=True)
    temp = file.with_suffix(file.suffix + ".tmp")
    temp.write_text(json.dumps(value, indent=2, allow_nan=False), encoding="utf-8")
    for attempt in range(7):
        try:
            os.replace(temp, file)
            break
        except PermissionError:
            if os.name != 'nt' or attempt == 6:
                raise
            time.sleep(.02 * 2 ** attempt)


def timecode(seconds):
    ms=round(seconds*1000)
    hours,ms=divmod(ms,3600000);minutes,ms=divmod(ms,60000);seconds,ms=divmod(ms,1000)
    return f"{hours:02}:{minutes:02}:{seconds:02}.{ms:03}"


def timestamps_csv(directory, report):
    fields=['shotId','referenceStart','referenceEnd','status','sourcePath','sourceStart','sourceEndExclusive',
            'sourceStartPts','sourceEndPtsExclusive','sourceTimeBase','boundaryStatus','sourceStartTimecode','sourceEndTimecode','reason']
    with (Path(directory)/'timestamps.csv').open('w',newline='',encoding='utf-8') as f:
        writer=csv.DictWriter(f,fields,extrasaction='ignore');writer.writeheader();writer.writerows(report['shots'])


def fingerprint(file):
    """Bounded content identity; avoid re-reading a multi-GB movie on every job."""
    p = Path(file).resolve()
    s = p.stat()
    h = hashlib.sha256()
    h.update(f"{p}|{s.st_size}|{s.st_mtime_ns}".encode())
    with p.open("rb") as f:
        for offset in [0, max(0, s.st_size // 2 - 32768), max(0, s.st_size - 65536)]:
            f.seek(offset)
            h.update(f.read(65536))
    return h.hexdigest()


def probe(file):
    with av.open(str(file)) as c:
        s = c.streams.video[0]
        origin = float((s.start_time or 0) * s.time_base)
        duration = float(s.duration * s.time_base) if s.duration else float(c.duration or 0) / av.time_base
        return dict(duration=duration, origin=origin, width=s.width, height=s.height,
                    fps=float(s.average_rate or 24), codec=s.codec_context.name,
                    timeBase=str(s.time_base))


def trim_bars(im):
    # Only remove contiguous nearly-black borders, never interior overlays/content.
    gray = cv2.cvtColor(im, cv2.COLOR_RGB2GRAY)
    rows = (gray > 12).mean(axis=1) > .02
    cols = (gray > 12).mean(axis=0) > .02
    ys, xs = np.flatnonzero(rows), np.flatnonzero(cols)
    if len(ys) and len(xs) and ys[-1] - ys[0] > im.shape[0] * .25 and xs[-1] - xs[0] > im.shape[1] * .25:
        return im[ys[0]:ys[-1]+1, xs[0]:xs[-1]+1]
    return im


def resized(im, size=640):
    h, w = im.shape[:2]
    scale = min(1, size / max(h, w))
    return cv2.resize(im, (max(1, round(w * scale)), max(1, round(h * scale))))


def decode(file, start=0, end=None, keyframes=False, size=640, check=lambda: None):
    """CPU decode for reference/bounded verification with integer frame PTS."""
    with av.open(str(file)) as c:
        s = c.streams.video[0]
        origin = float((s.start_time or 0) * s.time_base)
        s.thread_type = "AUTO"
        if keyframes:
            s.codec_context.skip_frame = "NONKEY"
        if start:
            c.seek(int((origin + start) / float(s.time_base)), stream=s, backward=True)
        for f in c.decode(s):
            check()
            if f.pts is None:
                continue
            absolute = float(f.pts * s.time_base)
            t = absolute - origin
            if t < start - 1e-6:
                continue
            if end is not None and t >= end - 1e-6:
                break
            yield dict(t=t, pts=f.pts, timeBase=str(s.time_base), absolute=absolute,
                       duration=float(f.duration * s.time_base) if f.duration else 1 / float(s.average_rate or 24),
                       durationVerified=bool(f.duration),
                       image=resized(f.to_ndarray(format="rgb24"), size))


def gpu_samples(file, interval, check, start=0, end=None, size=512):
    """GPU downscale before readback. select/showinfo preserve actual frame PTS."""
    import imageio_ffmpeg
    ff = os.environ.get("EDITFLOW_SOURCE_MATCH_FFMPEG") or imageio_ffmpeg.get_ffmpeg_exe()
    meta=probe(file)
    width=size; height=max(2,round(meta["height"]*size/meta["width"]/2)*2)
    selection=f"select='isnan(prev_selected_t)+gte(t-prev_selected_t,{interval})'," if interval else ""
    # Timestamp-only select accepts hardware frames; discard unneeded frames
    # before downscale/readback/RGB conversion rather than paying for every frame.
    vf = selection+f"scale_cuda={width}:{height}:format=nv12,hwdownload,format=nv12,format=rgb24,showinfo"
    cmd = [ff, "-nostdin", "-hide_banner", "-loglevel", "info", "-copyts",
           "-hwaccel", "cuda", "-hwaccel_output_format", "cuda",
           *(["-ss",str(start)] if start else []), *(["-t",str(end-start)] if end else []), "-i", str(file),
           "-map", "0:v:0", "-an", "-sn", "-vf", vf, "-fps_mode", "passthrough",
           "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    timestamps, errors = queue.Queue(), []
    def logs():
        filter_time_base=None
        for line in iter(proc.stderr.readline, b""):
            text = line.decode("utf-8", errors="replace")
            config=re.search(r"config in time_base:\s*(\d+/\d+)",text)
            if config:
                filter_time_base=Fraction(config[1])
            match = re.search(r"\bn:\s*\d+.*?pts:\s*(-?\d+).*?pts_time:\s*([-0-9.e+]+)", text)
            if match:
                duration=re.search(r"\bduration:\s*(\d+)",text)
                timestamps.put((int(match[1]),filter_time_base,int(duration[1]) if duration else None))
            errors.append(text)
            if len(errors) > 40:
                errors.pop(0)
    thread = threading.Thread(target=logs, daemon=True)
    thread.start()
    origin = meta["origin"]
    # A watcher can terminate a blocking pipe read at the budget/cancellation limit.
    done = threading.Event()
    def watch():
        while not done.wait(.2):
            try:
                check()
            except BudgetExpired:
                proc.kill()
                return
    watcher = threading.Thread(target=watch, daemon=True)
    watcher.start()
    try:
        frame_bytes = width * height * 3
        while True:
            check()
            data = bytearray()
            while len(data) < frame_bytes:
                part = proc.stdout.read(frame_bytes - len(data))
                if not part:
                    break
                data.extend(part)
            check()
            if not data:
                break
            if len(data) != frame_bytes:
                raise RuntimeError("Truncated GPU frame")
            try:
                filter_pts, filter_time_base, duration = timestamps.get(timeout=10)
            except queue.Empty:
                raise RuntimeError("GPU frame missing PTS")
            if filter_time_base is None:
                raise RuntimeError("GPU filter did not report its time base")
            source_pts=filter_pts*filter_time_base/Fraction(meta["timeBase"])
            if source_pts.denominator!=1:
                raise RuntimeError("GPU filter PTS does not map to an integer original source PTS")
            raw_pts=int(source_pts)
            absolute=float(raw_pts*Fraction(meta["timeBase"]))
            yield dict(t=absolute-origin, pts=raw_pts, timeBase=meta["timeBase"], absolute=absolute,
                       duration=float(duration*filter_time_base) if duration else 1/meta["fps"],
                       durationVerified=bool(duration),image=np.frombuffer(data, np.uint8).reshape(height,width,3))
        code = proc.wait(timeout=10)
        check()
        if code:
            raise RuntimeError("GPU decode failed: " + "".join(errors)[-2500:])
    finally:
        done.set()
        if proc.poll() is None:
            proc.kill()
        proc.wait()
        thread.join(timeout=2)
        proc.stdout.close()
        proc.stderr.close()


class Encoder:
    def __init__(self, backend, model=None, device="auto"):
        self.backend = backend
        self.device = "cpu"
        self.model_id = backend
        self.monochrome = False
        if backend == "sscd":
            import torch
            self.torch = torch
            self.device = "cuda" if device == "auto" and torch.cuda.is_available() else ("cpu" if device == "auto" else device)
            torch.set_num_threads(4)
            if self.device == "cuda":
                torch.backends.cudnn.benchmark = True
            if not model or not Path(model).is_file():
                raise RuntimeError("SSCD_MODEL_REQUIRED: run scripts/source-match/install.ps1")
            self.model_id = fingerprint(model)
            self.model = torch.jit.load(str(model), map_location=self.device).eval()
            self.mean = torch.tensor([.485,.456,.406], device=self.device)[None,:,None,None]
            self.std = torch.tensor([.229,.224,.225], device=self.device)[None,:,None,None]

    def encode(self, images):
        data = np.stack([cv2.resize(trim_bars(x), (256,256)) for x in images])
        if self.monochrome:
            data=np.stack([cv2.cvtColor(cv2.cvtColor(im,cv2.COLOR_RGB2GRAY),cv2.COLOR_GRAY2RGB) for im in data])
        if self.backend == "sscd":
            torch = self.torch
            with torch.inference_mode():
                t = torch.from_numpy(data.copy()).permute(0,3,1,2).to(self.device).float() / 255
                rgb_values = self.model((t-self.mean)/self.std).float().cpu().numpy()
                if self.monochrome:
                    gray_values=rgb_values
                else:
                    gray=np.stack([cv2.cvtColor(cv2.cvtColor(im,cv2.COLOR_RGB2GRAY),cv2.COLOR_GRAY2RGB) for im in data])
                    t=torch.from_numpy(gray.copy()).permute(0,3,1,2).to(self.device).float()/255
                    gray_values=self.model((t-self.mean)/self.std).float().cpu().numpy()
                values=np.concatenate([rgb_values,gray_values],axis=1)
        else:
            # Explicit lightweight test/diagnostic backend; never silently substitutes SSCD.
            values = np.stack([cv2.resize(cv2.equalizeHist(cv2.cvtColor(x,cv2.COLOR_RGB2GRAY)), (32,32)).ravel() for x in data]).astype(np.float32)
            values -= values.mean(axis=1, keepdims=True)
        return values / np.maximum(1e-8, np.linalg.norm(values, axis=1, keepdims=True))

    def similarity(self,query,source):
        if self.backend=="sscd":
            return np.maximum(2*(query[...,:512]@source[...,:512].T),2*(query[...,512:]@source[...,512:].T))
        return query@source.T


def variants(im, aspect):
    im = trim_bars(im)
    h,w = im.shape[:2]
    target = min(w, max(1, round(h * aspect)))
    yield im
    if target < w * .85:
        # Crop descriptors support a portrait edit taken from a landscape source.
        # Full frame remains in the index for off-centre and difficult crops.
        yield im[:, (w-target)//2:(w+target)//2]


def feature_points(im, method="SIFT"):
    gray=cv2.cvtColor(trim_bars(im),cv2.COLOR_RGB2GRAY)
    low,high=np.percentile(gray,[5,95])
    # Recover retained detail through a dark grade or white wash. Never invent
    # texture in a flat/clipped image; all geometry and ambiguity gates remain.
    if 0<high-low<64:
        gray=np.clip((gray.astype(float)-low)*255/(high-low),0,255).astype(np.uint8)
    a=cv2.createCLAHE(clipLimit=2).apply(gray)
    detector = cv2.ORB_create(nfeatures=2400,fastThreshold=7,edgeThreshold=15) if method=="ORB" else cv2.SIFT_create(nfeatures=1600)
    keypoints,descriptors=detector.detectAndCompute(a,None)
    return a,keypoints,descriptors


def retrieval_image(im):
    # Very faint retained pixels can be structurally useful while a copy model
    # sees almost constant black. Stretch observed levels only for proposals;
    # geometry still verifies the untouched reference against the original.
    gray=cv2.cvtColor(im,cv2.COLOR_RGB2GRAY)
    low,high=np.percentile(gray,[5,95])
    if 0<high-low<=6:
        gray=np.clip((gray.astype(float)-low)*255/(high-low),0,255).astype(np.uint8)
        return cv2.cvtColor(gray,cv2.COLOR_GRAY2RGB)
    return im


def boundary_information(im):
    """Describe retained spatial detail; brightness alone is not visibility."""
    gray,points,descriptors=feature_points(im)
    coordinates=np.float32([p.pt for p in points])
    coverage=float(cv2.contourArea(cv2.convexHull(coordinates))/(gray.shape[0]*gray.shape[1])) if len(points)>=3 else 0.
    cells={(min(5,int(p.pt[0]*6/gray.shape[1])),min(5,int(p.pt[1]*6/gray.shape[0]))) for p in points}
    distributed=len(points)>=12 and coverage>=.12 and len(cells)>=6 and len({y for x,y in cells})>=2
    return dict(kind="DISTRIBUTED_VISIBLE_DETAIL" if distributed else "INSUFFICIENT_DISTRIBUTED_DETAIL",
                featureCount=len(points),featureCoverage=coverage,occupiedCells=len(cells),
                note="Text or overlays may remain; actual source correspondence, not brightness, establishes identity.")


def geometry(query_im, source_im, query_features=None, source_features=None):
    a,ka,da = query_features if query_features is not None else feature_points(query_im)
    b,kb,db = source_features if source_features is not None else feature_points(source_im)
    if da is None or db is None or len(da)<8 or len(db)<8:
        return dict(inliers=0, coverage=0., fraction=0., score=0.)
    binary=da.dtype==np.uint8 and db.dtype==np.uint8
    pairs = cv2.BFMatcher(cv2.NORM_HAMMING if binary else cv2.NORM_L2).knnMatch(da,db,k=2)
    good = [p[0] for p in pairs if len(p)==2 and p[0].distance < .72*p[1].distance]
    if len(good)<8:
        return dict(inliers=0, coverage=0., fraction=0., score=0.)
    pa = np.float32([ka[m.queryIdx].pt for m in good])
    pb = np.float32([kb[m.trainIdx].pt for m in good])
    matrix,mask = cv2.findHomography(pa,pb,cv2.RANSAC,3)
    if matrix is None or mask is None:
        return dict(inliers=0, coverage=0., fraction=0., score=0.)
    keep = mask.ravel().astype(bool)
    inliers = int(keep.sum())
    area = cv2.contourArea(cv2.convexHull(pa[keep])) if inliers>=3 else 0.
    coverage = float(area / (a.shape[0]*a.shape[1]))
    fraction = inliers / len(good)
    # A crop/resize/rotation must describe a finite, non-folding image map.
    # RANSAC alone can produce a degenerate map from repeated text/texture.
    corners=np.float32([[0,0],[a.shape[1],0],[a.shape[1],a.shape[0]],[0,a.shape[0]]])
    projected=cv2.perspectiveTransform(corners[None],matrix)[0]
    denominators=np.c_[corners,np.ones(4)]@matrix[2]
    if (not np.isfinite(projected).all() or np.any(np.abs(denominators)<1e-8)
            or np.any(denominators*denominators[0]<=0) or not cv2.isContourConvex(projected)
            or abs(cv2.contourArea(projected))<16):
        return dict(inliers=0,coverage=0.,fraction=0.,score=0.,reason="DEGENERATE_TRANSFORM")
    inverse=np.linalg.inv(matrix)
    warped = cv2.warpPerspective(b, inverse, (a.shape[1],a.shape[0]))
    mask = cv2.warpPerspective(np.ones(b.shape,np.uint8), np.linalg.inv(matrix), (a.shape[1],a.shape[0])) > 0
    va,vb = a[mask].astype(float),warped[mask].astype(float)
    correlation = float(np.corrcoef(va,vb)[0,1]) if len(va)>32 and va.std()>1 and vb.std()>1 else 0.
    if not math.isfinite(correlation):
        correlation=0.
    global_correlation=correlation
    regional=None
    # Captions, masks and composites contaminate whole-image correlation.
    # Test a fixed lattice, rather than hiding arbitrary disagreeing pixels.
    # Each witness is an independently textured, aligned pixel region. Require
    # broad spatial support and stronger keypoint evidence for partial copies.
    if correlation<.55 and inliers>=20 and coverage>=.2 and fraction>=.5:
        regions=[];support=np.zeros(a.shape,np.uint8)
        for row in range(6):
            for col in range(6):
                x0,x1=round(col*a.shape[1]/6),round((col+1)*a.shape[1]/6)
                y0,y1=round(row*a.shape[0]/6),round((row+1)*a.shape[0]/6)
                valid=mask[y0:y1,x0:x1]
                if valid.mean()<.95:continue
                left=a[y0:y1,x0:x1][valid].astype(float)
                right=warped[y0:y1,x0:x1][valid].astype(float)
                if len(left)<64 or left.std()<4 or right.std()<4:continue
                value=float(np.corrcoef(left,right)[0,1])
                if math.isfinite(value) and value>=.72:
                    regions.append(dict(rect=[x0,y0,x1,y1],correlation=value))
                    support[y0:y1,x0:x1]=valid
        supported=float(support.mean())
        rows={r['rect'][1] for r in regions};cols={r['rect'][0] for r in regions}
        regional=dict(supportedFraction=supported,regions=regions,
                      passed=supported>=.4 and len(regions)>=10 and len(rows)>=3 and len(cols)>=3)
        if regional['passed']:
            correlation=max(correlation,float(np.median([r['correlation'] for r in regions])))
    partial=global_correlation<.55 and bool(regional and regional['passed'])
    return dict(inliers=inliers, coverage=coverage, fraction=fraction,descriptorMethod="ORB" if binary else "SIFT",
                correlation=correlation, globalCorrelation=global_correlation,
                verificationMethod="DISTRIBUTED_VISIBLE_REGIONS" if partial else "ALIGNED_IMAGE",
                regionalEvidence=regional,
                transform=dict(queryToSource=matrix.tolist(),querySize=[a.shape[1],a.shape[0]],
                               sourceSize=[b.shape[1],b.shape[0]],coordinateSpace="TRIMMED_IMAGE_PIXELS"),
                score=float(min(inliers,80) * min(1.,coverage/.25) * fraction * max(0,correlation)**6
                            * (regional['supportedFraction'] if partial else 1)))


def valid_geometry(g):
    valid=g["inliers"] >= 12 and g["coverage"] >= .12 and g["fraction"] >= .5 and g.get("correlation",1) >= .55
    if g.get('descriptorMethod')=='ORB':
        valid=valid and g['inliers']>=24 and g['coverage']>=.2 and g['fraction']>=.6 and g.get('correlation',0)>=.65
    if g.get('verificationMethod')=='DISTRIBUTED_VISIBLE_REGIONS':
        return valid and g['inliers']>=20 and g['coverage']>=.2 and bool(g.get('regionalEvidence',{}).get('passed'))
    return valid


def aligned_gray(query, source, g, size=320):
    """Original decoded intensities in a measured map; no generated content."""
    transform=g.get('transform')
    if not transform:return None
    a=cv2.resize(trim_bars(query),tuple(transform['querySize']))
    b=cv2.resize(trim_bars(source),tuple(transform['sourceSize']))
    inverse=np.linalg.inv(np.array(transform['queryToSource']))
    aligned=cv2.warpPerspective(b,inverse,(a.shape[1],a.shape[0]))
    mask=cv2.warpPerspective(np.ones(b.shape[:2],np.uint8),inverse,(a.shape[1],a.shape[0]))
    def gray(im):
        value=cv2.cvtColor(im,cv2.COLOR_RGB2GRAY).astype(np.float32)
        low,high=np.percentile(value[mask>0],[5,95]) if np.any(mask) else (0,0)
        return np.clip((value-low)/max(1,high-low)*255,0,255).astype(np.float32)
    return (cv2.resize(gray(a),(size,size)),cv2.resize(gray(aligned),(size,size)),
            cv2.resize(mask,(size,size),interpolation=cv2.INTER_NEAREST)>0)


def pixel_change_witnesses(left, right, mask, gradients=False):
    """Fixed-grid, independent pixel checks, never a timestamp prediction.

    Gradients test spatial edge orientation without descriptor matching. Signed
    frame differences test actual changing pixels; static captions/backgrounds
    cannot pass the change-energy requirement. Keep every tile, including failures.
    """
    if gradients:
        def edge(im):
            im=cv2.GaussianBlur(im.astype(np.float32),(5,5),1)
            return np.stack([cv2.Sobel(im,cv2.CV_32F,1,0),cv2.Sobel(im,cv2.CV_32F,0,1)],axis=-1)
        left,right=edge(left),edge(right)
    tiles=[];supported=0
    for row in range(6):
        for col in range(6):
            x0,x1=round(col*mask.shape[1]/6),round((col+1)*mask.shape[1]/6)
            y0,y1=round(row*mask.shape[0]/6),round((row+1)*mask.shape[0]/6)
            keep=mask[y0:y1,x0:x1];a=left[y0:y1,x0:x1][keep].ravel();b=right[y0:y1,x0:x1][keep].ravel()
            value=0.;energy=False
            if keep.mean()>=.95 and len(a)>=64:
                a=a-a.mean();b=b-b.mean()
                energy=min(float(np.sqrt(np.mean(a*a))),float(np.sqrt(np.mean(b*b))))>=3
                if energy:value=float(a@b/max(1e-9,np.linalg.norm(a)*np.linalg.norm(b)))
            passed=energy and math.isfinite(value) and value>=.7
            tiles.append(dict(row=row,col=col,correlation=value,changedOrTextured=energy,passed=passed))
            if passed:supported+=int(keep.sum())
    witnesses=[t for t in tiles if t['passed']]
    return dict(method="SPATIAL_GRADIENTS" if gradients else "SIGNED_TEMPORAL_PIXELS",
                passed=len(witnesses)>=(8 if gradients else 4) and len({t['row'] for t in witnesses})>=(2 if gradients else 3)
                    and len({t['col'] for t in witnesses})>=(2 if gradients else 3) and supported/mask.size>=.1,
                supportedFraction=supported/mask.size,tiles=tiles)


def correspondence_picture(query, source, g, file):
    """Reviewable aligned pixels and distributed witnesses, never a cleaned image."""
    transform=g.get('transform')
    if not transform:return
    a=trim_bars(query);b=trim_bars(source)
    a=cv2.resize(a,tuple(transform['querySize']))
    b=cv2.resize(b,tuple(transform['sourceSize']))
    matrix=np.array(transform['queryToSource'])
    aligned=cv2.warpPerspective(b,np.linalg.inv(matrix),(a.shape[1],a.shape[0]))
    witnesses=a.copy()
    for region in (g.get('regionalEvidence') or {}).get('regions',[]):
        x0,y0,x1,y1=region['rect']
        cv2.rectangle(witnesses,(x0,y0),(x1-1,y1-1),(30,255,30),max(1,a.shape[1]//300))
    columns=[]
    for title,im in [('Reference + pixel witnesses',witnesses),('Original source aligned by measured map',aligned)]:
        scale=min(480/im.shape[1],560/im.shape[0]);im=cv2.resize(im,(round(im.shape[1]*scale),round(im.shape[0]*scale)))
        column=np.zeros((600,500,3),np.uint8)
        column[32:32+im.shape[0],:im.shape[1]]=im
        cv2.putText(column,title,(4,20),0,.45,(255,255,255),1)
        columns.append(column)
    cv2.imwrite(str(file),cv2.cvtColor(np.concatenate(columns,axis=1),cv2.COLOR_RGB2BGR))


def temporal_alignment(anchors, frame_seconds):
    if len(anchors)<3 or any(not valid_geometry(a["geometry"]) for a in anchors):
        return None
    x = np.array([a["referenceTime"] for a in anchors])
    y = np.array([a["sourceTime"] for a in anchors])
    if np.ptp(x)<1e-5:
        return None
    slope,offset = np.polyfit(x-x[0],y-y[0],1)
    residual = float(np.max(np.abs((x-x[0])*slope+offset-(y-y[0]))))
    delta = np.diff(y)
    if abs(slope)<.05 or abs(slope)>16:
        return None
    if (slope>0 and np.any(delta<0)) or (slope<0 and np.any(delta>0)):
        return None
    rates=np.abs(delta/np.diff(x))
    if np.any(rates>16) or np.ptp(y)<frame_seconds*2:
        return None
    # Quantized slow motion can repeat the same original frame. A wholly static
    # sequence does not establish traversal; repeated anchors may be surrounded
    # by measured motion. Do not fabricate interpolation within the plateau.
    moving=rates[rates>=.05]
    kind="AFFINE" if residual<=max(frame_seconds*1.5,.025) else "PIECEWISE"
    if kind=="PIECEWISE" and (len(moving)<2 or max(moving)/min(moving)>16):
        return None
    return dict(direction="FORWARD" if slope>0 else "REVERSE", playbackRate=abs(float(slope)), residualSeconds=residual,
                kind=kind,segments=[dict(referenceStart=float(x[i]),referenceEnd=float(x[i+1]),sourceStart=float(y[i]),sourceEnd=float(y[i+1]),playbackRate=float(rates[i])) for i in range(len(rates))])


def consistent_path(options, frame_seconds):
    """Bounded beam search for measured monotone paths, including speed ramps.

    An affine prediction must not prune the true intermediate frames of a ramp.
    The score favors observed image evidence, with rate/monotonicity constraints.
    All retained times are actual matched PTS, never interpolated endpoints.
    """
    if len(options)<3 or any(not choices for choices in options):
        return None
    best=None
    for direction in (1,-1):
        paths=[(a["geometry"]["score"],[a]) for a in options[0][:12] if valid_geometry(a["geometry"])]
        for choices in options[1:]:
            extensions=[]
            for score,path in paths:
                previous=path[-1]
                for a in choices[:12]:
                    dt=a["referenceTime"]-previous["referenceTime"]
                    dy=direction*(a["sourceTime"]-previous["sourceTime"])
                    if dt>0 and 0<=dy<=16*dt and valid_geometry(a["geometry"]):
                        extensions.append((score+a["geometry"]["score"],path+[a]))
            paths=sorted(extensions,key=lambda p:p[0],reverse=True)[:128]
            if not paths:
                break
        for score,path in paths:
            alignment=temporal_alignment(path,frame_seconds) if len(path)==len(options) else None
            if alignment:
                if best is None or score>best[0]:
                    best=(score,path,alignment)
    return None if best is None else (best[1],best[2])


def merge_windows(windows, gap=0):
    result=[]
    for start,end in sorted(windows):
        if result and start<=result[-1][1]+gap:
            result[-1]=(result[-1][0],max(end,result[-1][1]))
        else:
            result.append((start,end))
    return result


def uncovered_windows(windows, covered):
    """Subtract already decoded half-open intervals without widening new work."""
    result=[]
    for low,high in windows:
        pieces=[(low,high)]
        for a,b in covered:
            next_pieces=[]
            for x,y in pieces:
                if b<=x or a>=y:
                    next_pieces.append((x,y))
                else:
                    if x<a:next_pieces.append((x,a))
                    if b<y:next_pieces.append((b,y))
            pieces=next_pieces
        result.extend(pieces)
    return result


def endpoint_identity(options, chosen, frame_seconds):
    """Repeated/static frames must not masquerade as an exact endpoint.

    This is a local uncertainty check, not an exhaustive uniqueness guarantee.
    Comparable geometric evidence spanning more than two frame intervals leaves
    the endpoint unresolved even when the interior path identifies its location.
    """
    peers=[a for a in options if a["geometry"]["score"]>=chosen["geometry"]["score"]*.98]
    if not peers:
        return False
    return max(a["sourceTime"] for a in peers)-min(a["sourceTime"] for a in peers)<=frame_seconds*2+1e-6


def hypothesis_quality(hypothesis):
    anchors=hypothesis["anchors"]
    return sum(a["geometry"]["score"] for a in anchors)/max(1,len(anchors))


def strongest_hypothesis(hypotheses):
    # A weak complete-looking copy must not displace stronger interior evidence.
    # Normalize for anchor count before comparing locations; completeness only
    # breaks equal-quality ties, never adds visual evidence.
    return max(hypotheses,key=lambda h:(hypothesis_quality(h),h["complete"]))


def completion_of_location(best, hypotheses):
    """A faint but fully verified endpoint may complete its established location.

    Mean scores across different anchor counts must not let a retained bright
    interior defeat its own complete measured path. Require agreement at every
    retained frame; a weak copy elsewhere still cannot replace that location.
    """
    if best.get('complete'):
        return best
    compatible=[]
    for candidate in hypotheses:
        if not candidate.get('complete') or candidate.get('source')!=best.get('source'):
            continue
        if candidate.get('alignment',{}).get('direction')!=best.get('alignment',{}).get('direction'):
            continue
        shared={a.get('queryIndex'):a for a in candidate['anchors']}
        if best['anchors'] and all(a.get('queryIndex') is not None and a.get('sourcePts') is not None
             and shared.get(a['queryIndex'],{}).get('sourcePts')==a['sourcePts'] for a in best['anchors']):
            compatible.append(candidate)
    return strongest_hypothesis(compatible) if compatible else best


def retained_location_path(prior, anchor_options, query_indices, frame_seconds):
    """Recheck a complete path constrained to every established interior frame.

    Options are fresh, geometrically valid correspondences. A prior frame cannot
    be carried into completion if it fails the new check. Endpoint ambiguity is
    tested against the unrestricted options, never against a forced single frame.
    """
    fixed={a['queryIndex']:a['sourcePts'] for a in prior['anchors']}
    choices=[[a for a in anchor_options.get(n,[]) if n not in fixed or a['sourcePts']==fixed[n]] for n in query_indices]
    path=consistent_path(choices,frame_seconds)
    if not path:return None
    anchors,alignment=path
    if not max(anchors,key=lambda a:a['sourceTime'])['sourceFrameDurationVerified']:
        return None
    if any(not endpoint_identity(anchor_options.get(a['queryIndex'],[]),a,frame_seconds) for a in (anchors[0],anchors[-1])):
        return None
    return anchors,alignment


class Engine:
    def __init__(self, request, out, cache, encoder):
        self.request, self.out, self.cache, self.encoder = request, Path(out), Path(cache), encoder
        self.started = time.monotonic()
        self.budget = float(request.get("budgetSeconds",480))
        self.report = dict(schema="editflow.source-match-report.v1", engine=VERSION,engineSha256=ENGINE_SHA256,
                           editorialAuthority="CHATGPT_DIRECT", automaticSelection=False,
                           timestampConvention="seconds from video stream start; raw integer PTS retained; end exclusive",
                           backend=encoder.backend, device=encoder.device, shots=[], sources=[], warnings=[], stages=[],
                           alternativeReviewComplete=False,
                           boundaryAccuracy="Measured frame correspondences; no universal one-frame accuracy guarantee")
        self.out.mkdir(parents=True,exist_ok=True)
        self.cache.mkdir(parents=True,exist_ok=True)
        self.candidates = {}
        self.checked_windows = {}
        self.checked_intervals = {}
        self.accepted_hypotheses = {}
        self.query_features = {}
        self.orb_queries = {}
        self.refine_ids = None
        self.refine_windows = {}
        self.verification_size = 1280 if request.get("refinement") else 640
        self.metrics = dict(encodedImages=0,inferenceSeconds=0.,geometryComparisons=0,geometrySeconds=0.,
                            sparseVerificationFrames=0,denseVerificationFrames=0,
                            denseVerificationSeconds=0.,cacheDescriptors=0)

    def encode(self, images):
        self.check()
        self.metrics["encodedImages"]+=len(images)
        start=time.monotonic()
        try:
            return self.encoder.encode(images)
        finally:
            self.metrics["inferenceSeconds"]+=time.monotonic()-start

    def source_frames(self,file,start,end,interval=None):
        if self.encoder.device=="cuda":
            yield from gpu_samples(file,interval,self.check,start,end,size=self.verification_size)
        else:
            previous=-1e9
            for f in decode(file,start,end,size=self.verification_size,check=self.check):
                if interval is None or f["t"]-previous>=interval-1e-6:
                    previous=f["t"]
                    yield f

    def check(self):
        if time.monotonic()-self.started > self.budget or (self.out/"cancel").exists():
            raise BudgetExpired()

    def progress(self, stage, **values):
        event=dict(stage=stage, elapsedSeconds=round(time.monotonic()-self.started,3), **values)
        self.report["stages"].append(event)
        self.report["stages"]=self.report["stages"][-500:]
        print(json.dumps(event),flush=True)
        atomic_json(self.out/"progress.json",event)

    def reference(self):
        file=self.request["referencePath"]
        meta=probe(file)
        if meta["duration"]>300:
            raise ValueError("Reference must be at most five minutes")
        times, cuts, previous = [], [0], None
        threshold=float(self.request.get("cutThreshold",.48))
        for f in decode(file,size=256,check=self.check):
            times.append(f["t"])
            im=cv2.resize(trim_bars(f["image"]),(96,96))
            hist=cv2.calcHist([cv2.cvtColor(im,cv2.COLOR_RGB2HSV)],[0,1],None,[24,16],[0,180,0,256])
            cv2.normalize(hist,hist)
            if previous is not None:
                diff=cv2.compareHist(hist,previous,cv2.HISTCMP_BHATTACHARYYA)
                if diff>threshold and f["t"]-times[cuts[-1]]>=.12:
                    cuts.append(len(times)-1)
            previous=hist
        if not times:
            raise ValueError("Empty reference")
        spans=self.request.get("shots") or [dict(start=times[cuts[i]],end=times[cuts[i+1]] if i+1<len(cuts) else meta["duration"]) for i in range(len(cuts))]
        if len(spans)>200:
            raise ValueError("At most 200 reference shots")
        self.report["reference"]={**meta,"path":file,"fingerprint":fingerprint(file),"boundaries":"EXPLICIT" if self.request.get("shots") else "DETECTED_ADVISORY"}
        self.queries=[]
        selected=[]
        extra=[]
        for i,span in enumerate(spans):
            start,end=float(span["start"]),float(span["end"])
            if not 0<=start<end<=meta["duration"]+1e-3:
                raise ValueError("Invalid reference shot interval")
            indices=np.flatnonzero((np.array(times)>=start-1e-6)&(np.array(times)<end-1e-6))
            if len(indices)<3:
                self.report["shots"].append(dict(shotId=f"shot-{i+1:03}",referenceStart=start,referenceEnd=end,status="UNRESOLVED",reason="Too few reference frames"))
                continue
            anchors=np.unique(np.round(np.linspace(0,len(indices)-1,5)).astype(int))
            chosen=[times[indices[x]] for x in anchors]
            shot=dict(shotId=f"shot-{i+1:03}",referenceStart=start,referenceEnd=end,status="UNRESOLVED",reason="Not yet matched",anchors=[])
            self.report["shots"].append(shot)
            for t in chosen:
                selected.append((i,t))
            target_ids=self.request.get('refinement',{}).get('shotIds')
            if target_ids is None or shot['shotId'] in target_ids:
                reach=min(12,max(1,len(indices)//3))
                burst=set(np.round(np.linspace(1,reach,4)).astype(int))
                burst|={len(indices)-1-n for n in burst}
                for n in sorted(burst):
                    if 0<n<len(indices)-1 and times[indices[n]] not in chosen:
                        extra.append((i,times[indices[n]]))
        # Core indexes stay compatible with retained reports; per-shot traversal
        # sorts by time. Bursts never change the actual first/last reference PTS.
        ordered=selected+extra
        target={round(t,6) for i,t in ordered}
        decoded={}
        self.boundary_evidence={}
        for f in decode(file,size=self.verification_size,check=self.check):
            if round(f["t"],6) in target:
                decoded[round(f['t'],6)]=f
        self.queries=[dict(shot=i,frame=decoded[round(t,6)],information=boundary_information(decoded[round(t,6)]['image']),
                           samplingRole='CORE' if n<len(selected) else 'BOUNDARY_BURST')
                      for n,(i,t) in enumerate(ordered)]
        for i,shot in enumerate(self.report['shots']):
            qs=sorted([q['frame'] for q in self.queries if q['shot']==i],key=lambda f:f['t'])
            if qs:
                evidence=[]
                for label,f in [('first',qs[0]),('last',qs[-1])]:
                    file=self.out/f"{shot['shotId']}-boundary-{label}-reference.jpg"
                    cv2.imwrite(str(file),cv2.cvtColor(f['image'],cv2.COLOR_RGB2BGR))
                    evidence.append(dict(endpoint=label,referenceTime=f['t'],referencePts=f['pts'],referenceTimeBase=f['timeBase'],referenceEvidencePath=str(file),information=boundary_information(f['image'])))
                self.boundary_evidence[shot['shotId']]=evidence
                shot['boundaryEvidence']=evidence
        if not self.queries:
            raise ValueError("No usable reference queries")
        chroma=[np.abs(q["frame"]["image"][:,:,0].astype(float)-q["frame"]["image"][:,:,1]).mean()+np.abs(q["frame"]["image"][:,:,1].astype(float)-q["frame"]["image"][:,:,2]).mean() for q in self.queries]
        self.encoder.monochrome=float(np.median(chroma))<6
        self.report["descriptorColorPolicy"]="MONOCHROME_REFERENCE" if self.encoder.monochrome else "RGB"
        batches=[]
        for start in range(0,len(self.queries),32):
            self.check()
            batches.append(self.encode([retrieval_image(q["frame"]["image"]) for q in self.queries[start:start+32]]))
        self.qvectors=np.concatenate(batches)
        self.aspect=float(np.median([trim_bars(q["frame"]["image"]).shape[1]/trim_bars(q["frame"]["image"]).shape[0] for q in self.queries]))
        self.progress("REFERENCE_READY",shots=len(self.report["shots"]),queries=len(self.queries))

    def restore(self):
        """Continue a retained report in a new job; never relabel old evidence."""
        refinement=self.request.get("refinement")
        if not refinement:
            return
        retained=(self.out/"resume-report.json").read_bytes()
        old=json.loads(retained)
        digest=hashlib.sha256(retained).hexdigest()
        if digest!=refinement["reportSha256"]:
            raise ValueError("RETAINED_REPORT_CHANGED")
        if old.get("reference",{}).get("fingerprint")!=self.report["reference"]["fingerprint"] or [s.get("fingerprint") for s in old.get("sources",[])]!=[s["fingerprint"] for s in self.report["sources"]]:
            raise ValueError("REFINEMENT_INPUT_CHANGED")
        spans=lambda r:[(s["shotId"],s["referenceStart"],s["referenceEnd"]) for s in r["shots"]]
        if spans(old)!=spans(self.report):
            raise ValueError("REFINEMENT_BOUNDARIES_CHANGED")
        self.refine_ids=set(refinement["shotIds"])
        self.report["shots"]=old["shots"]
        self.report['originVerifications']=old.get('originVerifications',{})
        self.report["lineage"]=dict(parentJobId=refinement["parentJobId"],reportSha256=digest,refinedShotIds=refinement["shotIds"],retainedEvidence=True)
        for w in refinement["windows"]:
            self.refine_windows.setdefault(w["shotId"],[]).append(w)
        for i,s in enumerate(self.report["shots"]):
            if s["shotId"] not in self.refine_ids:
                continue
            s['boundaryEvidence']=self.boundary_evidence.get(s['shotId'],[])
            for a in s.get('anchors',[]):
                n=next((n for n,q in enumerate(self.queries) if q['shot']==i and abs(q['frame']['t']-a['referenceTime'])<1e-6),None)
                if n is None:raise ValueError('RETAINED_QUERY_MISSING')
                a['queryIndex']=n
            windows=self.refine_windows.get(s["shotId"],[])
            if not windows and s.get("sourcePath"):
                points=[a["sourceTime"] for a in s.get("anchors",[])]
                if points:
                    margin=max(1,(s["referenceEnd"]-s["referenceStart"])*2)
                    windows=[dict(shotId=s["shotId"],sourceIndex=s["sourceIndex"],start=max(0,min(points)-margin),end=min(self.report["sources"][s["sourceIndex"]]["duration"],max(points)+margin))]
                    self.refine_windows[s["shotId"]]=windows
            for n,q in enumerate(self.queries):
                if q["shot"]==i:
                    self.candidates[n]=[(1.,w["sourceIndex"],(w["start"]+w["end"])/2) for w in windows]
            if s.get("alignment") and len(s.get("anchors",[]))>=3:
                self.accepted_hypotheses[i]=[dict(source=s["sourceIndex"],score=sum(a["geometry"]["score"] for a in s["anchors"]),anchors=s["anchors"],alignment=s["alignment"],frames=[],complete=s["status"]=="VERIFIED")]
        self.progress("RETAINED_REPORT_READY",shots=len(self.refine_ids),verificationSize=self.verification_size)

    def search(self,vectors,times,source):
        scores=self.encoder.similarity(self.qvectors,vectors)
        for q,row in enumerate(scores):
            limit=min(8,len(row))
            inds=np.argpartition(row,len(row)-limit)[-limit:]
            inds=inds[np.argsort(row[inds])[::-1]]
            values=self.candidates.setdefault(q,[])+[(float(row[j]),source,float(times[j])) for j in inds]
            result=[]
            for value in sorted(values,reverse=True):
                if not any(value[1]==v[1] and abs(value[2]-v[2])<.4 for v in result):
                    result.append(value)
                if len(result)==12:
                    break
            self.candidates[q]=result

    def scan(self,source,mode):
        file=self.request["sourcePaths"][source]
        identity=fingerprint(file)
        key=hashlib.sha256(f"{INDEX_VERSION}|rgb-gray-v1|{identity}|{self.encoder.model_id}|{self.encoder.monochrome}|{self.aspect:.3f}|{mode}".encode()).hexdigest()
        root=self.cache/key
        root.mkdir(exist_ok=True)
        marker=root/"complete.json"
        chunks=sorted(p for p in root.glob("*.npz") if p.stem.isdigit())
        count=[]
        for p in chunks:
            self.check()
            with np.load(p,allow_pickle=False) as n:
                self.search(n["vectors"],n["times"],source)
                count.extend(n["times"].tolist())
        self.metrics["cacheDescriptors"]+=len(count)
        if marker.exists():
            self.progress("CACHE_SEARCH",source=source,mode=mode,descriptors=len(count))
            return
        # Committed partial chunks are searchable immediately. Continue after their
        # last actual timestamp, instead of spending the next job's budget rescanning.
        resume=max(count)+1e-5 if count else 0
        batch,bt=[],[]
        if mode=="keys":
            frames=decode(file,start=resume,keyframes=True,size=512,check=self.check)
        elif self.encoder.device=="cuda":
            frames=gpu_samples(file,float(mode),self.check,start=resume)
        else:
            interval=float(mode)
            def sampled():
                last=-1e9
                for f in decode(file,start=resume,size=512,check=self.check):
                    if f["t"]-last>=interval-1e-6:
                        last=f["t"]
                        yield f
            frames=sampled()
        # Query/search and decode are pipelined using a bounded queue.
        channel=queue.Queue(maxsize=16)
        stopped=threading.Event()
        def producer():
            try:
                for f in frames:
                    while not stopped.is_set():
                        try:
                            channel.put(f,timeout=.2)
                            break
                        except queue.Full:
                            self.check()
                    if stopped.is_set():
                        break
                channel.put(None,timeout=1)
            except Exception as e:
                while not stopped.is_set():
                    try:
                        channel.put(e,timeout=.2)
                        break
                    except queue.Full:
                        pass
            finally:
                frames.close()
        thread=threading.Thread(target=producer,daemon=True)
        thread.start()
        chunk=max((int(p.stem) for p in chunks),default=-1)+1
        def flush():
            nonlocal chunk
            if not batch:
                return
            self.check()
            vectors=self.encode(batch)
            self.search(vectors,np.array(bt),source)
            temp=root/f"{chunk:06}.tmp.npz"
            np.savez_compressed(temp,vectors=vectors,times=np.array(bt))
            os.replace(temp,root/f"{chunk:06}.npz")
            count.extend(bt)
            self.progress("SEARCHING",source=source,mode=mode,descriptors=len(count),throughSourceSeconds=bt[-1])
            chunk+=1
            batch.clear();bt.clear()
            # First locations can be tested before a complete source pass. One
            # attempt per shot limits disruption of the producer and avoids
            # spending the whole budget on the earliest difficult shot.
            if chunk % 16 == 0:
                self.verify(rounds=1,progressive=True)
        try:
            while True:
                self.check()
                try:
                    f=channel.get(timeout=.5)
                except queue.Empty:
                    continue
                if f is None:
                    break
                if isinstance(f,Exception):
                    raise f
                for im in variants(f["image"],self.aspect):
                    batch.append(im);bt.append(f["t"])
                if len(batch)>=32:
                    flush()
            flush()
            atomic_json(marker,dict(identity=identity,descriptors=len(count),chunks=chunk))
        finally:
            stopped.set()
            thread.join(timeout=12)

    def verify(self,rounds=None,progressive=False,prioritize_locations=False):
        # Round robin: each unlocated shot gets a candidate before alternatives.
        # Located shots have evidence already; denser passes prioritize misses.
        for round_index in range(rounds or int(self.request.get("candidateLimit",4))):
            self._verify_round(round_index,progressive,prioritize_locations)

    def _verify_round(self,round_index,progressive=False,prioritize_locations=False):
        for i,shot in enumerate(self.report["shots"]):
            if self.refine_ids is not None and shot["shotId"] not in self.refine_ids:
                continue
            # Weak early retrieval is often a different scene because the true
            # location has not been scanned yet. Defer it to the complete pass;
            # this affects scheduling only, never geometric acceptance.
            if (progressive or prioritize_locations) and shot["status"] in ["VERIFIED","LOCATED"]:
                continue
            qs=sorted([(n,q) for n,q in enumerate(self.queries) if q["shot"]==i],key=lambda nq:nq[1]['frame']['t'])
            if len(qs)<3:
                continue
            middle=qs[len(qs)//2][0]
            if self.queries[middle].get('information',{}).get('kind')=='INSUFFICIENT_DISTRIBUTED_DETAIL':
                visible=[n for n,q in qs if q.get('information',{}).get('kind')=='DISTRIBUTED_VISIBLE_DETAIL']
                if visible:middle=min(visible,key=lambda n:abs(n-middle))
            width=min(30,max(4,(shot["referenceEnd"]-shot["referenceStart"])*3))
            checked=self.checked_windows.setdefault(i,[])
            locations=[]
            # A black/text-heavy middle must not hide locations proposed by a
            # different visible moment. Round-robin query ranks retain diversity.
            proposals=[]
            query_order=[middle]+[n for n,q in qs if n!=middle]
            for rank in range(12):
                for n in query_order:
                    values=self.candidates.get(n,[])
                    if rank<len(values):proposals.append(values[rank])
            for candidate in proposals:
                if progressive and candidate[0]<.5:
                    continue
                _,source,t=candidate
                meta=self.report["sources"][source]
                explicit=next((w for w in self.refine_windows.get(shot["shotId"],[]) if w["sourceIndex"]==source and abs((w["start"]+w["end"])/2-t)<1e-6),None)
                low,high=(explicit["start"],explicit["end"]) if explicit else (max(0,t-width),min(meta["duration"],t+width))
                if any(source==s and low>=a-1e-6 and high<=b+1e-6 for s,a,b in self.checked_intervals.get(i,[])):
                    continue
                if any(source==s and abs(t-v)<=width*.5 for s,v in checked):
                    continue
                if any(source==s and abs(t-v)<=width*.5 for _,s,v in locations):
                    continue
                locations.append(candidate)
                if len(locations)>=1:
                    break
            if not locations:
                continue
            self.progress("VERIFYING_SHOT",shotId=shot["shotId"],candidates=len(locations))
            for n,q in qs:
                if n not in self.query_features:
                    self.query_features[n]=feature_points(q["frame"]["image"])
            qfeatures=self.query_features
            # A higher-resolution reference can change SIFT extrema under a
            # strong grade. Retain the original 640px comparison as well as the
            # detailed view; every scale still passes the same geometry gates.
            qvariants={}
            for n,q in qs:
                im=q['frame']['image'];qvariants[n]=[(im,qfeatures[n])]
                if max(im.shape[:2])>640:
                    small=resized(im,640)
                    if (n,640) not in qfeatures:qfeatures[(n,640)]=feature_points(small)
                    qvariants[n].append((small,qfeatures[(n,640)]))
            hypotheses=list(self.accepted_hypotheses.get(i,[]))
            for score,source,t in locations:
                self.check()
                meta=self.report["sources"][source]
                file=meta["path"]
                explicit=next((w for w in self.refine_windows.get(shot["shotId"],[]) if w["sourceIndex"]==source and abs((w["start"]+w["end"])/2-t)<1e-6),None)
                start,end=(explicit["start"],explicit["end"]) if explicit else (max(0,t-width),min(meta["duration"],t+width))
                self.progress("VERIFY_DECODE",shotId=shot["shotId"],candidateTime=t)
                samples=list(self.source_frames(file,start,end,interval=1/8))
                self.metrics["sparseVerificationFrames"]+=len(samples)
                if not samples:
                    continue
                # Locate anchors at 8fps, then decode consecutive frames only
                # around the best measured locations, not the full wide window.
                coarse,images=[],[]
                for f in samples:
                    for im in variants(f["image"],self.aspect):
                        coarse.append(f);images.append(im)
                # Bounded inference batches avoid allocating an entire long shot on GPU.
                self.progress("VERIFY_DESCRIPTORS",shotId=shot["shotId"],frames=len(images))
                cvectors=np.concatenate([self.encode(images[j:j+32]) for j in range(0,len(images),32)])
                neighborhoods={}
                for n,q in qs:
                    scores=self.encoder.similarity(self.qvectors[n],cvectors)
                    near_times=[]
                    for j in np.argsort(scores)[::-1]:
                        if all(abs(coarse[j]["t"]-v)>.1 for v in near_times):
                            near_times.append(coarse[j]["t"])
                        if len(near_times)==3:
                            break
                    neighborhoods[n]=near_times
                requested_windows=self.request.get("refinement",{}).get("windows",[])
                if explicit and any(w==explicit for w in requested_windows):
                    # A user/GPT-chosen short window can bypass poor embedding
                    # retrieval through strong grading/crops. Screen its actual
                    # sparse pixels geometrically, then refine only observed peaks.
                    self.progress("GEOMETRIC_WINDOW_SEARCH",shotId=shot["shotId"],frames=len(samples))
                    sparse_features={f["pts"]:feature_points(f["image"]) for f in samples}
                    for n,q in qs:
                        scored=[]
                        for f in samples:
                            self.check();began=time.monotonic()
                            g=geometry(q["frame"]["image"],f["image"],qfeatures[n],sparse_features[f["pts"]])
                            self.metrics["geometrySeconds"]+=time.monotonic()-began;self.metrics["geometryComparisons"]+=1
                            if valid_geometry(g):scored.append((g["score"],f["t"]))
                        peaks=[]
                        for _,value in sorted(scored,reverse=True):
                            if all(abs(value-t)>.1 for t in peaks):peaks.append(value)
                            if len(peaks)==3:break
                        neighborhoods[n]=peaks+[t for t in neighborhoods[n] if all(abs(t-p)>.1 for p in peaks)]
                frames=[]
                loaded=[]
                def load_dense(near_times):
                    nonlocal frames,loaded
                    windows=merge_windows([(max(0,t-.18),min(meta["duration"],t+.18+1/meta["fps"]))
                                           for t in near_times],gap=.25)
                    for low,high in uncovered_windows(windows,loaded):
                        dense=list(self.source_frames(file,low,high))
                        self.metrics["denseVerificationSeconds"]+=high-low
                        self.metrics["denseVerificationFrames"]+=len(dense)
                        for k in range(len(dense)-1):
                            dense[k]["duration"]=dense[k+1]["t"]-dense[k]["t"]
                            dense[k]["durationVerified"]=True
                        frames.extend(dense)
                    loaded=merge_windows(loaded+windows)
                    frames=sorted({f["pts"]:f for f in frames}.values(),key=lambda f:f["t"])
                # Reject a wrong middle before opening any endpoint decoders.
                load_dense(neighborhoods[middle])
                anchors=[]
                anchor_options={}
                sfeatures={}
                coarse_sources={}
                orb_sources={}
                def compare(n,f):
                    if f['pts'] not in sfeatures:sfeatures[f['pts']]=feature_points(f['image'])
                    checks=[geometry(im,f['image'],features,sfeatures[f['pts']]) for im,features in qvariants[n]]
                    if not any(valid_geometry(g) for g in checks) and max(f['image'].shape[:2])>640:
                        if f['pts'] not in coarse_sources:
                            small=resized(f['image'],640);coarse_sources[f['pts']]=(small,feature_points(small))
                        small,features=coarse_sources[f['pts']]
                        im,qf=qvariants[n][-1]
                        checks.append(geometry(im,small,qf,features))
                    if not any(valid_geometry(g) for g in checks):
                        if f['pts'] not in orb_sources:orb_sources[f['pts']]=feature_points(f['image'],'ORB')
                        for im,_ in qvariants[n]:
                            key=(n,im.shape[:2])
                            if key not in self.orb_queries:self.orb_queries[key]=feature_points(im,'ORB')
                            checks.append(geometry(im,f['image'],self.orb_queries[key],orb_sources[f['pts']]))
                    self.metrics['geometryComparisons']+=len(checks)
                    return max([g for g in checks if valid_geometry(g)] or checks,key=lambda g:g['score'])
                ordered_qs=sorted(qs,key=lambda nq:0 if nq[0]==middle else 1)
                for n,q in ordered_qs:
                    self.check()
                    if n!=middle and len(anchor_options)==1:
                        load_dense([t for key,near in neighborhoods.items() if key!=middle for t in near])
                    measured=sorted([a for a in anchors if valid_geometry(a['geometry'])],key=lambda a:a['referenceTime'])
                    traversal=temporal_alignment(measured,1/meta['fps'])
                    if traversal and traversal['kind']=='AFFINE':
                        # Existing pixel anchors can propose a narrow missing
                        # search window. The predicted time is never evidence:
                        # only an independently verified decoded frame enters
                        # anchor_options, with all ambiguity checks retained.
                        x=np.array([a['referenceTime'] for a in measured]);y=np.array([a['sourceTime'] for a in measured])
                        if x[0]-1<=q['frame']['t']<=x[-1]+1:
                            slope,offset=np.polyfit(x-x[0],y,1)
                            predicted=float((q['frame']['t']-x[0])*slope+offset)
                            if 0<=predicted<meta['duration'] and all(abs(predicted-t)>.1 for t in neighborhoods[n]):
                                neighborhoods[n].append(predicted);load_dense([predicted])
                    best=[]
                    for near in neighborhoods[n]:
                        for f in frames:
                            if abs(f["t"]-near)<=.18:
                                self.check()
                                if f["pts"] not in sfeatures:
                                    sfeatures[f["pts"]]=feature_points(f["image"])
                                geometry_started=time.monotonic()
                                g=compare(n,f)
                                self.metrics["geometrySeconds"]+=time.monotonic()-geometry_started
                                best.append((g["score"],f,g))
                    if not best:
                        break
                    best.sort(key=lambda a:a[0],reverse=True)
                    options=[];used=set()
                    for _,f,g in best:
                        if f["pts"] in used:
                            continue
                        used.add(f["pts"])
                        a=dict(referenceTime=q["frame"]["t"],sourceTime=f["t"],
                                        sourcePts=f["pts"],sourceTimeBase=f["timeBase"],sourceAbsoluteTime=f["absolute"],
                                        sourceFrameDuration=f["duration"],sourceFrameDurationVerified=f.get("durationVerified",False),geometry=g,queryIndex=n)
                        if valid_geometry(g):
                            options.append(a)
                    _,f,g=best[0]
                    anchors.append(dict(referenceTime=q["frame"]["t"],sourceTime=f["t"],
                                        sourcePts=f["pts"],sourceTimeBase=f["timeBase"],sourceAbsoluteTime=f["absolute"],
                                        sourceFrameDuration=f["duration"],sourceFrameDurationVerified=f.get("durationVerified",False),geometry=g,queryIndex=n))
                    anchor_options[n]=options
                    # Every accepted sequence requires this middle anchor; reject cheap first.
                    if n==middle and not options and self.refine_ids is None:
                        break
                measured=sorted([a for a in anchors if valid_geometry(a['geometry'])],key=lambda a:a['referenceTime'])
                traversal=temporal_alignment(measured,1/meta['fps'])
                if traversal and traversal['kind']=='AFFINE':
                    # A faint first endpoint may have been attempted before
                    # three useful interior moments existed. Revisit it now;
                    # no fitted timestamp becomes an accepted correspondence.
                    x=np.array([a['referenceTime'] for a in measured]);y=np.array([a['sourceTime'] for a in measured])
                    slope,offset=np.polyfit(x-x[0],y,1)
                    for n,q in (qs[0],qs[-1]):
                        if anchor_options.get(n) or not x[0]-1<=q['frame']['t']<=x[-1]+1:continue
                        predicted=float((q['frame']['t']-x[0])*slope+offset)
                        if not 0<=predicted<meta['duration']:continue
                        load_dense([predicted]);options=[]
                        for f in frames:
                            if abs(f['t']-predicted)>.18:continue
                            self.check()
                            if f['pts'] not in sfeatures:sfeatures[f['pts']]=feature_points(f['image'])
                            began=time.monotonic()
                            g=compare(n,f)
                            self.metrics['geometrySeconds']+=time.monotonic()-began
                            if valid_geometry(g):options.append(dict(referenceTime=q['frame']['t'],sourceTime=f['t'],sourcePts=f['pts'],sourceTimeBase=f['timeBase'],sourceAbsoluteTime=f['absolute'],sourceFrameDuration=f['duration'],sourceFrameDurationVerified=f.get('durationVerified',False),geometry=g,queryIndex=n))
                        if options:
                            options.sort(key=lambda a:a['geometry']['score'],reverse=True);anchor_options[n]=options
                            anchors=[a for a in anchors if a['queryIndex']!=n]+[options[0]]
                anchors.sort(key=lambda a:a["referenceTime"])
                alignment=temporal_alignment(anchors,1/meta["fps"])
                if len(anchor_options)==len(qs):
                    path=consistent_path([anchor_options[n] for n,q in qs],1/meta["fps"])
                    if path and (alignment is None or sum(a["geometry"]["score"] for a in path[0])>sum(a["geometry"]["score"] for a in anchors)):
                        anchors,alignment=path
                complete=alignment is not None and len(anchors)==len(qs)
                diagnostics=[]
                if complete:
                    high_endpoint=max(anchors,key=lambda a:a["sourceTime"])
                    uncertain={a["queryIndex"] for a in (anchors[0],anchors[-1])
                               if not endpoint_identity(anchor_options.get(a["queryIndex"],[]),a,1/meta["fps"])}
                    if not high_endpoint["sourceFrameDurationVerified"]:
                        uncertain.add(high_endpoint["queryIndex"])
                    if uncertain:
                        diagnostics=[dict(referenceTime=self.queries[n]["frame"]["t"],reason="AMBIGUOUS_FRAME_IDENTITY_OR_UNVERIFIED_DURATION") for n in sorted(uncertain)]
                        complete=False
                        # Keep only confirmed frame correspondences in LOCATED.
                        # The candidate checks retain ambiguous endpoint options.
                        anchors=[a for a in anchors if a["queryIndex"] not in uncertain]
                        for n in uncertain:anchor_options[n]=[]
                        alignment=temporal_alignment(anchors,1/meta["fps"])
                if alignment is None:
                    visible=[a for a in anchors if valid_geometry(a["geometry"])]
                    alignment=temporal_alignment(visible,1/meta["fps"])
                    if alignment:
                        anchors=visible
                    else:
                        # A rounded boundary may include a frame from the adjacent cut.
                        # Fit only contiguous interior/prefix/suffix anchors, never invent
                        # a full-shot endpoint from that subset.
                        interior=[]
                        for chosen in [qs[:-1],qs[1:],qs[1:-1]]:
                            choices=[anchor_options.get(n,[]) for n,q in chosen]
                            path=consistent_path(choices,1/meta["fps"])
                            if path:
                                interior.append(path)
                        if interior:
                            anchors,alignment=max(interior,key=lambda p:sum(a["geometry"]["score"] for a in p[0]))
                        elif self.refine_ids is not None:
                            # Requested difficult-shot refinement may inspect
                            # other anchors after a weak/occluded middle. At least
                            # three measured moments must still form a valid path.
                            visible_choices=[anchor_options[n] for n,q in qs if anchor_options.get(n)]
                            path=consistent_path(visible_choices,1/meta["fps"])
                            if path:anchors,alignment=path
                # An obscured interior sample does not erase directly measured
                # endpoints. At least three visible moments, both actual first/
                # last frames, monotone traversal and uniqueness remain required.
                if alignment and not complete and not diagnostics:
                    present={a['queryIndex'] for a in anchors}
                    if qs[0][0] in present and qs[-1][0] in present:
                        high_endpoint=max(anchors,key=lambda a:a['sourceTime'])
                        complete=(high_endpoint['sourceFrameDurationVerified']
                                  and all(endpoint_identity(anchor_options.get(a['queryIndex'],[]),a,1/meta['fps']) for a in (anchors[0],anchors[-1])))
                for n,q in (qs[0],qs[-1]):
                    if not any(a["queryIndex"]==n for a in anchors) or not valid_geometry(next((a["geometry"] for a in anchors if a["queryIndex"]==n),{})):
                        im=q["frame"]["image"]
                        information=boundary_information(im)
                        diagnostics.append(dict(referenceTime=q["frame"]["t"],reason="LOW_INFORMATION_REFERENCE_BOUNDARY" if information['kind']=='INSUFFICIENT_DISTRIBUTED_DETAIL' else "NO_CONFIRMED_ENDPOINT_CORRESPONDENCE",information=information))
                shot.setdefault("candidateChecks",[]).append(dict(sourceIndex=source,candidateTime=t,retrievalScore=None if explicit else score,
                    proposalOrigin="RETAINED_LOCATION_OR_GPT_WINDOW" if explicit else "SSCD_QUERY",
                    passed=alignment is not None,anchors=[{k:a[k] for k in ["referenceTime","sourceTime","geometry"]} for a in anchors]))
                shot["candidateChecks"]=shot["candidateChecks"][-12:]
                for prior in list(hypotheses):
                    if prior.get('complete') or prior['source']!=source:continue
                    constrained=retained_location_path(prior,anchor_options,[n for n,q in qs],1/meta['fps'])
                    if not constrained:continue
                    fixed_anchors,fixed_alignment=constrained
                    hypotheses.append(dict(source=source,score=sum(a['geometry']['score'] for a in fixed_anchors),
                        anchors=fixed_anchors,alignment=fixed_alignment,frames=frames,complete=True,diagnostics=[]))
                    shot['candidateChecks'].append(dict(sourceIndex=source,candidateTime=t,retrievalScore=None,
                        proposalOrigin='RETAINED_FRAME_CONSTRAINT_WITH_FRESH_PIXEL_RECHECK',passed=True,
                        anchors=[{k:a[k] for k in ['referenceTime','sourceTime','sourcePts','geometry']} for a in fixed_anchors]))
                    shot['candidateChecks']=shot['candidateChecks'][-12:]
                checked.append((source,t))
                self.checked_intervals.setdefault(i,[]).append((source,start,end))
                if alignment:
                    hypotheses.append(dict(source=source,score=sum(a["geometry"]["score"] for a in anchors),anchors=anchors,alignment=alignment,frames=frames,complete=complete,diagnostics=diagnostics))
                    # Denser sampling must not let tie-breaking hide a repeated
                    # copy inside the same decoded window. Re-test a measured
                    # alternative path that disagrees by >1 s at shared moments.
                    chosen={a['queryIndex']:a for a in anchors}
                    alternatives=[]
                    for n,q in qs:
                        if n not in chosen:continue
                        values=[a for a in anchor_options.get(n,[]) if abs(a['sourceTime']-chosen[n]['sourceTime'])>1]
                        if values:alternatives.append(values)
                    competing=consistent_path(alternatives,1/meta['fps']) if len(alternatives)>=3 else None
                    if competing:
                        other,other_alignment=competing
                        hypotheses.append(dict(source=source,score=sum(a['geometry']['score'] for a in other),anchors=other,alignment=other_alignment,frames=frames,complete=False,diagnostics=[]))
                        shot['candidateChecks'].append(dict(sourceIndex=source,candidateTime=t,proposalOrigin='INDEPENDENT_REPEATED_COPY_PATH',passed=True,
                            anchors=[{k:a[k] for k in ['referenceTime','sourceTime','sourcePts','geometry']} for a in other]))
            # Preserve competing valid locations through later rounds and passes.
            # A later single proposal must not erase an already proven ambiguity.
            self.accepted_hypotheses[i]=[{**h,"frames":[]} for h in hypotheses]
            if not hypotheses:
                if shot["status"]!="LOCATED":
                    shot["reason"]="No geometrically and temporally consistent candidate"
                self.save()
                continue
            strongest=strongest_hypothesis(hypotheses)
            best=completion_of_location(strongest,hypotheses)
            location_quality=max(hypothesis_quality(best),hypothesis_quality(strongest))
            def different_location(other):
                if other["source"]!=best["source"]:
                    return True
                shared=[abs(a["sourceTime"]-b["sourceTime"]) for a in best["anchors"] for b in other["anchors"] if abs(a["referenceTime"]-b["referenceTime"])<1e-5]
                return not shared or float(np.median(shared))>1
            different=[h for h in hypotheses if h is not best and different_location(h)]
            if shot["status"]=="LOCATED":
                previous=dict(source=shot["sourceIndex"],anchors=shot["anchors"],score=sum(a["geometry"]["score"] for a in shot["anchors"]))
                if different_location(previous):
                    different.append(previous)
            if any(hypothesis_quality(h)>=location_quality*.85 for h in different):
                for key in ["sourcePath","sourceIndex","sourceStart","sourceEndExclusive","sourceStartTimecode","sourceEndTimecode","sourceStartPts","sourceEndPtsExclusive","sourceTimeBase","sourceLocationWindow","alignment","boundaryStatus"]:
                    shot.pop(key,None)
                shot["status"]="UNRESOLVED";shot["anchors"]=[]
                shot["reason"]="Ambiguous repeated source footage"
                self.save()
                continue
            anchors=best["anchors"]
            # Range uses real matched endpoint frame timestamps, never a fitted boundary.
            endpoints=[anchors[0],anchors[-1]]
            low=min(endpoints,key=lambda a:a["sourceTime"])
            high=max(endpoints,key=lambda a:a["sourceTime"])
            shot.update(status="VERIFIED" if best["complete"] else "LOCATED",reason="Geometry and temporal checks passed; GPT visual acceptance still required" if best["complete"] else "Source location confirmed by multiple frames; one or both endpoints could not be confirmed",
                        sourcePath=self.report["sources"][best["source"]]["path"],sourceIndex=best["source"],
                        alignment=best["alignment"],anchors=anchors,requiresVisualReview=True,
                        exactBoundaryGuaranteed=False)
            shot["boundaryDiagnostics"]=best.get("diagnostics",[])
            if not best["complete"] and not shot["boundaryDiagnostics"]:
                for n,q in (qs[0],qs[-1]):
                    if not any(a["queryIndex"]==n for a in anchors):
                        information=boundary_information(q['frame']['image'])
                        shot["boundaryDiagnostics"].append(dict(referenceTime=q["frame"]["t"],reason="LOW_INFORMATION_REFERENCE_BOUNDARY" if information['kind']=='INSUFFICIENT_DISTRIBUTED_DETAIL' else "NO_CONFIRMED_ENDPOINT_CORRESPONDENCE",information=information))
            if best["complete"]:
                shot.pop("sourceLocationWindow",None)
                shot.update(sourceStart=low["sourceTime"],sourceEndExclusive=high["sourceTime"]+high["sourceFrameDuration"],boundaryStatus="MEASURED_ENDPOINT_CORRESPONDENCES")
                shot["sourceStartTimecode"]=timecode(shot["sourceStart"])
                shot["sourceEndTimecode"]=timecode(shot["sourceEndExclusive"])
                shot.update(sourceStartPts=low['sourcePts'],sourceEndPtsExclusive=high['sourcePts']+round(high['sourceFrameDuration']/float(Fraction(high['sourceTimeBase']))),sourceTimeBase=low['sourceTimeBase'])
            else:
                for key in ["sourceStart","sourceEndExclusive","sourceStartTimecode","sourceEndTimecode","sourceStartPts","sourceEndPtsExclusive","sourceTimeBase"]:
                    shot.pop(key,None)
                shot.update(boundaryStatus="UNRESOLVED",sourceLocationWindow=dict(start=low["sourceTime"],end=high["sourceTime"]+high["sourceFrameDuration"],description="Span of confirmed interior frames, not full-shot source in/out"))
            for k,a in enumerate(anchors):
                if a.get("referenceEvidencePath") and a.get("sourceEvidencePath"):
                    continue
                q=self.queries[a["queryIndex"]]["frame"]
                source=[f for f in best["frames"] if f["pts"]==a["sourcePts"]]
                if not source:
                    source=list(self.source_frames(shot["sourcePath"],max(0,a["sourceTime"]-.000001),a["sourceTime"]+.001))
                if source:
                    # Evidence for a competing hypothesis must not overwrite an
                    # earlier hypothesis's pixels while its PTS stays retained.
                    refpath=self.out/f"{shot['shotId']}-query-{a['queryIndex']}-reference.jpg"
                    srcpath=self.out/f"{shot['shotId']}-query-{a['queryIndex']}-source-{best['source']}-pts-{a['sourcePts']}.jpg"
                    cv2.imwrite(str(refpath),cv2.cvtColor(q["image"],cv2.COLOR_RGB2BGR))
                    cv2.imwrite(str(srcpath),cv2.cvtColor(source[0]["image"],cv2.COLOR_RGB2BGR))
                    a.update(referenceEvidencePath=str(refpath),sourceEvidencePath=str(srcpath))
                    if a['geometry'].get('transform'):
                        proof=self.out/f"{shot['shotId']}-query-{a['queryIndex']}-source-{best['source']}-pts-{a['sourcePts']}-correspondence.jpg"
                        correspondence_picture(q['image'],source[0]['image'],a['geometry'],proof)
                        a['correspondenceEvidencePath']=str(proof)
            self.progress("MATCH_EVIDENCE",shotId=shot["shotId"],status=shot["status"],sourceStart=shot.get("sourceStart"),sourceEndExclusive=shot.get("sourceEndExclusive"))
            self.save()

    def origin_checks(self):
        """Corroborate movie-section origin independently of hidden trim pixels.

        Fresh descriptors, spatial gradients and changing pixels are separate
        evidence channels. No result here fills an unobserved source endpoint.
        Store separately so preserved shot/trim objects are never relabeled.
        """
        results=self.report.setdefault('originVerifications',{})
        for i,shot in enumerate(self.report['shots']):
            self.check()
            if self.refine_ids is not None and shot['shotId'] not in self.refine_ids and shot['shotId'] in results:continue
            if shot['status']=='UNRESOLVED':
                results[shot['shotId']]=dict(status='UNCONFIRMED',reason=shot.get('reason'));continue
            self.progress('INDEPENDENT_ORIGIN_CHECK',shotId=shot['shotId'])
            anchors=sorted(shot.get('anchors',[]),key=lambda a:a['referenceTime'])
            anchors=[anchors[n] for n in np.unique(np.round(np.linspace(0,len(anchors)-1,min(9,len(anchors)))).astype(int))] if anchors else []
            if len(anchors)<3:continue
            times=[a['sourceTime'] for a in anchors];pts={a['sourcePts'] for a in anchors}
            # Neighboring original frames are controls for direct GPT review,
            # not alternative timestamps to fill an invisible endpoint.
            review_anchors=[anchors[n] for n in np.unique(np.round(np.linspace(0,len(anchors)-1,3)).astype(int))]
            frame_seconds=1/self.report['sources'][shot['sourceIndex']]['fps']
            nearby={};frames={}
            for f in self.source_frames(shot['sourcePath'],max(0,min(times)-2.5*frame_seconds),max(times)+2.5*frame_seconds):
                if f['pts'] in pts:frames[f['pts']]=f
                for a in review_anchors:
                    for side,direction in [('earlier',-1),('later',1)]:
                        distance=abs(f['t']-(a['sourceTime']+direction*2*frame_seconds))
                        key=(a['sourcePts'],side)
                        if distance<frame_seconds*.6 and (key not in nearby or distance<nearby[key][0]):
                            nearby[key]=(distance,f)
            measured=[];paired=[]
            for a in anchors:
                self.check()
                query=next((q['frame'] for q in self.queries if q['shot']==i and abs(q['frame']['t']-a['referenceTime'])<1e-6),None)
                if query is None:
                    query=next(decode(self.report['reference']['path'],max(0,a['referenceTime']-1e-6),a['referenceTime']+.001,size=self.verification_size,check=self.check),None)
                source=frames.get(a['sourcePts'])
                if query is None or source is None:continue
                q=query['image'];s=source['image'];sf=feature_points(s)
                checks=[geometry(im,s,source_features=sf) for im in (q,resized(q,640))]
                if not any(valid_geometry(g) for g in checks) and max(s.shape[:2])>640:
                    checks.append(geometry(resized(q,640),resized(s,640)))
                if not any(valid_geometry(g) for g in checks):checks.append(geometry(q,s,feature_points(q,'ORB'),feature_points(s,'ORB')))
                good=[g for g in checks if valid_geometry(g)]
                if not good:continue
                g=max(good,key=lambda g:g['score']);images=aligned_gray(q,s,g)
                if images is None:continue
                edge=pixel_change_witnesses(*images,gradients=True)
                picture=self.out/f"{shot['shotId']}-origin-{source['pts']}.jpg"
                correspondence_picture(q,s,g,picture)
                item=dict(referenceTime=query['t'],referencePts=query['pts'],referenceTimeBase=query['timeBase'],sourceTime=source['t'],sourcePts=source['pts'],sourceTimeBase=source['timeBase'],geometry=g,gradientEvidence=edge,
                          referenceEvidencePath=a.get('referenceEvidencePath'),sourceEvidencePath=a.get('sourceEvidencePath'),correspondenceEvidencePath=str(picture))
                controls=[]
                for side in ['earlier','later']:
                    other=nearby.get((source['pts'],side))
                    if other is None:continue
                    other=other[1];file=self.out/f"{shot['shotId']}-review-control-pts-{other['pts']}.jpg"
                    cv2.imwrite(str(file),cv2.cvtColor(other['image'],cv2.COLOR_RGB2BGR))
                    controls.append(dict(role='NEARBY_ORIGINAL_FRAME_CONTROL',side=side,sourceTime=other['t'],sourcePts=other['pts'],sourceTimeBase=other['timeBase'],sourceEvidencePath=str(file)))
                item['nearbySourceFrames']=controls
                measured.append(item);paired.append((item,images))
            changes=[]
            for (a,(qa,sa,ma)),(b,(qb,sb,mb)) in zip(paired,paired[1:]):
                if a['sourcePts']==b['sourcePts']:continue
                evidence=pixel_change_witnesses(qb-qa,sb-sa,ma&mb)
                changes.append(dict(referenceStart=a['referenceTime'],referenceEnd=b['referenceTime'],sourceStartPts=a['sourcePts'],sourceEndPts=b['sourcePts'],evidence=evidence))
            geometric=len(measured)>=3 and temporal_alignment(measured,1/self.report['sources'][shot['sourceIndex']]['fps']) is not None
            gradients=sum(a['gradientEvidence']['passed'] for a in measured)
            motion=sum(a['evidence']['passed'] for a in changes)
            complete=self.report['alternativeReviewComplete']
            status='CONFIRMED' if geometric and gradients>=3 and motion>=1 and complete else 'MEASURED_LOCATION' if geometric and complete else 'INSUFFICIENT_INDEPENDENT_EVIDENCE'
            results[shot['shotId']]=dict(status=status,scope='MOVIE_SECTION_ORIGIN_ONLY',methods=['FRESH_GEOMETRIC_SEQUENCE','SPATIAL_GRADIENTS','SIGNED_TEMPORAL_PIXELS'],evidencePath=str(self.out/(shot['shotId']+'-origin-evidence.json')),
                independentFrameCount=len(measured),gradientPassCount=gradients,temporalChangePassCount=motion,competingLocationReviewComplete=complete,
                referenceCoverage=dict(start=min(a['referenceTime'] for a in measured),end=max(a['referenceTime'] for a in measured)) if measured else None,
                measuredSourceSection=dict(start=min(a['sourceTime'] for a in measured),end=max(a['sourceTime'] for a in measured),description='Observed corresponding section, not hidden trim extrapolation') if measured else None,
                exactTrimStatus=shot['boundaryStatus'],frames=measured,temporalChanges=changes)
            atomic_json(self.out/(shot['shotId']+'-origin-evidence.json'),results[shot['shotId']])
            self.save()

    def save(self):
        self.report["elapsedSeconds"]=round(time.monotonic()-self.started,3)
        self.report["metrics"]=self.metrics
        self.report["summary"]={state:sum(s["status"]==state for s in self.report["shots"]) for state in ["VERIFIED","LOCATED","UNRESOLVED"]}
        origins=self.report.get('originVerifications',{})
        self.report['originSummary']={state:sum(origins.get(s['shotId'],{}).get('status','NOT_CHECKED')==state for s in self.report['shots'])
            for state in ['CONFIRMED','MEASURED_LOCATION','INSUFFICIENT_INDEPENDENT_EVIDENCE','UNCONFIRMED','NOT_CHECKED']}
        atomic_json(self.out/"report.json",self.report)
        timestamps_csv(self.out,self.report)

    def contact_sheets(self):
        rows=[]
        for shot in self.report["shots"]:
            anchors=shot.get("anchors",[])
            if not anchors:
                continue
            anchor=anchors[len(anchors)//2]
            if not anchor.get("sourceEvidencePath"):
                continue
            row=np.full((210,800,3),28,np.uint8)
            for col,key in enumerate(["referenceEvidencePath","sourceEvidencePath"]):
                im=cv2.imread(anchor[key])
                if im is None:
                    continue
                h,w=im.shape[:2];scale=min(390/w,170/h)
                im=cv2.resize(im,(round(w*scale),round(h*scale)))
                y=30+(170-im.shape[0])//2;x=col*400+(400-im.shape[1])//2
                row[y:y+im.shape[0],x:x+im.shape[1]]=im
                label=f"{shot['shotId']}  {'ref' if col==0 else 'source'}  {timecode(anchor['referenceTime'] if col==0 else anchor['sourceTime'])}"
                cv2.putText(row,label,(col*400+8,21),cv2.FONT_HERSHEY_SIMPLEX,.45,(240,240,240),1,cv2.LINE_AA)
            rows.append(row)
        paths=[]
        for start in range(0,len(rows),8):
            p=self.out/f"evidence-contact-sheet-{start//8+1}.jpg"
            cv2.imwrite(str(p),np.vstack(rows[start:start+8]));paths.append(str(p))
        self.report["contactSheetPaths"]=paths

    def visual_reasoning_packet(self):
        """Issue original decoded evidence, without fabricating a GPT verdict.

        A montage is a navigation aid. Full individual images and measured maps
        remain available for fine landmarks and frame-level alternatives.
        """
        packets={}
        for i,shot in enumerate(self.report['shots']):
            origin=self.report.get('originVerifications',{}).get(shot['shotId'],{})
            frames=origin.get('frames') or shot.get('anchors',[])
            frames=sorted(frames,key=lambda a:a['referenceTime'])
            selected=[frames[n] for n in np.unique(np.round(np.linspace(0,len(frames)-1,min(3,len(frames)))).astype(int))] if frames else []
            evidence=[];rows=[]
            for n,a in enumerate(selected):
                evidence_id=f"{shot['shotId']}:pair:{n+1}"
                evidence.append({**a,'evidenceId':evidence_id,'role':'OBSERVED_FRAME_PAIR',
                    'nearbySourceFrames':[{**c,'evidenceId':evidence_id+':'+c['side']} for c in a.get('nearbySourceFrames',[])]})
                row=np.full((540,1240,3),24,np.uint8)
                for col,key in enumerate(['referenceEvidencePath','sourceEvidencePath']):
                    file=a.get(key);im=cv2.imread(file) if file else None
                    if im is None:continue
                    w=440 if col==0 else 760;x0=0 if col==0 else 460
                    scale=min(w/im.shape[1],485/im.shape[0]);im=cv2.resize(im,(round(im.shape[1]*scale),round(im.shape[0]*scale)))
                    x=x0+(w-im.shape[1])//2;y=48+(485-im.shape[0])//2
                    row[y:y+im.shape[0],x:x+im.shape[1]]=im
                    stamp=a['referenceTime'] if col==0 else a['sourceTime']
                    label=f"{evidence_id} {'EDIT' if col==0 else 'ORIGINAL MOVIE'} {stamp:.6f}s"
                    cv2.putText(row,label,(x0+6,25),0,.46,(240,240,240),1,cv2.LINE_AA)
                rows.append(row)
            sheet=None
            if rows:
                sheet=str(self.out/(shot['shotId']+'-visual-reasoning.jpg'))
                cv2.imwrite(sheet,np.vstack(rows))
            # Known competing measured hypotheses are exposed rather than hidden
            # behind the winning retrieval score. Missing images stay explicit.
            alternatives=[];seen=set()
            for h in self.accepted_hypotheses.get(i,[]):
                aa=h.get('anchors',[])
                if not aa:continue
                a=aa[len(aa)//2];identity=(h['source'],a['sourcePts'])
                if identity in seen:continue
                seen.add(identity)
                if h['source']==shot.get('sourceIndex') and any(x['sourcePts']==a['sourcePts'] for x in frames):continue
                alternatives.append(dict(sourceIndex=h['source'],sourcePath=self.report['sources'][h['source']]['path'],referenceTime=a['referenceTime'],sourceTime=a['sourceTime'],sourcePts=a['sourcePts'],sourceTimeBase=a['sourceTimeBase'],
                    referenceEvidencePath=a.get('referenceEvidencePath'),sourceEvidencePath=a.get('sourceEvidencePath'),geometry=a['geometry'],imageReviewAvailable=bool(a.get('sourceEvidencePath'))))
                if len(alternatives)>=4:break
            packet=dict(schema='editflow.source-match-visual-reasoning.v1',shotId=shot['shotId'],authority='CHATGPT_DIRECT',reviewStatus='AWAITING_DIRECT_IMAGE_REVIEW',
                scope='SHOT_ORIGIN_AND_OBSERVABLE_BOUNDARIES',exactTrimStatus=shot.get('boundaryStatus','UNRESOLVED'),machineStatus=shot['status'],originMeasurementStatus=origin.get('status','NOT_CHECKED'),
                referencePath=self.report['reference']['path'],sourcePath=shot.get('sourcePath'),contactSheetPath=sheet,framePairs=evidence,
                boundaries=[{**b,'evidenceId':shot['shotId']+':boundary:'+b['endpoint']} for b in shot.get('boundaryEvidence',[])],competingHypotheses=alternatives,competingLocationMeasurementComplete=self.report['alternativeReviewComplete'],
                imagePolicy='Read actual edit and original movie images; use aligned views only as labeled measured transforms. Do not inpaint, generate missing detail, or treat a montage as full-resolution endpoint proof.',
                reviewRequest='Compare the actual images before reading scores. Describe matching pose, landmark arrangement, background geometry and motion at multiple moments. Explain crop, borders, captions, grading, overlays or composites using visible evidence and the measured map. Inspect nearby original-frame controls and competing locations; name contradictions and what evidence would resolve them. Distinguish same movie section from the exact source frame. Return a concise evidence-grounded justification, never a similarity-only guess or an invented hidden frame.',
                requiredReviewFields=['originDecision: SAME_SHOT | DIFFERENT_SHOT | INSUFFICIENT_EVIDENCE','inspectedEvidenceIds','correspondences: evidenceId, region, observation','alterations: type, affectedRegion, evidenceId, explanation','motionObservations','alternativeChecks','contradictions','boundaryDecisions: first/last, OBSERVED | NOT_OBSERVABLE | AMBIGUOUS, evidenceId, original sourcePts only if observed','nextEvidenceRequests'],
                reviewPath=str(self.out/(shot['shotId']+'-visual-reasoning.json')))
            atomic_json(packet['reviewPath'],packet);packets[shot['shotId']]=dict(reviewPath=packet['reviewPath'],contactSheetPath=sheet,reviewStatus=packet['reviewStatus'],framePairCount=len(evidence),scope=packet['scope'])
        self.report['visualReasoningPackets']=packets

    def run(self):
        try:
            self.reference()
            self.report["sources"]=[dict(path=p,fingerprint=fingerprint(p),**probe(p)) for p in self.request["sourcePaths"]]
            self.restore()
            needs_global=self.refine_ids is None or any(s["shotId"] in self.refine_ids and s["shotId"] not in self.refine_windows for s in self.report["shots"])
            for mode in (["keys", "0.5", "0.125"] if needs_global else []):
                self.progress("PASS_STARTED",mode=mode)
                for source in range(len(self.report["sources"])):
                    self.scan(source,mode)
                self.verify(prioritize_locations=True)
                if all(s["status"] in ["VERIFIED","LOCATED"] for s in self.report["shots"]):
                    break
            # Give missing shots the denser source passes before spending extra
            # verification time on known locations. Completion still requires
            # the requested bounded competing-location review.
            self.progress("ALTERNATIVE_REVIEW")
            self.verify()
            self.report["alternativeReviewComplete"]=True
            self.origin_checks()
            self.report["status"]="COMPLETE" if all(s["status"]=="VERIFIED" for s in self.report["shots"]) else "PARTIAL"
        except BudgetExpired:
            self.report["status"]="CANCELLED" if (self.out/"cancel").exists() else "PARTIAL"
            self.report["warnings"].append("Budget/cancellation stopped further search; unresolved shots have no asserted source timestamps")
        except Exception as e:
            self.report["status"]="FAILED"
            self.report["warnings"].append(str(e))
            raise
        finally:
            self.contact_sheets()
            self.visual_reasoning_packet()
            self.save()
        self.progress("FINISHED",status=self.report["status"],verified=sum(s["status"]=="VERIFIED" for s in self.report["shots"]),total=len(self.report["shots"]))
        return self.report


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--request",required=True)
    parser.add_argument("--output",required=True)
    parser.add_argument("--cache",required=True)
    parser.add_argument("--model")
    parser.add_argument("--backend",choices=["sscd","diagnostic"],default="sscd")
    parser.add_argument("--device",default="auto",choices=["auto","cpu","cuda"])
    args=parser.parse_args()
    request=json.loads(Path(args.request).read_text(encoding="utf-8-sig"))
    if not request.get("sourcePaths") or len(request["sourcePaths"])>8:
        raise ValueError("Supply one through eight source paths")
    if not 10<=float(request.get("budgetSeconds",480))<=3600:
        raise ValueError("budgetSeconds must be between 10 and 3600")
    cv2.setNumThreads(2)
    engine=Engine(request,args.output,args.cache,Encoder(args.backend,args.model,args.device))
    engine.run()


if __name__=="__main__":
    main()
