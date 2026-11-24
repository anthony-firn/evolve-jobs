// Impact ("karma") scoring: where a job's work lands in the world, kept apart from pay and from how a
// company treats its staff. Scores run from -1 (the work does real harm) to +1 (it clearly helps).
//
// Evidence comes from two places:
//  - company facts a person wrote down with sources (companies.json). These are definitive.
//  - phrases in the posting. These are hints: half weight, benefits boilerplate ignored, and a positive or mild
//    category needs two different phrases. A veto category needs only one, because missing a weapons or tobacco
//    employer costs more than reviewing a false alarm; company facts can clear it.
//
// Ranking uses karma-adjusted pay: pay × (1 + exchangeRate × score). With the default rate of 0.25, a clearly
// helpful job (+1) is worth 25% more to you than its salary and a harmful one (-1) 25% less. Vetoed work is out
// at any salary. Every number here is a value judgment to edit, not a fact.

export const DEFAULT_CATEGORIES = {
  weapons: {weight: -1, veto: true, label: 'weapons that kill', terms: ['lethal', 'munitions', 'loitering munition', 'warheads', 'missiles', 'kill chain', 'weapons systems', 'weapon systems', 'strike drones', 'armed drones', 'firearms', 'ammunition']},
  tobacco: {weight: -1, veto: true, label: 'tobacco and nicotine', terms: ['tobacco', 'cigarettes', 'cigars', 'nicotine', 'vapes', 'vaping', 'e-cigarettes']},
  fossil: {weight: -0.8, veto: true, label: 'oil, gas and coal', terms: ['oil and gas', 'oil & gas', 'petroleum', 'oilfield', 'fracking', 'refinery', 'refineries', 'drilling rigs', 'coal mining', 'fossil fuels', 'midstream', 'lng terminal']},
  gambling: {weight: -0.7, veto: true, label: 'gambling', terms: ['sportsbook', 'sports betting', 'casino', 'casinos', 'igaming', 'online gambling', 'wagering']},
  predatory: {weight: -0.7, veto: true, label: 'predatory lending', terms: ['payday loans', 'payday lending', 'title loans', 'rent-to-own', 'debt collection']},
  military: {weight: -0.4, label: 'military work', terms: ['warfighter', 'warfighters', 'defense contractor', 'department of defense', 'department of war', 'battlefield', 'combat']},
  surveillance: {weight: -0.6, label: 'surveillance', terms: ['facial recognition', 'data broker', 'data brokers', 'spyware', 'mass surveillance', 'predictive policing', 'location data']},
  prisons: {weight: -0.6, label: 'incarceration', terms: ['private prisons', 'correctional facilities', 'detention centers', 'inmates']},
  adtech: {weight: -0.1, label: 'ad targeting', terms: ['ad targeting', 'retargeting', 'programmatic advertising', 'ad spend', 'marketing attribution', 'multi-touch attribution', 'adtech', 'ad tech']},
  climate: {weight: 0.5, label: 'climate and clean energy', terms: ['renewable energy', 'clean energy', 'solar', 'wind power', 'battery storage', 'decarbonization', 'carbon removal', 'emissions', 'electric vehicles', 'heat pumps', 'climate change', 'climate tech']},
  health: {weight: 0.4, label: 'health care', terms: ['patients', 'patient care', 'clinicians', 'clinical', 'healthcare', 'health care', 'hospitals', 'care teams', 'mental health', 'telehealth']},
  education: {weight: 0.3, label: 'education', terms: ['students', 'teachers', 'classrooms', 'k-12', 'learners', 'literacy']},
  access: {weight: 0.3, label: 'access and public interest', terms: ['accessibility', 'assistive technology', 'screen readers', 'nonprofit', 'non-profit', 'public interest', 'access to justice', 'legal aid', 'underserved']},
  science: {weight: 0.3, label: 'science', terms: ['scientific research', 'scientists', 'genomics', 'drug discovery', 'biology']},
  devtools: {weight: 0.15, label: 'tools for developers', terms: ['open source', 'open-source', 'developer tools', 'developer experience', 'sdks', 'developer platform']},
};
export const DEFAULT_IMPACT = {exchangeRate: 0.25, minScore: -0.2, minWorkplace: null, categories: DEFAULT_CATEGORIES};

const BOILERPLATE = /\b(dental|vision|401\(?k\)?|pto|paid time off|parental leave|insurance|benefits|wellness|stipend|equal opportunity|eeo|disability|veteran)\b/i;
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const clamp = x => Math.max(-1, Math.min(1, x));
const round = x => Math.round(x * 100) / 100;

