import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const argv = process.argv.slice(2);
const required = (name) => {
  const index = argv.indexOf(name);
  if (index < 0 || index + 1 >= argv.length) throw new Error(`Missing ${name}`);
  return path.resolve(argv[index + 1]);
};
const optionalNumber = (name, fallback) => {
  const index = argv.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(argv[index + 1]);
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${name}`);
  return value;
};
const optionalToken = (name, fallback) => {
  const index = argv.indexOf(name);
  const value = index < 0 ? fallback : argv[index + 1];
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
};
const planPath = required("--search-plan");
const outputPath = required("--output-jsx");
const localWindowMs = optionalNumber("--local-window-ms", 0);
const outputPrefix = optionalToken("--output-prefix", "M6_shutter_local");
const plan = JSON.parse(await readFile(planPath, "utf8"));
if (plan.schema !== "editflow.m6.ae-shutter-search-plan.v1") {
  throw new Error("Unexpected search plan schema.");
}
if (!Array.isArray(plan.combinedCandidates) || plan.combinedCandidates.length === 0) {
  throw new Error("Search plan contains no combined candidates.");
}
const payload = JSON.stringify(plan.combinedCandidates).replaceAll("\\", "\\\\").replaceAll("'", "\\'");
const source = `/* Generated M6 shutter actuator response probes. */
(function(){
var outputPrefix="${outputPrefix}";
var log=new File(Folder.temp.fsName+"/"+outputPrefix+"-search.log");log.open("w");
var localWindowMs=${localWindowMs};
function comp(n){for(var i=1;i<=app.project.numItems;i++){var x=app.project.item(i);if(x instanceof CompItem&&x.name===n)return x;}return null;}
function layer(C,n){for(var i=1;i<=C.numLayers;i++)if(C.layer(i).name===n)return C.layer(i);return null;}
function tr(L,m){return L.property("ADBE Transform Group").property(m);}
function k(P,t,v){P.setValueAtTime(t,v);var q=P.nearestKeyIndex(t);P.setInterpolationTypeAtKey(q,KeyframeInterpolationType.LINEAR,KeyframeInterpolationType.LINEAR);}
function add(a,x,y){return [a[0]+x,a[1]+y];}
function addBandMask(T,bands,band,overlapPct){
 var w=T.source.width,h=T.source.height,bandH=h/bands,pad=bandH*Math.max(0,Math.min(0.9,(overlapPct||0)/100))*.5,y0=(band*h)/bands-pad,y1=((band+1)*h)/bands+pad;
 var sh=new Shape();sh.vertices=[[0,y0],[w,y0],[w,y1],[0,y1]];
 sh.inTangents=[[0,0],[0,0],[0,0],[0,0]];sh.outTangents=[[0,0],[0,0],[0,0],[0,0]];sh.closed=true;
 var M=T.property("ADBE Mask Parade").addProperty("ADBE Mask Atom");
 M.name="M6_FRAGMENT_BAND_"+band;M.property("ADBE Mask Shape").setValue(sh);
}
function applyFragmentBands(T,bands,phase,phaseCount,overlapPct){
 bands=Math.max(1,Math.round(bands||1));if(bands<=1)return;
 phaseCount=Math.max(1,Math.min(bands,Math.round(phaseCount||1)));
 var target=((phase%phaseCount)+phaseCount)%phaseCount,added=0;
 for(var b=0;b<bands;b++){if((b%phaseCount)===target){addBandMask(T,bands,b,overlapPct);added++;}}
 if(added===0)addBandMask(T,bands,target%bands,overlapPct);
}
function addTemporalEcho(T,C,count,offsetFrames,decay){
 if(!count||count<=0)return;
 var E=T.property("ADBE Effect Parade").addProperty("ADBE Echo");
 E.property(1).setValue((offsetFrames||-1)/C.frameRate);
 E.property(2).setValue(Math.max(1,Math.round(count)));
 E.property(3).setValue(1);E.property(4).setValue(Math.max(0.05,Math.min(1,decay||0.6)));
}
function timeDisplacedComposite(C,L,name,cut,post,bands,frames,opacity,ordinal){
 bands=Math.max(2,Math.round(bands||6));frames=Math.max(0,frames||0);if(frames<=0)return;
 var fr=1/C.frameRate,mapName="M6_TD_MAP_"+ordinal+"_"+name,oldMap=comp(mapName);if(oldMap)oldMap.remove();
 var M=app.project.items.addComp(mapName,C.width,C.height,1,C.duration,C.frameRate);
 for(var b=0;b<bands;b++){var g=(b%2===0)?0:1,S=M.layers.addSolid([g,g,g],"band_"+b,C.width,C.height,1,C.duration);tr(S,"ADBE Scale").setValue([100,100/bands]);tr(S,"ADBE Position").setValue([C.width/2,(b+.5)*C.height/bands]);}
 var mapLayer=C.layers.add(M);mapLayer.name=mapName;mapLayer.enabled=false;
 var T=C.layers.add(L.source);T.name=name;T.audioEnabled=false;T.blendingMode=BlendingMode.NORMAL;T.startTime=L.startTime;T.inPoint=cut-2*fr;T.outPoint=cut+post*fr;
 var sample=Math.max(L.inPoint,Math.min(L.outPoint-fr,cut-fr)),P=tr(T,"ADBE Position"),Scl=tr(T,"ADBE Scale"),R=tr(T,"ADBE Rotate Z"),O=tr(T,"ADBE Opacity");
 P.setValue(tr(L,"ADBE Position").valueAtTime(sample,false));Scl.setValue(tr(L,"ADBE Scale").valueAtTime(sample,false));R.setValue(tr(L,"ADBE Rotate Z").valueAtTime(sample,false));
 k(O,cut-2*fr,0);k(O,cut-fr,opacity);k(O,cut,opacity*.7);k(O,cut+fr,0);
 var E=T.property("ADBE Effect Parade").addProperty("ADBE Time Displacement");E.property(1).setValue(mapLayer.index);E.property(2).setValue(frames*fr);E.property(3).setValue(C.frameRate);
}
function wideTimeComposite(C,L,name,cut,post,backwardSteps,forwardSteps,opacity){
 backwardSteps=Math.max(0,Math.round(backwardSteps||0));forwardSteps=Math.max(0,Math.round(forwardSteps||0));if(backwardSteps+forwardSteps<=0)return;
 var fr=1/C.frameRate,T=C.layers.add(L.source);T.name=name;T.audioEnabled=false;T.blendingMode=BlendingMode.NORMAL;T.startTime=L.startTime;T.inPoint=cut-2*fr;T.outPoint=cut+post*fr;
 var sample=Math.max(L.inPoint,Math.min(L.outPoint-fr,cut-fr)),P=tr(T,"ADBE Position"),S=tr(T,"ADBE Scale"),R=tr(T,"ADBE Rotate Z"),O=tr(T,"ADBE Opacity");
 P.setValue(tr(L,"ADBE Position").valueAtTime(sample,false));S.setValue(tr(L,"ADBE Scale").valueAtTime(sample,false));R.setValue(tr(L,"ADBE Rotate Z").valueAtTime(sample,false));
 k(O,cut-2*fr,0);k(O,cut-fr,opacity);k(O,cut,opacity*.65);k(O,cut+fr,0);
 var E=T.property("ADBE Effect Parade").addProperty("CC Wide Time");E.property(1).setValue(forwardSteps);E.property(2).setValue(backwardSteps);E.property(3).setValue(2);
}
function ghost(C,L,name,cut,lag,dy,opacity,post,bands,phase,phaseCount,bandOverlapPct,echoCount,echoOffsetFrames,echoDecay){
 var fr=1/C.frameRate,sample=Math.max(L.inPoint,Math.min(L.outPoint-fr,cut-fr));
 var T=C.layers.add(L.source);T.name=name;T.audioEnabled=false;T.motionBlur=true;T.blendingMode=BlendingMode.SCREEN;
 T.startTime=L.startTime+lag*fr;T.inPoint=cut-3*fr;T.outPoint=cut+post*fr;
 applyFragmentBands(T,bands,phase,phaseCount,bandOverlapPct);
 var P=tr(T,"ADBE Position"),S=tr(T,"ADBE Scale"),R=tr(T,"ADBE Rotate Z"),O=tr(T,"ADBE Opacity");
 var bp=tr(L,"ADBE Position").valueAtTime(sample,false),bs=tr(L,"ADBE Scale").valueAtTime(sample,false),br=tr(L,"ADBE Rotate Z").valueAtTime(sample,false);
 S.setValue(bs);R.setValue(br);
 k(P,cut-3*fr,add(bp,0,dy*1.10));k(P,cut-fr,add(bp,0,dy));k(P,cut,bp);k(P,cut+fr,bp);
 k(O,cut-3*fr,0);k(O,cut-2*fr,opacity*.45);k(O,cut-fr,opacity);k(O,cut,opacity*.34);k(O,cut+fr,0);
 var E=T.property("ADBE Effect Parade"),D=E.addProperty("ADBE Motion Blur");D.property(1).setValue(90);
 var B=D.property(2);k(B,cut-3*fr,32);k(B,cut-fr,20);k(B,cut,8);k(B,cut+fr,0);
 addTemporalEcho(T,C,echoCount,echoOffsetFrames,echoDecay);
}
function impulse(C,O,I,cut,px){
 var fr=1/C.frameRate,Po=tr(O,"ADBE Position"),Pi=tr(I,"ADBE Position");
 var bo=Po.valueAtTime(cut-3*fr,false),bi=Pi.valueAtTime(cut+2*fr,false);
 k(Po,cut-2*fr,bo);k(Po,cut-fr,add(bo,0,-px));k(Pi,cut,add(bi,0,px));k(Pi,cut+fr,bi);
}
function correct(C,item,ordinal){
 var O=layer(C,item.outgoingLayer),I=layer(C,item.incomingLayer);if(!O||!I)throw new Error("MISSING "+item.tag);
 var s=item.physicalState,cut=item.cutSeconds,spread=s.duplicateSpreadPx,opacity=s.duplicateOpacityPct,post=s.postCutFrames;
 var bands=Math.max(1,Math.round(s.fragmentBandCount||1)),copies=Math.max(1,Math.round(s.copyCount||1)),bandOverlapPct=Math.max(0,Math.min(90,s.fragmentBandOverlapPct||0));
 var echoCount=Math.max(0,Math.round(s.echoCount||0)),echoOffsetFrames=s.echoOffsetFrames||-1,echoDecay=s.echoDecay||0.6;
 var tdFrames=Math.max(0,s.timeDisplacementFrames||0),tdBands=Math.max(2,Math.round(s.timeDisplacementBandCount||6)),tdOpacity=s.timeDisplacementOpacityPct||50;
 var wtBackward=Math.max(0,Math.round(s.wideTimeBackwardSteps||0)),wtForward=Math.max(0,Math.round(s.wideTimeForwardSteps||0)),wtOpacity=s.wideTimeOpacityPct||50;
 var overlapCopies=Math.max(0,Math.min(4,Math.round(s.overlapCopyCount||0))),overlapSpread=Math.max(0,s.overlapSpreadPx||18),overlapOpacity=Math.max(0,Math.min(100,s.overlapOpacityPct||55));
 var phaseCount=Math.max(1,Math.min(bands,copies));
 impulse(C,O,I,cut,s.motionImpulsePx);
 if(copies>=1)ghost(C,O,"M6_SEARCH_"+ordinal+"_"+item.tag+"_OA",cut,1,spread,opacity,post,bands,0,phaseCount,bandOverlapPct,echoCount,echoOffsetFrames,echoDecay);
 if(copies>=2)ghost(C,O,"M6_SEARCH_"+ordinal+"_"+item.tag+"_OB",cut,2,spread*.695,opacity*.82,post,bands,1,phaseCount,bandOverlapPct,echoCount,echoOffsetFrames,echoDecay);
 if(copies>=3)ghost(C,I,"M6_SEARCH_"+ordinal+"_"+item.tag+"_IA",cut,1,spread*.51,opacity*.71,post,bands,2,phaseCount,bandOverlapPct,echoCount,echoOffsetFrames,echoDecay);
 if(copies>=4)ghost(C,I,"M6_SEARCH_"+ordinal+"_"+item.tag+"_IB",cut,3,spread*.356,opacity*.59,post,bands,3,phaseCount,bandOverlapPct,echoCount,echoOffsetFrames,echoDecay);
 if(copies>=5)ghost(C,O,"M6_SEARCH_"+ordinal+"_"+item.tag+"_OC",cut,3,spread*.24,opacity*.48,post,bands,4,phaseCount,bandOverlapPct,echoCount,echoOffsetFrames,echoDecay);
 if(copies>=6)ghost(C,I,"M6_SEARCH_"+ordinal+"_"+item.tag+"_IC",cut,2,spread*.18,opacity*.42,post,bands,5,phaseCount,bandOverlapPct,echoCount,echoOffsetFrames,echoDecay);
 if(overlapCopies>=1)ghost(C,O,"M6_SEARCH_"+ordinal+"_"+item.tag+"_OV1",cut,1,overlapSpread,overlapOpacity,post,1,0,1,0,0,-1,0.6);
 if(overlapCopies>=2)ghost(C,O,"M6_SEARCH_"+ordinal+"_"+item.tag+"_OV2",cut,2,-overlapSpread*.72,overlapOpacity*.82,post,1,0,1,0,0,-1,0.6);
 if(overlapCopies>=3)ghost(C,I,"M6_SEARCH_"+ordinal+"_"+item.tag+"_OV3",cut,1,overlapSpread*.46,overlapOpacity*.68,post,1,0,1,0,0,-1,0.6);
 if(overlapCopies>=4)ghost(C,I,"M6_SEARCH_"+ordinal+"_"+item.tag+"_OV4",cut,2,-overlapSpread*.34,overlapOpacity*.55,post,1,0,1,0,0,-1,0.6);
 if(tdFrames>0)timeDisplacedComposite(C,O,"M6_SEARCH_"+ordinal+"_"+item.tag+"_TD",cut,post,tdBands,tdFrames,tdOpacity,ordinal);
 if(wtBackward+wtForward>0)wideTimeComposite(C,O,"M6_SEARCH_"+ordinal+"_"+item.tag+"_WT",cut,post,wtBackward,wtForward,wtOpacity);
}
function renderWindow(C,start,duration,fileName,ordinal,candidateId,label){
 var rq=app.project.renderQueue.items.add(C);rq.applyTemplate("Draft Settings");
 rq.timeSpanStart=Math.max(0,start);rq.timeSpanDuration=Math.min(duration,C.duration-rq.timeSpanStart);
 var om=rq.outputModule(1);om.applyTemplate("H.264 - Match Render Settings -  5 Mbps");
 var out=new File(Folder.temp.fsName+"/"+fileName);if(out.exists)out.remove();om.file=out;
 app.project.renderQueue.render();
 log.writeln("OK ordinal="+ordinal+" candidate="+candidateId+" label="+label+" status="+rq.status+" bytes="+out.length+" file="+out.fsName);
 rq.remove();
}
try{
 app.beginUndoGroup("M6 shutter response search");
 var src=comp("spidy try 3 - MICROWAVE PRO");if(!src)throw new Error("BASELINE_COMP_MISSING");
 var candidates=eval('(${payload})');
 for(var ci=0;ci<candidates.length;ci++){
  var ordinal=ci+1,name="spidy try 3 - "+outputPrefix+" "+("0"+ordinal).slice(-2),old=comp(name);if(old)old.remove();
  var C=src.duplicate();C.name=name;
  var candidate=candidates[ci];
  for(var j=0;j<candidate.cases.length;j++)correct(C,candidate.cases[j],ordinal);
  if(localWindowMs>0){
   var localDuration=localWindowMs/1000;
   for(var windowIndex=0;windowIndex<candidate.cases.length;windowIndex++){
    var localCase=candidate.cases[windowIndex];
    if(candidate.changedTags&&candidate.changedTags.length>0){
     var tagChanged=false;
     for(var changedIndex=0;changedIndex<candidate.changedTags.length;changedIndex++){
      if(candidate.changedTags[changedIndex]===localCase.tag){tagChanged=true;break;}
     }
     if(!tagChanged)continue;
    }
    var safeTag=String(localCase.tag).replace(/[^A-Za-z0-9_-]/g,"_");
    renderWindow(
     C,
     localCase.cutSeconds-(localDuration/2),
     localDuration,
     outputPrefix+"_"+("0"+ordinal).slice(-2)+"_"+safeTag+".mp4",
     ordinal,
     candidate.candidateId,
     localCase.tag
    );
   }
  }else{
   renderWindow(C,7.15,5.05,"M6_shutter_search_"+("0"+ordinal).slice(-2)+".mp4",ordinal,candidate.candidateId,"full");
  }
 }
 app.endUndoGroup();
}catch(e){try{app.endUndoGroup();}catch(_e){}log.writeln("ERR "+e.toString()+" line="+e.line);}
log.close();
}());`;
await writeFile(outputPath, source, "utf8");
console.log(JSON.stringify({
  ok: true,
  output: outputPath,
  localWindowMs,
  outputPrefix,
  candidates: plan.combinedCandidates.map((item, index) => ({
    ordinal: index + 1,
    candidateId: item.candidateId,
  })),
}));
