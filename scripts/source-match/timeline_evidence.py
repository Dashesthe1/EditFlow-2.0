"""Validate an original edit's explicit frame map. Never infer hidden endpoints.

Input is a canonical JSON export, not a guessed timestamp table. Its original
project bytes, media identities, actual frame PTS and retained pixel anchors are
checked before any metadata-derived boundary can enter an official report.
"""
import argparse
import copy
import hashlib
import json
import importlib.util
import time
from fractions import Fraction
from pathlib import Path

spec = importlib.util.spec_from_file_location('source_match_engine', Path(__file__).with_name('engine.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def file_sha256(file):
    h = hashlib.sha256()
    with Path(file).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def integer(value):
    return isinstance(value, int) and not isinstance(value, bool)


def validate(parent, timeline, timeline_path, check=lambda: None):
    if timeline.get('schema') != 'editflow.original-timeline-frame-map.v1':
        raise ValueError('ORIGINAL_TIMELINE_FRAME_MAP_REQUIRED')
    provenance = timeline.get('provenance', {})
    project = Path(provenance.get('projectPath', ''))
    if provenance.get('kind') != 'ORIGINAL_EDIT_PROJECT_EXPORT' or not project.is_file():
        raise ValueError('ORIGINAL_PROJECT_PROVENANCE_REQUIRED')
    if not isinstance(provenance.get('exporter'), str) or not provenance['exporter'].strip():
        raise ValueError('ORIGINAL_PROJECT_EXPORTER_REQUIRED')
    if project.resolve() == Path(timeline_path).resolve() or file_sha256(project) != provenance.get('projectSha256'):
        raise ValueError('ORIGINAL_PROJECT_IDENTITY_MISMATCH')
    ref = parent['reference']
    if timeline.get('referenceFingerprint') != ref['fingerprint'] or m.fingerprint(ref['path']) != ref['fingerprint']:
        raise ValueError('TIMELINE_REFERENCE_IDENTITY_MISMATCH')
    sources = parent['sources']
    if timeline.get('sourceFingerprints') != [s['fingerprint'] for s in sources]:
        raise ValueError('TIMELINE_SOURCE_IDENTITY_MISMATCH')
    for source in sources:
        check()
        if m.fingerprint(source['path']) != source['fingerprint']:
            raise ValueError('TIMELINE_SOURCE_CHANGED')
    incoming = timeline.get('shots')
    if not isinstance(incoming, list) or not incoming or len({s.get('shotId') for s in incoming}) != len(incoming):
        raise ValueError('TIMELINE_SHOTS_REQUIRED')
    by_id = {s['shotId']: s for s in parent['shots']}
    result = copy.deepcopy(parent)
    result_by_id = {s['shotId']: s for s in result['shots']}
    receipt = dict(kind='ORIGINAL_EDIT_PROJECT_EXPORT', projectPath=str(project.resolve()),
                   projectSha256=provenance['projectSha256'], exporter=provenance['exporter'],
                   timelinePath=str(Path(timeline_path).resolve()), timelineSha256=file_sha256(timeline_path))
    for entry in incoming:
        check()
        shot = by_id.get(entry.get('shotId'))
        if not shot or not shot.get('sourcePath') or len(shot.get('anchors', [])) < 3:
            raise ValueError('TIMELINE_REQUIRES_RETAINED_PIXEL_LOCATION')
        source_index = entry.get('sourceIndex')
        if not integer(source_index) or not 0 <= source_index < len(sources) or source_index != shot.get('sourceIndex'):
            raise ValueError('TIMELINE_SOURCE_LOCATION_MISMATCH')
        source = sources[source_index]
        if entry.get('referenceTimeBase') != ref['timeBase'] or entry.get('referenceStart') != shot['referenceStart'] or entry.get('referenceEnd') != shot['referenceEnd']:
            raise ValueError('TIMELINE_REFERENCE_CUT_MISMATCH')
        pts_in, pts_out = entry.get('sourceInPts'), entry.get('sourceOutPtsExclusive')
        if not integer(pts_in) or not integer(pts_out) or pts_out <= pts_in or entry.get('sourceTimeBase') != source['timeBase']:
            raise ValueError('TIMELINE_INTEGER_SOURCE_PTS_REQUIRED')
        tb = Fraction(source['timeBase'])
        start = float(pts_in * tb) - source['origin']
        end = float(pts_out * tb) - source['origin']
        if not 0 <= start < end <= source['duration'] + 2e-6:
            raise ValueError('TIMELINE_SOURCE_RANGE_INVALID')
        reference = list(m.decode(ref['path'], shot['referenceStart'], shot['referenceEnd'], size=320, check=check))
        frame_map = entry.get('frames')
        if not isinstance(frame_map, list) or len(frame_map) != len(reference) or not reference:
            raise ValueError('COMPLETE_REFERENCE_FRAME_MAP_REQUIRED')
        if any(not integer(v.get('referencePts')) or not integer(v.get('sourcePts'))
               or v['referencePts'] != f['pts'] or not pts_in <= v['sourcePts'] < pts_out
               for v, f in zip(frame_map, reference)):
            raise ValueError('TIMELINE_FRAME_MAP_INVALID')
        # Decode one successor to prove that the exclusive end is a real source
        # boundary; VFR/nonzero origins use integer PTS, never rounded FPS.
        original = list(m.decode(source['path'], start, min(source['duration'] + 2e-6, end + max(.2, 2 / source['fps'])),
                                 size=320, check=check))
        by_pts = {f['pts']: f for f in original}
        if pts_in not in by_pts or any(v['sourcePts'] not in by_pts for v in frame_map):
            raise ValueError('TIMELINE_SOURCE_FRAME_NOT_FOUND')
        if pts_out not in by_pts:
            last = original[-1] if original else None
            if not last or not last['durationVerified'] or abs(last['t'] + last['duration'] - end) > 2e-6:
                raise ValueError('TIMELINE_EXCLUSIVE_END_NOT_FOUND')
        if min(v['sourcePts'] for v in frame_map) != pts_in:
            raise ValueError('TIMELINE_START_DOES_NOT_MATCH_TRAVERSAL')
        high = by_pts[max(v['sourcePts'] for v in frame_map)]
        successors = [f for f in original if f['pts'] > high['pts']]
        if successors:
            if successors[0]['pts'] != pts_out:
                raise ValueError('TIMELINE_END_DOES_NOT_MATCH_TRAVERSAL')
        elif not high['durationVerified'] or abs(high['t']+high['duration']-end)>2e-6:
            raise ValueError('TIMELINE_END_DOES_NOT_MATCH_TRAVERSAL')
        delta = [b['sourcePts'] - a['sourcePts'] for a, b in zip(frame_map, frame_map[1:])]
        direction = entry.get('direction')
        if direction not in ('FORWARD', 'REVERSE') or any(d < 0 if direction == 'FORWARD' else d > 0 for d in delta):
            raise ValueError('TIMELINE_DIRECTION_OR_TRAVERSAL_INVALID')
        # Timeline data must agree with every already measured picture, not just
        # the middle pose. A metadata declaration cannot overturn pixel evidence.
        matched = 0
        for anchor in shot['anchors']:
            n = min(range(len(reference)), key=lambda k: abs(reference[k]['t'] - anchor['referenceTime']))
            if abs(reference[n]['t'] - anchor['referenceTime']) > 2e-6 or frame_map[n]['sourcePts'] != anchor['sourcePts']:
                raise ValueError('TIMELINE_CONFLICTS_WITH_MEASURED_ANCHOR')
            src = by_pts.get(anchor['sourcePts'])
            if src is None or not m.valid_geometry(m.geometry(reference[n]['image'], src['image'])):
                raise ValueError('TIMELINE_PIXEL_LOCATION_RECHECK_FAILED')
            matched += 1
        if matched < 3:
            raise ValueError('TIMELINE_REQUIRES_THREE_PIXEL_ANCHORS')
        target = result_by_id[shot['shotId']]
        target.pop('sourceLocationWindow', None)
        target.update(status='VERIFIED', boundaryStatus='ORIGINAL_TIMELINE_FRAME_MAP', boundaryDiagnostics=[],
                      boundaryEvidenceKind='PROJECT_METADATA_WITH_PIXEL_LOCATION_RECHECK',
                      sourceStart=start, sourceEndExclusive=end, sourceStartTimecode=m.timecode(start),
                      sourceEndTimecode=m.timecode(end), exactBoundaryGuaranteed=False,
                      sourceStartPts=pts_in,sourceEndPtsExclusive=pts_out,sourceTimeBase=source['timeBase'],
                      reason='Original project frame map, media identities, decoded PTS and retained pixel location agree; GPT review still required',
                      originalTimelineEvidence={**receipt, 'referenceFrameCount': len(reference),
                                                'sourceInPts': pts_in, 'sourceOutPtsExclusive': pts_out,
                                                'sourceTimeBase': source['timeBase'], 'direction': direction,
                                                'recheckedPixelAnchors': matched}, originalTimelineFrameMap=frame_map)
    result['timelineEvidence'] = receipt
    result['summary'] = {state: sum(s['status'] == state for s in result['shots']) for state in ['VERIFIED', 'LOCATED', 'UNRESOLVED']}
    result['status'] = 'COMPLETE' if result.get('alternativeReviewComplete') is True and all(s['status'] == 'VERIFIED' for s in result['shots']) else 'PARTIAL'
    result['boundaryAccuracy'] = 'Pixel correspondences and explicitly distinguished original-project frame maps; no inferred hidden endpoints'
    return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--request', required=True)
    p.add_argument('--output', required=True)
    args = p.parse_args()
    out = Path(args.output)
    request = json.loads(Path(args.request).read_text())
    original = (out / 'resume-report.json').read_bytes()
    if hashlib.sha256(original).hexdigest() != request['refinement']['reportSha256']:
        raise ValueError('RETAINED_REPORT_CHANGED')
    parent = json.loads(original)
    started=time.monotonic()
    m.atomic_json(out/'report.json',parent)
    m.timestamps_csv(out,parent)
    m.atomic_json(out/'progress.json',dict(stage='VALIDATING_ORIGINAL_TIMELINE',elapsedSeconds=0))
    timeline = json.loads(Path(request['timelinePath']).read_text(encoding='utf-8-sig'))
    if file_sha256(request['timelinePath']) != request['timelineSha256']:
        raise ValueError('TIMELINE_CHANGED_SINCE_SUBMISSION')
    def check():
        if (out / 'cancel').exists():
            raise m.BudgetExpired()
        if time.monotonic()-started>request.get('budgetSeconds',480):
            raise m.BudgetExpired()
    try:
        result = validate(parent, timeline, request['timelinePath'], check)
    except m.BudgetExpired:
        result=copy.deepcopy(parent)
        result['status']='CANCELLED' if (out/'cancel').exists() else 'PARTIAL'
    result['engine'] = m.VERSION
    result['engineSha256'] = m.ENGINE_SHA256
    result['backend']='ORIGINAL_TIMELINE_EVIDENCE'
    result['device']='cpu'
    result['elapsedSeconds']=round(time.monotonic()-started,3)
    result['metrics']=dict(timelineShotsRequested=len(timeline.get('shots',[])),
                           validatedTimelineShots=sum(s.get('boundaryStatus')=='ORIGINAL_TIMELINE_FRAME_MAP' for s in result['shots']))
    result['stages']=[dict(stage='ORIGINAL_TIMELINE_VALIDATION_FINISHED',elapsedSeconds=result['elapsedSeconds'],status=result['status'])]
    result['lineage'] = dict(parentJobId=request['refinement']['parentJobId'], reportSha256=request['refinement']['reportSha256'],
                             retainedEvidence=True, operation='IMPORT_ORIGINAL_TIMELINE')
    m.atomic_json(out / 'report.json', result)
    m.timestamps_csv(out,result)
    m.atomic_json(out/'progress.json',result['stages'][-1])


if __name__ == '__main__':
    main()
