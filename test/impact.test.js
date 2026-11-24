import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessImpact, karmaPay, rank, impactPolicy} from '../src/impact.js';
import {assess} from '../src/core.js';

const now = Date.now();
const job = (board, description, pay = [150000, 190000]) => ({
  id: `lever:${board}:x`, board, company: board, title: 'Software Engineer', description, location: 'United States', remote: true,
  salaryMin: pay[0], salaryMax: pay[1], currency: 'USD', fetchedAt: now,
});
const policy = {minAnnual: 110000, currency: 'USD', titleTerms: ['engineer'], requiredTerms: ['typescript'], excludedTerms: [], remoteOnly: true, locations: [], impact: {}};

test('harmful employers are vetoed from posting text alone', () => {
  for (const text of ['We build the next generation of cigarettes and nicotine pouches.', 'Software for oil and gas drilling rigs.', 'Autonomy for loitering munitions and strike drones.', 'Our sportsbook serves millions of bettors.']) {
    const result = assessImpact(job('acme', text));
    assert.equal(result.vetoed, true, text);
    assert.equal(result.vetoes[0].review, true);
  }
});

test('benefits boilerplate and a single stray phrase do not count as impact', () => {
  const r = assessImpact(job('acme', 'TypeScript services for retailers.\nBenefits: medical, dental and vision insurance for patients and families.\nWe care about clinical precision in our code.'));
  assert.equal(r.score, 0);
  assert.equal(r.vetoed, false);
});

test('two posting phrases give half weight; company facts are definitive', () => {
  const posting = job('cleanco', 'Grid software for renewable energy and battery storage operators.');
  assert.equal(assessImpact(posting).score, 0.25);
  const facts = {cleanco: {impact: 0.7, note: 'grid-scale storage dispatch', sources: ['https://example.test']}};
  assert.equal(assessImpact(posting, {}, facts).score, 0.7);
});

test('company facts can veto a clean-looking posting or clear a false alarm', () => {
  const clean = job('defenseco', 'TypeScript developer platform for internal teams.');
  assert.equal(assessImpact(clean, {}, {defenseco: {categories: ['weapons'], note: 'builds armed drones'}}).vetoed, true);
  const falseAlarm = job('gameco', 'We make a pirate game with a casino level.');
  assert.equal(assessImpact(falseAlarm).vetoed, true);
  assert.equal(assessImpact(falseAlarm, {}, {gameco: {impact: 0, clears: ['gambling'], note: 'video game, no real-money betting'}}).vetoed, false);
});

test('karma-adjusted pay trades salary for impact at the configured rate', () => {
  const facts = {health: {impact: 0.8}, ads: {impact: -0.1}};
  const helpful = job('health', 'TypeScript', [160000, 160000]);
  const adtech = job('ads', 'TypeScript', [180000, 180000]);
  assert.equal(karmaPay(helpful, assessImpact(helpful, {}, facts)), 192000);
  assert.equal(karmaPay(adtech, assessImpact(adtech, {}, facts)), 175500);
  assert.deepEqual(rank([adtech, helpful], {}, facts).map(r => r.job.board), ['health', 'ads']);
  assert.deepEqual(rank([adtech, helpful], {exchangeRate: 0}, facts).map(r => r.job.board), ['ads', 'health']);
});

test('assess() blocks vetoed, low-impact and poor-workplace jobs only when impact is configured', () => {
  const tobacco = job('smokeco', 'TypeScript for our cigarettes e-commerce.');
  assert.equal(assess(tobacco, {...policy, impact: undefined}, now).eligible, true);
  const result = assess(tobacco, policy, now);
  assert.equal(result.eligible, false);
  assert.match(result.reasons.join(' '), /Impact veto: tobacco/);
  const facts = {lowco: {impact: -0.5}, rough: {impact: 0.1, workplace: {rating: 2.3, source: 'https://example.test'}}};
  assert.equal(assess(job('lowco', 'TypeScript'), policy, now, facts).eligible, false);
  assert.equal(assess(job('rough', 'TypeScript'), policy, now, facts).eligible, true);
  assert.equal(assess(job('rough', 'TypeScript'), {...policy, impact: {minWorkplace: 3}}, now, facts).eligible, false);
});

test('impact policy rejects nonsense settings', () => {
  assert.throws(() => impactPolicy({exchangeRate: 2}));
  assert.throws(() => impactPolicy({minScore: -3}));
  assert.throws(() => impactPolicy({categories: {x: {weight: 5, terms: ['a']}}}));
  assert.throws(() => assessImpact(job('a', ''), {}, {a: {categories: ['not-a-category']}}));
});
