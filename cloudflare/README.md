# RandBasket Cloudflare API

This folder contains the public catalogue API. It serves cached prices and retailer product choices from D1; it does not scrape retailer sites while a shopper waits.

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

## API endpoints

- `GET /v1/health`
- `GET /v1/catalogue?q=full+cream+milk+2l&limit=10&page=1`
- `GET /v1/catalogue/categories`
- `POST /v1/catalogue/request` with `{ "query": "product name", "source": "mobile" }`

The older `/api/catalogue` route is also supported for the existing web client while it is migrated.
