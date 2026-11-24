import {loadMatcher} from '../src/wasm.js';
import {assess, parsePublicJob, discover, setMatcher} from '../src/core.js';
import {generateSecretKey} from 'nostr-tools';
import {publish, receive} from '../src/network.js';
const $ = s => document.querySelector(s);
const form = $('#rules');
try {setMatcher(await loadMatcher(new URL('./matcher.wasm', location.href)));}
catch(error) {$('#status').textContent=error.message; throw error;}
let jobs = [], policy;
function message(text) {$('#status').textContent = text;}
function readRules() {
  const data = new FormData(form);
  const p = {minAnnual:Number(data.get('minAnnual')),currency:data.get('currency').trim(),remoteOnly:data.has('remoteOnly')};
  for (const key of ['titleTerms','requiredTerms','excludedTerms','locations']) p[key] = data.get(key).split(',').map(x=>x.trim()).filter(Boolean);
  return p;
}
try {
  const saved = JSON.parse(localStorage.getItem('evolve-jobs-rules'));
  if (saved) for (const [key,value] of Object.entries(saved)) {
    const field = form.elements.namedItem(key);
    if (field) {if (field.type === 'checkbox') field.checked = value === true; else field.value = Array.isArray(value) ? value.join(', ') : value;}
  }
} catch {message('Saved rules unavailable; using the defaults.');}
policy = readRules();
function node(tag, text, className) {const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;return el;}
function render() {
  const root = $('#listings'); root.replaceChildren();
  let rows;
  try {rows=jobs.map(job=>({job,result:assess(job,policy)})).sort((a,b)=>Number(b.result.eligible)-Number(a.result.eligible));}
  catch(error) {message(error.message);return;}
  $('#count').textContent = `${rows.filter(x=>x.result.eligible).length} rule matches / ${jobs.length} listings`;
  for (const {job,result} of rows) {
    const card=node('article','','job');
    card.append(node('p',`${job.company} · ${job.location}${job.remote?' · Remote':''}`),node('h3',job.title));
    card.append(node('p',job.salaryMin ? `${job.currency} ${job.salaryMin.toLocaleString()} – ${job.salaryMax?.toLocaleString() || 'undisclosed'} / year` : 'Annual pay not confirmed','pay'));
    card.append(node('p',result.eligible?'Matches your rules. Review the full employer requirements.':result.reasons.join(' · '),result.eligible?'':'reasons'));
    card.append(node('p',`Fetched ${new Date(job.fetchedAt).toLocaleString()} · Unverified until refreshed from employer`,'small'));
    if (!job.board.startsWith('fictional-')) {const a=node('a','Review employer listing ↗');a.href=job.url;a.target='_blank';a.rel='noopener noreferrer';card.append(a);}
    root.append(card);
  }
}
form.addEventListener('submit', event=>{event.preventDefault();policy=readRules();render();try{localStorage.setItem('evolve-jobs-rules',JSON.stringify(policy));}catch{message('Rules applied for this session; browser storage is unavailable.');}});
$('#import').addEventListener('change',async event=>{
  try {const file=event.target.files[0];if(!file)return;if(file.size>5_000_000)throw new Error('Choose a JSON file under 5 MB');
    const data=JSON.parse(await file.text());if(!Array.isArray(data)||data.length>5000)throw new Error('Expected an array of up to 5,000 listings');
    jobs=[...new Map(data.map(parsePublicJob).map(j=>[j.id,j])).values()];render();message(`Imported ${jobs.length} listings. Peer data requires employer verification.`);
  } catch(error){message(error.message);}
});
$('#plan').addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({version:1,policy,jobs:jobs.filter(j=>!j.board.startsWith('fictional-'))},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='application-plan.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
$('#export').addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(jobs,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='jobs.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
$('#connect').addEventListener('click',async()=>{
  $('#connect').disabled=true;message('Requesting public listings from the selected relays…');
  try{const received=await receive($('#relays').value.split(',').map(x=>x.trim()).filter(Boolean));jobs=[...new Map([...jobs,...received].map(j=>[j.id,j])).values()];render();message(`Received ${received.length} listings. This new network may have no publishers yet.`);}catch(error){message(error.message);}finally{$('#connect').disabled=false;}
});
$('#example').addEventListener('click',()=>{jobs=[{version:1,provider:'lever',board:'fictional-example',postingId:'example',id:'lever:fictional-example:example',title:'Fictional JavaScript engineer — example only',company:'Fictional company',location:'United States',remote:true,description:'Example JavaScript position. This is not a real vacancy.',salaryMin:120000,salaryMax:155000,currency:'USD',fetchedAt:Date.now()}];render();message('Fictional example loaded. It cannot be submitted to an employer.');});
render();

$('#discover').addEventListener('click', async()=>{
  const boards=[...new Set($('#boards').value.split(',').map(x=>x.trim()).filter(Boolean))];
  if (!boards.length || boards.length>8) {message('Enter 1–8 employer board names.');return;}
  $('#discover').disabled=true;message('Fetching current listings directly from employers…');
  const found=[], errors=[];
  try {for(const board of boards){try{found.push(...await discover(board));}catch(error){errors.push(error.message);}}
    jobs=[...new Map([...jobs,...found].map(j=>[j.id,j])).values()];render();message(`Fetched ${found.length} employer listings.${errors.length?' '+errors.join('; '):''}`);
  }finally{$('#discover').disabled=false;}
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(()=>{});

let publicSigningKey;
$('#share').addEventListener('click',async()=>{
  $('#share').disabled=true;
  try {
    const urls=$('#relays').value.split(',').map(x=>x.trim()).filter(Boolean);
    const selected=jobs.filter(j=>!j.board.startsWith('fictional-')&&assess(j,policy).eligible).slice(0,25);
    if(!selected.length)throw new Error('Find matching employer listings before sharing.');
    message('Refreshing public listings from employers before sharing…');
    const current=[];
    for(const board of new Set(selected.map(j=>`${j.provider}:${j.board}`))){
      const live=await discover(board);
      current.push(...live.filter(j=>selected.some(x=>x.id===j.id)&&assess(j,policy).eligible));
    }
    if(!current.length)throw new Error('No matching listings remain at the employer.');
    publicSigningKey ||= generateSecretKey();
    await publish(urls,current,publicSigningKey);
    message(`Shared ${current.length} public employer listings. Your profile and search rules were not published.`);
  }catch(error){message(error.message);}finally{$('#share').disabled=false;}
});
