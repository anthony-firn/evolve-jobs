import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {parseBoard, discover, normalizeGreenhouse, normalizeAshby, parsePublicJob, publicJob, htmlText, assess} from '../src/core.js';
import {apply} from '../src/worker.js';

const now = Date.now();
// Shapes copied from live boards-api.greenhouse.io and api.ashbyhq.com responses (November 2026).
const greenhouse = (patch = {}) => ({
  id: 4726569006, title: 'Senior Fullstack Engineer (Python + TypeScript)', location: {name: 'Remote - USA'},
  offices: [{name: 'Remote, United States'}], absolute_url: 'https://evil.test/steal',
  content: '&lt;h3&gt;About us&lt;/h3&gt;&lt;p&gt;We build Python &amp;amp; TypeScript data systems.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Own pipelines&lt;/li&gt;&lt;/ul&gt;&lt;p&gt;Benefits: medical, dental&lt;/p&gt;',
  pay_input_ranges: [{min_cents: 16500000, max_cents: 21000000, currency_type: 'USD', title: 'Base Salary Range', blurb: ''},
    {min_cents: 1500000, max_cents: 2800000, currency_type: 'USD', title: 'On-Target Earnings', blurb: ''}],
  ...patch,
});
const ashby = (patch = {}) => ({
  id: 'df2fe05d-1111-4222-8333-944455556666', title: 'Backend Engineer', location: 'Americas', secondaryLocations: [],
  isListed: true, isRemote: true, workplaceType: 'Remote', address: {postalAddress: {addressCountry: 'United States'}},
  jobUrl: 'https://evil.test/job', applyUrl: 'https://evil.test/apply', descriptionPlain: 'TypeScript APIs for email.',
  compensation: {summaryComponents: [
    {compensationType: 'EquityCashValue', interval: '1 YEAR', currencyCode: 'USD', minValue: null, maxValue: null},
    {compensationType: 'Salary', interval: '1 YEAR', currencyCode: 'USD', minValue: 170000, maxValue: 220000}]},
  ...patch,
});

test('board specs name a provider; a bare name stays Lever for older configurations', () => {
  assert.deepEqual(parseBoard('greenhouse:northbeam'), {provider: 'greenhouse', board: 'northbeam'});
  assert.deepEqual(parseBoard(' Ashby:resend '), {provider: 'ashby', board: 'resend'});
  assert.deepEqual(parseBoard('filevine'), {provider: 'lever', board: 'filevine'});
  for (const bad of ['workday:acme', 'constructor:acme', '__proto__:acme', 'ashby:../x', 'greenhouse:', 'lever:a/b']) assert.throws(() => parseBoard(bad), bad);
});

test('Greenhouse: base salary only, remote from location, canonical URLs, readable text', () => {
  const job = normalizeGreenhouse('northbeam', greenhouse(), now);
  assert.equal(job.id, 'greenhouse:northbeam:4726569006');
  assert.deepEqual([job.salaryMin, job.salaryMax, job.currency, job.remote], [165000, 210000, 'USD', true]);
  assert.equal(job.url, 'https://job-boards.greenhouse.io/northbeam/jobs/4726569006');
  assert.equal(job.applyUrl, job.url);
  assert.match(job.description, /Python & TypeScript data systems\./);
  assert.match(job.description, /\n- Own pipelines/);
  assert.doesNotMatch(job.description, /<|&lt;/);
  assert.equal(job.location, 'Remote - USA');
  const canada = normalizeGreenhouse('northbeam', greenhouse({location: {name: 'Remote - Canada'}}), now);
  assert.equal(canada.location, 'Remote - Canada');
  assert.equal(normalizeGreenhouse('northbeam', greenhouse({location: null}), now).location, 'Remote, United States');
});

test('Greenhouse pay that could be hourly, mixed-currency or partial counts as unknown', () => {
  const pay = ranges => normalizeGreenhouse('acme', greenhouse({pay_input_ranges: ranges}), now).salaryMin;
  assert.equal(pay([{min_cents: 4500, max_cents: 6000, currency_type: 'USD', title: 'Base'}]), null);
  assert.equal(pay([{min_cents: 15000000, max_cents: 18000000, currency_type: 'USD', title: 'Hourly rate'}]), null);
  assert.equal(pay([{min_cents: 15000000, max_cents: 18000000, currency_type: 'USD', title: 'Zone A'}, {min_cents: 13000000, max_cents: 16000000, currency_type: 'CAD', title: 'Zone B'}]), null);
  assert.equal(pay([{min_cents: 15000000, max_cents: 18000000, currency_type: 'USD', title: 'Zone A'}, {min_cents: 13500000, max_cents: 16000000, currency_type: 'USD', title: 'Zone B'}]), 135000);
  assert.equal(pay([]), null);
  assert.equal(normalizeGreenhouse('acme', greenhouse({location: {name: 'New York, NY'}, offices: []}), now).remote, false);
  assert.throws(() => normalizeGreenhouse('acme', greenhouse({id: '12; drop'}), now));
});

