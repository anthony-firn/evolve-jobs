import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {fillLever} from '../src/worker.js';
const basic='<label>Name<input name="name" required></label><label>Email<input name="email" type="email" required></label><label>Resume<input name="resume" type="file" required></label>';
const profile={name:'Test Person',email:'test@example.com',resume:new URL('../LICENSE',import.meta.url).pathname};
test('standard form fills truthful local fields; unknown questions and consent stop automation',async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();
    await page.setContent(basic);
    await fillLever(page,profile);
    assert.equal(await page.locator('[name=email]').inputValue(),profile.email);
    await page.setContent(basic+'<label>Work authorization<input name="authorization" required></label>');
    await assert.rejects(()=>fillLever(page,profile),/Unanswered field/);
    await fillLever(page,{...profile,answers:{'Work authorization':'Test answer'}});
    await page.setContent(basic+'<label><input type="checkbox" required>Consent</label>');
    await assert.rejects(()=>fillLever(page,profile),/Consent/);
    await page.setContent(basic+'<div data-sitekey="test"></div>');
    await assert.rejects(()=>fillLever(page,profile),/CAPTCHA/);
  }finally{await browser.close();}
});
