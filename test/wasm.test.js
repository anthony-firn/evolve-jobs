import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assess,normalize,setMatcher} from '../src/core.js';
import {loadMatcher} from '../src/wasm.js';
test('compiled WASM matches Unicode-lowercased role and qualification text, preserves pay rejection',async()=>{
  const bytes=await readFile(new URL('../dist/site/matcher.wasm',import.meta.url));
  const original=globalThis.fetch;
  globalThis.fetch=async()=>({ok:true,arrayBuffer:async()=>bytes});
  try{
    const matcher=await loadMatcher('fixture');setMatcher(matcher);
    assert.equal(matcher.contains('développeur javascript','javascript'),true);
    assert.equal(matcher.contains('rust','javascript'),false);
    assert.equal(matcher.salaryMeets(NaN,100000),false);
    const job=normalize('fixture',{id:'job',text:'Développeur',descriptionPlain:'JavaScript',workplaceType:'remote',salaryRange:{min:120000,max:140000,currency:'USD',interval:'per-year'}});
    const policy={minAnnual:100000,currency:'USD',titleTerms:['développeur'],requiredTerms:['javascript'],excludedTerms:[],locations:[],remoteOnly:true};
    assert.equal(assess(job,policy).eligible,true);
    assert.equal(assess({...job,salaryMin:90000},policy).eligible,false);
  }finally{globalThis.fetch=original;}
});
