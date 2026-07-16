# RandBasket Cloudflare API

This folder contains the public catalogue API. It serves cached prices and retailer product choices from D1; it does not scrape retailer sites while a shopper waits.

## Retailer coverage

Pick n Pay, Checkers, Woolworths, SPAR, and Makro are represented in the API and app. Makro publishes product URLs through compressed sitemaps, which the local importer supports. Its price pages currently present a human-verification response to unattended requests, so a browser-approved or partner-feed price refresh is required before Makro prices are published. SPAR's public sitemap is informational; SPAR2U prices are selected-store and app-catalogue dependent, so its price feed also needs a store-aware ingestion route.

Makro public search/category pages expose priced product cards without requiring protected product-page reads. Import them in small resumable batches with `scripts/import-makro-public-catalogue.mjs`; the script stops when Makro verification appears and accepts a term offset for a later run. SPAR cannot use this route: the public website has no product catalogue, so production SPAR prices require an authorised SPAR2U feed or a browser/app-assisted capture for a selected store.

## Public website deployment

The Cloudflare Pages project should use the repository root with no build command and `site` as its build output directory. The public price checker is available at `/app/` and calls `https://api.randbasket.co.za` directly. Attach both `randbasket.co.za` and `www.randbasket.co.za` to the Pages project.

## First deployment

All temporary imports and dependency installs should stay on `D:`.

1. In Cloudflare, create a D1 database named `randbasket-catalogue`.
2. Copy its database ID into `wrangler.toml` and change the Worker name to `randbasket-api`.
3. In a terminal, set the npm cache to D: and install this folder's dependencies:

```powershell
$env:npm_config_cache = 'D:\SouthAfricaGroceryPriceCheckerDeps\npm-cache'
Set-Location 'C:\Users\MieliePap\Documents\South Africa Grocery Price Checker\cloudflare'
npm install
```

4. Authenticate with `npx wrangler login`, then apply the schema:

```powershell
npx wrangler d1 execute randbasket-catalogue --remote --file=schema.sql
```

5. Generate D1 import batches from the local, ignored catalogue:

```powershell
node scripts/export-catalogue-import.mjs `
  '..\data\catalogue.json' `
  '..\data\popular-search-profiles.json' `
  'D:\SouthAfricaGroceryPriceCheckerDeps\randbasket-catalogue-import'
```

6. Run each generated `catalogue-*.sql` file and then `search-profiles.sql` with `wrangler d1 execute ... --remote --file=<file>`.
7. Deploy the Worker with `npx wrangler deploy`, then add `api.randbasket.co.za` as its custom domain in the Worker settings.

## Turnstile

The public Suggestions form uses Cloudflare Turnstile. Store the private key as a Worker secret; never add it to `wrangler.toml` or commit it:

```powershell
npx wrangler secret put TURNSTILE_SECRET_KEY
```

The public site key is included in the web client. The Worker validates every feedback token with Cloudflare Siteverify before saving or emailing the submission.

## Semantic catalogue search

RandBasket supplements keyword and typo-tolerant catalogue search with semantic candidate discovery. Product and query embeddings use Cloudflare Workers AI model `@cf/baai/bge-small-en-v1.5` with `cls` pooling. The model produces 384-dimensional vectors, stored in the `randbasket-products` Vectorize index with cosine similarity.

Vector matches use an initial minimum cosine score of `0.78`. They only add candidate product IDs: D1 remains authoritative, and category, characteristic, quantity, unit, size, location and retailer-offer checks still reject unsafe matches. Exact and typo-tolerant keyword scores remain dominant in final ranking.

Create the index and the private indexing token once:

```powershell
npx wrangler vectorize create randbasket-products --dimensions=384 --metric=cosine
npx wrangler secret put VECTOR_INDEX_TOKEN
```

Apply the backward-compatible embedding status migration and deploy the bindings:

```powershell
npx wrangler d1 execute randbasket-catalogue --remote --file=migrations/0011-product-embedding-status.sql
npx wrangler deploy
```

Set the local indexing token to the same value saved as the Worker secret, then index changed catalogue products. The script is idempotent and skips unchanged embedding text:

```powershell
$env:RANDBASKET_VECTOR_INDEX_TOKEN = "use-the-same-private-token"
$env:RANDBASKET_API_URL = "https://api.randbasket.co.za"
npm run vector:index
npm run vector:verify
```

The content hash automatically re-indexes products after embedding-text, model or pooling changes. Use `npm run vector:index -- --force` only to repair or repopulate a recreated Vectorize index. Normal website deployments do not rebuild the vector index.

## API endpoints

- `GET /v1/health`
- `GET /v1/catalogue?q=full+cream+milk+2l&limit=10&page=1`
- `GET /v1/catalogue/categories`
- `POST /v1/catalogue/request` with `{ "query": "product name", "source": "mobile" }`
- `POST /v1/admin/vector-index` with a private `Authorization: Bearer ...` header

The older `/api/catalogue` route is also supported for the existing web client while it is migrated.

