# RandBasket complete project handoff

## Purpose

This is the master handoff for the entire RandBasket project as of 17 July 2026. It covers the public website, price-comparison web app, Cloudflare Worker and D1 database, catalogue ingestion, Expo mobile app, Google Play build, Apple status, security, monetisation decisions, Git state, known limitations and exact next actions.

Use the focused documents for deeper detail:

- `HANDOFF-GOOGLE-PLAY-AAB.md` — Expo/EAS and Google Play release.
- `HANDOFF-SPAR-INDEXING.md` — full SPAR product index and its D1 deployment.
- `mobile/store/RELEASE_CHECKLIST.md` — mobile QA and store blockers.
- `mobile/store/PRIVACY_AND_DATA_SAFETY.md` — Apple privacy and Google Data Safety working answers.
- `cloudflare/README.md` — Worker/D1 technical commands.

## Repository and Git

- GitHub: `https://github.com/MieliePap-maxx/randbasket.git`
- Production branch on GitHub: `main`
- Current local branch: `seo-release`, tracking `origin/main` directly.
- Current remote commit before the pending mobile handoff changes: `bd57de4 Create D1 schema before catalogue import`.
- Important recent commits:
  - `bd57de4` — apply the D1 schema before catalogue imports.
  - `dadc62e` — trigger the catalogue deployment.
  - `b53cf8b` — restore SPAR/Makro staple coverage and keep Ease of Access open.
  - `bd01300` — index the complete SPAR product catalogue.
  - `50159b3` — show full product information on selection.
  - `3dff637` — restore resource-safe catalogue search.
  - `fc4bc22` — upgrade product and basket comparisons.
  - `8b2ebb3` — restore hybrid matching and retailer columns.

Pending local changes at handoff creation:

- `.gitignore` excludes the disposable `work-expo-home/` cache.
- `mobile/app.json` contains the linked Expo project ID and owner.
- `HANDOFF-GOOGLE-PLAY-AAB.md` is new.
- `HANDOFF-RANDBASKET-COMPLETE.md` is new.

Commit and push these before moving to the home computer:

```powershell
cd "C:\Users\aamann\Documents\Codex\2026-07-16\push-randbasket-commit-e371211-to-main\work\randbasket"
git add .gitignore mobile/app.json HANDOFF-GOOGLE-PLAY-AAB.md HANDOFF-RANDBASKET-COMPLETE.md
git commit -m "Link mobile release and add complete project handoff"
git push origin HEAD:main
```

On the home computer, clone or pull `main` and tell Codex to read this file completely before changing anything.

## Product direction and business decisions

RandBasket is an independent South African grocery-price comparison service. It compares published products, pack sizes, unit prices, specials and basket totals across:

- Pick n Pay
- Checkers
- Woolworths
- SPAR
- Makro

Current launch decision: **the product remains completely free to build traction**.

Deferred monetisation ideas, intentionally not active:

1. One-time Compare Basket unlock showing full retailer totals and the amount saved.
2. Paid location-aware sponsored placement for retailers/companies. Any future sponsored ordering must be visibly labelled and must not corrupt the objective best-price calculation.
3. Product price alerts for followed/favourite products when the current price is materially below normal.

Do not introduce subscriptions, paywalls or sponsored ranking until the owner explicitly reactivates this plan.

## Production architecture

### Public website

- Main site: `https://www.randbasket.co.za`
- Price checker: `https://www.randbasket.co.za/app/`
- Cloudflare Pages serves the files in `site/`.
- Expected Pages setup: repository root, no build command, output directory `site`.
- Both `randbasket.co.za` and `www.randbasket.co.za` should point to the Pages project.

Important pages/assets:

- `site/index.html` — landing page.
- `site/app/` — public price-checker application.
- `site/how-to.html` — usage guidance.
- `site/faq.html`, `about.html`, `methodology.html`.
- `site/privacy.html`, `terms.html`, `support.html` — required store/legal destinations.
- `site/robots.txt`, `sitemap.xml`, `llms.txt` — indexing/AI discovery.
- PNG/ICO favicon files exist in multiple sizes.

### Production API

- API origin: `https://api.randbasket.co.za`
- Worker name: `randbasket-api`
- Worker source: `cloudflare/src/index.ts`
- Worker Git root/path in Cloudflare: `/cloudflare`
- Normal deploy command: `npx wrangler deploy`
- Custom domain route: `api.randbasket.co.za`
- Production CORS origin: `https://www.randbasket.co.za`

Bindings in `cloudflare/wrangler.toml`:

- D1 binding `DB` -> `randbasket-catalogue`
- D1 database ID `494cfdd0-f4e7-4217-92b1-53283c64e826`
- Workers AI binding `AI`
- Send Email binding `FEEDBACK_EMAIL`
- Feedback sender `feedback@randbasket.co.za`
- Feedback destination `randbasketzar@gmail.com`

