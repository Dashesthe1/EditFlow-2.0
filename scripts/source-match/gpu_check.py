"""Known-frame SSCD/CUDA checks; deliberately small, not a movie benchmark."""
import argparse
import json
from pathlib import Path

import numpy as np
import cv2

import engine as m
from test_engine import encode, fixture


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model",required=True)
    parser.add_argument("--output",required=True)
    args=parser.parse_args()
    out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
    encoder=m.Encoder("sscd",args.model,"cuda")
    frames=fixture();source=out/"source.mp4";encode(source,frames)
    cases={
        "crop-grade":([np.clip(f[:,40:280].astype(float)*.9+10,0,255).astype(np.uint8) for f in frames[12:36]],"VERIFIED"),
        "reverse":(frames[12:36][::-1],"VERIFIED"),
        "retime":([frames[j] for j in [12,12,13,13,14,15,16,17,18,19,20,21,23,25,27,29,30,31,32,33,34,34,35,35]],"VERIFIED"),
        "faded":([np.zeros_like(frames[12])]+frames[13:35]+[np.zeros_like(frames[35])],"LOCATED"),
        "dark-endpoint":([np.clip(frames[12].astype(float)*.18+4,0,255).astype(np.uint8)]+frames[13:36],"VERIFIED"),
        "flash-endpoint":([np.clip(frames[12].astype(float)*.18+205,0,255).astype(np.uint8)]+frames[13:36],"VERIFIED"),
        "near-black-endpoint":([np.clip(frames[12].astype(float)*.06,0,255).astype(np.uint8)]+frames[13:36],"VERIFIED"),
        "crushed-endpoint":([np.clip(frames[12].astype(float)*.025,0,255).astype(np.uint8)]+frames[13:36],"LOCATED"),
        "hidden-interior":(frames[12:24]+[np.zeros_like(frames[24])]+frames[25:36],"VERIFIED"),
        "unrelated":([np.full_like(f,130) for f in frames[:24]],"UNRESOLVED"),
    }
    overlays=[]
    for i,f in enumerate(frames[12:36]):
        im=f.copy();im[:95]=np.random.default_rng(500+i).integers(0,255,im[:95].shape,dtype=np.uint8)
        cv2.putText(im,'NEW TEXT',(20,200),0,.7,(255,255,255),2);overlays.append(im)
    cases['overlay-composite']=(overlays,'VERIFIED')
    bordered=[]
    for f in frames[12:36]:
        im=np.pad(f[:,40:280],((80,80),(30,30),(0,0)))
        cv2.putText(im,'EDIT TEXT',(40,275),0,.7,(255,255,255),2);bordered.append(im)
    cases['border-caption']=(bordered,'VERIFIED')
    results=[]
    for name,(images,expected) in cases.items():
        ref=out/(name+".mp4");encode(ref,images)
        request=dict(referencePath=str(ref),sourcePaths=[str(source)],budgetSeconds=90,
                     shots=[dict(start=0,end=2)],candidateLimit=4)
        report=m.Engine(request,out/name,out/"cache",encoder).run();shot=report["shots"][0]
        result=dict(case=name,status=shot["status"],expected=expected,elapsed=report["elapsedSeconds"],
                    start=shot.get("sourceStart"),end=shot.get("sourceEndExclusive"))
        if expected=="VERIFIED":
            result["knownEndpointErrorFrames"]=max(abs(shot.get("sourceStart",-100)-1),abs(shot.get("sourceEndExclusive",-100)-3))*12
        results.append(result);print(json.dumps(result),flush=True)
    m.atomic_json(out/"results.json",dict(engine=m.VERSION,engineSha256=m.ENGINE_SHA256,
                  device=encoder.torch.cuda.get_device_name(),scope="Small 12fps encoded fixtures; not real-file accuracy or throughput",results=results))
    if any(r["status"]!=r["expected"] or r.get("knownEndpointErrorFrames",0)>1 for r in results):
        raise RuntimeError("GPU quality checks failed; inspect results.json and frame evidence")
    print("GPU QUALITY PASS",flush=True)


if __name__=="__main__":
    main()
