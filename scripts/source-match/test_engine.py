"""Executable end-to-end fixtures with known original frames, plus rejection tests."""
import importlib.util
import copy
import hashlib
import json
from fractions import Fraction
from pathlib import Path
import av
import cv2
import numpy as np

spec=importlib.util.spec_from_file_location("source_match_engine",Path(__file__).with_name("engine.py"))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


def encode(file,frames,fps=12,pts=None,time_base=None):
    with av.open(str(file),"w") as c:
        s=c.add_stream("libx264",rate=fps);s.width=frames[0].shape[1];s.height=frames[0].shape[0];s.pix_fmt="yuv420p"
        s.options={"crf":"12","g":"6","bf":"0"}
        for i,im in enumerate(frames):
            f=av.VideoFrame.from_ndarray(im,format="rgb24");f.pts=i if pts is None else pts[i];f.time_base=time_base or Fraction(1,fps)
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


def test_distributed_pixels_verify_caption_and_composite_without_whole_image_agreement():
    frame=fixture()[22]
    query=frame.copy()
    query[:100]=np.random.default_rng(200).integers(0,255,query[:100].shape,dtype=np.uint8)
    cv2.putText(query,'EDIT CAPTION',(15,190),0,.7,(255,255,255),2)
    g=m.geometry(query,frame)
    assert m.valid_geometry(g),g
    assert g['verificationMethod']=='DISTRIBUTED_VISIBLE_REGIONS',g
    assert g['globalCorrelation']<.55 and g['regionalEvidence']['supportedFraction']>=.4
    assert len(g['transform']['queryToSource'])==3
    assert not m.valid_geometry(m.geometry(query,np.random.default_rng(901).integers(0,255,frame.shape,dtype=np.uint8)))


def test_small_shared_insert_or_same_caption_does_not_certify_unrelated_picture():
    frame=fixture()[22]
    unrelated=np.random.default_rng(39).integers(0,255,frame.shape,dtype=np.uint8)
    query=unrelated.copy();query[80:140,80:200]=frame[80:140,80:200]
    assert not m.valid_geometry(m.geometry(query,frame))
    source=frame.copy()
    for im in [query,source]:cv2.putText(im,'COMMON TEXT',(10,170),0,1,(255,255,255),3)
    assert not m.valid_geometry(m.geometry(query,source))


def test_borders_resize_rotation_and_dark_picture_are_visible_not_hidden():
    frame=fixture()[22]
    crop=np.clip(frame[:,40:280].astype(float)*.4+5,0,255).astype(np.uint8)
    query=np.pad(cv2.resize(crop,(300,300)),((120,120),(80,80),(0,0)))
    cv2.putText(query,'ADDED CAPTION',(90,330),0,.65,(255,255,255),2)
    assert m.valid_geometry(m.geometry(query,frame))
    rotated=cv2.warpAffine(frame,cv2.getRotationMatrix2D((160,120),8,.9),(320,240))
    assert m.valid_geometry(m.geometry(rotated,frame))
    assert m.boundary_information(query)['kind']=='DISTRIBUTED_VISIBLE_DETAIL'
    text=np.zeros_like(frame);cv2.putText(text,'TEXT ONLY',(30,125),0,.7,(255,255,255),2)
    assert m.boundary_information(text)['kind']=='INSUFFICIENT_DISTRIBUTED_DETAIL'
    assert not m.valid_geometry(m.geometry(text,frame))


def test_encoded_overlaid_endpoints_return_known_original_pts(tmp_path):
    frames=fixture();source=tmp_path/'source.mp4';ref=tmp_path/'overlay.mp4'
    encode(source,frames)
    selected=[f.copy() for f in frames[12:36]]
    for i,im in enumerate(selected):
        im[:95]=np.random.default_rng(500+i).integers(0,255,im[:95].shape,dtype=np.uint8)
        cv2.putText(im,'NEW TEXT',(20,200),0,.7,(255,255,255),2)
    encode(ref,selected)
    request=dict(referencePath=str(ref),sourcePaths=[str(source)],budgetSeconds=120,shots=[dict(start=0,end=2)],candidateLimit=4)
    report=m.Engine(request,tmp_path/'out',tmp_path/'cache',m.Encoder('diagnostic')).run()
    shot=report['shots'][0]
    assert shot['status']=='VERIFIED',report
    assert shot['sourceStart']==1 and shot['sourceEndExclusive']==3,shot
    assert any(a['geometry']['verificationMethod']=='DISTRIBUTED_VISIBLE_REGIONS' for a in shot['anchors'])