Vectorize is deliberately **not bound** in the current `wrangler.toml`. Deployments must work without a Vectorize index.

### Local legacy system

The repository still contains the original Windows/PowerShell price checker:

- `server.ps1`
- `web/`
- retailer ingestion PowerShell scripts
- local launch `.bat`, `.vbs` and PowerShell helpers

This remains useful for ingestion and diagnostics but is not the public mobile production backend. The root `README.md` contains historical local-dashboard wording and should not be treated as the authoritative production architecture document.

## Website and price-checker feature state

Implemented public app behaviour includes:

- A separate column for each grocer; a retailer's products stay in its column.
- Search, pagination and closest compatible product matching.
- Product cards with image, retailer, pack size, price, unit price and retailer link.
- Clickable product-information dialog with brand, size, category, IDs, unit price, current price and description when present.
- Basket persistence on the device/browser.
- Automatic Compare Basket Totals refresh when items or quantities change.
- Basket totals per retailer with explicit missing-item counts.
- Catalogue & Specials section collapsed behind a dropdown to avoid clutter.
- Specials can participate in Price Checker calculations when compatible.
- Permanent **Ease of Access** weekly-staple selector, even when the basket contains items.
- Ease of Access shortcuts: Milk, Bread, Eggs, Mince, Chicken and Flour.
- Turnstile protection on Suggestions/feedback submission only.
- Save basket and share basket functions.
- Product and retailer disclaimers so RandBasket does not present prices as guaranteed checkout prices.
- Improved favicon and search/AI discovery metadata.

## Search and matching state

The active production design prioritises predictable structured/lexical matching and resource safety:

- D1 catalogue text and vocabulary lookup.
- Exact phrase/token coverage.
- Structured product-family, category, characteristic, species, unit and pack-size compatibility.
- Typo tolerance/Levenshtein logic exists as a bounded fallback.
- Cosine/vector semantic candidate discovery is optional and inactive without `PRODUCT_VECTORS`.
- D1 remains authoritative even if semantic candidates are used later.

Important rejection rules now prevent misleading results such as:

- milk chocolate or milk rolls for plain milk
- plant milk for dairy milk and vice versa
- flavoured milk for plain milk
- quail/pickled/chocolate eggs for standard egg searches
- bread flour, crumbs and bread accessories for bread loaves
- prepared/soya/pet mince for plain beef mince
- chicken offal for ordinary chicken unless requested
- incompatible species, category, dietary requirement or pack dimension

Tests: `cloudflare/scripts/test-catalogue-matching.mjs`.

Run from `cloudflare`:

```powershell
npm run test:matching
```

The matching suite passed at the latest local verification. Wrangler dry-run inside Codex failed only because its sandbox could not traverse parent directories; Cloudflare's real build environment compiled the Worker.

## Catalogue and retailer data state

### Pick n Pay, Checkers and Woolworths

These retailers have existing product/offer data and ingestion scripts. Search returns priced products in production when the cached catalogue is populated. Direct retailer prices can vary by branch, account, fulfilment mode and promotion.

Relevant scripts include:

- `Invoke-PickNPayCatalogueApiIngestion.ps1`
- `Invoke-CheckersCatalogueApiIngestion.ps1`
- `Invoke-WoolworthsCatalogueApiIngestion.ps1`
- generic sitemap/category/import helpers in the repository root

### SPAR

- Complete reviewed public own-brand catalogue: 1,283 products across 125 categories.
- Source capture: `cloudflare/data/spar-own-brand-catalogue.json`.
- Idempotent D1 import: `cloudflare/data/spar-own-brand-import.sql`.
- Product-only SPAR catalogue entries use `price_cents = NULL`; no prices were invented.
- The app must display `Price unavailable` for product-only rows.
- Regional specials are separate and may carry a real price/date/location context.
- Source dataset contains matches for milk, eggs, mince, bread, chicken and flour.

The SPAR schema/import succeeded during the catalogue deployment recovery. See `HANDOFF-SPAR-INDEXING.md` for complete evidence and refresh instructions.

### Makro

- Search plan: `cloudflare/data/popular-search-profiles.json`.
- Crawler: `cloudflare/scripts/import-makro-public-catalogue.mjs`.
- Batch applier: `cloudflare/scripts/apply-d1-import-directory.mjs`.
- Priority terms start with milk, eggs, bread, beef mince, chicken and flour, then expand to common grocery/household categories.
- Obvious irrelevant products are filtered before import.

Deployment history:

