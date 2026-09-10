import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { decodeBmp24, trackPoint } from "../.tmp/runtime/packages/tracking/src/index.js";
import { AeCepAdapterClientV11, AeFilesystemPolicyV11 } from "../.tmp/runtime/packages/adapters/ae-cep/src/v1_1.js";
import { AE_ADAPTER_PROTOCOL_VERSION_V11 } from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_1.js";
import { LoopbackCepBroker } from "../.tmp/runtime/apps/desktop-host/src/loopback-cep.js";

const arg=n=>{const i=process.argv.indexOf(n);return i>=0?process.argv[i+1]??null:null};
const req=n=>{const v=arg(n);if(!v)throw new Error(`Missing ${n}`);return v};
const bom=s=>s.charCodeAt(0)===0xfeff?s.slice(1):s;
const rec=v=>v&&typeof v==="object"&&!Array.isArray(v)?v:null;
const exists=async p=>{try{return(await stat(p)).size>0}catch{return false}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const writeJson=async(p,v)=>{await mkdir(path.dirname(p),{recursive:true});await writeFile(p,JSON.stringify(v,null,2)+"\n","utf8")};
const bmp=(w,h,pixel)=>{const stride=Math.ceil(w*3/4)*4,b=Buffer.alloc(54+stride*h);b.write("BM",0,2,"ascii");b.writeUInt32LE(b.length,2);b.writeUInt32LE(54,10);b.writeUInt32LE(40,14);b.writeInt32LE(w,18);b.writeInt32LE(h,22);b.writeUInt16LE(1,26);b.writeUInt16LE(24,28);b.writeUInt32LE(stride*h,34);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const [r,g,bl]=pixel(x,y),o=54+(h-1-y)*stride+x*3;b[o]=bl;b[o+1]=g;b[o+2]=r}return b};
const waitCompletion=async(p,id,ms)=>{const d=Date.now()+ms;while(Date.now()<d){try{const r=JSON.parse(bom(await readFile(p,"utf8")));if(r?.schemaVersion===1&&r.jobId===id&&(r.status==="DONE"||r.status==="FAILED"))return r}catch{}await sleep(60)}throw new Error(`RENDER_TIMEOUT ${id}`)};