def test_dark_and_flashed_detail_can_be_measured_without_accepting_flat_or_unrelated_images():
    frame=fixture()[22]
    for gain,offset in [(.18,4),(.18,205)]:
        query=np.clip(frame[:,60:260].astype(float)*gain+offset,0,255).astype(np.uint8)
        assert m.valid_geometry(m.geometry(query,frame))
        assert not m.valid_geometry(m.geometry(query,np.random.default_rng(13).integers(0,255,frame.shape,dtype=np.uint8)))
    assert not m.valid_geometry(m.geometry(np.zeros_like(frame),frame))
    assert not m.valid_geometry(m.geometry(np.full_like(frame,255),frame))


def test_temporal_reversal_and_inconsistent_time():
    good={"inliers":30,"coverage":.5,"fraction":.9,"score":20}
    anchors=[dict(referenceTime=x,sourceTime=10-2*x,geometry=good) for x in [0,.5,1]]
    result=m.temporal_alignment(anchors,1/24)
    assert result["direction"]=="REVERSE" and abs(result["playbackRate"]-2)<1e-8
    anchors[1]["sourceTime"]=11
    assert m.temporal_alignment(anchors,1/24) is None


def test_nonlinear_monotone_retiming_has_explicit_segments():
    good={"inliers":30,"coverage":.5,"fraction":.9,"score":20}
    anchors=[dict(referenceTime=x,sourceTime=y,geometry=good) for x,y in [(0,10),(.5,10.25),(1,11),(1.5,11.5)]]
    result=m.temporal_alignment(anchors,1/24)
    assert result["kind"]=="PIECEWISE" and len(result["segments"])==3


def test_joint_path_does_not_force_speed_ramps_to_be_affine():
    good={"inliers":30,"coverage":.5,"fraction":.9,"score":20}
    actual=[(0,10),(.5,10.1),(1,11.1),(1.5,11.5),(2,12)]
    options=[]
    for x,y in actual:
        distractor=dict(referenceTime=x,sourceTime=y+.2,geometry={**good,"score":10})
        options.append([dict(referenceTime=x,sourceTime=y,geometry=good),distractor])
    path,alignment=m.consistent_path(options,1/24)
    assert [a["sourceTime"] for a in path]==[y for x,y in actual]
    assert alignment["kind"]=="PIECEWISE"


def test_quantized_slow_motion_allows_plateau_but_rejects_static_copy():
    good={"inliers":30,"coverage":.5,"fraction":.9,"score":20}
    anchors=[dict(referenceTime=x,sourceTime=y,geometry=good)
             for x,y in [(0,10),(.25,10),(.5,10.1),(.75,10.2),(1,10.3)]]
    assert m.temporal_alignment(anchors,1/24) is not None
    for a in anchors:a["sourceTime"]=10
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


def test_faded_endpoints_locate_interior_without_asserting_boundaries(tmp_path):
    frames=fixture();source=tmp_path/"source.mp4";ref=tmp_path/"ref.mp4"
    encode(source,frames)
    selected=[f.copy() for f in frames[12:36]]
    selected[0][:]=0;selected[-1][:]=0
    encode(ref,selected)
    request=dict(referencePath=str(ref),sourcePaths=[str(source)],budgetSeconds=120,shots=[dict(start=0,end=2)],candidateLimit=4)
    result=m.Engine(request,tmp_path/"out",tmp_path/"cache",m.Encoder("diagnostic")).run()
    shot=result["shots"][0]
    assert shot["status"]=="LOCATED",result
    assert result["status"]=="PARTIAL" and result["summary"]["LOCATED"]==1
    assert "sourceStart" not in shot and "sourceEndExclusive" not in shot
    assert len(shot["anchors"])>=3 and shot["sourceLocationWindow"]["start"]>=1


