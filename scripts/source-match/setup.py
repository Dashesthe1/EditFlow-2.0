"""Install the official SSCD model; verify bytes and GPU before marking ready."""
import argparse, hashlib, json, os, shutil, sys, urllib.request
from pathlib import Path
import torch, av, cv2, imageio_ffmpeg

MODEL_URL = "https://dl.fbaipublicfiles.com/sscd-copy-detection/sscd_disc_mixup.torchscript.pt"
MODEL_SHA256 = "9f26bd4c848cc19b73d2ae92eea6e04886f61a7b764ceb7a13aeee62e6a6db56"

def setup(root, cpu=False):
    root=Path(root);root.mkdir(parents=True,exist_ok=True)
    model=root/"source-match-models"/"sscd_disc_mixup.torchscript.pt"
    model.parent.mkdir(exist_ok=True)
    if not model.exists():
        temp=model.with_suffix(".tmp")
        with urllib.request.urlopen(MODEL_URL,timeout=60) as r, temp.open("wb") as f:
            shutil.copyfileobj(r,f)
        temp.replace(model)
    digest=hashlib.sha256(model.read_bytes()).hexdigest()
    if digest!=MODEL_SHA256:
        raise RuntimeError("SSCD model checksum mismatch; no configuration published")
    if not cpu and not torch.cuda.is_available():
        raise RuntimeError("CUDA unavailable. Repair the driver or explicitly install with -CpuOnly")
    device="cpu" if cpu else "cuda"
    network=torch.jit.load(str(model),map_location=device).eval()
    with torch.inference_mode():
        result=network(torch.zeros((1,3,256,256),device=device))
    if result.shape!=(1,512) or not torch.isfinite(result).all():
        raise RuntimeError("SSCD smoke inference failed")
    value=dict(schema="editflow.source-match-runtime.v1",python=sys.executable,model=str(model),
               modelSha256=digest,device=device,backend="sscd",torchVersion=torch.__version__,ffmpeg=imageio_ffmpeg.get_ffmpeg_exe())
    config=root/"source-match-config.json"
    temp=config.with_suffix(".tmp")
    temp.write_text(json.dumps(value,indent=2),encoding="utf-8");os.replace(temp,config)
    print(json.dumps(value),flush=True)

if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--data-root",required=True);p.add_argument("--cpu",action="store_true")
    a=p.parse_args();setup(a.data_root,a.cpu)
