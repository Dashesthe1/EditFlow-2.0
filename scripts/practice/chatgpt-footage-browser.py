"""Metadata and ChatGPT-requested pixels only. No cuts, perceptual analysis or ranking."""
import argparse
import hashlib
import json
import math
import os
import re
import shutil
from pathlib import Path
import subprocess
from fractions import Fraction
from concurrent.futures import ThreadPoolExecutor
from PIL import Image, ImageDraw


def ffmpeg_path(value):
    if value:
        return value
    if os.environ.get("EDITFLOW_FFMPEG_PATH"):
        return os.environ["EDITFLOW_FFMPEG_PATH"]
    executable = shutil.which("ffmpeg")
    if executable:
        return executable
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def metadata(video, executable):
    sibling = str(Path(executable).with_name("ffprobe.exe" if executable.lower().endswith(".exe") else "ffprobe"))
    probe = sibling if Path(sibling).is_file() else shutil.which("ffprobe")
    if probe:
        result = subprocess.run([probe, "-v", "error", "-select_streams", "v:0", "-show_streams", "-show_format", "-of", "json", video], check=True, capture_output=True, timeout=45)
        info = json.loads(result.stdout)
        stream = info["streams"][0]
        fps = float(Fraction(stream.get("avg_frame_rate") or stream["r_frame_rate"]))
        duration = float(stream.get("duration") or info["format"]["duration"])
        width, height = int(stream["width"]), int(stream["height"])
        count = int(stream.get("nb_frames") or round(duration * fps))
    else:
        # Some packaged ffmpeg binaries omit ffprobe. Parse container metadata;
        # this selects no footage and performs no visual/content classification.
        result = subprocess.run([executable, "-hide_banner", "-i", video], capture_output=True, timeout=45)
        description = result.stderr.decode("utf8", errors="replace")
        dur = re.search(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)", description)
        line = next((line for line in description.splitlines() if "Video:" in line), "")
        dims = re.search(r"\b(\d{2,5})x(\d{2,5})\b", line)
        rate = re.search(r"([\d.]+) fps", line)
        if not dur or not dims or not rate:
            raise ValueError("Could not read footage metadata")
        duration = int(dur[1]) * 3600 + int(dur[2]) * 60 + float(dur[3])
        width, height = int(dims[1]), int(dims[2])
        fps = float(rate[1]); count = round(duration * fps)
    if fps <= 0 or duration <= 0 or count <= 0:
        raise ValueError("Invalid footage metadata")
    return dict(fps=fps,frameCount=count,width=width,height=height,durationMs=duration*1000)


def run(args):
    executable = ffmpeg_path(args.ffmpeg)
    info = metadata(args.video, executable)
    output = Path(args.output); output.parent.mkdir(parents=True, exist_ok=True)
    if args.command == "metadata":
        digest = hashlib.sha256()
        with open(args.video, "rb") as source:
            for block in iter(lambda: source.read(8*1024*1024), b""):
                digest.update(block)
        result = dict(schema="editflow.practice-source-index.v1",sourceId=args.source_id,sourcePath=args.video,
                      sourceSha256=digest.hexdigest(),video=info,evidenceRefs=["raw-metadata-only:no-content-analysis"])
    else:
        times = json.loads(args.times_json)
        if (not isinstance(times,list) or not 1<=len(times)<=48 or any(isinstance(t,bool) or not isinstance(t,(int,float)) or not math.isfinite(t) or t<0 or t>=info["durationMs"] for t in times)):
            raise ValueError("Request 1–48 explicit in-bounds timestamps")
        def extract(item):
            index,time_ms = item
            target = output.parent/(output.stem+"-%03d.png"%index)
            if not target.exists():
                subprocess.run([executable,"-hide_banner","-loglevel","error","-y","-ss",str(time_ms/1000),"-threads","2","-i",args.video,"-frames:v","1","-vf","scale=%d:-2"%args.width,"-threads","1","-an",str(target)],check=True,timeout=45,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
            with Image.open(target) as image:
                image.load()
            return index,time_ms,target
        with ThreadPoolExecutor(max_workers=min(4,len(times))) as pool:
            extracted=list(pool.map(extract,enumerate(times)))
        frames=[]; tiles=[]
        for index,time_ms,target in extracted:
            frames.append(dict(timeMs=time_ms,path=str(target),sha256=hashlib.sha256(target.read_bytes()).hexdigest()))
            tile=Image.new("RGB",(320,204),"black")
            with Image.open(target) as pixels:
                pixels=pixels.convert("RGB"); pixels.thumbnail((320,180)); tile.paste(pixels,(0,0))
            label="%03d | %02d:%02d:%06.3f"%(index,time_ms//3600000,(time_ms//60000)%60,(time_ms/1000)%60)
            ImageDraw.Draw(tile).text((4,187),label,fill="white"); tiles.append(tile)
        cols=min(4,len(tiles)); sheet=Image.new("RGB",(cols*320,math.ceil(len(tiles)/cols)*204),"black")
        for index,tile in enumerate(tiles):
            row,col=divmod(index,cols); sheet.paste(tile,(col*320,row*204))
        sheet_path=str(output.with_suffix(".sheet.jpg")); sheet.save(sheet_path)
        result=dict(schema="editflow.chatgpt-footage-inspection.v1",video=info,frames=frames,contactSheetPath=sheet_path)
    temporary=str(output)+".tmp-"+str(os.getpid()); Path(temporary).write_text(json.dumps(result),encoding="utf8"); os.replace(temporary,output)


if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("command",choices=["metadata","browse"])
    parser.add_argument("--video",required=True); parser.add_argument("--output",required=True)
    parser.add_argument("--source-id",default=""); parser.add_argument("--times-json",default="[]")
    parser.add_argument("--width",type=int,default=640); parser.add_argument("--ffmpeg",default="")
    args=parser.parse_args()
    if not 160<=args.width<=1920: parser.error("width must be 160–1920")
    run(args)