def test_refinement_reuses_locations_preserves_other_shots_and_black_uncertainty(tmp_path):
    frames=fixture();source=tmp_path/"source.mp4";ref=tmp_path/"ref.mp4"
    encode(source,frames)
    images=frames[12:36]+[np.zeros_like(frames[36])]+frames[37:60]
    encode(ref,images)
    request=dict(referencePath=str(ref),sourcePaths=[str(source)],budgetSeconds=120,
                 shots=[dict(start=0,end=2),dict(start=2,end=4)],candidateLimit=4)
    parent=m.Engine(request,tmp_path/"parent",tmp_path/"cache",m.Encoder("diagnostic")).run()
    assert parent["shots"][0]["status"]=="VERIFIED"
    assert parent["shots"][1]["status"]=="LOCATED"
    retained=json.dumps(parent).encode();out=tmp_path/"refined";out.mkdir()
    (out/"resume-report.json").write_bytes(retained)
    request["refinement"]=dict(parentJobId="prior",reportSha256=hashlib.sha256(retained).hexdigest(),shotIds=["shot-002"],windows=[])
    engine=m.Engine(request,out,tmp_path/"cache",m.Encoder("diagnostic"))
    def forbidden_scan(*a,**k):raise AssertionError("Known location refinement must not rescan the movie")
    engine.scan=forbidden_scan
    result=engine.run()
    assert result["shots"][0]==parent["shots"][0]
    assert result["shots"][1]["status"]=="LOCATED"
    assert "sourceStart" not in result["shots"][1]
    assert result["lineage"]["refinedShotIds"]==["shot-002"]
    assert result["metrics"]["cacheDescriptors"]==0


def test_refinement_rejects_stale_or_tampered_parent(tmp_path):
    import pytest
    frames=fixture();source=tmp_path/"source.mp4";ref=tmp_path/"ref.mp4"
    encode(source,frames);encode(ref,frames[12:36])
    request=dict(referencePath=str(ref),sourcePaths=[str(source)],budgetSeconds=120,shots=[dict(start=0,end=2)])
    original=m.Engine(request,tmp_path/"parent",tmp_path/"cache",m.Encoder("diagnostic"))
    original.reference();original.report["sources"]=[dict(path=str(source),fingerprint=m.fingerprint(source),**m.probe(source))]
    old=copy.deepcopy(original.report)
    for stale in [False,True]:
        out=tmp_path/("stale" if stale else "tampered");out.mkdir()
        report=copy.deepcopy(old)
        if stale:report["sources"][0]["fingerprint"]="old-version"
        retained=json.dumps(report).encode();(out/"resume-report.json").write_bytes(retained)
        request["refinement"]=dict(parentJobId="parent",shotIds=["shot-001"],windows=[],reportSha256=hashlib.sha256(retained).hexdigest() if stale else "changed")
        engine=m.Engine(request,out,tmp_path/"cache",m.Encoder("diagnostic"))
        engine.reference();engine.report["sources"]=original.report["sources"]
        with pytest.raises(ValueError,match="INPUT_CHANGED" if stale else "REPORT_CHANGED"):engine.restore()


