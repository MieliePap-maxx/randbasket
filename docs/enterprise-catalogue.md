# Enterprise Catalogue Architecture

The public app should not scrape retailer websites while a customer waits. The app should browse and scan against a cached catalogue.

## Layers

1. `source-products`
   - Every retailer product discovered from store search/category/sitemap pages.
   - Stored in `data/catalogue/source-products.json` and `source-products.csv`.
   - This can contain duplicates, retailer-specific pack sizes, and products that still need review.

2. `app catalogue`
   - Clean products shown in the mobile app.
   - Stored in `data/catalogue.json`.
   - Exported to `data/catalogue/products.csv` and `grocery-catalogue.xlsx`.

3. `cached scan`
   - The phone calls `/api/scan/catalogue`.
   - This uses saved prices and does not open retailer pages.
   - Live scraping is a background/admin refresh process, not a normal customer action.

## Commands

Start or resume the complete national import:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Run-NationalCatalogueImport.ps1
```

The worker records resumable progress in `data/catalogue/national-import-state.json` and writes operational output under `logs/`. It indexes Pick n Pay and Checkers product sitemaps first, crawls Woolworths food categories in batches, publishes the searchable catalogue, and then performs the initial price pass. Failed prices have bounded attempts so one unavailable product cannot block the queue.

Discover retailer category URLs from configured sitemap/navigation sources:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Discover-RetailerCategories.ps1 -MaxPerStore 100
```

Pull indexed product URLs from retailer sitemaps:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Invoke-SitemapProductIngestion.ps1 -MaxProductsPerStore 500 -Append
```

Refresh prices for source products discovered from sitemaps:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Update-SourceProductPrices.ps1 -StoreId pick-n-pay -Limit 100 -OnlyMissingPrice -MaxPriceAttempts 1
```

Ingest products from discovered category pages:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Invoke-CategoryProductIngestion.ps1 -StoreId woolworths -MaxCategoriesPerStore 50 -LimitPerCategory 24 -Append
```

Run source ingestion for a small controlled shelf:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Invoke-EnterpriseCatalogueIngestion.ps1 -StoreId pick-n-pay -Terms toothpaste -LimitPerTerm 20 -Append
```

Run default seed terms:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Invoke-EnterpriseCatalogueIngestion.ps1 -StoreId pick-n-pay -MaxTerms 20 -LimitPerTerm 20 -Append
```

Import reviewed rows into the app catalogue:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Import-ReviewedSourceProducts.ps1 -Limit 100
```

During development only, import unreviewed rows:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Import-ReviewedSourceProducts.ps1 -Limit 100 -ImportUnreviewed
```

Missing catalogue searches:

- When the mobile app searches for a product that is not in `data/catalogue.json`, it calls `/api/catalogue/request`.
- The backend writes the request to `data/catalogue-requests.json` and starts `Run-CatalogueRequestJob.ps1` in the background.
- The job runs retailer search ingestion for that query, writes candidates to `source-products`, and currently publishes discovered rows into the app catalogue for development testing.
- For launch, keep this queue but add approval/ranking before customer-visible publishing.

Refresh prices for verified app catalogue URLs:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Update-CataloguePrices.ps1
```

## Current Import

The catalogue is no longer limited to the original toothpaste and custard sample. The national worker indexes every product URL exposed by the configured retailer sitemaps and every product discovered from the Woolworths food category index. The phone receives compact category previews and searches the full server-side catalogue index.

Sitemap sources now configured:

- Pick n Pay: `https://www.pnp.co.za/sitemap.xml`
- Checkers: `https://www.checkers.co.za/sitemap.xml`
- Woolworths: `https://content.woolworthsstatic.co.za/sitemap/index.xml`

Current ingestion behaviour:

- Pick n Pay: product URLs come directly from sitemap; price refresh works on tested sample.
- Checkers: product URLs come directly from sitemap; price refresh works on some rows and needs extractor tuning for others.
- Woolworths: food sitemap mainly exposes category URLs, so product ingestion runs from rendered category pages.

## Launch Requirements

- Use one retailer ingestion job at a time with rate limits.
- Keep `source-products` separate from the public app catalogue.
- Review/approve products before publishing them to customers.
- Store `lastSeenAt` and show price freshness.
- Add location-aware refresh later, because online price and stock can vary by fulfilment area.
- Use dedicated retailer test accounts only if needed for location or logged-in specials. Do not store personal credentials in code.
