import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, readFileSync, statSync} from 'node:fs';
import {chromium} from 'playwright';
import {assess, discover} from './core.js';

export class Ledger {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec('CREATE TABLE IF NOT EXISTS applications (id TEXT PRIMARY KEY, status TEXT NOT NULL, updated INTEGER NOT NULL, note TEXT NOT NULL)');
  }
  reserve(id, limit, now = Date.now()) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const day = new Date(now).setUTCHours(0,0,0,0);
      if (this.db.prepare('SELECT id FROM applications WHERE id=?').get(id)) throw new Error('Already attempted; inspect application history');
      if (this.db.prepare('SELECT count(*) AS n FROM applications WHERE updated>=?').get(day).n >= limit) throw new Error('Daily attempt limit reached');
      this.db.prepare('INSERT INTO applications VALUES (?, ?, ?, ?)').run(id, 'reserved', now, 'No submission yet');
      this.db.exec('COMMIT');
    } catch (error) {this.db.exec('ROLLBACK'); throw error;}
  }
  status(id, status, note) {this.db.prepare('UPDATE applications SET status=?, updated=?, note=? WHERE id=?').run(status, Date.now(), note, id);}
  all() {return this.db.prepare('SELECT * FROM applications ORDER BY updated DESC').all();}
  close() {this.db.close();}
}

export function validateAutomation(config) {
  if (config.automation?.enabled !== true || !Array.isArray(config.automation.employers) || !config.automation.employers.length) throw new Error('Enable automation and select trusted employer boards in your private config');
  if (!Number.isInteger(config.automation.maxPerDay) || config.automation.maxPerDay < 1 || config.automation.maxPerDay > 25) throw new Error('maxPerDay must be 1–25');
  const p = config.profile;
  if (!p?.name?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email || '') || !p.resume || !statSync(p.resume).isFile()) throw new Error('Set your real name, email and local resume file');
  if (!config.automation.confirmTruthfulProfile) throw new Error('Confirm the profile and saved answers are truthful');
}

// Supports the standard Lever form only. New widgets and unanswered questions stop the attempt.
export async function fillLever(page, profile) {
  if (await page.locator('iframe[src*="captcha"], [class*="captcha"], [data-sitekey]').count()) throw new Error('CAPTCHA requires manual application');
  const fields = page.locator('input, textarea, select');
  let resumeAttached = false;
  for (let i = 0; i < await fields.count(); i++) {
    const field = fields.nth(i);
    const meta = await field.evaluate(el => ({type: el.type, name: el.name, tag: el.tagName, required: el.required || el.getAttribute('aria-required') === 'true', label: (el.labels?.[0]?.textContent || el.closest('.application-question')?.querySelector('.application-label')?.textContent || el.getAttribute('aria-label') || '').trim()}));
    if (['hidden','submit','button'].includes(meta.type) || !(await field.isVisible()) && meta.type !== 'file') continue;
    if (meta.type === 'file') {
      if (meta.name !== 'resume') throw new Error('Additional document requested; use manual application');
      await field.setInputFiles(profile.resume); resumeAttached = true; continue;
    }
    if (['checkbox','radio'].includes(meta.type)) throw new Error('Consent or choice question requires manual application');
    const base = {name: profile.name, email: profile.email, phone: profile.phone, org: profile.currentCompany};
    const answer = Object.hasOwn(base, meta.name) ? base[meta.name] : profile.answers?.[meta.label];
    if (answer === undefined || answer === '') throw new Error(`Unanswered field: ${meta.label || meta.name || 'unknown'}`);
    if (meta.tag === 'SELECT') await field.selectOption({label: String(answer)});
    else await field.fill(String(answer));
  }
  if (!resumeAttached) throw new Error('Standard resume field not found');
  const invalid = await page.locator('input:invalid, textarea:invalid, select:invalid').count();
  if (invalid) throw new Error('Required form fields incomplete');
}

export async function apply(job, config, ledger, launch = () => chromium.launch({headless: false})) {
  validateAutomation(config);
  // Greenhouse and Ashby listings are for discovery and matching; their forms have no tested adapter yet.
  if (job.provider !== 'lever') throw new Error(`Automatic applications support Lever forms only; apply to ${job.provider} listings by hand`);
  if (!config.automation.employers.includes(job.board)) throw new Error('Employer is not enabled');
  const live = (await discover(`lever:${job.board}`)).find(x => x.id === job.id);
  if (!live || !assess(live, config.policy).eligible) throw new Error('Current employer listing does not qualify');
  ledger.reserve(live.id, config.automation.maxPerDay);
  let browser, submitting = false;
  try {
    browser = await launch();
    const page = await browser.newPage();
    // Only the canonical provider page can receive private answers.
    await page.goto(live.applyUrl, {waitUntil: 'domcontentloaded', timeout: 30000});
    if (new URL(page.url()).origin !== 'https://jobs.lever.co' || new URL(page.url()).pathname !== new URL(live.applyUrl).pathname) throw new Error('Unexpected application redirect');
    await fillLever(page, config.profile);
    const submit = page.getByRole('button', {name: /^submit application$/i});
    if (await submit.count() !== 1) throw new Error('Standard submit control not found');
    ledger.status(live.id, 'submitting', 'Submission may have been sent; never automatically retry');
    submitting = true;
    await submit.click();
    await page.getByText(/application (has been )?(successfully )?(submitted|received)|thank you for applying/i).first().waitFor({timeout: 20000});
    ledger.status(live.id, 'submitted', 'Employer page displayed a submission confirmation');
    return 'submitted';
  } catch (error) {
    ledger.status(live.id, submitting ? 'uncertain' : 'needs-review', submitting ? 'Check employer confirmation before any manual retry' : error.message);
    throw error;
  } finally {await browser?.close();}
}

export function loadConfig(path) {
  mkdirSync('private', {recursive:true, mode:0o700});
  return JSON.parse(readFileSync(path, 'utf8'));
}