def test_occluded_interior_does_not_block_measured_endpoints_or_refinement(tmp_path):
    frames=fixture();source=tmp_path/"source.mp4";ref=tmp_path/"ref.mp4"
    encode(source,frames);images=[f.copy() for f in frames[12:36]];images[12][:]=0;encode(ref,images)
    request=dict(referencePath=str(ref),sourcePaths=[str(source)],budgetSeconds=120,shots=[dict(start=0,end=2)],candidateLimit=2)
    parent=m.Engine(request,tmp_path/"parent",tmp_path/"cache",m.Encoder("diagnostic")).run()
    assert parent["shots"][0]["status"]=="VERIFIED"
    assert parent['shots'][0]['sourceStart']==1 and parent['shots'][0]['sourceEndExclusive']==3
    retained=json.dumps(parent).encode();out=tmp_path/"refined";out.mkdir();(out/"resume-report.json").write_bytes(retained)
    request["refinement"]=dict(parentJobId="parent",shotIds=["shot-001"],reportSha256=hashlib.sha256(retained).hexdigest(),
      windows=[dict(shotId="shot-001",sourceIndex=0,start=.5,end=3.5)])
    result=m.Engine(request,out,tmp_path/"cache",m.Encoder("diagnostic")).run();shot=result["shots"][0]
    assert shot["status"]=="VERIFIED",result
    assert len(shot["anchors"])>=3 and shot['sourceStart']==1 and shot['sourceEndExclusive']==3
    assert shot["candidateChecks"][-1]["retrievalScore"] is None
    assert shot["candidateChecks"][-1]["proposalOrigin"]=="RETAINED_LOCATION_OR_GPT_WINDOW"


def test_explicit_window_geometry_recovers_known_frames_when_descriptor_retrieval_misses(tmp_path,monkeypatch):
    frames=fixture();source=tmp_path/"source.mp4";ref=tmp_path/"ref.mp4"
    encode(source,frames);encode(ref,[np.clip(f[:,40:280].astype(float)*.8+25,0,255).astype(np.uint8) for f in frames[12:36]])
    request=dict(referencePath=str(ref),sourcePaths=[str(source)],budgetSeconds=120,shots=[dict(start=0,end=2)],candidateLimit=1)
    parent=m.Engine(request,tmp_path/"parent",tmp_path/"cache",m.Encoder("diagnostic"))
    parent.reference();parent.report["sources"]=[dict(path=str(source),fingerprint=m.fingerprint(source),**m.probe(source))]
    parent.report["status"]="PARTIAL";retained=json.dumps(parent.report).encode();out=tmp_path/"refine";out.mkdir();(out/"resume-report.json").write_bytes(retained)
    request["refinement"]=dict(parentJobId="parent",shotIds=["shot-001"],windows=[dict(shotId="shot-001",sourceIndex=0,start=0,end=6)],reportSha256=hashlib.sha256(retained).hexdigest())
    encoder=m.Encoder("diagnostic")
    monkeypatch.setattr(encoder,"similarity",lambda query,source:np.zeros(len(source),np.float32))
    report=m.Engine(request,out,tmp_path/"cache",encoder).run();shot=report["shots"][0]
    assert shot["status"]=="VERIFIED",report
    assert shot["sourceStart"]==1 and shot["sourceEndExclusive"]==3
    assert any(s["stage"]=="GEOMETRIC_WINDOW_SEARCH" for s in report["stages"])


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


def test_partial_index_resumes_without_reencoding_committed_frames(tmp_path):
    frames=fixture();source=tmp_path/"source.mp4";ref=tmp_path/"ref.mp4"
    encode(source,frames);encode(ref,frames[12:36])
    request=dict(referencePath=str(ref),sourcePaths=[str(source)],budgetSeconds=120,shots=[dict(start=0,end=2)])
    engine=m.Engine(request,tmp_path/"out",tmp_path/"cache",m.Encoder("diagnostic"))
    engine.reference()
    engine.report["sources"]=[dict(path=str(source),**m.probe(source))]
    # Interrupt immediately after the first atomically saved descriptor batch.
    progress=engine.progress
    def interrupt(stage,**values):
        progress(stage,**values)
        if stage=="SEARCHING":raise m.BudgetExpired()
    engine.progress=interrupt
    import pytest
    with pytest.raises(m.BudgetExpired):engine.scan(0,"0.125")
    first=list((tmp_path/"cache").glob("*/*.npz"))
    assert len(first)==1
    saved=first[0].read_bytes()
    resumed=m.Engine(request,tmp_path/"resume",tmp_path/"cache",m.Encoder("diagnostic"))
    resumed.reference();resumed.report["sources"]=engine.report["sources"]
    resumed.scan(0,"0.125")
    assert first[0].read_bytes()==saved
    assert resumed.metrics["cacheDescriptors"]>0
    assert list((tmp_path/"cache").glob("*/complete.json"))


