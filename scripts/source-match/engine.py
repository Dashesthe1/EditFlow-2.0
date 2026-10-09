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

VERSION = "source-match-v1.0.0"


class BudgetExpired(Exception):
    pass


def atomic_json(file, value):
    file = Path(file)
    file.parent.mkdir(parents=True, exist_ok=True)
    temp = file.with_suffix(file.suffix + ".tmp")
    temp.write_text(json.dumps(value, indent=2, allow_nan=False), encoding="utf-8")
    os.replace(temp, file)


def timecode(seconds):
    ms=round(seconds*1000)
    hours,ms=divmod(ms,3600000);minutes,ms=divmod(ms,60000);seconds,ms=divmod(ms,1000)
    return f"{hours:02}:{minutes:02}:{seconds:02}.{ms:03}"


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
                       image=resized(f.to_ndarray(format="rgb24"), size))


def gpu_samples(file, interval, check, start=0, end=None, size=512):
    """GPU downscale before readback. select/showinfo preserve actual frame PTS."""
    import imageio_ffmpeg
    ff = os.environ.get("EDITFLOW_SOURCE_MATCH_FFMPEG") or imageio_ffmpeg.get_ffmpeg_exe()
    meta=probe(file)
    width=size; height=max(2,round(meta["height"]*size/meta["width"]/2)*2)
    selection=f"select='isnan(prev_selected_t)+gte(t-prev_selected_t,{interval})'," if interval else ""
    vf = f"scale_cuda={width}:{height}:format=nv12,hwdownload,format=nv12,format=rgb24,"+selection+"showinfo"
    cmd = [ff, "-nostdin", "-hide_banner", "-loglevel", "info", "-copyts",
           "-hwaccel", "cuda", "-hwaccel_output_format", "cuda",
           *(["-ss",str(start)] if start else []), *(["-t",str(end-start)] if end else []), "-i", str(file),
           "-map", "0:v:0", "-an", "-sn", "-vf", vf, "-fps_mode", "passthrough",
           "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    timestamps, errors = queue.Queue(), []
    def logs():
        for line in iter(proc.stderr.readline, b""):
            text = line.decode("utf-8", errors="replace")
            match = re.search(r"\bn:\s*\d+.*?pts:\s*(-?\d+).*?pts_time:\s*([-0-9.e+]+)", text)
            if match:
                timestamps.put((int(match[1]),float(match[2])))
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
            if not data:
                break
            if len(data) != frame_bytes:
                raise RuntimeError("Truncated GPU frame")
            try:
                raw_pts, pts = timestamps.get(timeout=10)
            except queue.Empty:
                raise RuntimeError("GPU frame missing PTS")
            absolute=float(raw_pts*Fraction(meta["timeBase"]))
            yield dict(t=absolute-origin, pts=raw_pts, timeBase=meta["timeBase"], absolute=absolute,
                       duration=1/meta["fps"], image=np.frombuffer(data, np.uint8).reshape(height,width,3))
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
                values = self.model((t-self.mean)/self.std).float().cpu().numpy()
        else:
            # Explicit lightweight test/diagnostic backend; never silently substitutes SSCD.
            values = np.stack([cv2.resize(cv2.equalizeHist(cv2.cvtColor(x,cv2.COLOR_RGB2GRAY)), (32,32)).ravel() for x in data]).astype(np.float32)
            values -= values.mean(axis=1, keepdims=True)
        return values / np.maximum(1e-8, np.linalg.norm(values, axis=1, keepdims=True))


def variants(im, aspect):
    im = trim_bars(im)
    h,w = im.shape[:2]
    target = min(w, max(1, round(h * aspect)))
    yield im
    if target < w * .85:
        # Crop descriptors support a portrait edit taken from a landscape source.
        # Full frame remains in the index for off-centre and difficult crops.
        yield im[:, (w-target)//2:(w+target)//2]


def feature_points(im):
    a=cv2.createCLAHE(clipLimit=2).apply(cv2.cvtColor(trim_bars(im),cv2.COLOR_RGB2GRAY))
    sift = cv2.SIFT_create(nfeatures=1600)
    keypoints,descriptors=sift.detectAndCompute(a,None)
    return a,keypoints,descriptors


def geometry(query_im, source_im, query_features=None, source_features=None):
    a,ka,da = query_features if query_features is not None else feature_points(query_im)
    b,kb,db = source_features if source_features is not None else feature_points(source_im)
    if da is None or db is None or len(da)<8 or len(db)<8:
        return dict(inliers=0, coverage=0., fraction=0., score=0.)
    pairs = cv2.BFMatcher().knnMatch(da,db,k=2)
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
    warped = cv2.warpPerspective(b, np.linalg.inv(matrix), (a.shape[1],a.shape[0]))
    mask = cv2.warpPerspective(np.ones(b.shape,np.uint8), np.linalg.inv(matrix), (a.shape[1],a.shape[0])) > 0
    va,vb = a[mask].astype(float),warped[mask].astype(float)
    correlation = float(np.corrcoef(va,vb)[0,1]) if len(va)>32 and va.std()>1 and vb.std()>1 else 0.
    if not math.isfinite(correlation):
        correlation=0.
    return dict(inliers=inliers, coverage=coverage, fraction=fraction,
                correlation=correlation, score=float(min(inliers,80) * min(1.,coverage/.25) * fraction * max(0,correlation)**6))


def valid_geometry(g):
    return g["inliers"] >= 12 and g["coverage"] >= .12 and g["fraction"] >= .5 and g.get("correlation",1) >= .55


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
    if abs(slope)<.05 or abs(slope)>16 or residual>max(frame_seconds*1.5,.025):
        return None
    if (slope>0 and np.any(delta<0)) or (slope<0 and np.any(delta>0)):
        return None
    return dict(direction="FORWARD" if slope>0 else "REVERSE", playbackRate=abs(float(slope)), residualSeconds=residual)


def consistent_path(options, frame_seconds):
    """Fit the sequence jointly; individual frame maxima can jitter on slow motion."""
    if len(options)<3 or any(not choices for choices in options):
        return None
    best=None
    for first in options[0][:10]:
        for last in options[-1][:10]:
            span=last["referenceTime"]-first["referenceTime"]
            if span<=0:
                continue
            rate=(last["sourceTime"]-first["sourceTime"])/span
            if not .05<=abs(rate)<=16:
                continue
            path=[first]
            for choices in options[1:-1]:
                expected=first["sourceTime"]+(choices[0]["referenceTime"]-first["referenceTime"])*rate
                near=[a for a in choices if abs(a["sourceTime"]-expected)<=frame_seconds*1.5 and a["geometry"]["score"]>=choices[0]["geometry"]["score"]*.55]
                if not near:
                    break
                path.append(max(near,key=lambda a:a["geometry"]["score"]))
            path.append(last)
            alignment=temporal_alignment(path,frame_seconds) if len(path)==len(options) else None
            if alignment:
                score=sum(a["geometry"]["score"] for a in path)
                if best is None or score>best[0]:
                    best=(score,path,alignment)
    return None if best is None else (best[1],best[2])


class Engine:
    def __init__(self, request, out, cache, encoder):
        self.request, self.out, self.cache, self.encoder = request, Path(out), Path(cache), encoder
        self.started = time.monotonic()
        self.budget = float(request.get("budgetSeconds",480))
        self.report = dict(schema="editflow.source-match-report.v1", engine=VERSION,
                           editorialAuthority="CHATGPT_DIRECT", automaticSelection=False,
                           timestampConvention="seconds from video stream start; raw integer PTS retained; end exclusive",
                           backend=encoder.backend, device=encoder.device, shots=[], sources=[], warnings=[], stages=[],
                           boundaryAccuracy="Measured frame correspondences; no universal one-frame accuracy guarantee")
        self.out.mkdir(parents=True,exist_ok=True)
        self.cache.mkdir(parents=True,exist_ok=True)
        self.candidates = {}

    def check(self):
        if time.monotonic()-self.started > self.budget or (self.out/"cancel").exists():
            raise BudgetExpired()

    def progress(self, stage, **values):
        event=dict(stage=stage, elapsedSeconds=round(time.monotonic()-self.started,3), **values)
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
        target={round(t,6):(i,t) for i,t in selected}
        for f in decode(file,size=640,check=self.check):
            if round(f["t"],6) in target:
                i,t=target[round(f["t"],6)]
                self.queries.append(dict(shot=i,frame=f))
        if not self.queries:
            raise ValueError("No usable reference queries")
        chroma=[np.abs(q["frame"]["image"][:,:,0].astype(float)-q["frame"]["image"][:,:,1]).mean()+np.abs(q["frame"]["image"][:,:,1].astype(float)-q["frame"]["image"][:,:,2]).mean() for q in self.queries]
        self.encoder.monochrome=float(np.median(chroma))<6
        self.report["descriptorColorPolicy"]="MONOCHROME_REFERENCE" if self.encoder.monochrome else "RGB"
        self.qvectors=self.encoder.encode([q["frame"]["image"] for q in self.queries])
        self.aspect=float(np.median([trim_bars(q["frame"]["image"]).shape[1]/trim_bars(q["frame"]["image"]).shape[0] for q in self.queries]))
        self.progress("REFERENCE_READY",shots=len(self.report["shots"]),queries=len(self.queries))

    def search(self,vectors,times,source):
        scores=self.qvectors@vectors.T
        for q,row in enumerate(scores):
            inds=np.argsort(row)[-8:][::-1]
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
        key=hashlib.sha256(f"{VERSION}|{identity}|{self.encoder.model_id}|{self.encoder.monochrome}|{self.aspect:.3f}|{mode}".encode()).hexdigest()
        root=self.cache/key
        root.mkdir(exist_ok=True)
        marker=root/"complete.json"
        if marker.exists():
            count=0
            for p in sorted(root.glob("*.npz")):
                self.check()
                with np.load(p,allow_pickle=False) as n:
                    self.search(n["vectors"],n["times"],source)
                    count+=len(n["times"])
            self.progress("CACHE_SEARCH",source=source,mode=mode,descriptors=count)
            return
        # Partial chunks are reusable, but missing completion marker requires a full rescan.
        # Replace chunks in-place; marker is written only after successful complete coverage.
        count,batch,bt=[],[],[]
        if mode=="keys":
            frames=decode(file,keyframes=True,size=512,check=self.check)
        elif self.encoder.device=="cuda":
            frames=gpu_samples(file,float(mode),self.check)
        else:
            interval=float(mode)
            def sampled():
                last=-1e9
                for f in decode(file,size=512,check=self.check):
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
        chunk=0
        def flush():
            nonlocal chunk
            if not batch:
                return
            self.check()
            vectors=self.encoder.encode(batch)
            self.search(vectors,np.array(bt),source)
            temp=root/f"{chunk:06}.tmp.npz"
            np.savez_compressed(temp,vectors=vectors,times=np.array(bt))
            os.replace(temp,root/f"{chunk:06}.npz")
            count.extend(bt)
            self.progress("SEARCHING",source=source,mode=mode,descriptors=len(count),throughSourceSeconds=bt[-1])
            chunk+=1
            batch.clear();bt.clear()
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
            # Remove stale chunks left by an interrupted older scan before completion.
            for p in root.glob("*.npz"):
                if p.stem.isdigit() and int(p.stem)>=chunk:
                    p.unlink()
            atomic_json(marker,dict(identity=identity,descriptors=len(count),chunks=chunk))
        finally:
            stopped.set()
            thread.join(timeout=12)

    def verify(self):
        for i,shot in enumerate(self.report["shots"]):
            if shot["status"]=="VERIFIED":
                continue
            qs=[(n,q) for n,q in enumerate(self.queries) if q["shot"]==i]
            if len(qs)<3:
                continue
            middle=qs[len(qs)//2][0]
            locations=self.candidates.get(middle,[])[:int(self.request.get("candidateLimit",4))]
            self.progress("VERIFYING_SHOT",shotId=shot["shotId"],candidates=len(locations))
            qfeatures={n:feature_points(q["frame"]["image"]) for n,q in qs}
            hypotheses=[]
            for score,source,t in locations:
                self.check()
                meta=self.report["sources"][source]
                file=meta["path"]
                width=min(30,max(4,(shot["referenceEnd"]-shot["referenceStart"])*3))
                start,end=max(0,t-width),min(meta["duration"],t+width)
                self.progress("VERIFY_DECODE",shotId=shot["shotId"],candidateTime=t)
                frames=list(gpu_samples(file,None,self.check,start,end,size=640) if self.encoder.device=="cuda" else decode(file,start,end,size=640,check=self.check))
                for k in range(len(frames)-1):
                    frames[k]["duration"]=frames[k+1]["t"]-frames[k]["t"]
                if not frames:
                    continue
                # First find each anchor among a dense 8fps view by SSCD.
                samples=frames[::max(1,round(meta["fps"]/8))]
                coarse,images=[],[]
                for f in samples:
                    for im in variants(f["image"],self.aspect):
                        coarse.append(f);images.append(im)
                # Bounded inference batches avoid allocating an entire long shot on GPU.
                self.progress("VERIFY_DESCRIPTORS",shotId=shot["shotId"],frames=len(images))
                cvectors=np.concatenate([self.encoder.encode(images[j:j+32]) for j in range(0,len(images),32)])
                anchors=[]
                anchor_options={}
                sfeatures={}
                ordered_qs=sorted(qs,key=lambda nq:0 if nq[0]==middle else 1)
                for n,q in ordered_qs:
                    self.check()
                    scores=self.qvectors[n]@cvectors.T
                    best=[]
                    near_times=[]
                    for j in np.argsort(scores)[::-1]:
                        if all(abs(coarse[j]["t"]-v)>.1 for v in near_times):
                            near_times.append(coarse[j]["t"])
                        if len(near_times)==3:
                            break
                    for near in near_times:
                        for f in frames:
                            if abs(f["t"]-near)<=.18:
                                self.check()
                                if f["pts"] not in sfeatures:
                                    sfeatures[f["pts"]]=feature_points(f["image"])
                                g=geometry(q["frame"]["image"],f["image"],qfeatures[n],sfeatures[f["pts"]])
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
                                        sourceFrameDuration=f["duration"],geometry=g,queryIndex=n)
                        if valid_geometry(g):
                            options.append(a)
                    _,f,g=best[0]
                    anchors.append(dict(referenceTime=q["frame"]["t"],sourceTime=f["t"],
                                        sourcePts=f["pts"],sourceTimeBase=f["timeBase"],sourceAbsoluteTime=f["absolute"],
                                        sourceFrameDuration=f["duration"],geometry=g,queryIndex=n))
                    anchor_options[n]=options
                    # Every accepted sequence requires this middle anchor; reject cheap first.
                    if n==middle and not options:
                        break
                anchors.sort(key=lambda a:a["referenceTime"])
                alignment=temporal_alignment(anchors,1/meta["fps"])
                if alignment is None and len(anchor_options)==len(qs):
                    path=consistent_path([anchor_options[n] for n,q in qs],1/meta["fps"])
                    if path:
                        anchors,alignment=path
                shot.setdefault("candidateChecks",[]).append(dict(sourceIndex=source,candidateTime=t,retrievalScore=score,
                    passed=alignment is not None,anchors=[{k:a[k] for k in ["referenceTime","sourceTime","geometry"]} for a in anchors]))
                shot["candidateChecks"]=shot["candidateChecks"][-12:]
                if alignment:
                    hypotheses.append(dict(source=source,score=sum(a["geometry"]["score"] for a in anchors),anchors=anchors,alignment=alignment,frames=frames))
            hypotheses.sort(key=lambda h:h["score"],reverse=True)
            if not hypotheses:
                shot["reason"]="No geometrically and temporally consistent candidate"
                self.save()
                continue
            best=hypotheses[0]
            different=[h for h in hypotheses[1:] if h["source"]!=best["source"] or abs(h["anchors"][0]["sourceTime"]-best["anchors"][0]["sourceTime"])>1]
            if different and different[0]["score"]>=best["score"]*.85:
                shot["reason"]="Ambiguous repeated source footage"
                self.save()
                continue
            anchors=best["anchors"]
            # Range uses real matched endpoint frame timestamps, never a fitted boundary.
            endpoints=[anchors[0],anchors[-1]]
            low=min(endpoints,key=lambda a:a["sourceTime"])
            high=max(endpoints,key=lambda a:a["sourceTime"])
            shot.update(status="VERIFIED",reason="Geometry and temporal checks passed; GPT visual acceptance still required",
                        sourcePath=self.report["sources"][best["source"]]["path"],sourceIndex=best["source"],
                        sourceStart=low["sourceTime"],sourceEndExclusive=high["sourceTime"]+high["sourceFrameDuration"],
                        alignment=best["alignment"],anchors=anchors,requiresVisualReview=True,
                        exactBoundaryGuaranteed=False)
            shot["sourceStartTimecode"]=timecode(shot["sourceStart"])
            shot["sourceEndTimecode"]=timecode(shot["sourceEndExclusive"])
            for k,a in enumerate(anchors):
                q=self.queries[a["queryIndex"]]["frame"]
                source=[f for f in best["frames"] if f["pts"]==a["sourcePts"]]
                if not source:
                    source=list(decode(shot["sourcePath"],max(0,a["sourceTime"]-.000001),a["sourceTime"]+.001,size=640,check=self.check))
                if source:
                    refpath=self.out/f"{shot['shotId']}-anchor-{k}-reference.jpg"
                    srcpath=self.out/f"{shot['shotId']}-anchor-{k}-source.jpg"
                    cv2.imwrite(str(refpath),cv2.cvtColor(q["image"],cv2.COLOR_RGB2BGR))
                    cv2.imwrite(str(srcpath),cv2.cvtColor(source[0]["image"],cv2.COLOR_RGB2BGR))
                    a.update(referenceEvidencePath=str(refpath),sourceEvidencePath=str(srcpath))
            self.progress("VERIFIED_CANDIDATE",shotId=shot["shotId"],sourceStart=shot["sourceStart"],sourceEndExclusive=shot["sourceEndExclusive"])
            self.save()

    def save(self):
        self.report["elapsedSeconds"]=round(time.monotonic()-self.started,3)
        atomic_json(self.out/"report.json",self.report)
        fields=["shotId","referenceStart","referenceEnd","status","sourcePath","sourceStart","sourceEndExclusive","sourceStartTimecode","sourceEndTimecode","reason"]
        with (self.out/"timestamps.csv").open("w",newline="",encoding="utf-8") as f:
            writer=csv.DictWriter(f,fields,extrasaction="ignore")
            writer.writeheader();writer.writerows(self.report["shots"])

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

    def run(self):
        try:
            self.reference()
            self.report["sources"]=[dict(path=p,fingerprint=fingerprint(p),**probe(p)) for p in self.request["sourcePaths"]]
            for mode in ["keys", "0.5", "0.125"]:
                self.progress("PASS_STARTED",mode=mode)
                for source in range(len(self.report["sources"])):
                    self.scan(source,mode)
                self.verify()
                if all(s["status"]=="VERIFIED" for s in self.report["shots"]):
                    break
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
