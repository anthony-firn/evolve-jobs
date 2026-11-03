import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateSecretKey} from 'nostr-tools';
import {normalize, assess, parsePublicJob, discover} from '../src/core.js';
import {makeEvent, readEvent} from '../src/network.js';
import {Ledger} from '../src/worker.js';
const now=Date.now();
const policy={minAnnual:100000,currency:'USD',titleTerms:['engineer'],requiredTerms:['javascript'],excludedTerms:['clearance'],remoteOnly:true,locations:['United States']};
const fixture={id:'abc-123',text:'Software engineer',descriptionPlain:'JavaScript experience',categories:{location:'United States'},workplaceType:'remote',salaryRange:{min:120000,max:160000,interval:'per-year',currency:'USD'}};
const job=()=>normalize('example',fixture,now);
test('salary floor uses the lower bound, known annual interval and exact currency',()=>{
  assert.equal(assess(job(),policy,now).eligible,true);
  for(const patch of [{salaryMin:90000,salaryMax:200000},{salaryMin:null},{currency:'CAD'},{fetchedAt:now-86400001},{remote:false},{location:'Canada'},{description:'Python only'},{description:'JavaScript security clearance'}])assert.equal(assess({...job(),...patch},policy,now).eligible,false,JSON.stringify(patch));
  for(const interval of ['per-hour','per-month',undefined])assert.equal(normalize('example',{...fixture,salaryRange:{...fixture.salaryRange,interval}}).salaryMin,null);
});
test('normalization never trusts remote URLs or profile properties',()=>{
  const j=normalize('example',{...fixture,applyUrl:'https://evil.test',profile:{email:'private'}});
  assert.equal(j.applyUrl,'https://jobs.lever.co/example/abc-123/apply');
  assert.equal(j.profile,undefined);
  assert.equal(parsePublicJob({...j,url:'javascript:alert(1)'}).url,j.url);
  assert.throws(()=>parsePublicJob({...j,board:'../bad'}));
});
test('signed listing protocol rejects tampering and strips private data',()=>{
  const event=makeEvent({...job(),profile:{email:'secret'},resume:'private'},generateSecretKey());
  assert.equal(readEvent(event).id,job().id);
  assert.equal(event.content.includes('secret'),false);
  assert.throws(()=>readEvent({...event,content:event.content+' '}));
});
test('worker discovers source jobs and exposes source failures',async()=>{
  const rows=await discover('example',async url=>{assert.match(url,/api.lever.co/);return {ok:true,json:async()=>[fixture]};});
  assert.equal(rows[0].id,job().id);
  await assert.rejects(()=>discover('example',async()=>({ok:false,status:429})),/429/);
});
test('application reservations prevent duplicates, preserve uncertain attempts and enforce daily limits',()=>{
  const ledger=new Ledger(':memory:');
  ledger.reserve('one',2,now);
  ledger.status('one','uncertain','Check employer');
  assert.throws(()=>ledger.reserve('one',2,now),/Already attempted/);
  ledger.reserve('two',2,now);
  assert.throws(()=>ledger.reserve('three',2,now),/Daily/);
  assert.equal(ledger.all().length,2);
  ledger.close();
});
