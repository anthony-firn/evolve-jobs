# Evolve Jobs

A free, self-hostable job-search and application tool from EvolveTech. Set a pay floor and qualification rules, discover employer listings, and let a client on your own device apply to supported positions. The browser workspace is featured at [evolvetech.dev](https://www.evolvetech.dev/play/evolve-jobs/).

**Status: early prototype.** Live discovery supports public Greenhouse, Ashby and Lever employer boards. The browser uses a compiled Rust/WASM engine for text and pay matching. Automatic applications in the companion Chromium extension support the standard Lever hosted form with saved answers; unfamiliar fields, consent controls and CAPTCHA require manual review. Automated form behavior is tested against local fixtures, not real applications. No real application has been submitted during development. This is a foundation for a broader job agent, with explicit limits rather than a universal auto-apply claim.

## Client-first setup

Use the browser workspace at [evolvetech.dev](https://www.evolvetech.dev/play/evolve-jobs/) or host the static files anywhere, including localhost. No hosted backend, résumé API, EvolveTech login or Node worker is required. The Rust/WASM engine runs text and pay matching on your device; JavaScript handles UI, networking and browser APIs. The workspace caches its own assets for offline use after the first successful load. Live discovery and applications still require network access.

1. Search employer boards (`greenhouse:company`, `ashby:company` or `lever:company`), or import listing files / connect to your chosen Nostr relays.
2. Set your pay, qualification, role and location rules. Review full requirements; keywords do not establish eligibility.
3. Download the companion extension ZIP from the workspace. Unzip it, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the extracted `extension` directory. This prototype is not in a browser extension store.
4. Export an **application plan** from the workspace and import it into the extension panel (opened from the extension toolbar icon).
5. Save your truthful profile, PDF résumé, exact question-label answers, enabled employer boards and daily attempt cap. These stay in `chrome.storage.local`, never browser sync or a hosted service.
6. Click **Start application queue** to authorize applying under those rules. Keep the browser running. Jobs are fetched from the employer again before opening their forms. The extension uses the same WASM matching engine.

A site cannot control forms on another employer's domain; the companion extension supplies that browser permission. Its only host permissions are the Lever public API and Lever hosted forms. It has no external messaging bridge. It opens fresh tabs for enabled matching employers and conservatively stops on unknown fields, choices, consent or CAPTCHA. The profile goes directly from the extension into the employer form. Donation support stays in Fairground's shared flow.

The extension records reservations before opening a form. It never retries an attempted job automatically. Interruptions and missing confirmation become `uncertain`; inspect the employer before any manual retry. The cap counts all attempts per UTC day. **Stop queue** prevents new applications and prevents submit authorization if filling is still in progress; an already submitted form cannot be recalled. Deleting the saved profile retains history for duplicate protection. Clearing all extension data or using a different browser loses that protection. Browser application history is not synchronized with the optional Node worker; use one application client for a given search.

To build and host everything yourself, install Node.js 22.13+, Rust, Python 3 and the WASM target:

```sh
git clone https://github.com/anthony-firn/evolve-jobs.git
cd evolve-jobs
rustup target add wasm32-unknown-unknown
npm ci
npm run build
python3 -m http.server 8080 --directory dist/site
```

Open http://localhost:8080. You can load `dist/extension` directly as an unpacked Chromium extension. The site and extension are static artifacts: serve `dist/site` from any HTTPS static host. The browser app requires `connect-src 'self' https://api.lever.co wss:` and `script-src 'self' 'wasm-unsafe-eval'`; no inline scripts, external fonts or cloud inference are used. The extension has its own WASM-enabled CSP.

## Optional Node worker


Requires Node.js 22.13+ and a desktop for the visible browser worker.

```sh
git clone https://github.com/anthony-firn/evolve-jobs.git
cd evolve-jobs
npm ci
npx playwright install chromium
mkdir -m 700 private
cp config.example.json private/config.json
chmod 600 private/config.json
```

Edit `private/config.json`. Set your annual pay minimum, currency, title terms, qualification keywords and location rules. All required terms must occur in the listing; excluded terms disqualify it. The lower end of the published salary range must meet your floor. Hourly, missing and nonmatching currency compensation is excluded; there is no assumed exchange rate or working-hour conversion. Pay is advertised gross annual base pay, not guaranteed take-home income.

Name each board as `provider:board`, taking the board from the employer's careers link: `job-boards.greenhouse.io/<board>`,
`jobs.ashbyhq.com/<board>` or `jobs.lever.co/<board>`. A bare name means Lever. Discovery uses each provider's public
job-board API and needs no employer API key.

- **Pay** counts only when it's unambiguous: Lever and Ashby must say the interval is annual. Greenhouse ranges carry no
  interval, so only base-salary ranges of 20,000 or more count; on-target earnings, bonus and equity are ignored.
  Mixed currencies count as unknown.
- **Remote** comes from Lever's and Ashby's workplace fields and from the posted Greenhouse location ("Remote - USA").
- **Automatic applications** remain Lever-only. Greenhouse and Ashby listings are for search and matching; apply to them by hand.

```sh
# Replace with real boards. Fetches public listings only.
node src/cli.js discover greenhouse:employer ashby:employer lever:employer > private/jobs.json
node src/cli.js match private/config.json private/jobs.json
```

Import `private/jobs.json` into the browser workspace, or read match results in the terminal. Browser rules and worker rules are separate: editing one does not silently authorize the other. Qualification keywords do not establish eligibility. Check experience, licenses, residence restrictions, work authorization, and the full job description before enabling an employer.

For automation, set your real name, email, phone, current company, absolute local résumé path and exact question-label answers in `profile`. Enable `automation.enabled`, select trusted board slugs in `automation.employers`, set `maxPerDay` (1–25) and confirm your profile and answers are truthful with `confirmTruthfulProfile: true`.

```sh
node src/cli.js apply private/config.json private/jobs.json
node src/cli.js history
```

This command is the explicit instruction to submit matching applications to enabled employers. Each job is refetched from Lever immediately before filling. Application attempts are reserved transactionally in local SQLite before the browser runs. A duplicate, crash or ambiguous response is never automatically retried. `needs-review` means the worker stopped before submission; `uncertain` means submission may have occurred. Inspect the employer's confirmation and apply manually if appropriate. There is no automatic retry/reset command. The daily cap counts all attempts across UTC calendar days. Keep the database with your private files; deleting it loses duplicate protection. Do not run multiple workers with separate databases for the same profile.

The worker opens a fresh visible Chromium session; it does not read your personal browser's passwords or cookies. It stops on any unanswered visible field (even optional fields), extra document requests, radio/checkbox consent, CAPTCHA, an unexpected URL, or an unrecognized submit control. It cannot handle all Lever variants. Use manual applications for unsupported forms. Credentials for employer-side Lever APIs are not requested or bypassed.

To run periodically on a desktop, schedule the discovery and apply commands with your operating system's scheduler. Refresh discovery before each run; source failures should stop the scheduled apply command. This release does not install a background daemon.

## Distributed operation

There is no EvolveTech job database, application backend, required account, mandatory relay or central matching service. Every user can fetch employer boards and run matching and applications locally. The static site is one optional client. Hosts and relays remain infrastructure dependencies; employer hiring systems are the source of truth.

Use **Share matched public listings** in the browser to publish up to 25 matches per click, refreshed directly from the employer. The browser generates an ephemeral signing key for that session; only public listing fields are sent, never search rules or a profile. Public listings can be shared as signed Nostr events through relays you choose or operate. This follows Fairground's use of Nostr, using an independent experimental job schema. There is no claim of compatibility with an established job-listing NIP. General public relays may reject the event kind or have no Evolve Jobs listings. Signatures authenticate publishers, not the employer or job accuracy. Application clients always return to the employer before applying.

```sh
node src/cli.js relay-publish private/jobs.json wss://your-relay.example
node src/cli.js relay-pull wss://your-relay.example > private/peer-jobs.json
```

Publishing creates a local signing key at `private/relay-key.json` and freshly fetches the requested public listings from the employer. It never publishes a profile, résumé, answers or application history. Private application state is not synchronized across devices. Users may also exchange JSON listing files without relays. See [protocol and privacy](docs/protocol.md).

## Browser workspace

```sh
npm run build
python3 -m http.server 8080 --directory dist/site
```

Open http://localhost:8080. Rules are stored in this browser's localStorage; listings are held in memory until exported. No network request occurs until you explicitly search employer boards, connect to relays or follow a link. The sample listing is visibly fictional. The workspace supports direct employer discovery, JSON imports, matching, source links, exports and relay discovery. Applications use the companion extension or optional local worker; the public website never receives your résumé.

## Impact ("karma") scoring

Pay isn't the only thing a job pays you in. Add an `impact` section to `policy` and Evolve Jobs scores each listing
from -1 (the work does real harm) to +1 (it clearly helps), separately from pay and from how the company treats staff.

- **Vetoes.** Weapons that kill, tobacco and nicotine, oil, gas and coal, gambling and predatory lending are out at any
  salary. `apply` never submits a vetoed listing.
- **Company facts** in `private/companies.json` are the real evidence: your own judgment with sources, kept private.
  Postings only hint. Benefits boilerplate is ignored, and a positive category needs two different phrases. A veto
  needs one phrase, so expect the odd false alarm; a company entry with `"clears": ["gambling"]` settles it.
- **Karma-adjusted pay** = pay × (1 + `exchangeRate` × score). At the default 0.25, a +0.8 health-care role at $160K
  ranks above a -0.1 ad-tech role at $180K. Set `exchangeRate` to 0 to rank by pay alone.
- `minScore` (default -0.2) blocks low-impact work; `minWorkplace` (1–5, off by default) blocks companies whose
  recorded review rating is lower.

```json
{
  "examplehealth": {"impact": 0.6, "note": "scheduling software for community clinics", "sources": ["https://example.org/about"],
                    "workplace": {"rating": 3.9, "note": "review site, 40 ratings", "asOf": "2026-11-24"}},
  "defenseco": {"categories": ["weapons"], "note": "builds armed drones"}
}
```

```sh
npm run jobs -- rank private/config.json private/jobs.json   # eligible first, by karma-adjusted pay, with reasons
```

Categories, weights and phrases live in `src/impact.js` and can be overridden under `policy.impact.categories`.
Every number is a value judgment. Change them to match yours.

## Donations

Free to use, with no application fee, subscription, salary commission or paid ranking. [Support development through Fairground](https://www.evolvetech.dev/play/fairground/#/about), the same shared development-fund flow used by other EvolveTech projects. Wallet setup and donation availability are managed there; this project does not create a new processor or take custody of funds. Donations support development and do not buy preferential access to jobs or applications. Relay-operator donation splitting is not implemented.

## Development

```sh
rustup target add wasm32-unknown-unknown
npm ci
npx playwright install chromium
npm test
npm run build
```

Tests cover conservative pay matching, location/qualification exclusions, stale data, canonical URLs, signed events, privacy allowlists, duplicate/daily-limit reservations and standard form filling/refusal behavior. CI needs `npx playwright install --with-deps chromium` before tests. The extension test routes all employer requests to fixtures. No test sends a real application or donation.

Next steps include additional job providers, guided local configuration, a desktop scheduler, richer evidence-based qualification checks, and more form adapters with fixture coverage. Contributions should keep personal data local and document which application forms they actually support.

Apache 2.0. See [LICENSE](LICENSE).