export function impactPolicy(p = {}) {
  const merged = {...DEFAULT_IMPACT, ...p, categories: {...DEFAULT_CATEGORIES, ...(p.categories || {})}};
  if (!Number.isFinite(merged.exchangeRate) || merged.exchangeRate < 0 || merged.exchangeRate > 1) throw new Error('impact.exchangeRate must be between 0 and 1');
  if (!Number.isFinite(merged.minScore) || merged.minScore < -1 || merged.minScore > 1) throw new Error('impact.minScore must be between -1 and 1');
  if (merged.minWorkplace !== null && !(merged.minWorkplace >= 1 && merged.minWorkplace <= 5)) throw new Error('impact.minWorkplace must be null or 1–5');
  for (const [name, c] of Object.entries(merged.categories)) {
    if (!Number.isFinite(c.weight) || c.weight < -1 || c.weight > 1 || !Array.isArray(c.terms) || c.terms.some(t => typeof t !== 'string' || !t.trim())) throw new Error(`Invalid impact category ${name}`);
  }
  return merged;
}

export function companyKey(job) {
  return String(job.board || job.company || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// Phrases found per category, ignoring lines about benefits and legal boilerplate.
export function postingEvidence(job, categories) {
  const text = `${job.title}\n${job.description}`.split('\n').filter(line => !BOILERPLATE.test(line)).join('\n').toLowerCase();
  const found = {};
  for (const [name, c] of Object.entries(categories)) {
    const hits = [];
    for (const term of c.terms) {
      const m = new RegExp(`\\b${escape(term.toLowerCase())}\\b`).exec(text);
      if (m) hits.push({term, context: text.slice(Math.max(0, m.index - 50), m.index + term.length + 50).replace(/\s+/g, ' ').trim()});
    }
    if (hits.length) found[name] = hits;
  }
  return found;
}

export function assessImpact(job, policy = {}, companies = {}) {
  const p = impactPolicy(policy);
  const facts = companies[companyKey(job)] || null;
  const reasons = [];
  const vetoes = [];
  let score = 0;
  const curated = new Set(facts?.categories || []);
  const cleared = new Set(facts?.clears || []);
  if (facts) {
    if (Number.isFinite(facts.impact)) {
      score = facts.impact;
      reasons.push(`company facts: ${round(facts.impact)} (${facts.note || 'no note'})`);
    } else {
      for (const name of curated) {
        const c = p.categories[name];
        if (!c) throw new Error(`Unknown impact category ${name} for ${companyKey(job)}`);
        score += c.weight;
        reasons.push(`company facts: ${c.label} ${c.weight > 0 ? '+' : ''}${c.weight}`);
      }
    }
    for (const name of curated) if (p.categories[name]?.veto) vetoes.push({category: name, label: p.categories[name].label, source: 'company facts', review: false});
  } else {
    reasons.push('no company facts yet; posting phrases only');
  }
  const evidence = postingEvidence(job, p.categories);
  for (const [name, hits] of Object.entries(evidence)) {
    const c = p.categories[name];
    if (cleared.has(name) || curated.has(name)) continue;
    if (c.veto) {
      vetoes.push({category: name, label: c.label, source: 'posting', review: true, evidence: hits.map(h => h.context)});
      continue;
    }
    if (hits.length < 2 || Number.isFinite(facts?.impact)) continue;
    score += c.weight / 2;
    reasons.push(`posting: ${c.label} ${c.weight > 0 ? '+' : ''}${c.weight / 2} (${hits.map(h => h.term).join(', ')})`);
  }
  score = round(clamp(score));
  const workplace = facts?.workplace || null;
  return {score, vetoed: vetoes.length > 0, vetoes, reasons, workplace, known: Boolean(facts)};
}

export function annualPay(job) {
  if (Number.isFinite(job.salaryMin) && Number.isFinite(job.salaryMax)) return (job.salaryMin + job.salaryMax) / 2;
  return Number.isFinite(job.salaryMin) ? job.salaryMin : null;
}

export function karmaPay(job, impact, policy = {}) {
  const pay = annualPay(job);
  if (pay === null || impact.vetoed) return null;
  return Math.round(pay * (1 + impactPolicy(policy).exchangeRate * impact.score));
}

// Reasons an otherwise matching job should not be applied to, for assess() in core.js.
export function impactReasons(impact, policy = {}) {
  const p = impactPolicy(policy);
  const out = [];
  for (const v of impact.vetoes) out.push(`Impact veto: ${v.label}${v.review ? ' (from posting text; add company facts to clear a false alarm)' : ''}`);
  if (impact.score < p.minScore) out.push(`Impact ${impact.score} is below your floor of ${p.minScore}`);
  const rating = impact.workplace?.rating;
  if (p.minWorkplace !== null && Number.isFinite(rating) && rating < p.minWorkplace) out.push(`Workplace rating ${rating} is below your floor of ${p.minWorkplace}`);
  return out;
}

export function rank(jobs, policy = {}, companies = {}) {
  return jobs.map(job => {
    const impact = assessImpact(job, policy, companies);
    return {job, impact, pay: annualPay(job), karmaPay: karmaPay(job, impact, policy), blockers: impactReasons(impact, policy)};
  }).sort((a, b) => (a.blockers.length - b.blockers.length) || ((b.karmaPay ?? -1) - (a.karmaPay ?? -1)));
}
