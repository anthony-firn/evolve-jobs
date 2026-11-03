import {assess, discover, parsePublicJob, validatePolicy, setMatcher} from '../src/core.js';
import {loadMatcher} from '../src/wasm.js';
const ready=loadMatcher(chrome.runtime.getURL('matcher.wasm')).then(setMatcher);
let serial=Promise.resolve();
function locked(fn){const next=serial.then(fn);serial=next.catch(()=>{});return next;}
const empty=()=>({running:false,history:[],active:null});
function validate(s){validatePolicy(s.plan.policy);if(!s.truthful||!s.profile.name.trim()||!s.profile.email.includes('@')||!s.profile.resume?.data||!s.employers.length||!Number.isInteger(s.maxPerDay)||s.maxPerDay<1||s.maxPerDay>25)throw new Error('Set a truthful profile, résumé, employers and daily attempt limit');s.plan.jobs=s.plan.jobs.map(parsePublicJob);}
async function advance(){
  await ready;
  const data=await chrome.storage.local.get(['state','settings']), state=data.state||empty(), s=data.settings;
  if(!state.running||!s)return;
  if(state.active){const active=state.history.find(x=>x.id===state.active);if(Date.now()-active.at<300000)return;active.status='uncertain';active.note='Interrupted or timed out; check employer before any retry';state.active=null;await chrome.storage.local.set({state});}
  validate(s);
  const day=new Date().toISOString().slice(0,10);
  if(state.history.filter(x=>new Date(x.at).toISOString().slice(0,10)===day).length>=s.maxPerDay){state.running=false;await chrome.storage.local.set({state});return;}
  for(const candidate of s.plan.jobs){
    if(!s.employers.includes(candidate.board)||state.history.some(x=>x.id===candidate.id))continue;
    let live;
    try{live=(await discover(candidate.board)).find(x=>x.id===candidate.id);}catch(error){state.note=error.message;await chrome.storage.local.set({state});return;}
    if(!live||!assess(live,s.plan.policy).eligible)continue;
    const entry={id:live.id,url:live.applyUrl,at:Date.now(),status:'reserved'};
    state.history.push(entry);state.active=entry.id;
    await chrome.storage.local.set({state});
    try{const tab=await chrome.tabs.create({url:'about:blank',active:false});entry.tab=tab.id;await chrome.storage.local.set({state});await chrome.tabs.update(tab.id,{url:live.applyUrl});}
    catch(error){entry.status='needs-review';entry.note=error.message;state.active=null;await chrome.storage.local.set({state});}
    return;
  }
  state.running=false;state.note='No unattempted matching roles remain';await chrome.storage.local.set({state});
}
async function handle(message,sender){
  const data=await chrome.storage.local.get(['settings','state']),state=data.state||empty();
  const ownPanel=sender.url===chrome.runtime.getURL('panel.html');
  if(['save','start','stop','clear'].includes(message.type)){
    if(!ownPanel)throw new Error('Open the extension panel');
    if(message.type==='save'){if(state.active)throw new Error('Wait for the current application to finish before editing settings');validate(message.settings);await chrome.storage.local.set({settings:message.settings});return {message:'Saved'};}
    if(message.type==='clear'){if(state.active)throw new Error('Close the active employer tab before deleting the profile');state.running=false;await chrome.storage.local.set({state});await chrome.storage.local.remove('settings');return {message:'Profile and résumé deleted; application history retained for duplicate protection'};}
    if(message.type==='start'){if(!data.settings)throw new Error('Save your configuration first');validate(data.settings);state.running=true;await chrome.alarms.create('advance',{periodInMinutes:1});}
    if(message.type==='stop')state.running=false;
    await chrome.storage.local.set({state});
    if(message.type==='start')queueMicrotask(()=>locked(advance));
    return {message:message.type==='stop'?'Queue stopped; the current application may already be in progress. Close its employer tab to interrupt it.':'Queue started. Check history for results.'};
  }
  const entry=state.history.find(x=>x.id===state.active);
  const senderURL=sender.url?new URL(sender.url):null;
  const expected=entry?new URL(entry.url):null;
  const applicationPage=expected&&senderURL?.origin===expected.origin&&senderURL.pathname===expected.pathname;
  const thanksPage=expected&&senderURL?.origin===expected.origin&&senderURL.pathname===expected.pathname.replace(/\/apply$/, '/thanks');
  if(!entry||entry.tab!==sender.tab?.id||!(applicationPage||message.type==='result'&&thanksPage&&entry.status==='submitting'))throw new Error('No authorized application for this tab');
  if(message.type==='ready'){
    if(entry.status!=='reserved')throw new Error('This application was already started; inspect history');
    if(!state.running)throw new Error('Queue stopped');
    entry.status='filling';await chrome.storage.local.set({state});return {profile:data.settings.profile};
  }
  if(message.type==='submitting'){if(!state.running||entry.status!=='filling')throw new Error('Submission is not authorized');entry.status='submitting';entry.note='May have been sent; do not retry automatically';await chrome.storage.local.set({state});return {ok:true};}
  if(message.type==='result'){
    if(!['filling','submitting'].includes(entry.status))throw new Error('Unexpected application state');
    entry.status=message.success&&entry.status==='submitting'?'submitted':entry.status==='submitting'?'uncertain':'needs-review';
    entry.note=String(message.note||'').slice(0,500);state.active=null;await chrome.storage.local.set({state});queueMicrotask(()=>locked(advance));return {ok:true};
  }
  throw new Error('Unknown message');
}
chrome.runtime.onMessage.addListener((msg,sender,reply)=>{locked(()=>handle(msg,sender)).then(reply,e=>reply({error:e.message}));return true;});
chrome.alarms.onAlarm.addListener(()=>locked(advance).catch(console.error));
chrome.action.onClicked.addListener(()=>chrome.tabs.create({url:chrome.runtime.getURL('panel.html')}));
chrome.tabs.onRemoved.addListener(tabId=>locked(async()=>{const{state}=await chrome.storage.local.get('state');const entry=state?.history.find(x=>x.id===state.active&&x.tab===tabId);if(entry){entry.status=['submitting','filling'].includes(entry.status)?'uncertain':'needs-review';entry.note='Employer tab closed; check for submission';state.active=null;await chrome.storage.local.set({state});await advance();}}));
