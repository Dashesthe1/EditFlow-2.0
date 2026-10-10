"""Extraction-only benchmark. Repeats known endpoint ranges; never accepts a report or writes AE."""
import argparse
import concurrent.futures
import json
from pathlib import Path
import time

from assemble_ranges import materialize, atomic_json


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--report', required=True)
    p.add_argument('--ffmpeg', required=True)
    p.add_argument('--output', required=True)
    p.add_argument('--count', type=int, default=20)
    p.add_argument('--encoder', choices=['NVENC', 'CPU'], default='NVENC')
    args = p.parse_args()
    report = json.loads(Path(args.report).read_text())
    known = [s for s in report['shots'] if s['status'] == 'VERIFIED']
    if not known:
        raise ValueError('At least one endpoint-verified range needed for the extraction check')
    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)
    shots = [dict(**{k:v for k,v in known[i % len(known)].items() if k!='shotId'},shotId=f'check-{i:03}')
             for i in range(args.count)]
    sources = {s['path']:s for s in report['sources']}
    started = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda s: materialize(s,sources[s['sourcePath']],out,args.ffmpeg,args.encoder), shots))
    result = dict(schema='editflow.source-assembly-check.v1',encoder=args.encoder,count=len(results),
                  uniqueVerifiedRanges=len(known), elapsedSeconds=time.monotonic()-started,
                  sourceSeconds=sum(s['sourceEndExclusive']-s['sourceStart'] for s in shots),
                  frameCount=sum(s['frameCount'] for s in results),
                  maxFrameTimingErrorSeconds=max(s['frameTimingErrorSeconds'] for s in results),
                  maxEndpointPixelMeanError=max(s['endpointPixelMeanError'] for s in results),
                  scope='Extraction-only, 20 ranges repeated from endpoint-verified evidence. Not full-edit timestamp verification or AE assembly.')
    atomic_json(out/'results.json',result)
    print(json.dumps(result),flush=True)


if __name__ == '__main__':
    main()