def test_dense_verification_is_bounded_to_anchor_neighborhoods(tmp_path):
    frames=fixture();source=tmp_path/"source.mp4";ref=tmp_path/"ref.mp4"
    encode(source,frames);encode(ref,frames[12:36])
    request=dict(referencePath=str(ref),sourcePaths=[str(source)],budgetSeconds=120,
                 shots=[dict(start=0,end=2)],candidateLimit=1)
    report=m.Engine(request,tmp_path/"out",tmp_path/"cache",m.Encoder("diagnostic")).run()
    assert report["shots"][0]["status"]=="VERIFIED",report
    assert report["metrics"]["denseVerificationSeconds"]<m.probe(source)["duration"]


def test_wrong_middle_does_not_decode_endpoint_windows(tmp_path,monkeypatch):
    frames=fixture();source=tmp_path/"source.mp4";ref=tmp_path/"ref.mp4"
    encode(source,frames);encode(ref,frames[12:36])
    request=dict(referencePath=str(ref),sourcePaths=[str(source)],budgetSeconds=120,
                 shots=[dict(start=0,end=2)],candidateLimit=1)
    engine=m.Engine(request,tmp_path/"out",tmp_path/"cache",m.Encoder("diagnostic"))
    engine.reference();engine.report["sources"]=[dict(path=str(source),**m.probe(source))]
    engine.candidates={2:[(.9,0,2)]}
    calls=[];original=engine.source_frames
    def observed(file,start,end,interval=None):
        if interval is None:calls.append((start,end))
        return original(file,start,end,interval)
    monkeypatch.setattr(engine,"source_frames",observed)
    monkeypatch.setattr(m,"geometry",lambda *a,**k:dict(inliers=0,coverage=0.,fraction=0.,score=0.))
    engine.verify(rounds=1)
    assert len(calls)<=3 and sum(b-a for a,b in calls)<2
    assert engine.report["shots"][0]["candidateChecks"][0]["passed"] is False


def test_progressive_search_defers_weak_candidates_until_complete_pass(tmp_path,monkeypatch):
    engine=m.Engine({},tmp_path/"out",tmp_path/"cache",m.Encoder("diagnostic"))
    engine.report["sources"]=[dict(path="fixture",duration=100,fps=24)]
    engine.report["shots"]=[dict(shotId="s",referenceStart=0,referenceEnd=1,status="UNRESOLVED")]
    engine.queries=[dict(shot=0,frame=dict(image=fixture()[0],t=i/2)) for i in range(3)]
    engine.candidates={1:[(.4,0,10)]}
    calls=[]
    monkeypatch.setattr(engine,"source_frames",lambda *a,**k:calls.append(a) or iter([]))
    monkeypatch.setattr(m,"feature_points",lambda image:None)
    engine.verify(rounds=1,progressive=True)
    assert calls==[]
    engine.verify(rounds=1)
    assert len(calls)==1  # The weak candidate is deferred, never discarded.


def test_overlapping_dense_windows_are_not_decoded_twice():
    assert m.uncovered_windows([(1,5),(8,10)],[(2,3),(4,9)])==[(1,2),(3,4),(9,10)]


def test_weak_endpoints_cannot_displace_stronger_interior_location():
    strong=dict(complete=False,anchors=[dict(geometry=dict(score=50)) for _ in range(3)])
    weak=dict(complete=True,anchors=[dict(geometry=dict(score=15)) for _ in range(5)])
    assert m.strongest_hypothesis([weak,strong]) is strong
    # Same-quality competing copies remain comparable even with different counts.
    competing=dict(complete=True,anchors=[dict(geometry=dict(score=49)) for _ in range(5)])
    assert m.hypothesis_quality(competing)>=m.hypothesis_quality(strong)*.85


