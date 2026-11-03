import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {normalize} from '../src/core.js';
test('extension submits fixture only after local authorization and keeps a durable duplicate reservation',{timeout:45000},async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'evolve-jobs-ext-'));
  const extension=path.resolve('dist/extension');
  const context=await chromium.launchPersistentContext(dir,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  try{
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:15000});
    const id=new URL(worker.url()).host;
    const post={id:'fixture',text:'Software engineer',descriptionPlain:'javascript',categories:{location:'United States'},workplaceType:'remote',salaryRange:{min:120000,max:140000,currency:'USD',interval:'per-year'}};
    // Every employer request is intercepted. No application leaves this test.
    await context.route('https://api.lever.co/**',route=>route.fulfill({json:[post,{...post,id:'low',salaryRange:{...post.salaryRange,min:90000}},{...post,id:'consent'}]}));
    await context.route('https://jobs.lever.co/**',route=>route.fulfill({contentType:'text/html',body:(route.request().url().includes('/consent/')?'<label><input type=checkbox required>Consent</label>':'')+'<label>Name<input name="name" required></label><label>Email<input type="email" name="email" required></label><label>Resume<input type="file" name="resume" required></label><button id="submit">Submit application</button><div id="confirmation"></div><script>document.querySelector("#submit").onclick=()=>{document.querySelector("#confirmation").textContent="Thank you for applying"}</script>'}));
    const panel=await context.newPage();await panel.goto(`chrome-extension://${id}/panel.html`);
    const settings={truthful:true,employers:['fixture'],maxPerDay:3,plan:{version:1,policy:{minAnnual:100000,currency:'USD',titleTerms:['engineer'],requiredTerms:['javascript'],excludedTerms:[],locations:['United States'],remoteOnly:true},jobs:[normalize('fixture',{...post,id:'low'}),normalize('fixture',post),normalize('fixture',{...post,id:'consent'})]},profile:{name:'Fixture Person',email:'fixture@example.com',answers:{},resume:{name:'fixture.pdf',type:'application/pdf',data:Buffer.from('%PDF-1.4 fixture').toString('base64')}}};
    await worker.evaluate(async settings=>chrome.storage.local.set({settings}),settings);
    await panel.locator('#start').click();
    await panel.waitForFunction(()=>document.querySelector('#history').textContent.includes('submitted'),null,{timeout:20000});
    await panel.waitForFunction(()=>document.querySelector('#history').textContent.includes('No unattempted matching roles'));
    let state=await worker.evaluate(async()=>(await chrome.storage.local.get('state')).state);
    assert.equal(state.history.length,2);assert.equal(state.history[0].status,'submitted');assert.equal(state.history[1].status,'needs-review');assert.match(state.history[1].note,/Consent/);assert.equal(state.history.some(x=>x.id.endsWith(':low')),false);
    await panel.locator('#start').click();
    await panel.waitForFunction(()=>document.querySelector('#history').textContent.includes('No unattempted matching roles'));
    state=await worker.evaluate(async()=>(await chrome.storage.local.get('state')).state);
    assert.equal(state.history.length,2);
  }finally{await context.close();await rm(dir,{recursive:true,force:true});}
});
