import { spawn } from "node:child_process";
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

const arg=(name)=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]??null:null};
const required=(name)=>{const v=arg(name);if(!v)throw new Error(`Missing ${name}`);return v};
const stripBom=(s)=>s.charCodeAt(0)===0xfeff?s.slice(1):s;
const record=(v)=>v!==null&&typeof v==="object"&&!Array.isArray(v)?v:null;
const nested=(v,key)=>{const r=record(v);return r?record(r[key]):null};
const stable=(v)=>JSON.stringify(v);
const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));
const nonEmpty=async(p)=>{try{return(await stat(p)).size>0}catch{return false}};
const writeJson=async(p,v)=>{await mkdir(path.dirname(p),{recursive:true});await writeFile(p,JSON.stringify(v,null,2)+"\n","utf8")};
const launchScript=async(exe,script)=>new Promise((resolve,reject)=>{const c=spawn(exe,["-r",script],{stdio:"ignore",windowsHide:false});c.once("error",reject);c.once("spawn",()=>{c.unref();resolve()})});
const waitText=async(p,prefix,timeoutMs)=>{const d=Date.now()+timeoutMs;let last=null;while(Date.now()<d){try{const t=(await readFile(p,"utf8")).trim();if(t.startsWith(prefix))return t;last=t}catch(e){last=e instanceof Error?e.message:String(e)}await sleep(80)}throw new Error(`PROOF_MARKER_TIMEOUT ${prefix}${last?` (${last})`:""}`)};
const samePath=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
const bmp=(w,h,pixel)=>{const stride=Math.ceil(w*3/4)*4,b=Buffer.alloc(54+stride*h);b.write("BM",0,2,"ascii");b.writeUInt32LE(b.length,2);b.writeUInt32LE(54,10);b.writeUInt32LE(40,14);b.writeInt32LE(w,18);b.writeInt32LE(h,22);b.writeUInt16LE(1,26);b.writeUInt16LE(24,28);b.writeUInt32LE(stride*h,34);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const [r,g,bl]=pixel(x,y),o=54+(h-1-y)*stride+x*3;b[o]=bl;b[o+1]=g;b[o+2]=r}return b};
const session=(s)=>({sessionId:s.sessionId,protocolVersion:s.protocolVersion,supportedProtocolVersions:[...s.supportedProtocolVersions],extensionId:s.extensionId,extensionVersion:s.extensionVersion,registeredAt:s.registeredAt});

