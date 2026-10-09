"""Create an original, known-frame edit project for the full service handoff check."""
import argparse
import hashlib
import json
from pathlib import Path

from test_engine import fixture, encode, m


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output',required=True)
    p.add_argument('--shots',type=int,default=20)
    args=p.parse_args()
    out=Path(args.output).resolve();out.mkdir(parents=True,exist_ok=True)
    if not 2<=args.shots<=40:raise ValueError('Use 2..40 fixture shots')
    images=fixture();source=out/'source.mp4';reference=out/'reference.mp4'
    project=out/'original-edit.project.json';export=out/'original-frame-map.json'
    indices=[list(range(24,48)) if i%2==0 else list(range(12,36)) for i in range(args.shots)]
    # This is the actual original definition used to render the reference, not a
    # project inferred after matching. Only the final shot hides its endpoints.
    definition=dict(schema='editflow.known-frame-fixture.v1',fps=12,sourceFrameIndices=indices,
                    blackEndpointOverlayShot=args.shots-1)
    project.write_text(json.dumps(definition,indent=2))
    encode(source,images)
    selected=[]
    for i,sequence in enumerate(indices):
        frames=[images[n].copy() for n in sequence]
        if i==args.shots-1:frames[0][:]=0;frames[-1][:]=0
        selected.extend(frames)
    encode(reference,selected)
    src=list(m.decode(source));ref=list(m.decode(reference))
    shots=[dict(start=i*2,end=(i+1)*2) for i in range(args.shots)]
    timeline=dict(schema='editflow.original-timeline-frame-map.v1',referenceFingerprint=m.fingerprint(reference),
        sourceFingerprints=[m.fingerprint(source)],provenance=dict(kind='ORIGINAL_EDIT_PROJECT_EXPORT',
        projectPath=str(project),projectSha256=hashlib.sha256(project.read_bytes()).hexdigest(),exporter='known-original-project-fixture'),
        shots=[dict(shotId=f'shot-{args.shots:03}',sourceIndex=0,referenceStart=shots[-1]['start'],referenceEnd=shots[-1]['end'],
            referenceTimeBase=ref[0]['timeBase'],sourceTimeBase=src[0]['timeBase'],direction='FORWARD',
            sourceInPts=src[indices[-1][0]]['pts'],sourceOutPtsExclusive=src[indices[-1][-1]+1]['pts'],
            frames=[dict(referencePts=f['pts'],sourcePts=src[n]['pts']) for f,n in zip(ref[-24:],indices[-1])])])
    export.write_text(json.dumps(timeline,indent=2))
    m.atomic_json(out/'fixture.json',dict(referencePath=str(reference),sourcePaths=[str(source)],shots=shots,
        timelinePath=str(export),expected=[dict(start=n[0]/12,end=(n[-1]+1)/12) for n in indices],
        scope='Known 320x240 12fps original project; not real movie recovery or a two-hour benchmark'))
    print(str(out/'fixture.json'))


if __name__=='__main__':main()
