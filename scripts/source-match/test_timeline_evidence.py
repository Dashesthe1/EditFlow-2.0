"""Known-frame project export checks, including boundaries hidden in rendered pixels."""
import copy
import importlib.util
import json
from pathlib import Path

import pytest

from test_engine import encode, fixture, m

spec=importlib.util.spec_from_file_location('timeline_evidence',Path(__file__).with_name('timeline_evidence.py'))
t=importlib.util.module_from_spec(spec);spec.loader.exec_module(t)


def evidence(root,reverse=False):
    source=root/'source.mp4';ref=root/'reference.mp4';project=root/'original-edit.project';export=root/'original-frame-map.json'
    images=fixture();encode(source,images)
    selected=[f.copy() for f in images[12:36]]
    if reverse:selected.reverse()
    selected[0][:]=0;selected[-1][:]=0;encode(ref,selected)
    report=m.Engine(dict(referencePath=str(ref),sourcePaths=[str(source)],shots=[dict(start=0,end=2)],budgetSeconds=90),
                    root/'parent',root/'cache',m.Encoder('diagnostic')).run()
    assert report['shots'][0]['status']=='LOCATED'
    src=list(m.decode(source));reference=list(m.decode(ref))
    indices=list(range(12,36))
    if reverse:indices.reverse()
    project.write_bytes(b'Known original project fixture; raw frames 12..35, black endpoint overlays.')
    timeline=dict(schema='editflow.original-timeline-frame-map.v1',referenceFingerprint=report['reference']['fingerprint'],
                  sourceFingerprints=[s['fingerprint'] for s in report['sources']],
                  provenance=dict(kind='ORIGINAL_EDIT_PROJECT_EXPORT',projectPath=str(project),projectSha256=t.file_sha256(project),exporter='known-frame-fixture'),
                  shots=[dict(shotId='shot-001',sourceIndex=0,referenceStart=0,referenceEnd=2,
                              sourceInPts=src[12]['pts'],sourceOutPtsExclusive=src[36]['pts'],sourceTimeBase=src[12]['timeBase'],
                              referenceTimeBase=reference[0]['timeBase'],direction='REVERSE' if reverse else 'FORWARD',
                              frames=[dict(referencePts=f['pts'],sourcePts=src[i]['pts']) for f,i in zip(reference,indices)])])
    export.write_text(json.dumps(timeline))
    return report,timeline,export,project


@pytest.mark.parametrize('reverse',[False,True])
def test_original_project_map_resolves_hidden_boundaries_without_claiming_pixel_endpoint_proof(tmp_path,reverse):
    parent,timeline,path,_=evidence(tmp_path,reverse)
    saved=copy.deepcopy(parent)
    result=t.validate(parent,timeline,path)
    assert parent==saved
    assert result['status']=='COMPLETE'
    shot=result['shots'][0]
    assert shot['boundaryStatus']=='ORIGINAL_TIMELINE_FRAME_MAP'
    assert shot['sourceStart']==1 and shot['sourceEndExclusive']==3
    assert shot['originalTimelineEvidence']['recheckedPixelAnchors']>=3
    assert shot['originalTimelineEvidence']['direction']==('REVERSE' if reverse else 'FORWARD')
    assert shot['exactBoundaryGuaranteed'] is False
    assert len(shot['originalTimelineFrameMap'])==24


def test_missing_project_changed_media_and_guessed_or_incomplete_maps_are_rejected(tmp_path):
    parent,timeline,path,project=evidence(tmp_path)
    for edit,expected in [
        (lambda v:v['provenance'].update(projectSha256='0'*64),'PROJECT_IDENTITY'),
        (lambda v:v.update(referenceFingerprint='foreign'),'REFERENCE_IDENTITY'),
        (lambda v:v['shots'][0]['frames'].pop(),'COMPLETE_REFERENCE'),
        (lambda v:v['shots'][0]['frames'][8].update(sourcePts=1),'FRAME_MAP_INVALID'),
        (lambda v:v['shots'][0].update(sourceInPts=1),'SOURCE_FRAME_NOT_FOUND|START_DOES_NOT'),
        (lambda v:v['shots'][0]['frames'][12].update(sourcePts=v['shots'][0]['frames'][13]['sourcePts']),'MEASURED_ANCHOR'),
        (lambda v:v['shots'][0].update(referenceTimeBase='1/99'),'REFERENCE_CUT'),
    ]:
        value=copy.deepcopy(timeline);edit(value)
        with pytest.raises(ValueError,match=expected):t.validate(parent,value,path)
    project.write_bytes(b'Changed original project')
    with pytest.raises(ValueError,match='PROJECT_IDENTITY'):t.validate(parent,timeline,path)


def test_metadata_cannot_create_a_location_without_actual_retained_pixel_anchors(tmp_path):
    parent,timeline,path,_=evidence(tmp_path)
    parent['shots'][0]['anchors']=[]
    with pytest.raises(ValueError,match='RETAINED_PIXEL_LOCATION'):t.validate(parent,timeline,path)
