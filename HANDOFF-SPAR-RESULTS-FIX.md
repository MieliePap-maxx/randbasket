# RandBasket SPAR Results Fix Handoff

## Objective

Make SPAR catalogue products appear for ordinary RandBasket searches such as
`milk`, `eggs`, `flour`, and `chicken`, with or without browser location
permission.

## Worktree

- Path: `C:\Users\MieliePap\Documents\South Africa Grocery Price Checker\data\worktrees\spar-results-fix`
- Branch: `spar-results-fix`
- Fix commit: `29aff22 Fix SPAR catalogue search results`
- Deployment branch: `origin/main`
- Pushed to production `main` on 2026-07-18.

## Root Cause

The production D1 database already contains the reviewed SPAR own-brand
catalogue. Exact SPAR product-name searches returned SPAR candidates, proving
that the import was present.

Generic searches returned zero SPAR candidates because
`findBalancedProductCandidates()` applied one global product limit ordered by
the shortest `search_text`. Short Pick n Pay, Checkers, and Woolworths rows
filled that limit before SPAR's longer official product descriptions were
reached. Location permission could not fix this because SPAR was removed before
location filtering happened.

SPAR own-brand offers have `location_key = NULL`, so they are national and must
be visible without location permission. Only regional specials are location
dependent.

## Changes

### `cloudflare/src/index.ts`

- Replaced the globally starved candidate query with one bounded D1 query that:
  - scans matching products once;
  - joins the indexed retailer offers;
  - uses `ROW_NUMBER() OVER (PARTITION BY retailer_id ...)`;
  - reserves up to the configured candidate limit independently for every
    retailer;
  - remains globally capped to protect Worker CPU usage.
- Added retailer-category normalization for SPAR categories such as:
  - `Breakfast Milk Long Life` -> dairy;
  - `Perishables Eggs` -> dairy;
  - `Main Meal Flour` -> pantry;
  - `Perishables Frozen Poultry` -> meat.
- Prioritized candidates whose source category matches the requested product
  family.
- Increased catalogue candidate depth to 30 per retailer so SPAR's more
  descriptive records survive matching and safety filters.
- Rejected misleading generic staple results such as evaporated/condensed milk
  for `milk` and chicken offal for `chicken`.

### `cloudflare/scripts/test-catalogue-matching.mjs`

- Added SPAR category-family regression tests.
- Added plain milk and generic chicken safety tests.
- Added SQL assertions proving that candidate limits are partitioned by
  retailer and category matches are ranked first.

## Validation Completed

- Full `HANDOFF-RANDBASKET-COMPLETE.md` read.
- Production API diagnosis completed before editing:
  - generic searches had `SPAR candidateCount = 0`;
  - exact known SPAR names returned SPAR candidates;
  - `locationApplied = true` did not change the zero generic count.
- Full local SPAR import loaded successfully:
  - 2,569 D1 statements executed;
  - 1,283 SPAR products represented.
- Local catalogue inspection confirmed useful candidates within the new cap:
  - full-cream long-life milk within the first 20 milk candidates;
  - eggs and cake wheat flour near the top of their categories;
  - chicken thighs and mixed portions within the first 22 chicken candidates.
- `node cloudflare/scripts/test-catalogue-matching.mjs`: passed.
- `git diff --check`: passed.
- `wrangler deploy --dry-run`: passed.
  - upload: 102.69 KiB;
  - gzip: 24.63 KiB.
- The unrelated app test currently fails on clean `origin/main` because
  `site/app/app.js` uses app shell version 31 while
  `site/app/test-comparison-core.mjs` expects service worker version 32. No app
  files were changed by this SPAR fix.
- Wrangler local dev could not start because the existing Worker module exports
  `MIN_SEMANTIC_SIMILARITY` as a non-handler named export. The production dry
  build succeeds; this local-runtime issue predates and is separate from the
  SPAR query change.
