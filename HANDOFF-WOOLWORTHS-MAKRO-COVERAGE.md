# RandBasket Woolworths and Makro Catalogue Handoff

Date: 18 July 2026 (Africa/Johannesburg)

## Objective

Investigate missing Woolworths and Makro products, determine whether the loss occurs in the frontend or backend, remove the three stale Pick n Pay milk placeholders reported by the user, and prevent unrelated products from entering comparison baskets.

## Repository state

- Main repository: `C:\Users\MieliePap\Documents\South Africa Grocery Price Checker`
- Active worktree: `C:\Users\MieliePap\Documents\South Africa Grocery Price Checker\data\worktrees\spar-results-fix`
- Branch: `spar-results-fix`
- Current committed HEAD: `eec50e0 Fix session location and refresh SPAR regional prices`
- `origin/main` was also at `eec50e0` when this work started.
- The changes described below are **not committed or pushed**.
- User rule: ask before every commit and push.

## Audit findings

### Woolworths

- Current Woolworths food API total: **8,560 products**.
- Production D1 Woolworths offers: **8,860**.
- Positive-price Woolworths offers: **8,860**.
- Woolworths offers with images: **8,555**.
- This indicates the main Woolworths issue is not a wholesale missing import.
- The Worker capped discovery at 30 products per retailer and only performed the family fallback when the combined result set was small. A successful retailer could therefore prevent equivalent Woolworths products from being discovered, and later pages could never exceed the 30-row ceiling.

### Makro

- Makro publishes **185** compressed product-sitemap shards, generally around 5,000 URLs per shard.
- Its browse sitemap publishes **248** food-category pages, reduced to **232 unique category search terms**.
- Production initially contained only **2,285 Makro offers** because the old importer used 34 hard-coded searches and Makro verification interrupted later crawling.
- The new sitemap-driven importer successfully captured **120 priced breakfast-cereal products** with images and URLs.
- One product already existed, so production Makro offers increased to **2,404** after applying the batch.
- Production now returns ten Makro matches for `cereal`.
- Makro verification activated after the sample. A subsequent 20-category batch produced an empty manifest and was not applied.

### Pick n Pay placeholders

The reported rows were confirmed in D1 with `price_cents = 0`, no image, and no observation timestamp:

- `bosparadys-milk-full-cream-2l`
- `crickley-full-cream-milk-2l`
- `dewfresh-full-cream-milk-2l`

Migration `0013-clean-stale-catalogue-placeholders.sql` was applied to production. All three product rows are now absent.

Production also contains many other zero-price Pick n Pay legacy rows: 36,583 total offers but only 26,271 with a positive price. These rows are retained for possible future refresh, but the pending Worker change suppresses them from search and basket results. SPAR product-only rows remain visible because missing SPAR prices are an intentional, honest catalogue state.

### Comparison categorisation

The egg screenshot was reproduced from production data:

- `Butternut 2 pk` was incorrectly labelled `Dairy`.
- The matching layer allowed a recognised `eggs` request to use a category-only Dairy fallback.
- That produced the invalid `9 packs exactly meet 18 items` comparison.

The pending Worker now requires the same product family whenever a recognised family exists. Category-only fallback remains available only for genuinely generic category searches. Cereal searches also reject unrequested snack/energy bars.

## Production changes already applied

These D1 changes are live even though their source files are not committed yet:

1. `cloudflare/migrations/0013-clean-stale-catalogue-placeholders.sql`
   - Removed the three named Pick n Pay milk offers and orphan products.
   - Reclassified the concrete butternut records from Dairy to Fresh Fruit & Vegetables.
2. `.wrangler/makro-cereal-audit/makro-category-001.sql`
   - Imported 120 reviewed priced Makro cereal rows; one updated an existing offer.
3. `.wrangler/makro-cereal-audit/makro-category-vocabulary.sql`
   - Added the corresponding vocabulary terms.

Current relevant production counts:

| Retailer | Offers | Positive prices | Images |
|---|---:|---:|---:|
| Makro | 2,404 | 2,404 | 2,404 |
| Pick n Pay | 36,583 | 26,271 | 26,277 |
| Woolworths | 8,860 | 8,860 | 8,555 |

## Pending source changes

### `cloudflare/src/index.ts`

- Added `isCatalogueOfferUsable()`.
- Non-SPAR zero-price rows no longer consume candidate slots or enter basket matching.
- SPAR product-only rows remain supported.
- Increased bounded per-retailer candidate depth from 30 to 60.
- Candidate depth now grows with the requested retailer page.
- Increased the balanced global cap while keeping the query bounded.
- Family/profile fallback always runs when it differs from the strict query; another retailer can no longer suppress it.
- Recognised product families require family matches.
- Breakfast cereal rejects unrequested snack bars.

### `cloudflare/scripts/import-makro-category-catalogue.mjs`

- Reads Makro's own compressed browse sitemap.
- Derives 232 unique food search terms from `food-products` and `food-nutrition`.
- Uses priced search-result state rather than protected product pages.
- Supports category limit, delay, offset, page cap, and optional category filter.
- Produces idempotent D1 product, offer, and vocabulary SQL.
- Records successful, failed, incomplete, and next-resume offsets.
- Stops safely when verification is detected.

### Other files

- `cloudflare/scripts/apply-d1-import-directory.mjs`
  - Supports category manifests.
  - Supports a `WRANGLER_ENTRY` environment variable for the D-drive Wrangler runtime.
- `cloudflare/scripts/test-catalogue-matching.mjs`
  - Adds zero-price, butternut/eggs, cereal-bar, candidate-cap, and SQL-filter regression checks.
- `cloudflare/migrations/0013-clean-stale-catalogue-placeholders.sql`
  - Idempotent source for the production cleanup already applied.
