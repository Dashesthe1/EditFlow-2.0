/* Generated retained M6.9 shutter transfer proof. */
(function(){
var plan=eval('({"schema":"editflow.m6.shutter-transfer-plan.v1","generatedAt":"2026-09-20T19:59:42.5951697Z","compName":"__EF2_M6_SHUTTER_TRANSFER_V15_PASS02__","outgoingSource":"C:\\\\Users\\\\Shadow\\\\EditFlow-2.0-m6\\\\proofs\\\\artifacts\\\\m6-shutter-transfer-16x9\\\\source-outgoing.mp4","incomingSource":"C:\\\\Users\\\\Shadow\\\\EditFlow-2.0-m6\\\\proofs\\\\artifacts\\\\m6-shutter-transfer-16x9\\\\source-incoming.mp4","outputVideo":"C:\\\\Users\\\\Shadow\\\\EditFlow-2.0-m6-separation\\\\proofs\\\\artifacts\\\\m6-shutter-transfer-v15\\\\render-16x9-pass02-v15.mp4","sourceIdentity":{"outgoingSha256":"e2749fe782afadcd14cca75cbf3711b45d240ce74f7e0298894c9e9ae13aa4e3","incomingSha256":"7c7e0b5f217d9184fd661223925c53d33af2d0505c8e24b7ffeff10254d31826","transferSourceContentKey":"3dea801bad6a239ba8f2bb2934209170f00a65b645d77317b751434477e5e063","baselineSourceContentKey":"c6b8fa7373d43ae332a71852468afcbd4ff812571fe9a76aec266463ae78f2ae"},"width":1280,"height":720,"frameRate":60,"durationSeconds":0.72,"cutSeconds":0.36,"outgoingSourceStartSeconds":2,"incomingSourceStartSeconds":5,"transferAxes":["subject","aspect-ratio"],"adaptation":{"geometryRule":"scale spatial displacement by min(targetWidth,targetHeight)/1080","geometryScale":0.6666666666666666,"sourceFit":"COVER_CENTER","frameRateRule":"retain frame-count timing semantics at target frame rate","literalSourceValuesReused":false},"baselinePhysicalState":{"motionImpulsePx":190,"duplicateSpreadPx":28,"duplicateOpacityPct":80,"postCutFrames":1.25,"copyCount":2,"fragmentBandCount":5,"overlapCopyCount":1,"overlapSpreadPx":8,"overlapOpacityPct":65},"physicalState":{"motionImpulsePx":126.66666666666666,"duplicateSpreadPx":8.347987115999214,"duplicateOpacityPct":80,"postCutFrames":1.25,"copyCount":2,"fragmentBandCount":5,"overlapCopyCount":1,"overlapSpreadPx":5.333333333333333,"overlapOpacityPct":65},"correctionFrom":{"fidelityRef":"proofs/diagnostics/m6-shutter-transfer-16x9-v13-fidelity.json","invariantId":"shutter.displacement","control":"DUPLICATE_SPREAD","direction":"DECREASE","multiplier":0.4472135954999579}})');
var log=new File(Folder.temp.fsName+"/m6-shutter-transfer.log");log.open("w");
var owned=[];
function comp(n){for(var i=1;i<=app.project.numItems;i++){var x=app.project.item(i);if(x instanceof CompItem&&x.name===n)return x;}return null;}
function tr(L,m){return L.property("ADBE Transform Group").property(m);}
function k(P,t,v){P.setValueAtTime(t,v);var q=P.nearestKeyIndex(t);P.setInterpolationTypeAtKey(q,KeyframeInterpolationType.LINEAR,KeyframeInterpolationType.LINEAR);}
function add(a,x,y){return [a[0]+x,a[1]+y];}
function importOwned(filePath,label){var F=new File(filePath);if(!F.exists)throw new Error("SOURCE_MISSING "+label+" "+filePath);var item=app.project.importFile(new ImportOptions(F));item.name=label;owned.push(item);return item;}
function addBandMask(T,bands,band,overlapPct){
 var w=T.source.width,h=T.source.height,bandH=h/bands,pad=bandH*Math.max(0,Math.min(.9,(overlapPct||0)/100))*.5,y0=(band*h)/bands-pad,y1=((band+1)*h)/bands+pad;
 var sh=new Shape();sh.vertices=[[0,y0],[w,y0],[w,y1],[0,y1]];sh.inTangents=[[0,0],[0,0],[0,0],[0,0]];sh.outTangents=[[0,0],[0,0],[0,0],[0,0]];sh.closed=true;
 var M=T.property("ADBE Mask Parade").addProperty("ADBE Mask Atom");M.name="M6_TRANSFER_BAND_"+band;M.property("ADBE Mask Shape").setValue(sh);
}
function applyBands(T,bands,phase,phaseCount,overlapPct){
 bands=Math.max(1,Math.round(bands||1));if(bands<=1)return;
 phaseCount=Math.max(1,Math.min(bands,Math.round(phaseCount||1)));var target=((phase%phaseCount)+phaseCount)%phaseCount,added=0;
 for(var b=0;b<bands;b++){if((b%phaseCount)===target){addBandMask(T,bands,b,overlapPct);added++;}}
 if(added===0)addBandMask(T,bands,target%bands,overlapPct);
}
function ghost(C,L,name,cut,lag,dy,opacity,post,bands,phase,phaseCount,bandOverlapPct){
 var fr=1/C.frameRate,sample=Math.max(L.inPoint,Math.min(L.outPoint-fr,cut-fr));
 var T=C.layers.add(L.source);T.name=name;T.audioEnabled=false;T.motionBlur=true;T.blendingMode=BlendingMode.SCREEN;
 T.startTime=L.startTime+lag*fr;T.inPoint=Math.max(0,cut-3*fr);T.outPoint=Math.min(C.duration,cut+post*fr);
 applyBands(T,bands,phase,phaseCount,bandOverlapPct);
 var P=tr(T,"ADBE Position"),S=tr(T,"ADBE Scale"),R=tr(T,"ADBE Rotate Z"),O=tr(T,"ADBE Opacity");
 var bp=tr(L,"ADBE Position").valueAtTime(sample,false),bs=tr(L,"ADBE Scale").valueAtTime(sample,false),br=tr(L,"ADBE Rotate Z").valueAtTime(sample,false);
 S.setValue(bs);R.setValue(br);
 k(P,Math.max(0,cut-3*fr),add(bp,0,dy*1.10));k(P,cut-fr,add(bp,0,dy));k(P,cut,bp);k(P,Math.min(C.duration-fr/4,cut+fr),bp);
 k(O,Math.max(0,cut-3*fr),0);k(O,cut-2*fr,opacity*.45);k(O,cut-fr,opacity);k(O,cut,opacity*.34);k(O,Math.min(C.duration-fr/4,cut+fr),0);
 var E=T.property("ADBE Effect Parade"),D=E.addProperty("ADBE Motion Blur");D.property(1).setValue(90);
 var B=D.property(2);k(B,Math.max(0,cut-3*fr),32);k(B,cut-fr,20);k(B,cut,8);k(B,Math.min(C.duration-fr/4,cut+fr),0);
}
function impulse(C,O,I,cut,px){
 var fr=1/C.frameRate,Po=tr(O,"ADBE Position"),Pi=tr(I,"ADBE Position");
 var bo=Po.valueAtTime(Math.max(0,cut-3*fr),false),bi=Pi.valueAtTime(Math.min(C.duration-fr,cut+2*fr),false);
 k(Po,cut-2*fr,bo);k(Po,cut-fr,add(bo,0,-px));k(Pi,cut,add(bi,0,px));k(Pi,cut+fr,bi);
}
function fitCover(L,C){
 var sx=100*C.width/L.source.width,sy=100*C.height/L.source.height,s=Math.max(sx,sy);
 tr(L,"ADBE Scale").setValue([s,s]);tr(L,"ADBE Position").setValue([C.width/2,C.height/2]);
}
try{
 app.beginUndoGroup("M6 retained shutter transfer");
 var old=comp(plan.compName);if(old)old.remove();
 var outItem=importOwned(plan.outgoingSource,"M6_TRANSFER_SOURCE_OUT");
 var inItem=importOwned(plan.incomingSource,"M6_TRANSFER_SOURCE_IN");
 var C=app.project.items.addComp(plan.compName,plan.width,plan.height,1,plan.durationSeconds,plan.frameRate);owned.push(C);
 C.motionBlur=true;C.shutterAngle=180;C.shutterPhase=-90;
 var O=C.layers.add(outItem);O.name="M6_TRANSFER_OUTGOING";O.audioEnabled=false;O.startTime=-plan.outgoingSourceStartSeconds;O.inPoint=0;O.outPoint=plan.cutSeconds;fitCover(O,C);
 var I=C.layers.add(inItem);I.name="M6_TRANSFER_INCOMING";I.audioEnabled=false;I.startTime=plan.cutSeconds-plan.incomingSourceStartSeconds;I.inPoint=plan.cutSeconds;I.outPoint=plan.durationSeconds;fitCover(I,C);
 var s=plan.physicalState,cut=plan.cutSeconds,spread=s.duplicateSpreadPx,opacity=s.duplicateOpacityPct,post=s.postCutFrames;
 var bands=Math.max(1,Math.round(s.fragmentBandCount||1)),copies=Math.max(1,Math.round(s.copyCount||1)),phaseCount=Math.max(1,Math.min(bands,copies));
 var overlapCopies=Math.max(0,Math.min(4,Math.round(s.overlapCopyCount||0))),overlapSpread=Math.max(0,s.overlapSpreadPx||18),overlapOpacity=Math.max(0,Math.min(100,s.overlapOpacityPct||55));
 impulse(C,O,I,cut,s.motionImpulsePx);
 if(copies>=1)ghost(C,O,"M6_TRANSFER_OA",cut,1,spread,opacity,post,bands,0,phaseCount,s.fragmentBandOverlapPct||0);
 if(copies>=2)ghost(C,O,"M6_TRANSFER_OB",cut,2,spread*.695,opacity*.82,post,bands,1,phaseCount,s.fragmentBandOverlapPct||0);
 if(copies>=3)ghost(C,I,"M6_TRANSFER_IA",cut,1,spread*.51,opacity*.71,post,bands,2,phaseCount,s.fragmentBandOverlapPct||0);
 if(overlapCopies>=1)ghost(C,O,"M6_TRANSFER_OV1",cut,1,overlapSpread,overlapOpacity,post,1,0,1,0);
 if(overlapCopies>=2)ghost(C,O,"M6_TRANSFER_OV2",cut,2,-overlapSpread*.72,overlapOpacity*.82,post,1,0,1,0);
 var rq=app.project.renderQueue.items.add(C);rq.applyTemplate("Draft Settings");rq.timeSpanStart=0;rq.timeSpanDuration=C.duration;
 var om=rq.outputModule(1);om.applyTemplate("H.264 - Match Render Settings -  5 Mbps");
 var out=new File(plan.outputVideo);if(out.exists)out.remove();om.file=out;app.project.renderQueue.render();
 log.writeln("OK bytes="+out.length+" file="+out.fsName+" comp="+C.width+"x"+C.height+" fps="+C.frameRate);
 rq.remove();
 for(var oi=owned.length-1;oi>=0;oi--){try{if(owned[oi]&&owned[oi].parentFolder)owned[oi].remove();}catch(_e){}}
 app.endUndoGroup();
}catch(e){
 try{app.endUndoGroup();}catch(_e){}
 log.writeln("ERR "+e.toString()+" line="+e.line);
}
log.close();
}());