test('Ashby: annual salary components only, unlisted jobs dropped, canonical URLs', () => {
  const job = normalizeAshby('resend', ashby(), now);
  assert.equal(job.id, 'ashby:resend:df2fe05d-1111-4222-8333-944455556666');
  assert.deepEqual([job.salaryMin, job.salaryMax, job.currency, job.remote], [170000, 220000, 'USD', true]);
  assert.equal(job.url, 'https://jobs.ashbyhq.com/resend/df2fe05d-1111-4222-8333-944455556666');
  assert.equal(job.applyUrl, `${job.url}/application`);
  assert.equal(job.location, 'Americas; United States');
  assert.equal(normalizeAshby('resend', ashby({isListed: false}), now), null);
  const hourly = ashby({compensation: {summaryComponents: [{compensationType: 'Salary', interval: '1 HOUR', currencyCode: 'USD', minValue: 90, maxValue: 120}]}});
  assert.equal(normalizeAshby('resend', hourly, now).salaryMin, null);
  assert.equal(normalizeAshby('resend', ashby({compensation: null}), now).salaryMin, null);
  assert.equal(normalizeAshby('resend', ashby({isRemote: false, workplaceType: 'Hybrid'}), now).remote, false);
});

test('discover calls each provider’s public API and reads its response shape', async () => {
  const seen = [];
  const fake = body => async url => {seen.push(url); return {ok: true, json: async () => body};};
  assert.equal((await discover('greenhouse:northbeam', fake({jobs: [greenhouse()], meta: {total: 1}})))[0].provider, 'greenhouse');
  const ash = await discover('ashby:resend', fake({jobs: [ashby(), ashby({id: 'aaaaaaaa-1111-4222-8333-944455556666', isListed: false})], apiVersion: '1'}));
  assert.equal(ash.length, 1);
  assert.match(seen[0], /^https:\/\/boards-api\.greenhouse\.io\/v1\/boards\/northbeam\/jobs\?content=true&pay_transparency=true$/);
  assert.match(seen[1], /^https:\/\/api\.ashbyhq\.com\/posting-api\/job-board\/resend\?includeCompensation=true$/);
  await assert.rejects(() => discover('ashby:resend', async () => ({ok: false, status: 404})), /Ashby resend: HTTP 404/);
  await assert.rejects(() => discover('greenhouse:x', fake({jobs: 'nope'})), /Invalid board response/);
});

test('shared listings keep their provider identity and get canonical URLs back', () => {
  for (const job of [normalizeGreenhouse('northbeam', greenhouse(), now), normalizeAshby('resend', ashby(), now)]) {
    const shared = {...publicJob(job), url: 'javascript:alert(1)', applyUrl: 'https://evil.test'};
    const clean = parsePublicJob(shared);
    assert.equal(clean.url, job.url);
    assert.equal(clean.applyUrl, job.applyUrl);
    assert.throws(() => parsePublicJob({...shared, provider: 'lever'}));
    assert.throws(() => parsePublicJob({...shared, postingId: '../../x'}));
    assert.throws(() => parsePublicJob({...shared, provider: 'constructor'}));
  }
});

test('Greenhouse and Ashby listings match normally but are never auto-applied', async () => {
  const policy = {minAnnual: 150000, currency: 'USD', titleTerms: ['engineer'], requiredTerms: ['typescript'], excludedTerms: [], remoteOnly: true, locations: ['United States', 'USA']};
  assert.equal(assess(normalizeGreenhouse('northbeam', greenhouse(), now), policy, now).eligible, true);
  assert.equal(assess(normalizeAshby('resend', ashby(), now), policy, now).eligible, true);
  const config = {automation: {enabled: true, employers: ['northbeam'], maxPerDay: 3, confirmTruthfulProfile: true},
    profile: {name: 'Test Person', email: 'test@example.com', resume: fileURLToPath(import.meta.url)}, policy};
  const ledger = {reserve() {throw new Error('must not reserve');}, status() {}};
  await assert.rejects(() => apply(normalizeGreenhouse('northbeam', greenhouse(), now), config, ledger, () => {throw new Error('must not launch');}), /Lever forms only/);
});

test('htmlText decodes entities once per layer and survives malformed ones', () => {
  assert.equal(htmlText('&lt;p&gt;A &amp;amp; B&lt;/p&gt;'), 'A & B');
  assert.equal(htmlText('<p>x &#99999999; y &#x41;</p>'), 'x y A');
  assert.equal(htmlText('<script>alert(1)</script><p>ok</p>'), 'ok');
});
