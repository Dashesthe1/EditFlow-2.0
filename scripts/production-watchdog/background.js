'use strict';
const BASE='http://127.0.0.1:32147';
let busy=false;
async function request(route,value){
  const response=await fetch(BASE+route,{method:value?'POST':'GET',headers:{'content-type':'application/json','x-editflow-actuator-id':chrome.runtime.id,'x-editflow-actuator-version':chrome.runtime.getManifest().version},
    ...(value?{body:JSON.stringify(value)}:{})});
  const result=await response.json();if(!response.ok)throw Error(result.error??'SUPERVISOR_UNAVAILABLE');return result;
}
async function execute(){
  if(busy)return;busy=true;let cmd;
  try{
    cmd=await request('/actuator');
    if(cmd.command==='CREATE'){
      const saved=await chrome.storage.local.get('launchTabs');
      const tabId=saved.launchTabs?.[cmd.id];
      const tab=(Number.isInteger(tabId)?await chrome.tabs.get(tabId).catch(()=>null):null)
        ??await chrome.tabs.create({url:'https://chatgpt.com/',active:false});
      await chrome.storage.local.set({launchTabs:{...saved.launchTabs,[cmd.id]:tab.id}});
      await chrome.tabs.update(tab.id,{autoDiscardable:false});
      await request('/actuator/ack',{id:cmd.id,type:'CREATED',tabId:tab.id});
    }else if(cmd.command==='SEND'){
      const tab=await chrome.tabs.get(cmd.tabId).catch(()=>null);
      if(!tab){await request('/actuator/ack',{id:cmd.id,type:'MISSING'});return;}
      if(tab.status!=='complete')return;
      let attached;
      try{attached=await chrome.tabs.sendMessage(tab.id,{type:'EDITFLOW_ACTUATOR_PING'});}catch{}
      if(attached?.version!==chrome.runtime.getManifest().version)await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});
      const reply=await chrome.tabs.sendMessage(tab.id,{type:'EDITFLOW_ACTUATOR_SEND',id:cmd.id,prompt:cmd.prompt});
      if(!reply?.sent)throw Error(reply?.error??'SEND_NOT_CONFIRMED');
      await request('/actuator/ack',{id:cmd.id,type:'SENT',tabId:tab.id,observedUrl:reply.conversationUrl});
    }
  }catch(e){if(cmd?.id)await request('/actuator/ack',{id:cmd.id,type:'FAILED',error:e.message}).catch(()=>{});}
  finally{busy=false;}
}
async function initialize(){
  await chrome.alarms.create('editflow-practice-supervisor',{periodInMinutes:0.5});
  await request('/actuator/ack',{type:'READY',version:chrome.runtime.getManifest().version}).catch(()=>{});
  void execute();
}
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='editflow-practice-supervisor')void execute();});
chrome.runtime.onStartup.addListener(()=>void initialize());
chrome.runtime.onInstalled.addListener(()=>void initialize());
setInterval(()=>void execute(),3000);
void initialize();