def test_valid_faint_endpoint_completes_its_own_location_but_never_a_different_copy():
    anchors=[dict(queryIndex=i,sourcePts=100+i,geometry=dict(score=50)) for i in range(1,4)]
    interior=dict(source=0,complete=False,anchors=anchors,alignment=dict(direction='FORWARD'))
    full=dict(source=0,complete=True,anchors=[dict(queryIndex=0,sourcePts=100,geometry=dict(score=1))]+anchors+
              [dict(queryIndex=4,sourcePts=104,geometry=dict(score=1))],alignment=dict(direction='FORWARD'))
    assert m.strongest_hypothesis([interior,full]) is interior
    assert m.completion_of_location(interior,[interior,full]) is full
    changed=copy.deepcopy(full);changed['anchors'][2]['sourcePts']+=1
    assert m.completion_of_location(interior,[interior,changed]) is interior
    changed=copy.deepcopy(full);changed['source']=1
    assert m.completion_of_location(interior,[interior,changed]) is interior


def test_retained_path_requires_fresh_exact_interior_and_unrestricted_endpoint_identity():
    good=dict(inliers=40,coverage=.6,fraction=.9,correlation=.9,score=20)
    anchors=[dict(queryIndex=i,referenceTime=i*.5,sourceTime=10+i*.5,sourcePts=120+i*6,
                  sourceFrameDurationVerified=True,geometry=good.copy()) for i in range(5)]
    prior=dict(anchors=anchors[1:4])
    options={i:[a.copy()] for i,a in enumerate(anchors)}
    stronger=dict(anchors[2],sourceTime=11+1/12,sourcePts=133,geometry={**good,'score':30})
    options[2].append(stronger)
    path=m.retained_location_path(prior,options,list(range(5)),1/12)
    assert path and path[0][2]['sourcePts']==132
    missing=copy.deepcopy(options);missing[2]=[stronger]
    assert m.retained_location_path(prior,missing,list(range(5)),1/12) is None
    ambiguous=copy.deepcopy(options);ambiguous[0].append(dict(anchors[0],sourceTime=12,sourcePts=144))
    assert m.retained_location_path(prior,ambiguous,list(range(5)),1/12) is None
    unmeasured=copy.deepcopy(options);unmeasured[4][0]['sourceFrameDurationVerified']=False
    assert m.retained_location_path(prior,unmeasured,list(range(5)),1/12) is None


def test_competing_copy_in_same_source_is_checked_after_location_search(tmp_path):
    frames=fixture();source=tmp_path/"repeated.mp4";ref=tmp_path/"ref.mp4"
    encode(source,frames+frames)
    encode(ref,frames[12:36])
    request=dict(referencePath=str(ref),sourcePaths=[str(source)],budgetSeconds=120,
                 shots=[dict(start=0,end=2)],candidateLimit=4)
    report=m.Engine(request,tmp_path/"out",tmp_path/"cache",m.Encoder("diagnostic")).run()
    assert report["alternativeReviewComplete"] is True
    assert report["shots"][0]["status"]=="UNRESOLVED",report
    assert report["status"]=="PARTIAL" and "sourceStart" not in report["shots"][0]


def test_location_priority_defers_known_alternatives_without_discarding_them(tmp_path,monkeypatch):
    engine=m.Engine({},tmp_path/"out",tmp_path/"cache",m.Encoder("diagnostic"))
    engine.report["sources"]=[dict(path="fixture",duration=100,fps=24)]
    engine.report["shots"]=[dict(shotId="s",referenceStart=0,referenceEnd=1,status="VERIFIED")]
    engine.queries=[dict(shot=0,frame=dict(image=fixture()[0],t=i/2)) for i in range(3)]
    engine.candidates={1:[(.9,0,10)]}
    calls=[]
    monkeypatch.setattr(engine,"source_frames",lambda *a,**k:calls.append(a) or iter([]))
    monkeypatch.setattr(m,"feature_points",lambda image:None)
    engine.verify(rounds=1,prioritize_locations=True)
    assert calls==[]
    engine.verify(rounds=1)
    assert len(calls)==1


