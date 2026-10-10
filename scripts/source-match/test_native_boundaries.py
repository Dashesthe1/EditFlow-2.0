"""Known-frame video fixtures for native boundary recovery and honest occlusion."""
import copy
import hashlib
import json
from pathlib import Path
from test_engine import m, encode, fixture
import numpy as np
import cv2


def prepared(tmp_path, mapping, black=(), pts=None):
    frames=fixture();source=tmp_path/'raw.mp4';reference=tmp_path/'edit.mp4'
    encode(source,frames)
    edits=[frames[n].copy() for n in mapping]
    for n in black:edits[n][:]=0
    encode(reference,edits,pts=pts)
    raw=list(m.decode(source,size=640));refs=list(m.decode(reference,size=640))
    usable=[n for n in range(len(mapping)) if n not in black]
    indexes=np.unique(np.round(np.linspace(0,len(usable)-1,3)).astype(int))
    anchors=[]
    for j in indexes:
        n=usable[j];r=refs[n];s=raw[mapping[n]]
        anchors.append(dict(referenceTime=r['t'],sourceTime=s['t'],sourcePts=s['pts'],sourceTimeBase=s['timeBase'],
            sourceFrameDuration=s['duration'],sourceFrameDurationVerified=True,geometry=m.geometry(r['image'],s['image']),queryIndex=n))
    alignment=m.temporal_alignment(anchors,1/12)
    engine=m.Engine(dict(referencePath=str(reference),sourcePaths=[str(source)],budgetSeconds=180),tmp_path/'out',tmp_path/'cache',m.Encoder('diagnostic'))
    engine.queries=[dict(shot=0,frame=r) for r in refs]
    engine.report.update(reference={**m.probe(reference),'path':str(reference)},sources=[{**m.probe(source),'path':str(source)}],
        shots=[dict(shotId='shot-001',referenceStart=0,referenceEnd=m.probe(reference)['duration'],status='LOCATED',sourcePath=str(source),sourceIndex=0,anchors=anchors,alignment=alignment,boundaryStatus='UNRESOLVED')])
    return engine,raw,refs


def test_native_black_burst_is_separate_from_visible_picture(tmp_path):
    engine,raw,refs=prepared(tmp_path,list(range(20,40)),black=(0,1,2))
    engine.native_boundaries()
    result=engine.report['boundaryRecoveries']['shot-001'];shot=engine.report['shots'][0]
    assert result['status']=='VISIBLE_CONTENT_MEASURED'
    expected=[r for r in refs if r['t']<.55 or r['t']>=engine.report['shots'][0]['referenceEnd']-.55
              or any(abs(r['t']-a['referenceTime'])<1e-6 for a in engine.report['shots'][0]['anchors'])]
    assert result['actualReferenceFrameCount']==len(expected)
    assert not result['exactOriginalTrimMeasured'] and not result['hiddenEndpointsInferred']
    assert shot['status']=='LOCATED' and 'sourceStartPts' not in shot
    assert result['visibleSourceRange']['sourceStartPts']==raw[23]['pts']
    assert result['visibleSourceRange']['referenceStart']==refs[3]['t']
    event=result['transitionEvents'][0]
    assert event['referencePts']==[r['pts'] for r in refs[:3]]
    assert event['hiddenSourcePts'] is None and not event['effectCauseProven']


def test_native_visible_endpoints_recover_exact_trim_and_preserve_verified(tmp_path):
    engine,raw,refs=prepared(tmp_path,list(range(20,40)))
    preserved=copy.deepcopy(engine.report['shots'][0]);preserved.update(shotId='shot-002',status='VERIFIED')
    engine.report['shots'].append(copy.deepcopy(preserved))
    engine.native_boundaries()
    shot=engine.report['shots'][0]
    assert shot['status']=='VERIFIED'
    assert shot['sourceStartPts']==raw[20]['pts']
    assert shot['sourceEndPtsExclusive']==raw[40]['pts']
    assert engine.report['shots'][1]==preserved


