import {SimplePool, finalizeEvent, verifyEvent} from 'nostr-tools';
import {KIND, TOPIC, parsePublicJob, publicJob} from './core.js';
export function relayURLs(urls) {
  if (!Array.isArray(urls) || urls.length < 1 || urls.length > 8 || urls.some(x => {try {return new URL(x).protocol !== 'wss:';} catch {return true;}})) throw new Error('Choose 1–8 wss:// relays');
  return urls;
}
export function makeEvent(job, key) {
  const listing = parsePublicJob(publicJob(job));
  return finalizeEvent({kind: KIND, created_at: Math.floor(Date.now()/1000), tags: [['d', listing.id], ['t', TOPIC]], content: JSON.stringify(listing)}, key);
}
export function readEvent(raw) {
  // Reconstruct wire fields so an in-memory cached verification flag cannot survive mutation.
  const event = Object.fromEntries(['id','pubkey','created_at','kind','tags','content','sig'].map(k => [k, raw[k]]));
  if (event.kind !== KIND || !verifyEvent(event) || !event.tags.some(x => x[0] === 't' && x[1] === TOPIC) || event.content.length > 75000 || event.created_at > Date.now()/1000 + 300 || event.created_at < Date.now()/1000 - 86400) throw new Error('Invalid or stale event');
  const job = parsePublicJob(JSON.parse(event.content));
  if (!event.tags.some(x => x[0] === 'd' && x[1] === job.id)) throw new Error('Wrong event identity');
  return job;
}
export async function receive(urls) {
  relayURLs(urls);
  const pool = new SimplePool();
  try {
    const events = await pool.querySync(urls, {kinds: [KIND], '#t': [TOPIC], since: Math.floor(Date.now()/1000)-86400, limit: 200}, {maxWait: 10000});
    const jobs = new Map();
    for (const event of events) {try {const j = readEvent(event); if (!jobs.has(j.id) || jobs.get(j.id).fetchedAt < j.fetchedAt) jobs.set(j.id,j);} catch { /* untrusted gossip */ }}
    return [...jobs.values()];
  } finally {pool.close(urls);}
}
export async function publish(urls, jobs, key) {
  relayURLs(urls);
  const pool = new SimplePool();
  try { for (const job of jobs) {
    const results = await Promise.allSettled(pool.publish(urls, makeEvent(job, key), {maxWait: 10000}));
    if (!results.some(x => x.status === 'fulfilled')) throw new Error('No relay accepted the listing');
  }} finally {pool.close(urls);}
}
