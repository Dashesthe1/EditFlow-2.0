'use strict';
const http=require('node:http');
const path=require('node:path');
const {execFile}=require('node:child_process');
const EXTENSION='ljjjjjoghmheifakiiahgoonhhmoebog';

/** Deliver exactly one scoped first-chat prompt. Never choose, analyze or edit media. */
async function startSupervisor({backend,token,port=32147,browserLaunchEnabled=true}) {
  let task=null,lastExtensionLoadedAt=0,extensionVersion=null,gatewayError=null,busy=false,lastActuatorAt=0;
  const opened=new Set();
  async function product(body) {
    const response=await fetch(backend+'/v1/product/practice/supervisor',{method:body?'POST':'GET',
      headers:{'content-type':'application/json','x-editflow-token':token},signal:AbortSignal.timeout(10000),
      ...(body?{body:JSON.stringify(body)}:{})});
    const value=await response.json();if(!response.ok)throw Error(value.error??'SUPERVISOR_BACKEND_UNAVAILABLE');
    return value;
  }
  async function refresh() {
    if(busy)return;busy=true;
    try{task=(await product()).task;gatewayError=null;
      if(task&&browserLaunchEnabled&&process.platform==='win32'&&Date.now()-lastActuatorAt>15000&&!opened.has(task.launchId)){
        opened.add(task.launchId);
        execFile(path.join(process.env.ProgramFiles??'C:\\Program Files','Google','Chrome','Application','chrome.exe'),['about:blank'],{windowsHide:true},e=>{if(e)gatewayError='Chrome could not open: '+e.message;});
      }
    }catch(e){task=null;gatewayError=e.message;}finally{busy=false;}
  }
  const server=http.createServer(async(req,res)=>{
    const origin=req.headers.origin;
    const allowed=origin==='chrome-extension://'+EXTENSION||(!origin&&req.headers['x-editflow-actuator-id']===EXTENSION);
    res.setHeader('content-type','application/json');res.setHeader('cache-control','no-store');
    if(origin==='chrome-extension://'+EXTENSION){res.setHeader('access-control-allow-origin',origin);res.setHeader('access-control-allow-headers','content-type,x-editflow-actuator-id,x-editflow-actuator-version');}
    const send=(status,value)=>{res.writeHead(status);res.end(JSON.stringify(value));};
    try{
      if(req.url==='/health'&&req.method==='GET')return send(200,{ok:true,service:'EditFlow Practice Source Supervisor',version:'4.0.2',
        scope:'FIRST_CHAT_SOURCE_MATCH_ONLY',lastExtensionLoadedAt,extensionVersion,gatewayError,
        phase:task?'FIRST_CHAT_HANDOFF':'IDLE',sessionId:task?.sessionId??null});
      if(!allowed)return send(403,{error:'EXTENSION_REQUIRED'});
      if(req.method==='OPTIONS')return send(200,{});
      if(req.url==='/actuator'&&req.method==='GET'){
        lastActuatorAt=Date.now();extensionVersion=String(req.headers['x-editflow-actuator-version']??extensionVersion??'unknown');await refresh();
        return send(200,task?{command:task.tabId===null?'CREATE':'SEND',id:task.launchId,tabId:task.tabId,
          ...(task.tabId!==null?{prompt:task.prompt}:{})}:{command:'NONE'});
      }
      if(req.url==='/actuator/ack'&&req.method==='POST'){
        let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>200000)throw Error('BODY_TOO_LARGE');}
        const b=JSON.parse(raw||'{}');
        if(b.type==='READY'){lastExtensionLoadedAt=Date.now();extensionVersion=b.version;return send(200,{ok:true});}
        await product({launchId:b.id,type:b.type,tabId:b.tabId,conversationUrl:b.observedUrl,error:b.error});
        await refresh();return send(200,{ok:true});
      }
      return send(404,{error:'NOT_FOUND'});
    }catch(e){return send(409,{error:e.message});}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  const timer=setInterval(()=>void refresh(),2000);timer.unref();await refresh();
  return {port:server.address().port,stop:async()=>{clearInterval(timer);await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}};
}
module.exports={startSupervisor};