const main=async()=>{
  const configPath=req("--config"),resultPath=req("--result"),readyPath=arg("--broker-ready"),started=Date.now(),dir=path.dirname(resultPath),progressPath=path.join(dir,"progress.jsonl");await mkdir(dir,{recursive:true});await writeFile(progressPath,"","utf8");
  const progress=async(stage,extra={})=>appendFile(progressPath,JSON.stringify({stage,elapsedMs:Date.now()-started,...extra})+"\n","utf8");
  const W=240,H=135,FPS=30,frameCount=8,duration=frameCount/FPS,truth=[{x:42,y:47},{x:48,y:50},{x:55,y:54},{x:63,y:58},{x:72,y:63},{x:82,y:67},{x:93,y:72},{x:105,y:76}];
  const framePaths=[],sequenceStart=path.join(dir,"track-0001.bmp"),markerPath=path.join(dir,"attach-marker.bmp"),renderPath=path.join(dir,"m4-point-track-preview.avi");
  for(let i=0;i<frameCount;i++){const target=truth[i],p=path.join(dir,`track-${String(i+1).padStart(4,"0")}.bmp`);framePaths.push(p);await writeFile(p,bmp(W,H,(x,y)=>{const n=(x*13+y*17+(x*y)%37)%39;let c=[9+n,15+(n*2)%41,24+(n*3)%53];const dx=x-target.x,dy=y-target.y;if(Math.abs(dx)<=5&&Math.abs(dy)<=5){if(dx===0||dy===0||dx===dy)c=[248,246,238];else if(dx>0&&dy<0)c=[65,180,245];else c=[218,76,62]}return c}))}
  await writeFile(markerPath,bmp(5,5,(x,y)=>(x===2||y===2)?[255,30,230]:[16,0,16]));
  const decoded=[];for(const p of framePaths)decoded.push(decodeBmp24(await readFile(p)));
  const trackingStarted=Date.now();const track=trackPoint({frames:decoded,seed:truth[0],featureRadius:5,searchRadius:15,minSimilarity:0.70,minSeparation:0.001});const trackingElapsedMs=Date.now()-trackingStarted;
  const derived=track.samples.map(s=>s.point);const maxError=derived.reduce((m,p,i)=>Math.max(m,Math.hypot(p.x-truth[i].x,p.y-truth[i].y)),0);
  const checks={tracker_pixel_derived:track.status==="TRACKED",tracker_frame_count:track.samples.length===frameCount,tracker_accuracy:maxError<=0.01,tracker_confidence:track.samples.slice(1).every(s=>s.accepted&&s.similarity>=0.70)};
  if(!Object.values(checks).every(Boolean))throw new Error(`Pixel tracker did not produce the expected bounded proof track: ${JSON.stringify({track,maxError})}`);
  await progress("tracker.complete",{trackingElapsedMs,maxError,derived});

  const cfg=JSON.parse(bom(await readFile(configPath,"utf8")));let broker=null,client=null,state=null,op=0,failure=null,panel=null,environment=null;const responses=[];
  const prefix=`M4_POINT_${Date.now()}`,tx=`${prefix}_TX`,projectId="m4-point-tracking-p1-p3",sequenceId=`${prefix}_SEQUENCE`,markerMedia=`${prefix}_MARKER_MEDIA`,compId=`${prefix}_COMP`,sequenceLayer=`${prefix}_SEQUENCE_LAYER`,markerLayer=`${prefix}_MARKER_LAYER`;
  const record=r=>responses.push({command:r.command,outcome:r.outcome,error:r.error??null,hostProjectRevision:r.hostProjectRevision??null,readback:r.readback??null});
  const refresh=async()=>{const o=await client.observe(projectId);state=o.observed;return o};
  const exec=async(command,payload,refreshAfter=true)=>{const r=await client.executePublic(command,{transactionId:tx,operationId:`${tx}_${++op}`,payload,expectedState:state,readbackProfile:"M4_POINT_TRACKING_P1_P3"});record(r);if(r.outcome==="FAILED"||r.outcome==="REJECTED")throw new Error(`${command}: ${r.error?.code??r.outcome}`);if(refreshAfter)await refresh();return r};
  try{
    if(cfg.schemaVersion!==1||cfg.host!=="127.0.0.1"||!Array.isArray(cfg.supportedProtocolVersions)||!cfg.supportedProtocolVersions.includes(AE_ADAPTER_PROTOCOL_VERSION_V11))throw new Error("Installed CEP config lacks protocol 1.1 compatibility");
    broker=new LoopbackCepBroker({port:cfg.port,token:cfg.token,commandTimeoutMs:7000,commandLeaseMs:1800,expectedExtensionId:cfg.extensionId,supportedProtocolVersions:[AE_ADAPTER_PROTOCOL_VERSION_V11]});if(await broker.start()!==cfg.port)throw new Error("Unexpected broker port");if(readyPath)await writeJson(readyPath,{schemaVersion:1,state:"LISTENING",port:cfg.port});panel=await broker.waitForPanel(7000);checks.panel_v11=panel.protocolVersion===AE_ADAPTER_PROTOCOL_VERSION_V11;
    client=new AeCepAdapterClientV11(broker,()=>`m4-point-v11-${++op}`,new AeFilesystemPolicyV11([dir]));environment=await client.probe();checks.real_ae=environment.hostName==="Adobe After Effects";const base=await refresh();checks.blank_baseline=base.project.itemCount===0&&base.project.filePath===null;if(!checks.panel_v11||!checks.real_ae||!checks.blank_baseline)throw new Error("M4 point proof requires real AE blank unsaved baseline and v1.1 bridge");
    await exec("media.import",{path:sequenceStart,stableId:sequenceId,sequence:true});await exec("media.import",{path:markerPath,stableId:markerMedia,sequence:false});await exec("comp.create",{stableId:compId,name:`${prefix} Pixel Point Track`,width:W,height:H,pixelAspect:1,duration,frameRate:FPS});await exec("layer.add_media",{stableId:sequenceLayer,comp:{stableId:compId},item:{stableId:sequenceId},duration});await exec("layer.add_media",{stableId:markerLayer,comp:{stableId:compId},item:{stableId:markerMedia},duration});
    const keyframes=track.samples.map(s=>({time:s.frameIndex/FPS,value:[s.point.x,s.point.y]}));const set=await exec("property.set_keyframes",{comp:{stableId:compId},layer:{stableId:markerLayer},propertyPath:["ADBE Transform Group","ADBE Position"],keyframes});checks.ae_key_count=rec(set.readback)?.numKeys===frameCount;
    const layerRead=await exec("readback.object",{kind:"LAYER",comp:{stableId:compId},target:{stableId:markerLayer}});const lr=rec(layerRead.readback)?.layer;checks.ae_marker_layer=lr?.stableId===markerLayer;checks.ae_marker_position=Array.isArray(lr?.transform?.position);
    await progress("ae.track_applied",{keyframeCount:rec(set.readback)?.numKeys});
    const scheduled=await exec("render.capture",{comp:{stableId:compId},outputPath:renderPath,timeSpanStart:0,timeSpanDuration:duration},false);const rr=rec(scheduled.readback);if(typeof rr?.jobId==="string"&&typeof rr?.completionPath==="string"){const c=await waitCompletion(rr.completionPath,rr.jobId,14000);checks.render_done=c.ok===true&&c.status==="DONE"&&c.queueItemRemoved===true&&await exists(c.outputPath)}else{checks.render_done=typeof rr?.outputPath==="string"&&await exists(rr.outputPath)}
    await refresh();checks.structural_exact=Object.values(checks).every(Boolean);await progress("render.complete",{ok:checks.render_done});
  }catch(e){failure=e instanceof Error?(e.stack??e.message):String(e);await progress("error",{message:e instanceof Error?e.message:String(e)})}finally{if(broker)try{await broker.stop()}catch{}}
  const elapsedMs=Date.now()-started,ok=failure===null&&checks.structural_exact===true;await writeJson(resultPath,{proofId:"M4_POINT_TRACKING_P1_P3_REAL_AE",status:ok?"VISUAL_REVIEW_REQUIRED":"FAILURE",ok,elapsedMs,trackingElapsedMs,speedTargetMs:30000,speedTargetMet:elapsedMs<=30000,visualReviewRequired:ok,analysisRoute:"EDITFLOW_PIXEL_TRACKER_SUBSYSTEM",aeApplicationRoute:"AE_CEP_PROPERTY_KEYFRAMES",nativeAeAnalyzeForwardClaimed:false,seed:truth[0],derivedTrack:track.samples,groundTruthForProofOnly:truth,maxErrorPixels:maxError,checks,panel,environment,responses,failure,artifacts:{preview:renderPath,sequenceStart,marker:markerPath},reviewSpec:{sampleFrameIndices:[0,3,7],expected:["magenta attachment marker remains centered on the asymmetric high-contrast tracked feature","marker movement follows the target across the frame without visible drift","the preview is driven by tracker-derived coordinates rather than predeclared AE motion"]}});if(!ok)process.exitCode=1;
};
main().catch(e=>{console.error(e);process.exitCode=1});
