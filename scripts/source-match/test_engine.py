"""Executable end-to-end fixtures with known original frames, plus rejection tests."""
import importlib.util
from fractions import Fraction
from pathlib import Path
import av
import cv2
import numpy as np

spec=importlib.util.spec_from_file_location("source_match_engine",Path(__file__).with_name("engine.py"))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


def encode(file,frames,fps=12):
    with av.open(str(file),"w") as c:
        s=c.add_stream("libx264",rate=fps);s.width=frames[0].shape[1];s.height=frames[0].shape[0];s.pix_fmt="yuv420p"
        s.options={"crf":"12","g":"6","bf":"0"}
        for i,im in enumerate(frames):
            f=av.VideoFrame.from_ndarray(im,format="rgb24");f.pts=i;f.time_base=Fraction(1,fps)
            for p in s.encode(f):c.mux(p)
        for p in s.encode():c.mux(p)


def fixture():
    rng=np.random.default_rng(741)
    base=rng.integers(20,230,(240,320,3),dtype=np.uint8)
    base=cv2.GaussianBlur(base,(3,3),0)
    frames=[]
    for i in range(72):
        im=base.copy()
        for j in range(16):
            x=(i*7+j*51)%290;y=(i*3+j*31)%205
            cv2.rectangle(im,(x,y),(x+22,y+22),(20+j*12,220-j*8,40+j*10),-1)
        cv2.putText(im,str(i),(20,215),cv2.FONT_HERSHEY_SIMPLEX,1,(250,20,100),2)
        frames.append(im)
    return frames


def test_geometry_crop_grade_and_unrelated():
    frame=fixture()[22]
    query=np.clip(frame[:,60:260].astype(float)*.8+25,0,255).astype(np.uint8)
    assert m.valid_geometry(m.geometry(query,frame))
    assert not m.valid_geometry(m.geometry(query,np.random.default_rng(88).integers(0,255,frame.shape,dtype=np.uint8)))


def test_temporal_reversal_and_inconsistent_time():
    good={"inliers":30,"coverage":.5,"fraction":.9,"score":20}
    anchors=[dict(referenceTime=x,sourceTime=10-2*x,geometry=good) for x in [0,.5,1]]
    result=m.temporal_alignment(anchors,1/24)
    assert result["direction"]=="REVERSE" and abs(result["playbackRate"]-2)<1e-8
    anchors[1]["sourceTime"]=11
    assert m.temporal_alignment(anchors,1/24) is None


def test_real_encoded_pts_crop_reverse_cache(tmp_path):
    frames=fixture();source=tmp_path/"source.mp4";reference=tmp_path/"ref.mp4"
    encode(source,frames)
    selected=frames[12:36]
    crop=[np.clip(im[:,40:280].astype(float)*.9+10,0,255).astype(np.uint8) for im in selected]
    encode(reference,crop)
    request=dict(referencePath=str(reference),sourcePaths=[str(source)],budgetSeconds=120,shots=[dict(start=0,end=2)],candidateLimit=4)
    encoder=m.Encoder("diagnostic")
    engine=m.Engine(request,tmp_path/"out",tmp_path/"cache",encoder)
    report=engine.run();shot=report["shots"][0]
    assert shot["status"]=="VERIFIED",report
    assert abs(shot["sourceStart"]-1)<=1/12
    assert abs(shot["sourceEndExclusive"]-3)<=1/12
    assert shot["anchors"][0]["sourcePts"] is not None
    engine2=m.Engine(request,tmp_path/"cached",tmp_path/"cache",encoder)
    assert engine2.run()["shots"][0]["status"]=="VERIFIED"
    reverse=tmp_path/"reverse.mp4";encode(reverse,selected[::-1])
    request["referencePath"]=str(reverse)
    result=m.Engine(request,tmp_path/"rev-out",tmp_path/"cache",encoder).run()
    assert result["shots"][0]["status"]=="VERIFIED",result
    assert result["shots"][0]["alignment"]["direction"]=="REVERSE"


def test_unrelated_never_has_source_timestamps(tmp_path):
    source=tmp_path/"source.mp4";ref=tmp_path/"ref.mp4"
    frames=fixture();encode(source,frames)
    encode(ref,[np.full_like(im,130) for im in frames[:12]])
    request=dict(referencePath=str(ref),sourcePaths=[str(source)],budgetSeconds=120,shots=[dict(start=0,end=1)],candidateLimit=1)
    result=m.Engine(request,tmp_path/"out",tmp_path/"cache",m.Encoder("diagnostic")).run()
    assert result["status"]=="PARTIAL"
    assert "sourceStart" not in result["shots"][0]


def test_input_change_invalidates_cache(tmp_path):
    p=tmp_path/"media";p.write_bytes(b"a"*200000)
    first=m.fingerprint(p)
    with p.open("r+b") as f:f.seek(100000);f.write(b"different")
    assert first!=m.fingerprint(p)


def test_duplicate_movies_are_ambiguous(tmp_path):
    a,b,ref=[tmp_path/n for n in ["a.mp4","b.mp4","ref.mp4"]]
    frames=fixture();encode(a,frames);b.write_bytes(a.read_bytes());encode(ref,frames[12:36])
    request=dict(referencePath=str(ref),sourcePaths=[str(a),str(b)],budgetSeconds=120,shots=[dict(start=0,end=2)],candidateLimit=6)
    result=m.Engine(request,tmp_path/"out",tmp_path/"cache",m.Encoder("diagnostic")).run()
    assert result["shots"][0]["status"]=="UNRESOLVED"
    assert "sourceStart" not in result["shots"][0]


def test_budget_retains_partial_report(tmp_path):
    source=tmp_path/"source.mp4";ref=tmp_path/"ref.mp4"
    frames=fixture();encode(source,frames);encode(ref,frames[:12])
    request=dict(referencePath=str(ref),sourcePaths=[str(source)],budgetSeconds=0)
    result=m.Engine(request,tmp_path/"out",tmp_path/"cache",m.Encoder("diagnostic")).run()
    assert result["status"]=="PARTIAL" and (tmp_path/"out"/"report.json").exists()
