(function () {
  "use strict";
  var root = new File($.fileName).parent.parent.parent;
  var out = new File(root.fsName + "/proofs/artifacts/m4-tracker-repair-resume-backward-readback.json");
  var setupFile = new File(root.fsName + "/proofs/artifacts/m4-tracker-repair-resume-backward-fixture.json");
  var loader = new File(root.fsName + "/packages/adapters/ae-cep/host/editflow_host_current_v24.jsx");
  function write(v){out.parent.create();out.open("w");out.encoding="UTF-8";out.write(JSON.stringify(v));out.close();}
  function readJson(file){file.open("r");var text=file.read();file.close();return JSON.parse(text);}
  function find(name){for(var i=1;i<=app.project.numItems;i+=1){if(app.project.item(i).name===name)return app.project.item(i);}return null;}
  function same2(a,b,tol){return a&&b&&Math.abs(a[0]-b[0])<=tol&&Math.abs(a[1]-b[1])<=tol;}
  var r={ok:false,checks:{}};
  try{
    if(!setupFile.exists)throw new Error("Backward repair/resume setup evidence missing.");
    var setup=readJson(setupFile);if(!setup.ok)throw new Error("Backward repair/resume setup not accepted.");
    var comp=find(setup.compName);if(!comp||!(comp instanceof CompItem))throw new Error("Backward repair/resume fixture missing.");
    var layer=app.project.layerByID?app.project.layerByID(setup.layerId):comp.layer(1);if(!layer||layer.containingComp!==comp)throw new Error("Backward repair/resume layer mismatch.");
    if(!loader.exists)throw new Error("Protocol 2.4 loader missing.");
    $.evalFile(loader);
    var request={protocolVersion:"2.1.0",requestId:"M4_RRB_READBACK",transactionId:"M4_RRB_READBACK",operationId:"M4_RRB_READBACK",capabilityId:"ae.tracker.readback",command:"tracker.readback",expectedHostProjectRevision:null,payload:{comp:{hostId:comp.id},layer:{hostId:layer.id}},readbackProfile:"M4_TRACKER_REPAIR_RESUME_BACKWARD_VERIFY"};
    var response=$.global.EditFlow2_JSON.parse($.global.EditFlow2_dispatch($.global.EditFlow2_JSON.stringify(request)));
    var trackers=response&&response.readback?response.readback.trackers:[],point=trackers.length===1&&trackers[0].points.length===1?trackers[0].points[0]:null;
    if(!point)throw new Error("Expected one repaired tracker point.");
    var frame=comp.frameDuration,repair=null,pre=[],minPreX=999999,i,s;
    for(i=0;i<point.samples.length;i+=1){
      s=point.samples[i];
      if(Math.abs(s.time-setup.repairTime)<=frame/1000)repair=s;
      if(s.time<setup.repairTime-frame/2){pre.push(s);if(s.featureCenter&&s.featureCenter.length>=2)minPreX=Math.min(minPreX,s.featureCenter[0]);}
    }
    var nearestPre=pre.length?pre[pre.length-1]:null;
    var expectedPreX=nearestPre?220+(280/2.5)*nearestPre.time:null;
    var dx=nearestPre?nearestPre.featureCenter[0]-expectedPreX:0,dy=nearestPre?nearestPre.featureCenter[1]-360:0;
    var groundTruthError=nearestPre?Math.sqrt(dx*dx+dy*dy):null;
    r.checks.protocol21=response.protocolVersion==="2.1.0"&&response.outcome==="NO_OP";
    r.checks.keyCountGrew=point.keyedSampleCount>setup.preResumeFeatureCenterKeyCount;
    r.checks.repairKeyPreserved=!!repair&&same2(repair.featureCenter,setup.desiredRepairCenter,0.01);
    r.checks.preRepairSamplesAdded=pre.length>0;
    r.checks.backwardMotionObserved=!!nearestPre&&nearestPre.featureCenter[0]<setup.desiredRepairCenter[0]-1;
    r.checks.groundTruthTrajectoryMatched=groundTruthError!==null&&groundTruthError<=3;
    r={proof:"M4_TRACKER_REPAIR_RESUME_BACKWARD_READBACK",ok:r.checks.protocol21&&r.checks.keyCountGrew&&r.checks.repairKeyPreserved&&r.checks.preRepairSamplesAdded&&r.checks.backwardMotionObserved&&r.checks.groundTruthTrajectoryMatched,checks:r.checks,fixtureCompId:comp.id,layerId:layer.id,preResumeFeatureCenterKeyCount:setup.preResumeFeatureCenterKeyCount,postResumeKeyedSampleCount:point.keyedSampleCount,repairSample:repair,preRepairSampleCount:pre.length,minPreFeatureCenterX:minPreX,nearestPreExpectedX:expectedPreX,groundTruthErrorPx:groundTruthError,nearestPreRepairSample:nearestPre,response:response};
  }catch(error){r.error=String(error);}
  write(r);
}());