- Production verification after Cloudflare deployment passed:
  - `milk`: 26 SPAR candidates, 15 accepted, 10 displayed with Johannesburg location;
  - `eggs`: 17 SPAR candidates, 16 accepted, 10 displayed;
  - `flour`: 9 SPAR candidates, 6 accepted, 6 displayed;
  - `chicken`: 21 SPAR candidates, 8 accepted, 8 displayed;
  - `milk` without location: 25 SPAR candidates, 14 accepted, 10 displayed.

## Important Product/Price Behaviour

- SPAR own-brand catalogue rows have real product names, sizes, categories,
  descriptions, images, and official product URLs.
- Many own-brand rows do not publish a live price. RandBasket must show these as
  `Price unavailable`; it must never invent a price.
- A priced SPAR result requires a current regional-special offer for the user's
  area. Location permission filters those regional offers but is not required
  for national catalogue visibility.
- Some categories may honestly remain empty where the reviewed SPAR source has
  no equivalent. The own-brand dataset has suitable milk, eggs, flour, and
  chicken products, but does not guarantee an ordinary bread loaf or beef mince.

## Exact Validation Commands

Run from PowerShell:

```powershell
Set-Location 'C:\Users\MieliePap\Documents\South Africa Grocery Price Checker\data\worktrees\spar-results-fix'

$node = 'C:\Users\MieliePap\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
& $node cloudflare\scripts\test-catalogue-matching.mjs
git diff --check

$env:Path = 'C:\Users\MieliePap\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:Path
$env:WRANGLER_LOG_PATH = 'D:\SouthAfricaGroceryPriceCheckerDeps\wrangler-logs'
Set-Location cloudflare
& 'D:\SouthAfricaGroceryPriceCheckerDeps\npm-cache\_npx\c943b712072b77c4\node_modules\.bin\wrangler.cmd' deploy --dry-run --outdir .wrangler\spar-results-dry-run
Set-Location ..
```

## Exact Commit And Push Commands

These commands were completed for commit `29aff22` and are retained for audit
and future reference:

```powershell
Set-Location 'C:\Users\MieliePap\Documents\South Africa Grocery Price Checker\data\worktrees\spar-results-fix'

git status --short
git diff --check
git add cloudflare/src/index.ts cloudflare/scripts/test-catalogue-matching.mjs HANDOFF-SPAR-RESULTS-FIX.md
git commit -m "Fix SPAR catalogue search results"

git fetch origin
git rebase origin/main
git push origin HEAD:main
```

Do not use force push. If the rebase reports a conflict, stop and resolve it
before pushing.

## Post-Deploy Verification

The Cloudflare Worker build from `main` completed and the checks below passed.
They can be rerun at any time:

```powershell
$base = 'https://api.randbasket.co.za/v1/catalogue'
foreach ($query in @('milk', 'eggs', 'flour', 'chicken')) {
  $encoded = [uri]::EscapeDataString($query)
  $url = "$base?q=$encoded&perRetailer=10&debug=1&latitude=-26.2041&longitude=28.0473"
  $data = Invoke-RestMethod -Uri $url
  $spar = @($data.products | Where-Object { $_.stores[0].storeId -eq 'spar' })
  [pscustomobject]@{
    Query = $query
    CandidateCount = $data.candidateCounts.spar
    AcceptedCount = $data.retailerDiagnostics.spar.acceptedCount
    SelectedCount = $spar.Count
    Examples = ($spar | Select-Object -First 3 | ForEach-Object { $_.stores[0].productName }) -join ' | '
  }
}
```

Expected after deployment:

- `candidateCount` is greater than zero for all four checks;
- SPAR products appear in the SPAR column;
- unpriced own-brand rows display `Price unavailable`;
- location permission is not required for those national own-brand rows;
- regional priced offers remain limited to applicable locations.

Also repeat `milk` without latitude and longitude. National SPAR products must
still appear.

## Rollback

If the production Worker shows a regression, revert the new commit normally and
push the revert to `main`:

```powershell
git revert <new-commit-sha>
git push origin HEAD:main
```

Do not reset or force push shared `main`.