- `cloudflare/package.json`
  - Adds category crawl/apply scripts.
- `cloudflare/README.md`
  - Documents the resumable category workflow and verification rules.
- `TODO-RANDBASKET.md`
  - Product roadmap requested by the user.

## Current working tree

Expected modified/untracked files:

```text
M  cloudflare/README.md
M  cloudflare/package.json
M  cloudflare/scripts/apply-d1-import-directory.mjs
M  cloudflare/scripts/test-catalogue-matching.mjs
M  cloudflare/src/index.ts
?? TODO-RANDBASKET.md
?? cloudflare/migrations/0013-clean-stale-catalogue-placeholders.sql
?? cloudflare/scripts/import-makro-category-catalogue.mjs
?? HANDOFF-WOOLWORTHS-MAKRO-COVERAGE.md
```

`.wrangler` crawl and dry-run output is ignored and must not be committed.

## Validation completed

- `node cloudflare/scripts/test-catalogue-matching.mjs` passed.
- Node syntax checks passed for both changed catalogue scripts.
- `git diff --check` passed.
- Wrangler Worker dry build passed:
  - Upload: 103.44 KiB
  - gzip: 24.87 KiB
- Production D1 verification confirmed the three named stale milks have count zero.
- Production API verification confirmed Makro now returns ten priced cereal products with images.

## Important live/pending distinction

- The D1 cleanup and Makro cereal rows are already live.
- The Worker matching and zero-price visibility fixes are **not live** until these source changes are committed, pushed to `main`, and Cloudflare finishes the deployment.
- Until that deployment, other zero-price Pick n Pay rows can still appear after the three deleted products.
- `breakfast cereal` can still be over-restricted across retailers until the pending family fallback is deployed.

## Next action: obtain commit/push approval

Do not commit or push without explicit user approval. After approval, run:

```powershell
Set-Location 'C:\Users\MieliePap\Documents\South Africa Grocery Price Checker\data\worktrees\spar-results-fix'

$git  = 'C:\Users\MieliePap\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd\git.exe'
$node = 'C:\Users\MieliePap\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$env:GIT_PAGER = 'cat'

& $node cloudflare\scripts\test-catalogue-matching.mjs
& $node --check cloudflare\scripts\import-makro-category-catalogue.mjs
& $node --check cloudflare\scripts\apply-d1-import-directory.mjs
& $git diff --check

& $git add `
  cloudflare\README.md `
  cloudflare\package.json `
  cloudflare\scripts\apply-d1-import-directory.mjs `
  cloudflare\scripts\import-makro-category-catalogue.mjs `
  cloudflare\scripts\test-catalogue-matching.mjs `
  cloudflare\src\index.ts `
  cloudflare\migrations\0013-clean-stale-catalogue-placeholders.sql `
  TODO-RANDBASKET.md `
  HANDOFF-WOOLWORTHS-MAKRO-COVERAGE.md

& $git diff --cached --check
& $git commit -m 'Expand retailer catalogue coverage and reject stale matches'
& $git fetch origin
& $git rebase origin/main
& $git push origin HEAD:main
& $git --no-pager log -3 --oneline --decorate
```

## Post-deployment verification

After Cloudflare reports a successful Worker build, verify:

```powershell
$base = 'https://api.randbasket.co.za/v1/catalogue'

Invoke-RestMethod "$base?q=cereal&limit=50&perRetailer=10&debug=1"
Invoke-RestMethod "$base?q=breakfast%20cereal&limit=50&perRetailer=10&debug=1"
Invoke-RestMethod "$base?q=full%20cream%20milk%202l&limit=50&perRetailer=10&debug=1"
Invoke-RestMethod "$base?q=large%20eggs%2018%20pack&limit=50&perRetailer=10&debug=1"
```

Acceptance checks:

- No non-SPAR result has a missing or zero price.
- No butternut result appears for eggs.
- No unrequested energy/snack bar appears for breakfast cereal.
- Makro cereal results retain images, price, pack size, and product URL.
- Woolworths and Pick n Pay can contribute equivalent cereal results even when their title omits `breakfast`.
- Page 4 can return additional retailer results when enough valid products exist.

## Resume the broader Makro import

Makro verification is active at handoff time. Do not bypass it. When ordinary search pages load normally again, restart from the first incomplete offset shown by the prior manifest. The empty test batch must not be applied.

```powershell
Set-Location 'C:\Users\MieliePap\Documents\South Africa Grocery Price Checker\data\worktrees\spar-results-fix\cloudflare'

$node = 'C:\Users\MieliePap\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$env:WRANGLER_ENTRY = 'D:\SouthAfricaGroceryPriceCheckerDeps\npm-cache\_npx\c943b712072b77c4\node_modules\wrangler\bin\wrangler.js'

# Retry offset 0 because the first three categories were challenged and imported nothing.
& $node scripts\import-makro-category-catalogue.mjs .wrangler\makro-category-batch-000 20 1800 0 4
Get-Content -Raw .wrangler\makro-category-batch-000\manifest.json

# Apply only when products > 0 and successfulCategories > 0.
& $node scripts\apply-d1-import-directory.mjs .wrangler\makro-category-batch-000
```

For the next batch, use the manifest's `nextCategoryOffset` in both the output-directory name and offset argument. Re-run a partially completed offset because all SQL is idempotent.

## Product roadmap

The requested list is maintained in `TODO-RANDBASKET.md`:

1. Add product categories.
2. Add price tracking for users.
3. Add fuel calculation for users.
4. Add an area selector for retailer-specific data.
5. Fix app text artifacts.
6. Triple-check item categorisation for comparison baskets.
7. Fix app prices not fully working or updating.
