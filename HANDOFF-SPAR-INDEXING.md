# RandBasket SPAR indexing handoff

## Ending state

Work is on branch `seo-release` in this repository. The pending top commit contains the complete SPAR catalogue index and the UI/API support needed to show catalogue products even when SPAR has not published a current price.

The official SPAR own-brand catalogue was enumerated from:

`https://www.spar.co.za/Assets/Our-Brands/In-Store/Our-Brands-Microsite/Products`

Captured and validated:

- 125 SPAR categories
- 1,283 unique products
- Stable SPAR product IDs
- Official product names, images, sizes and descriptions in the source dataset
- 16 database search matches for `eggs` after normalization, covering the 15-product egg category shown by SPAR
- No invented prices: product-only entries have `price_cents = NULL`

## What changed

- `cloudflare/scripts/crawl-spar-own-brand-catalogue.mjs` discovers the full Food and Non-Food hierarchy, follows category pagination, retries failures and extracts every product page.
- `cloudflare/data/spar-own-brand-catalogue.json` is the reviewed 1,283-product capture.
- `cloudflare/scripts/export-spar-own-brand-import.mjs` produces an idempotent D1 import.
- `cloudflare/data/spar-own-brand-import.sql` is the ready-to-import D1 file.
- Customer catalogue search now retains compatible unpriced catalogue entries instead of discarding them.
- The website labels these entries `Price unavailable`; they can still be opened or added to a basket so other retailers can be compared.
- Priced SPAR regional specials remain ranked ahead of unpriced catalogue-only products.
- The old README claim that SPAR has no public product catalogue was corrected. SPAR has a public product catalogue, but it is not a live-price feed.

## Verification completed

- Catalogue matching regression tests passed.
- Shared website catalogue tests passed.
- JavaScript syntax checks passed.
- The generated SQL was applied to a fresh local SQLite database successfully.
- Local database result: 1,283 SPAR products, 1,283 SPAR catalogue offers, 16 egg search matches and zero fabricated catalogue-only prices.
- The SQL contains no explicit `BEGIN TRANSACTION` or `COMMIT`, matching Cloudflare D1 import requirements.
- `git diff --check` passed.

Wrangler's dry-run command could not write its global log or traverse outside the workspace sandbox. This was an environment permission failure, not a Worker compilation or test failure. The matching test imports the Worker module successfully, and the previous production Worker configuration was not changed.

## Required deployment

### 1. Push all commits to GitHub main

Run in PowerShell:

```powershell
cd "C:\Users\aamann\Documents\Codex\2026-07-16\push-randbasket-commit-e371211-to-main\work\randbasket"
git push origin HEAD:main
```

This deploys the resource-safe search repair, product-information dialog and SPAR catalogue-support code.

### 2. Import the SPAR product rows into the production D1 database once

The simplest route with the existing Cloudflare Git build is:

1. Open Cloudflare → Workers & Pages → `randbasket-api` → Settings/Builds.
2. Temporarily change the deploy command from `npx wrangler deploy` to:

   `npm run deploy:with-spar`

3. Save it and retry the latest deployment.
4. Confirm the build shows the D1 execute step followed by a successful Worker deployment.
5. Change the deploy command back to `npx wrangler deploy` so later deployments do not re-import all 1,283 rows.

The one-time command uses the existing `randbasket-catalogue` D1 binding and the checked-in `data/spar-own-brand-import.sql`. No Vectorize index, AI binding, new database or new secret is required.

Cloudflare's documented direct CLI equivalent is:

```powershell
cd "C:\Users\aamann\Documents\Codex\2026-07-16\push-randbasket-commit-e371211-to-main\work\randbasket\cloudflare"
npx wrangler d1 execute randbasket-catalogue --remote --file=data/spar-own-brand-import.sql
```

Use the Git-build route above if `npx` is not available in the local terminal.

### 3. Verify production

Open:

`https://api.randbasket.co.za/v1/catalogue?q=eggs%2018&perRetailer=5`

Then search `eggs 18` on RandBasket. The SPAR column should contain compatible SPAR egg products. Catalogue-only items must say `Price unavailable`; an item should only show a rand amount when a current regional special or store-aware price exists.

## Important limitation

The public SPAR own-brand catalogue is useful for product indexing but does not publish live national prices. RandBasket must never treat those products as priced. Live SPAR totals still depend on the reviewed regional-special imports or a future authorised/store-aware SPAR2U price feed.

## Refreshing the catalogue later

From `cloudflare`:

```powershell
npm run catalogue:spar:crawl
npm run catalogue:spar:export
```

Review the changed product count, commit the refreshed JSON/SQL, push, then run the same one-time D1 import step.