def test_dark_picture_is_not_classified_as_blackout():
    dark=np.clip(fixture()[22].astype(float)*.06,0,255).astype(np.uint8)
    assert m.transition_appearance(dark)['kind']=='PICTURE_OR_UNCLASSIFIED'
    assert m.transition_appearance(np.zeros_like(dark))['kind']=='BLACKOUT_APPEARANCE'
    assert m.transition_appearance(np.full_like(dark,255))['kind']=='WHITE_FLASH_APPEARANCE'
    caption=np.zeros((640,360,3),np.uint8)
    cv2.putText(caption,'ONLY TEXT',(25,330),0,.8,(255,255,255),2)
    assert m.transition_appearance(caption)['kind']=='BLACK_WITH_LOCAL_OVERLAY_CANDIDATE'


def test_repeated_frames_and_reverse_traversal_use_measured_pts(tmp_path):
    mapping=[39,39,38,37,37,36,35,35,34,33,32,31,30,29,28,27,26,25,24,23]
    engine,raw,refs=prepared(tmp_path,mapping)
    engine.native_boundaries()
    shot=engine.report['shots'][0]
    assert shot['status']=='VERIFIED' and shot['alignment']['direction']=='REVERSE'
    assert shot['sourceStartPts']==raw[23]['pts']
    assert shot['sourceEndPtsExclusive']==raw[40]['pts']
    observed=engine.report['boundaryRecoveries']['shot-001']['measuredFrameMap']
    assert observed[0]['sourcePts']==observed[1]['sourcePts']==raw[39]['pts']


def test_unmatched_picture_is_not_declared_a_flash(tmp_path):
    engine,raw,refs=prepared(tmp_path,list(range(20,40)))
    engine.report['shots'][0]['anchors'][1]['sourcePts']=raw[60]['pts']
    engine.native_boundaries()
    result=engine.report['boundaryRecoveries']['shot-001']
    assert result['status']=='VISIBLE_CONTENT_MEASURED' and result['contradictions']
    assert not result['exactOriginalTrimMeasured']
    assert not result['transitionEvents'] and engine.report['shots'][0]['status']=='LOCATED'


def test_vfr_reference_keeps_actual_pts_and_duration(tmp_path):
    pts=[0,1,2,4,5,7,8,9,11,12,13,15,16,17,19,20,22,23,24,26]
    engine,raw,refs=prepared(tmp_path,list(range(20,40)),black=(0,),pts=pts)
    engine.native_boundaries()
    result=engine.report['boundaryRecoveries']['shot-001']
    assert [r['referencePts'] for r in result['frames']]==[r['pts'] for r in refs if r['t']<.55 or r['t']>=engine.report['shots'][0]['referenceEnd']-.55 or any(abs(r['t']-a['referenceTime'])<1e-6 for a in engine.report['shots'][0]['anchors'])]
    assert result['transitionEvents'][0]['referenceEndExclusive']==refs[1]['t']


def test_known_refinement_skips_descriptors_and_rejects_changed_parent(tmp_path):
    engine,raw,refs=prepared(tmp_path,list(range(20,40)),black=(0,))
    engine.report['reference']['fingerprint']=m.fingerprint(engine.report['reference']['path'])
    engine.report['sources'][0]['fingerprint']=m.fingerprint(engine.report['sources'][0]['path'])
    retained=json.dumps(engine.report).encode();(engine.out/'resume-report.json').write_bytes(retained)
    engine.request.update(shots=[dict(start=0,end=engine.report['reference']['duration'])],
        refinement=dict(parentJobId='parent',shotIds=['shot-001'],windows=[],reportSha256=hashlib.sha256(retained).hexdigest()))
    engine.encoder.encode=lambda *a:(_ for _ in ()).throw(AssertionError('Known boundaries must not encode descriptors'))
    assert engine.restore_native_locations()
    engine.native_boundaries()
    assert engine.report['boundaryRecoveries']['shot-001']['status']=='VISIBLE_CONTENT_MEASURED'
    (engine.out/'resume-report.json').write_bytes(retained+b' ')
    try:engine.restore_native_locations()
    except ValueError as e:assert str(e)=='RETAINED_REPORT_CHANGED'
    else:raise AssertionError('Modified parent report accepted')