1. The first Makro/SPAR deployment successfully crawled all six basic Makro staple searches and uploaded Makro product SQL batches, but failed when `makro-vocabulary.sql` found that production D1 lacked `search_vocabulary`.
2. Commit `bd57de4` updated catalogue deployment scripts to apply `schema.sql` first.
3. The next attempt created the missing schema and imported SPAR successfully.
4. The repeated Makro crawl triggered human verification after milk, eggs and bread, so the guard correctly refused an incomplete second Makro import.
5. The Cloudflare deploy command was restored to `npx wrangler deploy` afterward.

The first attempt's Makro product inserts were idempotent and persisted before the vocabulary failure, but production coverage must be verified through the live API. Do not assume every Makro result is current merely because the row exists. Do not fabricate prices, and avoid rapid repeated crawling because Makro activates human verification.

### Catalogue deployment commands

Normal Worker deployment:

```text
npx wrangler deploy
```

One-time SPAR import plus deployment:

```text
npm run deploy:with-spar
```

Makro crawl plus guarded catalogue deployment:

```text
npm run catalogue:makro:crawl && npm run deploy:with-catalogues
```

Only use the Makro command deliberately. The guard requires all six basic staples and will stop rather than publish a silently incomplete crawl.

## D1 schema and migrations

Canonical idempotent schema: `cloudflare/schema.sql`.

Important tables:

- `catalogue_products`
- `catalogue_offers`
- `search_profiles`
- `search_vocabulary`
- `product_embedding_status`
- `search_requests`
- `feedback_submissions`

Migrations are in `cloudflare/migrations/0002...0012`. `0010-search-vocabulary.sql` creates/seeds vocabulary for older databases. Catalogue deployment scripts now apply `schema.sql` before imports so new required tables exist.

Do not delete or recreate the production D1 database. Use idempotent schema/migration/import files and verify remote execution logs.

## Cloudflare deployment and security

### Worker

- Git-connected Worker builds from `/cloudflare`.
- Normal deploy command is `npx wrangler deploy`.
- Non-production version command was `npx wrangler versions upload`.
- A push to GitHub `main` triggers deployment.

### Pages

- Public site deploys independently from the `site/` directory.
- When website changes appear stale, the app service-worker cache version in `site/app/service-worker.js` and the script query version in `site/app/index.html` must be bumped together.

### Turnstile

- Turnstile is used only for Suggestions/feedback submissions.
- Public site key is safe in the client.
- Private key must exist only as Worker secret `TURNSTILE_SECRET_KEY`.
- A private Turnstile secret was pasted into the prior Codex conversation. It was not intentionally committed, but it should be rotated in Cloudflare before public launch because chat exposure counts as secret exposure.
- After rotation, update the Worker secret and do not place the new value in Git or documentation.

### Other secrets

Never commit:

- Expo access tokens
- Android keystores or passwords
- Apple credentials/certificates
- Google Play service-account JSON
- Cloudflare API tokens
- Turnstile secret keys
- retailer account cookies/tokens

## Native mobile app

Location: `mobile/`.

Stack:

- Expo SDK 54
- React Native 0.81.5
- React 19.1
- AsyncStorage
- foreground Expo Location

Identity:

- App name: RandBasket
- Scheme: `randbasket`
- Android package: `za.co.randbasket.app`
- iOS bundle ID: `za.co.randbasket.app`
- App version: `1.0.0`
- Production API: `https://api.randbasket.co.za`

Mobile behaviour:

- No user account/sign-in.
- Basket/settings/latest comparison stored locally.
- Optional foreground location for nearby retailer relevance.
- Search, catalogue request, specials and basket comparison use the production API.
- Legal/support links open the public Pages site.
- No ads, analytics SDK, tracking SDK or background location in the current dependencies.

Validation already passed:

- TypeScript check.
- Expo public configuration.
- 1024 x 1024 app icon, adaptive icon and splash PNGs.
- Production EAS configuration.

## Expo/EAS and Google Play current state

- Expo owner: `randbasket.co.za`
- Expo project ID: `c95f0ee4-0323-40d2-bf2c-91d44593d2a3`
- `mobile/app.json` is linked but pending Git commit at handoff creation.
- Production Android EAS build was successfully submitted to Expo.
- Build shown in dashboard: Android Play Store build, profile `production`, SDK `54.0.0`, app version `1.0.0 (2)`.
- It entered the free-tier queue, then failed Expo Doctor before native compilation because the old Metro config enabled `resolver.unstable_enableSymlinks` and local Expo `54.0.35` was one patch behind the required `54.0.36`.
- The Metro config was reset to Expo's supported default, `mobile/package.json` now requires `expo ~54.0.36`, and `pnpm install` successfully refreshed `mobile/pnpm-lock.yaml` to Expo `54.0.36`.
- Local Expo Doctor passed 15/18 checks. Its remaining three failures were all `spawn npm ENOENT` because the bundled Codex runtime provides pnpm but no npm executable; the original Metro and Expo-version failures were resolved. EAS has npm and must perform the authoritative build validation.
- Build source displayed commit `bd57de4`; the uploaded build archive included the current linked mobile configuration.