const main=async()=>{
  const configPath=required("--config"),resultPath=required("--result"),afterFxPath=required("--afterfx-path"),brokerReadyPath=arg("--broker-ready");
  const started=Date.now(),dir=path.dirname(resultPath),projectPath=path.join(dir,"m3-human-parity-exit-gate-transfer.aep"),reopenScript=path.join(dir,"reopen-proof.jsx"),cleanupScript=path.join(dir,"cleanup-proof.jsx"),reopenMarker=path.join(dir,"reopen-result.txt"),cleanupMarker=path.join(dir,"cleanup-result.txt"),hostScript=path.resolve("packages/adapters/ae-cep/host/editflow_host_current_v20.jsx");
  await mkdir(dir,{recursive:true});
  const checks={},responses=[],cleanupErrors=[];let broker=null,client=null,state=null,rev=null,op=0,rq=0,initialSession=null,reconnectedSession=null,failure=null,cleanupComplete=false,savedFingerprint=null;
  const prefix=`M3_EXIT_P5_${Date.now()}`,tx=`${prefix}_TX`,projectId="m3-human-parity-exit-gate-p5";
  const protocols=[AE_MARKER_MOTION_PROTOCOL_VERSION_V20,AE_SPATIAL_GRAPH_PROTOCOL_VERSION_V19,AE_TEMPORAL_EASE_PROTOCOL_VERSION_V18,AE_TEMPORAL_INTERPOLATION_PROTOCOL_VERSION_V17,AE_COMPOSITE_PROTOCOL_VERSION_V13,AE_MASK_PROTOCOL_VERSION_V12,AE_ADAPTER_PROTOCOL_VERSION_V11];
  const W=240,H=135,D=0.5,FPS=12,pos=["ADBE Transform Group","ADBE Position"],opacity=["ADBE Transform Group","ADBE Opacity"];
  const small={closed:true,vertices:[[120,57],[134,68],[120,79],[106,68]],inTangents:[[0,-7],[-7,0],[0,7],[7,0]],outTangents:[[0,7],[7,0],[0,-7],[-7,0]]};
  const medium={closed:true,vertices:[[120,28],[190,68],[120,107],[50,68]],inTangents:[[0,-24],[-38,0],[0,24],[38,0]],outTangents:[[0,24],[38,0],[0,-24],[-38,0]]};
  const large={closed:true,vertices:[[120,-28],[290,68],[120,163],[-50,68]],inTangents:[[0,-58],[-92,0],[0,58],[92,0]],outTangents:[[0,58],[92,0],[0,-58],[-92,0]]};
  const interpolation={inType:"BEZIER",outType:"BEZIER",temporalContinuous:false,temporalAutoBezier:false};
  const ease1={inEase:[{speed:0,influence:33}],outEase:[{speed:0,influence:72}]},ease2={inEase:[{speed:0,influence:72}],outEase:[{speed:0,influence:33}]};
  const spatial={mode:"MANUAL",inTangent:[-80,-75,0],outTangent:[80,75,0],continuous:false,roving:false};
  const marker={comment:"M3 exit transfer midpoint",chapter:"Human Parity",url:"",frameTarget:"transition",cuePointName:"midpoint",duration:0,eventCuePoint:false,label:9,protectedRegion:false,parameters:{proof:"m3-exit-p5"}};

  const recordResponse=(r)=>responses.push({protocolVersion:r.protocolVersion,command:r.command,outcome:r.outcome,error:r.error??null,hostProjectRevision:r.hostProjectRevision??null,notes:r.diagnostics?.notes??[]});
  const refresh=async()=>{const o=await client.observe(projectId);state=o.observed;rev=o.hostRevision;return o};
  const v11=async(command,payload,profile="M3_HUMAN_PARITY_EXIT_GATE_P5")=>{const r=await client.executePublic(command,{transactionId:tx,operationId:`${tx}_V11_${++op}`,payload,expectedState:state,readbackProfile:profile});recordResponse(r);if(r.outcome==="FAILED"||r.outcome==="REJECTED")throw new Error(`${command}: ${r.error?.code??r.outcome}`);await refresh();return r};
  const dispatch=async(builder,command,payload,expected=null,profile="M3_HUMAN_PARITY_EXIT_GATE_P5")=>{const r=await broker.dispatch(builder({requestId:`m3-exit-p5-${++rq}`,transactionId:tx,operationId:`${tx}_M3_${++op}`,command,expectedHostProjectRevision:expected,payload,readbackProfile:profile}));recordResponse(r);if(typeof r.hostProjectRevision==="number")rev=r.hostProjectRevision;return r};
  const apply=async(builder,command,payload)=>{const r=await dispatch(builder,command,payload,rev);if(r.outcome!=="APPLIED"&&r.outcome!=="NO_OP")throw new Error(`${command}: ${r.error?.code??r.outcome}`);await refresh();return r};
  const makeClient=()=>new AeCepAdapterClientV11(broker,()=>`m3-exit-p5-v11-${++rq}`,new AeFilesystemPolicyV11([dir]));

  const ids=(suffix)=>({bgMedia:`${prefix}_${suffix}_BG_MEDIA`,fgMedia:`${prefix}_${suffix}_FG_MEDIA`,matteMedia:`${prefix}_${suffix}_MATTE_MEDIA`,comp:`${prefix}_${suffix}_COMP`,bgLayer:`${prefix}_${suffix}_BG_LAYER`,fgLayer:`${prefix}_${suffix}_FG_LAYER`,matteLayer:`${prefix}_${suffix}_MATTE_LAYER`,mask:`${prefix}_${suffix}_MASK`});
  const files=async(suffix,variant)=>{const bg=path.join(dir,`${suffix.toLowerCase()}-background.bmp`),fg=path.join(dir,`${suffix.toLowerCase()}-foreground.bmp`),matte=path.join(dir,`${suffix.toLowerCase()}-matte.bmp`);if(variant===1){await writeFile(bg,bmp(W,H,(x,y)=>((Math.floor(x/18)+Math.floor(y/18))%2?[8,20,44]:[18,42,78])));await writeFile(fg,bmp(W,H,(x,y)=>(((x+y)>>3)%2?[248,70,32]:[255,184,42])))}else{await writeFile(bg,bmp(W,H,(x,y)=>((Math.floor(x/12)%2)?[28,64,34]:[12,30,18])));await writeFile(fg,bmp(W,H,(x,y)=>(((x*2-y)>>3)&1?[70,220,244]:[188,64,236])))}await writeFile(matte,bmp(W,H,()=>[255,255,255]));return{bg,fg,matte}};

  const readSignature=async(i)=>{
    const maskR=await dispatch(buildMaskRequestV12,"mask.readback",{comp:{stableId:i.comp},layer:{stableId:i.matteLayer},mask:{stableId:i.mask}},null);
    const compR=await dispatch(buildCompositeRequestV13,"layer.composite_readback",{comp:{stableId:i.comp},layer:{stableId:i.fgLayer}},null);
    const ti1=await dispatch(buildTemporalInterpolationRequestV17,"property.temporal_interpolation.readback",{comp:{stableId:i.comp},layer:{stableId:i.fgLayer},propertyPath:opacity,keyIndex:1},null);
    const ti2=await dispatch(buildTemporalInterpolationRequestV17,"property.temporal_interpolation.readback",{comp:{stableId:i.comp},layer:{stableId:i.fgLayer},propertyPath:opacity,keyIndex:2},null);
    const te1=await dispatch(buildTemporalEaseRequestV18,"property.temporal_ease.readback",{comp:{stableId:i.comp},layer:{stableId:i.fgLayer},propertyPath:opacity,keyIndex:1},null);
    const te2=await dispatch(buildTemporalEaseRequestV18,"property.temporal_ease.readback",{comp:{stableId:i.comp},layer:{stableId:i.fgLayer},propertyPath:opacity,keyIndex:2},null);
    const sp=await dispatch(buildSpatialGraphRequestV19,"property.spatial_graph.readback",{comp:{stableId:i.comp},layer:{stableId:i.fgLayer},propertyPath:pos,keyIndex:2},null);
    const mk=await dispatch(buildMarkerMotionRequestV20,"marker.readback",{target:{kind:"COMP",comp:{stableId:i.comp}}},null);
    return{mask:nested(maskR.readback,"mask"),composite:nested(compR.readback,"composite"),temporal1:nested(nested(ti1.readback,"temporalInterpolation"),"state"),temporal2:nested(nested(ti2.readback,"temporalInterpolation"),"state"),ease1:nested(nested(te1.readback,"temporalEase"),"state"),ease2:nested(nested(te2.readback,"temporalEase"),"state"),spatial:nested(nested(sp.readback,"spatialGraph"),"state"),markers:Array.isArray(mk.readback?.markers)?mk.readback.markers:[]};
  };
  const validateSignature=(sig,i)=>{
    const pathKeys=sig.mask?.pathKeyframes;
    return sig.mask?.stableId===i.mask&&Array.isArray(pathKeys)&&pathKeys.length===3&&sig.mask?.mode==="ADD"&&sig.mask?.inverted===false&&sig.mask?.opacity===100&&stable(sig.mask?.feather)===stable([5,5])
      &&sig.composite?.hasTrackMatte===true&&sig.composite?.trackMatteType==="ALPHA"&&sig.composite?.blendMode==="ADD"&&nested(sig.composite,"trackMatteLayer")?.stableId===i.matteLayer
      &&sig.temporal1?.inType==="BEZIER"&&sig.temporal1?.outType==="BEZIER"&&sig.temporal2?.inType==="BEZIER"&&sig.temporal2?.outType==="BEZIER"
      &&Array.isArray(sig.ease1?.inEase)&&Array.isArray(sig.ease1?.outEase)&&Array.isArray(sig.ease2?.inEase)&&Array.isArray(sig.ease2?.outEase)
      &&sig.spatial?.autoBezier===false&&sig.spatial?.continuous===false&&Array.isArray(sig.spatial?.inTangent)&&sig.spatial.inTangent[0]===-80&&sig.spatial.outTangent[0]===80
      &&sig.markers.length===1&&sig.markers[0]?.time===0.25&&sig.markers[0]?.marker?.comment===marker.comment;
  };
  const geometrySignature=(sig)=>({pathKeyframes:sig.mask?.pathKeyframes,feather:sig.mask?.feather,expansion:sig.mask?.expansion,opacity:sig.mask?.opacity,mode:sig.mask?.mode,inverted:sig.mask?.inverted,trackMatteType:sig.composite?.trackMatteType,blendMode:sig.composite?.blendMode,temporal1:sig.temporal1,temporal2:sig.temporal2,ease1:sig.ease1,ease2:sig.ease2,spatial:sig.spatial,markerTime:sig.markers[0]?.time,marker:sig.markers[0]?.marker});

  const construct=async(i,f)=>{
    await v11("media.import",{path:f.bg,stableId:i.bgMedia,sequence:false});await v11("media.import",{path:f.fg,stableId:i.fgMedia,sequence:false});await v11("media.import",{path:f.matte,stableId:i.matteMedia,sequence:false});
    await v11("comp.create",{stableId:i.comp,name:`${i.comp} Object Mask Transition`,width:W,height:H,pixelAspect:1,duration:D,frameRate:FPS});
    await v11("layer.add_media",{stableId:i.bgLayer,comp:{stableId:i.comp},item:{stableId:i.bgMedia}});await v11("layer.add_media",{stableId:i.fgLayer,comp:{stableId:i.comp},item:{stableId:i.fgMedia}});await v11("layer.add_media",{stableId:i.matteLayer,comp:{stableId:i.comp},item:{stableId:i.matteMedia}});await v11("layer.reorder",{comp:{stableId:i.comp},layer:{stableId:i.bgLayer},position:"END"});
    await v11("property.set_keyframes",{comp:{stableId:i.comp},layer:{stableId:i.fgLayer},propertyPath:pos,keyframes:[{time:0,value:[40,82]},{time:0.25,value:[120,28]},{time:0.5,value:[200,82]}]});await v11("property.set_keyframes",{comp:{stableId:i.comp},layer:{stableId:i.fgLayer},propertyPath:opacity,keyframes:[{time:0,value:15},{time:0.5,value:100}]});
    await apply(buildMaskRequestV12,"mask.create",{comp:{stableId:i.comp},layer:{stableId:i.matteLayer},stableId:i.mask,name:"Exact Bezier Reveal",shape:small,properties:{feather:[5,5],expansion:0,opacity:100,mode:"ADD",inverted:false}});await apply(buildMaskRequestV12,"mask.set_path",{comp:{stableId:i.comp},layer:{stableId:i.matteLayer},mask:{stableId:i.mask},keyframes:[{time:0,shape:small},{time:0.25,shape:medium},{time:0.5,shape:large}]});
    await apply(buildCompositeRequestV13,"layer.set_track_matte",{comp:{stableId:i.comp},layer:{stableId:i.fgLayer},matteLayer:{stableId:i.matteLayer},trackMatteType:"ALPHA"});await apply(buildCompositeRequestV13,"layer.set_blend_mode",{comp:{stableId:i.comp},layer:{stableId:i.fgLayer},blendMode:"ADD"});
    for(const k of[1,2])await apply(buildTemporalInterpolationRequestV17,"property.temporal_interpolation.set",{comp:{stableId:i.comp},layer:{stableId:i.fgLayer},propertyPath:opacity,keyIndex:k,interpolation});
    await apply(buildTemporalEaseRequestV18,"property.temporal_ease.set",{comp:{stableId:i.comp},layer:{stableId:i.fgLayer},propertyPath:opacity,keyIndex:1,ease:ease1});await apply(buildTemporalEaseRequestV18,"property.temporal_ease.set",{comp:{stableId:i.comp},layer:{stableId:i.fgLayer},propertyPath:opacity,keyIndex:2,ease:ease2});
    await apply(buildSpatialGraphRequestV19,"property.spatial_graph.set",{comp:{stableId:i.comp},layer:{stableId:i.fgLayer},propertyPath:pos,keyIndex:2,state:spatial});await apply(buildMarkerMotionRequestV20,"marker.set",{target:{kind:"COMP",comp:{stableId:i.comp}},time:0.25,marker});
    return readSignature(i);
  };

  const writeHelpers=async()=>{
    const js=(v)=>JSON.stringify(v);
    const reopen=`(function(){"use strict";var projectFile=new File(${js(projectPath)}),markerFile=new File(${js(reopenMarker)}),hostScript=new File(${js(hostScript)});function s(v){return v===null||v===undefined?"":String(v)}function same(a,b){return s(a).replace(/\\\\/g,"/").toLowerCase()===s(b).replace(/\\\\/g,"/").toLowerCase()}function out(t){markerFile.encoding="UTF-8";markerFile.open("w");markerFile.write(t);markerFile.close()}try{if($.getenv("EDITFLOW_M3_EXIT_GATE_P5_PROOF")!=="1")throw new Error("proof gate not armed");if(!app.project||!app.project.file||!same(app.project.file.fsName,projectFile.fsName))throw new Error("refusing non-proof project");if(app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES)===false)throw new Error("close failed");app.open(projectFile);if(!app.project||!app.project.file||!same(app.project.file.fsName,projectFile.fsName))throw new Error("reopen failed");try{$.global.EditFlow2_dispatch=undefined}catch(_){};$.evalFile(hostScript);if(typeof $.global.EditFlow2_dispatch!=="function"||$.global.EditFlow2_HOST_PROTOCOL_20!==true)throw new Error("protocol 2.0 dispatcher reload failed");out("OK|"+app.project.numItems+"|"+app.project.file.fsName)}catch(e){out("ERROR|"+String(e))}}());\n`;
    const cleanup=`(function(){"use strict";var projectFile=new File(${js(projectPath)}),markerFile=new File(${js(cleanupMarker)}),prefix=${js(prefix)},SP="[[EDITFLOW2_STABLE:",SX="]]";function s(v){return v===null||v===undefined?"":String(v)}function same(a,b){return s(a).replace(/\\\\/g,"/").toLowerCase()===s(b).replace(/\\\\/g,"/").toLowerCase()}function stableId(t){t=s(t);var a=t.indexOf(SP),b;if(a<0)return null;a+=SP.length;b=t.indexOf(SX,a);return b<0?null:t.substring(a,b)}function out(t){markerFile.encoding="UTF-8";markerFile.open("w");markerFile.write(t);markerFile.close()}try{if($.getenv("EDITFLOW_M3_EXIT_GATE_P5_PROOF")!=="1")throw new Error("proof gate not armed");if(!app.project||!app.project.file||!same(app.project.file.fsName,projectFile.fsName))throw new Error("refusing non-proof project");for(var i=1;i<=app.project.numItems;i++){var id=stableId(app.project.item(i).comment);if(!id||id.indexOf(prefix)!==0)throw new Error("foreign project item: "+id)}if(app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES)===false)throw new Error("close failed");app.newProject();if(!app.project||app.project.file||app.project.numItems!==0)throw new Error("blank reset failed");out("OK|0")}catch(e){out("ERROR|"+String(e))}}());\n`;
    await writeFile(reopenScript,reopen,"utf8");await writeFile(cleanupScript,cleanup,"utf8");
  };

  try{
    await writeHelpers();
    const f1=await files("A",1),f2=await files("B",2),i1=ids("A"),i2=ids("B");
    const cfg=JSON.parse(stripBom(await readFile(configPath,"utf8")));if(cfg.schemaVersion!==1||cfg.host!=="127.0.0.1"||!Array.isArray(cfg.supportedProtocolVersions)||protocols.some(p=>!cfg.supportedProtocolVersions.includes(p)))throw new Error("Installed config lacks complete M3 protocol stack");
    broker=new LoopbackCepBroker({port:cfg.port,token:cfg.token,commandTimeoutMs:7000,commandLeaseMs:1800,expectedExtensionId:cfg.extensionId,supportedProtocolVersions:protocols});if(await broker.start()!==cfg.port)throw new Error("Unexpected broker port");if(brokerReadyPath)await writeJson(brokerReadyPath,{schemaVersion:1,state:"LISTENING",port:cfg.port});
    const first=await broker.waitForPanel(7000);initialSession=session(first);checks.initial_full_stack=first.protocolVersion===AE_MARKER_MOTION_PROTOCOL_VERSION_V20&&protocols.every(p=>first.supportedProtocolVersions.includes(p));if(!checks.initial_full_stack)throw new Error("Initial full-stack negotiation failed");
    client=makeClient();const env=await client.probe();checks.real_ae=env.hostName==="Adobe After Effects";const base=await refresh();checks.blank_baseline=base.project.itemCount===0&&base.project.filePath===null;if(!checks.real_ae||!checks.blank_baseline)throw new Error("P5 requires real AE blank unsaved baseline");
    const firstSig=await construct(i1,f1);checks.first_signature_exact=validateSignature(firstSig,i1);if(!checks.first_signature_exact)throw new Error("First integrated construction readback failed");
    const save=await v11("project.save",{path:projectPath},"M3_HUMAN_PARITY_EXIT_GATE_P5_SAVE");checks.project_saved=(save.outcome==="APPLIED"||save.outcome==="NO_OP")&&await nonEmpty(projectPath);const saved=await refresh();savedFingerprint=saved.observed.projectFingerprint;checks.saved_project_path=saved.project.filePath!==null&&samePath(saved.project.filePath,projectPath);if(!checks.project_saved||!checks.saved_project_path)throw new Error("Integrated project save failed");
    await launchScript(afterFxPath,reopenScript);const reopen=await waitText(reopenMarker,"OK|",7000);const parts=reopen.split("|");checks.reopen_exact=Number(parts[1])===4&&samePath(parts.slice(2).join("|"),projectPath);if(!checks.reopen_exact)throw new Error(`Reopen marker invalid: ${reopen}`);
    const firstSessionId=initialSession.sessionId;await broker.stop();await sleep(250);if(await broker.start()!==cfg.port)throw new Error("Rebound port mismatch");const second=await broker.waitForPanel(7000);reconnectedSession=session(second);checks.distinct_authenticated_reconnect=second.sessionId!==firstSessionId&&second.protocolVersion===AE_MARKER_MOTION_PROTOCOL_VERSION_V20&&second.extensionId===cfg.extensionId&&second.extensionVersion===cfg.extensionVersion;if(!checks.distinct_authenticated_reconnect)throw new Error("Distinct authenticated reconnect failed");
    client=makeClient();const env2=await client.probe();checks.post_reconnect_real_ae=env2.hostName==="Adobe After Effects";const reopened=await refresh();checks.saved_fingerprint_preserved=reopened.observed.projectFingerprint===savedFingerprint;checks.first_stable_ids_preserved=reopened.project.items.some(x=>x.stableId===i1.comp)&&reopened.project.items.some(x=>x.composition?.layers.some(l=>l.stableId===i1.fgLayer));const reopenedSig=await readSignature(i1);checks.first_signature_survived=validateSignature(reopenedSig,i1)&&stable(geometrySignature(reopenedSig))===stable(geometrySignature(firstSig));if(!checks.post_reconnect_real_ae||!checks.saved_fingerprint_preserved||!checks.first_stable_ids_preserved||!checks.first_signature_survived)throw new Error("Integrated construction changed across save/reopen/reconnect");
    const secondSig=await construct(i2,f2);checks.second_signature_exact=validateSignature(secondSig,i2);checks.geometry_matte_curves_transferred=stable(geometrySignature(secondSig))===stable(geometrySignature(firstSig));if(!checks.second_signature_exact||!checks.geometry_matte_curves_transferred)throw new Error("Construction did not transfer exactly to unrelated second fixture");
    const save2=await v11("project.save",{path:projectPath},"M3_HUMAN_PARITY_EXIT_GATE_P5_TRANSFER_SAVE");checks.transferred_project_saved=(save2.outcome==="APPLIED"||save2.outcome==="NO_OP")&&await nonEmpty(projectPath);if(!checks.transferred_project_saved)throw new Error("Transferred project save failed");
  }catch(e){failure=e instanceof Error?(e.stack??e.message):String(e)}finally{
    if(broker){try{await broker.stop()}catch(e){cleanupErrors.push(String(e))}}
    if(await nonEmpty(projectPath)){try{await launchScript(afterFxPath,cleanupScript);const t=await waitText(cleanupMarker,"OK|",7000);cleanupComplete=t==="OK|0";if(!cleanupComplete)cleanupErrors.push(`cleanup marker ${t}`)}catch(e){cleanupErrors.push(e instanceof Error?e.message:String(e))}}else{cleanupErrors.push("saved proof project unavailable for cleanup")}
    checks.saved_project_retained=await nonEmpty(projectPath);if(cleanupErrors.length)cleanupComplete=false;
    const elapsedMs=Date.now()-started,ok=failure===null&&cleanupComplete&&checks.first_signature_exact===true&&checks.first_signature_survived===true&&checks.distinct_authenticated_reconnect===true&&checks.second_signature_exact===true&&checks.geometry_matte_curves_transferred===true&&checks.transferred_project_saved===true&&checks.saved_project_retained===true;
    await writeJson(resultPath,{proofId:"M3_HUMAN_PARITY_EXIT_GATE_P5_REAL_AE",status:ok?"ACCEPTED":"FAILURE",classification:ok?"PASS":"PRODUCT_FAILURE",ok,elapsedMs,speedTargetMs:30000,speedTargetMet:elapsedMs<=30000,proofLevels:{integratedVisualAccepted:true,saveReopenReconnect:true,unrelatedFixtureTransfer:checks.geometry_matte_curves_transferred===true,P5_transfer:ok},checks,initialSession,reconnectedSession,cleanupComplete,cleanupErrors,failure,artifacts:{savedProject:projectPath,reopenScript,cleanupScript,reopenMarker,cleanupMarker},responses});if(!ok)process.exitCode=1;
  }
};
main().catch((e)=>{console.error(e);process.exitCode=1});
