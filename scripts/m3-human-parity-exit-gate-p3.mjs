import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { AeCepAdapterClientV11, AeFilesystemPolicyV11 } from "../.tmp/runtime/packages/adapters/ae-cep/src/v1_1.js";
import { AE_ADAPTER_PROTOCOL_VERSION_V11 } from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_1.js";
import { AE_MASK_PROTOCOL_VERSION_V12 } from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_2.js";
import { AE_COMPOSITE_PROTOCOL_VERSION_V13 } from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_3.js";
import { AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17 } from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_7.js";
import { AE_TEMPORAL_EASE_PROTOCOL_VERSION_V18 } from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_8.js";
import { AE_SPATIAL_GRAPH_PROTOCOL_VERSION_V19 } from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v1_9.js";
import { AE_MARKER_MOTION_PROTOCOL_VERSION_V20 } from "../.tmp/runtime/packages/adapters/ae-cep/src/protocol-v2_0.js";
import { buildMaskRequestV12 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-mask.js";
import { buildCompositeRequestV13 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-composite.js";
import { buildTemporalInterpolationRequestV17 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-temporal-interpolation.js";
import { buildTemporalEaseRequestV18 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-temporal-ease.js";
import { buildSpatialGraphRequestV19 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-spatial-graph.js";
import { buildMarkerMotionRequestV20 } from "../.tmp/runtime/packages/adapters/ae-cep/src/m3-marker-motion.js";
import { LoopbackCepBroker } from "../.tmp/runtime/apps/desktop-host/src/loopback-cep.js";

const arg=(n)=>{const i=process.argv.indexOf(n);return i>=0?process.argv[i+1]??null:null};
const req=(n)=>{const v=arg(n);if(!v)throw new Error(`Missing ${n}`);return v};
const stripBom=(s)=>s.charCodeAt(0)===0xfeff?s.slice(1):s;
const rec=(v)=>v!==null&&typeof v==="object"&&!Array.isArray(v)?v:null;
const nested=(v,k)=>{const r=rec(v);return r?rec(r[k]):null};
const exists=async(p)=>{try{return (await stat(p)).size>0}catch{return false}};
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const writeJson=async(p,v)=>{await mkdir(path.dirname(p),{recursive:true});await writeFile(p,JSON.stringify(v,null,2)+"\n","utf8")};

const createBmp24=(w,h,pixel)=>{const stride=Math.ceil((w*3)/4)*4,b=Buffer.alloc(54+stride*h,0);b.write("BM",0,2,"ascii");b.writeUInt32LE(b.length,2);b.writeUInt32LE(54,10);b.writeUInt32LE(40,14);b.writeInt32LE(w,18);b.writeInt32LE(h,22);b.writeUInt16LE(1,26);b.writeUInt16LE(24,28);b.writeUInt32LE(stride*h,34);b.writeInt32LE(2835,38);b.writeInt32LE(2835,42);for(let y=0;y<h;y++){const row=54+(h-1-y)*stride;for(let x=0;x<w;x++){const [r,g,bl]=pixel(x,y),o=row+x*3;b[o]=bl;b[o+1]=g;b[o+2]=r}}return b};
const parseCompletion=(v)=>{const r=rec(v);if(!r||r.schemaVersion!==1||typeof r.jobId!=="string"||(r.status!=="DONE"&&r.status!=="FAILED"))throw new Error("Invalid render completion");return r};
const waitCompletion=async(p,id,timeout)=>{const d=Date.now()+timeout;let e=null;while(Date.now()<d){try{const r=parseCompletion(JSON.parse(stripBom(await readFile(p,"utf8"))));if(r.jobId===id)return r;e=`stale ${r.jobId}`}catch(x){e=x instanceof Error?x.message:String(x)}await sleep(80)}throw new Error(`RENDER_TIMEOUT ${id}${e?` (${e})`:""}`)};

const main=async()=>{
  const configPath=req("--config"),resultPath=req("--result"),brokerReady=arg("--broker-ready"),started=Date.now();
  const artifactDir=path.dirname(resultPath);await mkdir(artifactDir,{recursive:true});
  const renderPath=path.join(artifactDir,"m3-exit-gate-transition.avi"),bgPath=path.join(artifactDir,"background.bmp"),revealPath=path.join(artifactDir,"reveal.bmp"),mattePath=path.join(artifactDir,"matte.bmp");
  await writeFile(bgPath,createBmp24(320,180,(x,y)=>{const grid=(Math.floor(x/24)+Math.floor(y/24))%2;return grid?[10,22,46]:[18,38,72]}));
  await writeFile(revealPath,createBmp24(320,180,(x,y)=>{const band=((x+y)>>4)%2;return band?[244,78,36]:[255,190,48]}));
  await writeFile(mattePath,createBmp24(320,180,()=>[255,255,255]));

  const checks={},responses=[];let broker=null,client=null,state=null,rev=null,op=0,rq=0,failure=null,panel=null,environment=null;
  const prefix=`M3_EXIT_${Date.now()}`,tx=`${prefix}_TX`,projectId="m3-human-parity-exit-gate";
  const bgMedia=`${prefix}_BG_MEDIA`,revealMedia=`${prefix}_REVEAL_MEDIA`,matteMedia=`${prefix}_MATTE_MEDIA`,compId=`${prefix}_COMP`,bgLayer=`${prefix}_BG_LAYER`,revealLayer=`${prefix}_REVEAL_LAYER`,matteLayer=`${prefix}_MATTE_LAYER`,maskId=`${prefix}_MASK`;
  const protocols=[AE_MARKER_MOTION_PROTOCOL_VERSION_V20,AE_SPATIAL_GRAPH_PROTOCOL_VERSION_V19,AE_TEMPORAL_EASE_PROTOCOL_VERSION_V18,AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17,AE_COMPOSITE_PROTOCOL_VERSION_V13,AE_MASK_PROTOCOL_VERSION_V12,AE_ADAPTER_PROTOCOL_VERSION_V11];
  const record=(r)=>responses.push({protocolVersion:r.protocolVersion,command:r.command,outcome:r.outcome,error:r.error??null,hostProjectRevision:r.hostProjectRevision??null,notes:r.diagnostics?.notes??[]});
  const refresh=async()=>{const o=await client.observe(projectId);state=o.observed;rev=o.hostRevision;return o};
  const v11=async(command,payload,refreshAfter=true)=>{const r=await client.executePublic(command,{transactionId:tx,operationId:`${tx}_V11_${++op}`,payload,expectedState:state,readbackProfile:"M3_HUMAN_PARITY_EXIT_GATE"});record(r);if(r.outcome==="FAILED"||r.outcome==="REJECTED")throw new Error(`${command}: ${r.error?.code??r.outcome}`);if(refreshAfter)await refresh();return r};
  const dispatch=async(builder,command,payload,expected=rev,profile="M3_HUMAN_PARITY_EXIT_GATE")=>{const r=await broker.dispatch(builder({requestId:`m3-exit-${++rq}`,transactionId:tx,operationId:`${tx}_M3_${++op}`,command,expectedHostProjectRevision:expected,payload,readbackProfile:profile}));record(r);if(typeof r.hostProjectRevision==="number")rev=r.hostProjectRevision;return r};
  const mustApply=async(builder,command,payload)=>{const r=await dispatch(builder,command,payload);if(r.outcome!=="APPLIED"&&r.outcome!=="NO_OP")throw new Error(`${command}: ${r.error?.code??r.outcome}`);await refresh();return r};
  const render=async()=>{const s=await v11("render.capture",{comp:{stableId:compId},outputPath:renderPath,timeSpanStart:0,timeSpanDuration:0.75},false);const rr=rec(s.readback),id=rr?.jobId,cp=rr?.completionPath;if(typeof id!=="string"||typeof cp!=="string")throw new Error("render.capture missing completion contract");const c=await waitCompletion(cp,id,18000);if(c.ok!==true||c.status!=="DONE"||c.queueItemRemoved!==true||!(await exists(c.outputPath)))throw new Error(`Render failed: ${c.error??c.status}`);await refresh();return c};

  const small={closed:true,vertices:[[160,72],[178,90],[160,108],[142,90]],inTangents:[[0,-10],[-10,0],[0,10],[10,0]],outTangents:[[0,10],[10,0],[0,-10],[-10,0]]};
  const medium={closed:true,vertices:[[160,42],[238,90],[160,138],[82,90]],inTangents:[[0,-30],[-42,0],[0,30],[42,0]],outTangents:[[0,30],[42,0],[0,-30],[-42,0]]};
  const large={closed:true,vertices:[[160,-35],[355,90],[160,215],[-35,90]],inTangents:[[0,-75],[-105,0],[0,75],[105,0]],outTangents:[[0,75],[105,0],[0,-75],[-105,0]]};
  const manualBezier={inType:"BEZIER",outType:"BEZIER",temporalContinuous:false,temporalAutoBezier:false};
  const posPath=["ADBE Transform Group","ADBE Position"],opacityPath=["ADBE Transform Group","ADBE Opacity"];

  try{
    const config=JSON.parse(stripBom(await readFile(configPath,"utf8")));if(config.schemaVersion!==1||config.host!=="127.0.0.1"||!Array.isArray(config.supportedProtocolVersions)||protocols.some(p=>!config.supportedProtocolVersions.includes(p)))throw new Error("Installed CEP config does not expose the complete M3 protocol stack");
    broker=new LoopbackCepBroker({port:config.port,token:config.token,commandTimeoutMs:8000,commandLeaseMs:2000,expectedExtensionId:config.extensionId,supportedProtocolVersions:protocols});
    if(await broker.start()!==config.port)throw new Error("Unexpected broker port");if(brokerReady)await writeJson(brokerReady,{schemaVersion:1,state:"LISTENING",port:config.port,at:new Date().toISOString()});
    panel=await broker.waitForPanel(8000);checks.panel_v20=panel.protocolVersion===AE_MARKER_MOTION_PROTOCOL_VERSION_V20;checks.panel_all_m3=protocols.every(p=>panel.supportedProtocolVersions.includes(p));if(!checks.panel_v20||!checks.panel_all_m3)throw new Error("CEP panel did not negotiate complete M3 stack");
    client=new AeCepAdapterClientV11(broker,()=>`m3-exit-v11-${++rq}`,new AeFilesystemPolicyV11([artifactDir]));environment=await client.probe();checks.real_ae=environment.hostName==="Adobe After Effects";if(!checks.real_ae)throw new Error("Real AE host probe failed");
    const baseline=await refresh();checks.blank_baseline=baseline.project.itemCount===0&&baseline.project.filePath===null;if(!checks.blank_baseline)throw new Error("M3 exit gate refuses to write into a non-blank project");

    await v11("media.import",{path:bgPath,stableId:bgMedia,sequence:false});await v11("media.import",{path:revealPath,stableId:revealMedia,sequence:false});await v11("media.import",{path:mattePath,stableId:matteMedia,sequence:false});
    await v11("comp.create",{stableId:compId,name:`${prefix} Object Mask Transition`,width:320,height:180,pixelAspect:1,duration:0.75,frameRate:24});
    await v11("layer.add_media",{stableId:bgLayer,comp:{stableId:compId},item:{stableId:bgMedia}});await v11("layer.add_media",{stableId:revealLayer,comp:{stableId:compId},item:{stableId:revealMedia}});await v11("layer.add_media",{stableId:matteLayer,comp:{stableId:compId},item:{stableId:matteMedia}});await v11("layer.reorder",{comp:{stableId:compId},layer:{stableId:bgLayer},position:"END"});
    await v11("property.set_keyframes",{comp:{stableId:compId},layer:{stableId:revealLayer},propertyPath:posPath,keyframes:[{time:0,value:[50,105]},{time:0.375,value:[160,42]},{time:0.75,value:[270,105]}]});
    await v11("property.set_keyframes",{comp:{stableId:compId},layer:{stableId:revealLayer},propertyPath:opacityPath,keyframes:[{time:0,value:15},{time:0.75,value:100}]});

    let r=await mustApply(buildMaskRequestV12,"mask.create",{comp:{stableId:compId},layer:{stableId:matteLayer},stableId:maskId,name:"Exact Bezier Reveal",shape:small,properties:{feather:[8,8],expansion:0,opacity:100,mode:"ADD",inverted:false}});checks.mask_created=nested(r.readback,"mask")?.stableId===maskId;
    r=await mustApply(buildMaskRequestV12,"mask.set_path",{comp:{stableId:compId},layer:{stableId:matteLayer},mask:{stableId:maskId},keyframes:[{time:0,shape:small},{time:0.375,shape:medium},{time:0.75,shape:large}]});checks.mask_three_bezier_keys=Array.isArray(nested(r.readback,"mask")?.pathKeyframes)&&nested(r.readback,"mask").pathKeyframes.length===3;
    r=await dispatch(buildMaskRequestV12,"mask.readback",{comp:{stableId:compId},layer:{stableId:matteLayer},mask:{stableId:maskId}},null);checks.mask_readback=r.outcome==="NO_OP"&&nested(r.readback,"mask")?.stableId===maskId;

    r=await mustApply(buildCompositeRequestV13,"layer.set_track_matte",{comp:{stableId:compId},layer:{stableId:revealLayer},matteLayer:{stableId:matteLayer},trackMatteType:"ALPHA"});const cr=nested(r.readback,"composite");checks.arbitrary_alpha_matte=cr?.hasTrackMatte===true&&cr?.trackMatteType==="ALPHA"&&nested(cr,"trackMatteLayer")?.stableId===matteLayer;
    r=await mustApply(buildCompositeRequestV13,"layer.set_blend_mode",{comp:{stableId:compId},layer:{stableId:revealLayer},blendMode:"ADD"});checks.blend_mode=nested(r.readback,"composite")?.blendMode==="ADD";
    r=await dispatch(buildCompositeRequestV13,"layer.composite_readback",{comp:{stableId:compId},layer:{stableId:revealLayer}},null);const cr2=nested(r.readback,"composite");checks.composite_readback=r.outcome==="NO_OP"&&cr2?.hasTrackMatte===true&&cr2?.trackMatteType==="ALPHA"&&cr2?.blendMode==="ADD";

    for(const keyIndex of [1,2]){r=await mustApply(buildTemporalInterpolationRequestV17,"property.temporal_interpolation.set",{comp:{stableId:compId},layer:{stableId:revealLayer},propertyPath:opacityPath,keyIndex,interpolation:manualBezier});const st=nested(nested(r.readback,"temporalInterpolation"),"state");checks[`temporal_interp_${keyIndex}`]=st?.inType==="BEZIER"&&st?.outType==="BEZIER"}
    const ease1={inEase:[{speed:0,influence:33}],outEase:[{speed:0,influence:72}]},ease2={inEase:[{speed:0,influence:72}],outEase:[{speed:0,influence:33}]};
    for(const [keyIndex,ease] of [[1,ease1],[2,ease2]]){r=await mustApply(buildTemporalEaseRequestV18,"property.temporal_ease.set",{comp:{stableId:compId},layer:{stableId:revealLayer},propertyPath:opacityPath,keyIndex,ease});const st=nested(nested(r.readback,"temporalEase"),"state");checks[`temporal_ease_${keyIndex}`]=Array.isArray(st?.inEase)&&Array.isArray(st?.outEase)}
    const spatial={mode:"MANUAL",inTangent:[-100,-110,0],outTangent:[100,110,0],continuous:false,roving:false};r=await mustApply(buildSpatialGraphRequestV19,"property.spatial_graph.set",{comp:{stableId:compId},layer:{stableId:revealLayer},propertyPath:posPath,keyIndex:2,state:spatial});const ss=nested(nested(r.readback,"spatialGraph"),"state");checks.spatial_exact=ss?.autoBezier===false&&ss?.continuous===false&&Array.isArray(ss?.inTangent)&&ss.inTangent[0]===-100&&ss.outTangent[0]===100;

    r=await dispatch(buildMarkerMotionRequestV20,"comp.motion.readback",{comp:{stableId:compId}},null);const nativeComp=nested(nested(r.readback,"compMotion"),"state");if(!nativeComp)throw new Error("No comp motion baseline");r=await mustApply(buildMarkerMotionRequestV20,"comp.motion.set",{comp:{stableId:compId},state:{...nativeComp,motionBlur:true,shutterAngle:180,shutterPhase:-90,samplesPerFrame:16,adaptiveSampleLimit:64}});checks.comp_motion=nested(nested(r.readback,"compMotion"),"state")?.motionBlur===true;
    r=await mustApply(buildMarkerMotionRequestV20,"layer.motion.set",{comp:{stableId:compId},layer:{stableId:revealLayer},state:{motionBlur:true,frameBlendingType:"NO_FRAME_BLEND"}});checks.layer_motion=nested(nested(r.readback,"layerMotion"),"state")?.motionBlur===true;
    const marker={comment:"M3 exit gate midpoint",chapter:"Human Parity",url:"",frameTarget:"transition",cuePointName:"midpoint",duration:0,eventCuePoint:false,label:9,protectedRegion:false,parameters:{proof:"m3-exit"}};r=await mustApply(buildMarkerMotionRequestV20,"marker.set",{target:{kind:"COMP",comp:{stableId:compId}},time:0.375,marker});checks.marker=r.outcome==="APPLIED"||r.outcome==="NO_OP";

    const c=await render();checks.visual_artifact=await exists(c.outputPath);const structural=Object.entries(checks).filter(([k])=>k!=="visual_artifact").every(([,v])=>v===true);checks.structural_exact=structural;
  }catch(e){failure=e instanceof Error?(e.stack??e.message):String(e)}finally{if(broker)try{await broker.stop()}catch{}}
  const elapsedMs=Date.now()-started,ok=failure===null&&checks.structural_exact===true&&checks.visual_artifact===true;
  await writeJson(resultPath,{proofId:"M3_HUMAN_PARITY_EXIT_GATE_P3_REAL_AE",status:ok?"VISUAL_REVIEW_REQUIRED":"FAILURE",ok,elapsedMs,speedTargetMs:30000,speedTargetMet:elapsedMs<=30000,visualReviewRequired:ok,proofLevels:{constituentP1P2Accepted:true,integratedStructuralReadback:checks.structural_exact===true,integratedVisualArtifactEmitted:checks.visual_artifact===true,integratedVisualAccepted:false,transferAccepted:false},prefix,panel,environment,checks,responses,failure,artifacts:{transition:renderPath,background:bgPath,reveal:revealPath,matte:mattePath},reviewSpec:{sampleTimesSeconds:[0.08,0.375,0.70],expected:["bright foreground is revealed by an expanding curved mask-driven alpha matte rather than a rectangular approximation","foreground follows a visibly curved spatial trajectory while its opacity eases rather than changing linearly","motion blur is visible on the moving foreground and the midpoint differs materially from both endpoints"]}});
  if(!ok)process.exitCode=1;
};
main().catch(e=>{console.error(e);process.exitCode=1});
