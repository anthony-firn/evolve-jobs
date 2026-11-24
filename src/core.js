import {assessImpact, impactPolicy, impactReasons} from './impact.js';
export const SUPPORT = 'https://www.evolvetech.dev/play/fairground/#/about';
export const KIND = 30382; // Experimental application-specific addressable event.
export const TOPIC = 'evolve-jobs-v1';
let matcher = {contains: (text, term) => text.includes(term), salaryMeets: (min, floor) => Number.isFinite(min) && min > 0 && min >= floor};
export function setMatcher(engine) {matcher = engine;}
const slug = /^[a-zA-Z0-9_-]{1,100}$/;
export function boardURL(board) {
  if (!slug.test(board)) throw new Error('Invalid Lever board name');
  return `https://api.lever.co/v0/postings/${board}?mode=json`;
}
export function normalize(board, post, now = Date.now()) {
  boardURL(board);
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(post.id)) throw new Error('Invalid posting ID');
  const salary = post.salaryRange || {};
  const annual = ['per-year', 'per-year-salary'].includes(salary.interval);
  return {
    version: 1, id: `lever:${board}:${post.id}`, provider: 'lever', board, postingId: post.id,
    title: String(post.text || '').slice(0, 300), company: board,
    location: String(post.categories?.location || '').slice(0, 300),
    remote: post.workplaceType === 'remote',
    description: [post.descriptionPlain, ...(post.lists || []).map(x => x.content?.replace(/<[^>]*>/g, ' ')), post.additionalPlain].filter(Boolean).join('\n').slice(0, 50000),
    salaryMin: annual && Number.isFinite(salary.min) && salary.min > 0 ? salary.min : null,
    salaryMax: annual && Number.isFinite(salary.max) && salary.max > 0 ? salary.max : null,
    currency: annual ? salary.currency : null,
    url: `https://jobs.lever.co/${board}/${post.id}`,
    applyUrl: `https://jobs.lever.co/${board}/${post.id}/apply`, fetchedAt: now,
  };
}
export async function discover(board, request = fetch) {
  const res = await request(boardURL(board), {signal: AbortSignal.timeout(20000), redirect: 'error'});
  if (!res.ok) throw new Error(`Lever ${board}: HTTP ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length > 20000) throw new Error('Invalid board response');
  return rows.map(row => normalize(board, row));
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
  if (!raw || raw.version !== 1 || raw.provider !== 'lever') throw new Error('Unsupported listing');
  boardURL(raw.board);
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(raw.postingId) || raw.id !== `lever:${raw.board}:${raw.postingId}`) throw new Error('Invalid listing identity');
  for (const key of ['title','description','location','company']) if (typeof raw[key] !== 'string' || raw[key].length > 50000) throw new Error('Invalid listing text');
  if (typeof raw.remote !== 'boolean' || !Number.isFinite(raw.fetchedAt)) throw new Error('Invalid listing metadata');
  for (const key of ['salaryMin','salaryMax']) if (raw[key] !== null && (!Number.isFinite(raw[key]) || raw[key] <= 0)) throw new Error('Invalid pay');
  if (raw.currency !== null && !/^[A-Z]{3}$/.test(raw.currency)) throw new Error('Invalid currency');
  const clean = publicJob(raw);
  clean.url = `https://jobs.lever.co/${raw.board}/${raw.postingId}`;
  clean.applyUrl = `${clean.url}/apply`;
  return clean;
}