def test_repeated_endpoint_frames_do_not_assert_an_exact_start(tmp_path):
    frames=fixture()
    for i in range(13,17):frames[i]=frames[12].copy()
    source=tmp_path/"source.mp4";ref=tmp_path/"ref.mp4"
    encode(source,frames);encode(ref,frames[12:36])
    request=dict(referencePath=str(ref),sourcePaths=[str(source)],budgetSeconds=120,
                 shots=[dict(start=0,end=2)],candidateLimit=1)
    report=m.Engine(request,tmp_path/"out",tmp_path/"cache",m.Encoder("diagnostic")).run()
    shot=report["shots"][0]
    assert shot["status"]=="LOCATED",report
    assert "sourceStart" not in shot and "sourceEndExclusive" not in shot


def test_verification_budget_gives_later_shots_a_turn(tmp_path,monkeypatch):
    engine=m.Engine({},tmp_path/"out",tmp_path/"cache",m.Encoder("diagnostic"))
    engine.report["sources"]=[dict(path="fixture",duration=100,fps=24)]
    frame=dict(image=fixture()[0],t=0)
    engine.queries=[dict(shot=i,frame=frame) for i in range(2) for _ in range(3)]
    engine.report["shots"]=[dict(shotId=f"s-{i}",referenceStart=i,referenceEnd=i+1,status="UNRESOLVED") for i in range(2)]
    engine.candidates={1:[(.9,0,10),(.8,0,20)],4:[(.9,0,30)]}
    calls=[]
    def blocked_window(file,start,end,interval=None):
        if len(calls)==2:raise m.BudgetExpired()
        calls.append(start)
        return iter([])
    monkeypatch.setattr(engine,"source_frames",blocked_window)
    monkeypatch.setattr(m,"feature_points",lambda image:None)
    import pytest
    with pytest.raises(m.BudgetExpired):engine.verify(rounds=2)
    assert calls==[6,26]  # First proposal for both shots, before shot 1's alternative.


def test_ffmpeg_sample_pts_match_original_decoder(tmp_path,monkeypatch):
    """Run the FFmpeg timestamp transport; CUDA alone is replaced on this CPU host."""
    source=tmp_path/"source.mp4";encode(source,fixture())
    import imageio_ffmpeg
    monkeypatch.setenv("EDITFLOW_SOURCE_MATCH_FFMPEG",imageio_ffmpeg.get_ffmpeg_exe())
    popen=m.subprocess.Popen
    def cpu_launch(command,**kwargs):
        command=list(command)
        for flag in ("-hwaccel","-hwaccel_output_format"):
            index=command.index(flag);del command[index:index+2]
        index=command.index("-vf")+1
        command[index]=command[index].replace("scale_cuda=","scale=").replace(":format=nv12","").replace("hwdownload,","")
        return popen(command,**kwargs)
    monkeypatch.setattr(m.subprocess,"Popen",cpu_launch)
    original={f["pts"]:f for f in m.decode(source)}
    samples=list(m.gpu_samples(source,.125,lambda:None,start=1.3,end=2.3,size=128))
    assert samples
    for f in samples:
        assert f["pts"] in original
        assert f["t"]==original[f["pts"]]["t"]
        assert 1.3<=f["t"]<2.3


def test_variable_frame_rate_end_exclusive_uses_observed_duration(tmp_path):
    frames=fixture();source=tmp_path/"vfr-source.mp4";ref=tmp_path/"ref.mp4"
    pts=[0]
    for i in range(len(frames)-1):pts.append(pts[-1]+(10 if i%2==0 else 20))
    encode(source,frames,pts=pts,time_base=Fraction(1,120))
    encode(ref,frames[12:36])
    original=list(m.decode(source))
    request=dict(referencePath=str(ref),sourcePaths=[str(source)],budgetSeconds=120,
                 shots=[dict(start=0,end=2)],candidateLimit=1)
    report=m.Engine(request,tmp_path/"out",tmp_path/"cache",m.Encoder("diagnostic")).run()
    shot=report["shots"][0]
    assert shot["status"]=="VERIFIED",report
    assert abs(shot["sourceStart"]-original[12]["t"])<1e-6
    assert abs(shot["sourceEndExclusive"]-original[36]["t"])<1e-6
