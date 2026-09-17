import argparse, json
from pathlib import Path
import cv2
import numpy as np

p=argparse.ArgumentParser()
p.add_argument('--baseline',required=True);p.add_argument('--defect',required=True);p.add_argument('--repaired',required=True)
p.add_argument('--action-json',required=True);p.add_argument('--result',required=True)
p.add_argument('--threshold',type=int,default=12)
a=p.parse_args()

def load(path):
    im=cv2.imread(str(path),cv2.IMREAD_COLOR)
    if im is None: raise RuntimeError(f'could not read image: {path}')
    return im
base,defect,repaired=map(load,[a.baseline,a.defect,a.repaired])
if base.shape!=defect.shape or base.shape!=repaired.shape: raise RuntimeError('repair evidence image dimensions differ')
action=json.loads(Path(a.action_json).read_text(encoding='utf-8-sig'))
h,w=base.shape[:2];r=action['window'];x1=max(0,int(r['left']));y1=max(0,int(r['top']));x2=min(w,int(r['right']));y2=min(h,int(r['bottom']))
if x2-x1<100 or y2-y1<100: raise RuntimeError('invalid Mocha comparison crop')
B=base[y1:y2,x1:x2].astype(np.int16);D=defect[y1:y2,x1:x2].astype(np.int16);R=repaired[y1:y2,x1:x2].astype(np.int16)
def metrics(X,Y):
    delta=np.abs(Y-X);px=delta.max(axis=2)>=a.threshold
    changed=int(px.sum());mean=float(delta.mean());mx=int(delta.max())
    if changed:
        ys,xs=np.where(px);bbox=[int(xs.min()+x1),int(ys.min()+y1),int(xs.max()+1+x1),int(ys.max()+1+y1)]
    else:bbox=None
    return changed,mean,mx,bbox,px,delta
dc,dm,dx,dbox,dmask,ddelta=metrics(B,D)
rc,rm,rx,rbox,rmask,rdelta=metrics(B,R)
drc,drm,drx,drbox,_,_=metrics(D,R)
residual_ratio=float(rc/max(1,dc));mean_ratio=float(rm/max(1e-9,dm))
defect_visible=dc>=25 and dm>=0.002
repair_restored=defect_visible and residual_ratio<=0.35 and mean_ratio<=0.35
out={
 'ok':bool(defect_visible and repair_restored),'threshold':a.threshold,
 'crop':{'left':x1,'top':y1,'right':x2,'bottom':y2,'width':x2-x1,'height':y2-y1},
 'defect':{'changedPixels':dc,'meanAbs':dm,'maxAbs':dx,'bbox':dbox,'visible':bool(defect_visible)},
 'repairedResidual':{'changedPixels':rc,'meanAbs':rm,'maxAbs':rx,'bbox':rbox,'residualPixelRatio':residual_ratio,'meanAbsRatio':mean_ratio,'restored':bool(repair_restored)},
 'defectVsRepaired':{'changedPixels':drc,'meanAbs':drm,'maxAbs':drx,'bbox':drbox}
}
result=Path(a.result);result.parent.mkdir(parents=True,exist_ok=True);result.write_text(json.dumps(out,indent=2)+'\n',encoding='utf-8')
# Persist compact visual masks as independent evidence.
for name,mask in [('repair-defect-diff.png',dmask),('repair-residual-diff.png',rmask)]:
    vis=np.zeros((mask.shape[0],mask.shape[1],3),dtype=np.uint8);vis[mask]=255;cv2.imwrite(str(result.parent/name),vis)
print(json.dumps(out,separators=(',',':')))
raise SystemExit(0 if out['ok'] else 2)
