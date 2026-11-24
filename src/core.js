import {assessImpact, impactPolicy, impactReasons} from './impact.js';
export const SUPPORT = 'https://www.evolvetech.dev/play/fairground/#/about';
export const KIND = 30382; // Experimental application-specific addressable event.
export const TOPIC = 'evolve-jobs-v1';
let matcher = {contains: (text, term) => text.includes(term), salaryMeets: (min, floor) => Number.isFinite(min) && min > 0 && min >= floor};
export function setMatcher(engine) {matcher = engine;}
const slug = /^[a-zA-Z0-9_-]{1,100}$/;
// Public job-board APIs. Each provider's listing URLs are rebuilt from its own IDs, never taken from the response,
// so a listing passed around over Nostr cannot send a private application somewhere else.
const API = {
  lever: board => `https://api.lever.co/v0/postings/${board}?mode=json`,
  greenhouse: board => `https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true&pay_transparency=true`,
  ashby: board => `https://api.ashbyhq.com/posting-api/job-board/${board}?includeCompensation=true`,
};
const POSTING_ID = {lever: /^[a-zA-Z0-9-]{1,100}$/, greenhouse: /^[0-9]{1,20}$/, ashby: /^[0-9a-fA-F-]{36}$/};
const PAGES = {
  lever: (board, id) => [`https://jobs.lever.co/${board}/${id}`, `https://jobs.lever.co/${board}/${id}/apply`],
  greenhouse: (board, id) => [`https://job-boards.greenhouse.io/${board}/jobs/${id}`, `https://job-boards.greenhouse.io/${board}/jobs/${id}`],
  ashby: (board, id) => [`https://jobs.ashbyhq.com/${board}/${id}`, `https://jobs.ashbyhq.com/${board}/${id}/application`],
};
export const PROVIDERS = Object.keys(API);
// "greenhouse:northbeam", "ashby:resend", "lever:filevine", or a bare Lever board name as in older configurations.
export function parseBoard(spec) {
  const parts = String(spec).trim().split(':');
  const [provider, board] = parts.length === 1 ? ['lever', parts[0]] : [parts[0].toLowerCase(), parts.slice(1).join(':')];
  if (!Object.hasOwn(API, provider)) throw new Error(`Unsupported job board provider "${provider}" (use ${PROVIDERS.join(', ')})`);
  if (!slug.test(board)) throw new Error(`Invalid ${provider} board name`);
  return {provider, board};
}
export function boardURL(board, provider = 'lever') {
  const p = parseBoard(`${provider}:${board}`);
  return API[p.provider](p.board);
}
const ENTITIES = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '};
const codePoint = e => {
  const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ' ';
};
const decode = s => s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e) => e[0] === '#' ? codePoint(e) : ENTITIES[e.toLowerCase()] ?? m);
// Plain text from HTML (Greenhouse sends it entity-escaped). Block ends become line breaks so impact
// scoring can drop benefits lines. The result is only ever shown as text, never as markup.
export function htmlText(html) {
  return decode(decode(String(html || ''))
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/li|\/h[1-6]|\/div|\/ul|\/ol)\b[^>]*>/gi, '\n').replace(/<li\b[^>]*>/gi, '\n- ').replace(/<[^>]*>/g, ' '))
    .replace(/[ \t ]+/g, ' ').replace(/ *\n[\s]*/g, '\n').trim();
}
const listing = (provider, board, id, fields, now) => {
  const [url, applyUrl] = PAGES[provider](board, id);
  return {version: 1, id: `${provider}:${board}:${id}`, provider, board, postingId: id, company: board, ...fields,
    title: String(fields.title || '').slice(0, 300), location: String(fields.location || '').slice(0, 300),
    description: String(fields.description || '').slice(0, 50000), url, applyUrl, fetchedAt: now};
};
// One currency and a positive lower bound, or no pay at all: a floor must never pass on a guess.
function annualRange(ranges) {
  const ok = ranges.filter(r => Number.isFinite(r.min) && r.min > 0 && /^[A-Z]{3}$/.test(r.currency || ''));
  if (!ok.length || ok.length !== ranges.length || new Set(ok.map(r => r.currency)).size !== 1) return {salaryMin: null, salaryMax: null, currency: null};
  const maxes = ok.map(r => r.max).filter(x => Number.isFinite(x) && x > 0);
  return {salaryMin: Math.min(...ok.map(r => r.min)), salaryMax: maxes.length ? Math.max(...maxes) : null, currency: ok[0].currency};
}
export function normalize(board, post, now = Date.now()) {
  boardURL(board);
  if (!POSTING_ID.lever.test(post.id)) throw new Error('Invalid posting ID');
  const salary = post.salaryRange || {};
  const annual = ['per-year', 'per-year-salary'].includes(salary.interval);
  return {
    ...listing('lever', board, post.id, {
      title: post.text, location: post.categories?.location, remote: post.workplaceType === 'remote',
      description: [post.descriptionPlain, ...(post.lists || []).map(x => x.content?.replace(/<[^>]*>/g, ' ')), post.additionalPlain].filter(Boolean).join('\n'),
    }, now),
    salaryMin: annual && Number.isFinite(salary.min) && salary.min > 0 ? salary.min : null,
    salaryMax: annual && Number.isFinite(salary.max) && salary.max > 0 ? salary.max : null,
    currency: annual ? salary.currency : null,
  };
}
export function normalizeGreenhouse(board, post, now = Date.now()) {
  boardURL(board, 'greenhouse');
  const id = String(post.id);
  if (!POSTING_ID.greenhouse.test(id)) throw new Error('Invalid posting ID');
  // Greenhouse ranges carry no pay interval. Keep base-salary ranges only, and treat anything under 20,000 as
  // hourly or monthly (unknown): misreading can only make pay look lower, never clear a floor it shouldn't.
  const base = (post.pay_input_ranges || []).filter(r => !/on.?target|\bote\b|commission|bonus|equity|variable|hour|month/i.test(`${r.title || ''} ${r.blurb || ''}`));
  const ranges = base.map(r => ({min: r.min_cents / 100, max: r.max_cents / 100, currency: r.currency_type}));
  const pay = ranges.every(r => r.min >= 20000) ? annualRange(ranges) : annualRange([]);
  // The posted location is what the candidate sees. Office names are internal groupings (a "Remote - Canada" role
  // can sit under a "Remote, United States" office), so they are used only when no location is posted.
  const places = post.location?.name ? [post.location.name] : (post.offices || []).map(o => o?.name).filter(Boolean);
  return {...listing('greenhouse', board, id, {
    title: post.title, location: places.join('; '), remote: places.some(p => /\bremote\b/i.test(p)), description: htmlText(post.content),
  }, now), ...pay};
}
export function normalizeAshby(board, post, now = Date.now()) {
  boardURL(board, 'ashby');
  if (!POSTING_ID.ashby.test(post.id || '')) throw new Error('Invalid posting ID');
  if (post.isListed === false) return null;
  const salary = (post.compensation?.summaryComponents || []).filter(c => c.compensationType === 'Salary');
  const pay = salary.every(c => c.interval === '1 YEAR')
    ? annualRange(salary.map(c => ({min: c.minValue, max: c.maxValue, currency: c.currencyCode}))) : annualRange([]);
  const places = [post.location, ...(post.secondaryLocations || []).map(l => typeof l === 'string' ? l : l?.location), post.address?.postalAddress?.addressCountry].filter(Boolean);
  return {...listing('ashby', board, post.id, {
    title: post.title, location: [...new Set(places)].join('; '), remote: post.isRemote === true || post.workplaceType === 'Remote',
    description: post.descriptionPlain || htmlText(post.descriptionHtml),
  }, now), ...pay};
}
const NORMALIZE = {lever: normalize, greenhouse: normalizeGreenhouse, ashby: normalizeAshby};
export async function discover(spec, request = fetch) {
  const {provider, board} = parseBoard(spec);
  const res = await request(API[provider](board), {signal: AbortSignal.timeout(20000), redirect: 'error'});
  if (!res.ok) throw new Error(`${provider[0].toUpperCase() + provider.slice(1)} ${board}: HTTP ${res.status}`);
  const data = await res.json();
  const rows = provider === 'lever' ? data : data?.jobs;
  if (!Array.isArray(rows) || rows.length > 20000) throw new Error('Invalid board response');
  return rows.map(row => NORMALIZE[provider](board, row)).filter(Boolean);
}
export function validatePolicy(p) {
  if (!Number.isFinite(p.minAnnual) || p.minAnnual <= 0 || !/^[A-Z]{3}$/.test(p.currency || '')) throw new Error('Set a positive annual pay floor and ISO currency');
  for (const key of ['titleTerms', 'requiredTerms', 'excludedTerms', 'locations']) {
    if (!Array.isArray(p[key]) || p[key].some(x => typeof x !== 'string' || !x.trim())) throw new Error(`Invalid ${key}`);
  }
  if (!p.titleTerms.length || !p.requiredTerms.length || (!p.remoteOnly && !p.locations.length)) throw new Error('Set role, qualification and location rules');
  if (p.impact !== undefined) impactPolicy(p.impact);
  return p;
}
// companies: optional curated company facts for impact scoring (see impact.js), keyed by companyKey().
export function assess(job, policy, now = Date.now(), companies = {}) {
  validatePolicy(policy);
  const reasons = [];
  const text = `${job.title}\n${job.description}`.toLowerCase();
  if (!Number.isFinite(job.fetchedAt) || now - job.fetchedAt > 86400000 || job.fetchedAt > now + 300000) reasons.push('Listing must be refreshed');
  if (!matcher.salaryMeets(job.salaryMin ?? NaN, policy.minAnnual) || job.currency !== policy.currency) reasons.push('Annual salary floor or currency not confirmed');
  if (!policy.titleTerms.some(x => matcher.contains(job.title.toLowerCase(), x.toLowerCase()))) reasons.push('Role does not match');
  if (!policy.requiredTerms.every(x => matcher.contains(text, x.toLowerCase()))) reasons.push('Qualification keywords missing');
  if (policy.excludedTerms.some(x => matcher.contains(text, x.toLowerCase()))) reasons.push('Excluded terms present');
  if (policy.remoteOnly && !job.remote) reasons.push('Remote work not confirmed');
  if (policy.locations.length && !policy.locations.some(x => matcher.contains(job.location.toLowerCase(), x.toLowerCase()))) reasons.push('Location does not match');
  if (policy.impact === undefined) return {eligible: reasons.length === 0, reasons};
  const impact = assessImpact(job, policy.impact, companies);
  reasons.push(...impactReasons(impact, policy.impact));
  return {eligible: reasons.length === 0, reasons, impact};
}
export function publicJob(job) {
  // Explicit allowlist: profiles, resumes, answers and application history never enter a public event.
  return Object.fromEntries(['version','id','provider','board','postingId','title','company','location','remote','description','salaryMin','salaryMax','currency','url','applyUrl','fetchedAt'].map(k => [k, job[k]]));
}
export function parsePublicJob(raw) {
  if (!raw || raw.version !== 1 || !Object.hasOwn(API, raw.provider ?? '')) throw new Error('Unsupported listing');
  boardURL(raw.board, raw.provider);
  if (typeof raw.postingId !== 'string' || !POSTING_ID[raw.provider].test(raw.postingId) || raw.id !== `${raw.provider}:${raw.board}:${raw.postingId}`) throw new Error('Invalid listing identity');
  for (const key of ['title','description','location','company']) if (typeof raw[key] !== 'string' || raw[key].length > 50000) throw new Error('Invalid listing text');
  if (typeof raw.remote !== 'boolean' || !Number.isFinite(raw.fetchedAt)) throw new Error('Invalid listing metadata');
  for (const key of ['salaryMin','salaryMax']) if (raw[key] !== null && (!Number.isFinite(raw[key]) || raw[key] <= 0)) throw new Error('Invalid pay');
  if (raw.currency !== null && !/^[A-Z]{3}$/.test(raw.currency)) throw new Error('Invalid currency');
  const clean = publicJob(raw);
  [clean.url, clean.applyUrl] = PAGES[raw.provider](raw.board, raw.postingId);
  return clean;
}
