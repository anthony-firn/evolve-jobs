import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import path from 'node:path';
test('browser loads WASM under the site CSP, searches direct employer fixtures and stores rules locally',async()=>{
  const root=path.resolve('dist/site');
  const server=createServer(async(req,res)=>{
    try{const rel=new URL(req.url,'http://localhost').pathname;const file=path.join(root,rel==='/'?'index.html':rel);if(!file.startsWith(root+'/'))throw new Error('Path');const body=await readFile(file);res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.html':'text/html','.webmanifest':'application/manifest+json'})[path.extname(file)]||'application/octet-stream');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self'; connect-src 'self' https://api.lever.co wss:; object-src 'none'; form-action 'none'");res.end(body);}catch{res.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    let employerRequests=0;
    await page.route('https://api.lever.co/**',route=>{employerRequests++;return route.fulfill({headers:{'access-control-allow-origin':'*'},json:[{id:'fixture',text:'Engineer <img src=x onerror=alert(1)>',descriptionPlain:'javascript',categories:{location:'United States'},workplaceType:'remote',salaryRange:{min:120000,max:140000,currency:'USD',interval:'per-year-salary'}}]});});
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator('#example').click();await page.waitForFunction(()=>document.querySelector('#count').textContent.startsWith('1 rule matches'));
    assert.equal(employerRequests,0);
    await page.locator('#boards').fill('fixture');await page.locator('#discover').click();
    await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Fetched 1'));
    assert.equal(await page.locator('#listings img').count(),0);
    assert.equal(employerRequests,1);
    await page.locator('[name=minAnnual]').fill('200000');await page.locator('#rules button').click();
    assert.match(await page.locator('#count').textContent(),/^0 rule matches/);
    await page.reload();assert.equal(await page.locator('[name=minAnnual]').inputValue(),'200000');
    assert.deepEqual(errors,[]);
    await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();
    await page.context().setOffline(true);await page.reload();
    await page.locator('#example').click();assert.match(await page.locator('#status').textContent(),/Fictional example/);
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