Do not retry that failed build unchanged. Refresh dependencies/lockfile, rerun Expo Doctor, commit the fix, and start one new production build. When status becomes Finished, download the `.aab` and upload it to Google Play Console internal testing.

Exact continuation is in `HANDOFF-GOOGLE-PLAY-AAB.md`.

## Google Play release requirements still pending

- Wait for and download the EAS `.aab`.
- Create/open the Google Play app with package `za.co.randbasket.app`.
- Enable Play App Signing.
- Complete App access, Ads, Content rating, Target audience, News, Data Safety and privacy-policy sections.
- Upload first to Internal testing.
- Add testers and complete real-device testing.
- Capture Android screenshots.
- Complete any mandatory closed-testing requirement presented by the account before production access.
- Use the exact production behaviour when answering Data Safety; do not copy declarations blindly if backend logging changes.

## Apple status

- The owner began Apple Developer enrollment using a private iCloud account.
- Apple initially showed pending membership/payment and a duplicate-order error after payment details were entered.
- No confirmed successful Apple Developer activation or TestFlight build is recorded in this handoff.
- The app already has iOS bundle ID `za.co.randbasket.app`, build number `1`, encryption declaration and foreground-location usage text.
- A macOS/Xcode environment is not required for an EAS cloud iOS build, but active Apple Developer membership and Apple signing access are required.

Before continuing Apple release work, verify the membership status in Apple Developer and App Store Connect rather than submitting another duplicate purchase.

## Privacy and store positioning

Current intended declarations:

- No accounts.
- No advertising.
- No behavioural tracking.
- Basket/search content and optional location are sent to the API for app functionality.
- HTTPS in transit.
- Local basket/settings storage.
- Retailer links leave RandBasket and are governed by retailer policies.

Authoritative working documents:

- `mobile/store/PRIVACY_AND_DATA_SAFETY.md`
- `mobile/store/STORE_LISTING.md`
- `mobile/store/REVIEW_NOTES.md`

These are drafts until production logs, retention, Cloudflare settings and every dependency are verified.

## Known limitations and risks

1. Retailer prices vary by location, account, loyalty status, stock, fulfilment method and time.
2. SPAR's public own-brand catalogue is not a national live-price feed.
3. Makro may block automated repeated searches with human verification.
4. Catalogue rows can become stale; `last_seen_at` and price freshness must remain visible/meaningful.
5. Full basket comparison can show incomplete totals where a retailer lacks a compatible product; never label incomplete totals as fully comparable.
6. Retailer product-data terms and permitted usage should receive legal review before broad commercial launch.
7. The Android release candidate has not yet completed physical-device QA.
8. Apple enrollment status is unresolved.
9. Google/Apple search visibility and AI overviews are controlled by their crawlers/review systems and cannot be guaranteed by metadata alone.

## Immediate priority order for the home Codex

1. Read this file, `HANDOFF-GOOGLE-PLAY-AAB.md` and `HANDOFF-SPAR-INDEXING.md` completely.
2. Pull GitHub `main` and confirm the working tree is clean.
3. Check Expo build status; do not queue another build if version `1.0.0 (2)` is still queued/running.
4. When finished, download the `.aab`, record the EAS build ID and preserve EAS-managed credentials.
5. Verify live API health and basic searches (`milk`, `eggs`, `bread`, `beef mince`, `chicken`, `flour`) across all retailer columns.
6. Verify the latest Cloudflare Worker and Pages deployments are green.
7. Upload the AAB to Google Play Internal testing and complete store declarations.
8. Test the release on a real Android device before any production rollout.
9. Rotate the exposed Turnstile secret.
10. Only then continue Apple/TestFlight preparation.

## Evidence commands

Repository state:

```powershell
git status -sb
git log -12 --oneline --decorate
git rev-parse HEAD
git rev-parse origin/main
```

Worker matching tests:

```powershell
cd cloudflare
npm run test:matching
```

Mobile checks:

```powershell
cd mobile
pnpm exec tsc --noEmit
pnpm exec expo config --type public
pnpm dlx eas-cli project:info
pnpm dlx eas-cli build:list --platform android --limit 5
```

Live API checks:

```text
https://api.randbasket.co.za/v1/health
https://api.randbasket.co.za/v1/catalogue?q=milk&perRetailer=5
https://api.randbasket.co.za/v1/catalogue?q=eggs%2018&perRetailer=5
```

The home Codex should verify external state rather than assume it from this snapshot, because deployments and the Expo queue can change after handoff creation.
