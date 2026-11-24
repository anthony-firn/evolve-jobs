import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {generateSecretKey} from 'nostr-tools';
import {useWebSocketImplementation} from 'nostr-tools/pool';
import WebSocket from 'ws';
import {discover, assess, parsePublicJob} from './core.js';
import {rank} from './impact.js';
import {publish, receive} from './network.js';
import {Ledger, apply, loadConfig, validateAutomation} from './worker.js';
useWebSocketImplementation(WebSocket);
const [command, ...args] = process.argv.slice(2);
// Curated company facts for impact scoring; private by default because they hold your own judgments.
const loadCompanies = config => {
  const file = config.companies || 'private/companies.json';
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
};
try {
  if (command === 'discover') {
    if (!args.length) throw new Error('Provide job boards, e.g. lever:filevine greenhouse:northbeam ashby:resend');
    const jobs = [];
    let failed = false;
    for (const board of args) {try {jobs.push(...await discover(board));} catch(error) {console.error(error.message); failed = true;}}
    process.stdout.write(JSON.stringify(jobs, null, 2)+'\n');
    if (failed) process.exitCode = 1;
  } else if (command === 'match' || command === 'apply') {
    const config = loadConfig(args[0] || 'private/config.json');
    const jobs = JSON.parse(readFileSync(args[1] || 'private/jobs.json', 'utf8')).map(parsePublicJob);
    if (command === 'apply') validateAutomation(config);
    const ledger = command === 'apply' ? new Ledger('private/applications.sqlite') : null;
    const companies = loadCompanies(config);
    try {for (const job of jobs) {
      const result = assess(job, config.policy, Date.now(), companies);
      if (command === 'match') console.log(JSON.stringify({id:job.id,...result}));
      else if (result.eligible) {try {console.log(job.id, await apply(job, config, ledger));} catch(error) {console.error(job.id, error.message); process.exitCode = 1;}}
    }} finally {ledger?.close();}
  } else if (command === 'rank') {
    // Eligible jobs first, ordered by karma-adjusted pay; prints why each one scored as it did.
    const config = loadConfig(args[0] || 'private/config.json');
    const jobs = JSON.parse(readFileSync(args[1] || 'private/jobs.json', 'utf8')).map(parsePublicJob);
    const companies = loadCompanies(config);
    for (const row of rank(jobs, config.policy.impact || {}, companies)) {
      const result = assess(row.job, {...config.policy, impact: config.policy.impact || {}}, Date.now(), companies);
      console.log(JSON.stringify({id: row.job.id, title: row.job.title, eligible: result.eligible, pay: row.pay, karmaPay: row.karmaPay, impact: row.impact.score, why: row.impact.reasons, blockers: result.reasons}));
    }
  } else if (command === 'history') {
    const ledger = new Ledger('private/applications.sqlite');
    try {console.log(JSON.stringify(ledger.all(),null,2));} finally {ledger.close();}
  } else if (command === 'relay-pull') {
    console.log(JSON.stringify(await receive(args),null,2));
  } else if (command === 'relay-publish') {
    const [file, ...urls] = args;
    const config = loadConfig('private/config.json');
    const keyFile = 'private/relay-key.json';
    if (!existsSync(keyFile)) writeFileSync(keyFile, JSON.stringify([...generateSecretKey()]), {mode:0o600, flag:'wx'});
    // Only share listings freshly fetched from the original employer, never private application data.
    const requested = JSON.parse(readFileSync(file,'utf8')).map(parsePublicJob);
    const jobs = [];
    for (const board of new Set(requested.map(x=>`${x.provider}:${x.board}`))) {
      const current = await discover(board);
      jobs.push(...current.filter(j=>requested.some(r=>r.id===j.id)));
    }
    await publish(urls.length ? urls : config.relays, jobs, Uint8Array.from(JSON.parse(readFileSync(keyFile,'utf8'))));
    console.log(`Published ${jobs.length} public listings`);
  } else throw new Error('Usage: npm run jobs -- discover <board...> | match [config] [jobs] | rank [config] [jobs] | apply [config] [jobs] | history | relay-pull <wss://...> | relay-publish <jobs.json> [wss://...]');
} catch (error) {console.error(error.message); process.exitCode = 1;}
