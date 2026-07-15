# Grocery Catalogue Plan

The app should not ask users to paste retailer URLs. The intended flow is:

1. A backend catalogue job gathers retailer products into a store catalogue.
2. The catalogue is reviewed/exported as Excel.
3. The phone app searches that catalogue.
4. Selecting a product fills hidden retailer product URLs for Pick n Pay, Woolworths, Checkers, and later Spar/Food Lover's Market.
5. Price scans use the stored URLs and current price extraction.

## Catalogue Columns

- `canonical_id`
- `canonical_name`
- `category`
- `target_size`
- `search_terms`
- `store_id`
- `store_name`
- `product_name`
- `brand`
- `size`
- `unit`
- `price`
- `regular_price`
- `savings`
- `promo_text`
- `promo_type`
- `promo_applied`
- `normalised_price_for_target`
- `normalised_target_size`
- `status`
- `message`
- `ingredients`
- `quantity`
- `url`
- `last_matched_url`
- `last_seen_at`

## Store Status

- Pick n Pay: direct URL price reads work through rendered page extraction.
- Checkers: direct URL price reads work through rendered page extraction.
- Woolworths: direct URL price reads work.
- Spar: catalogue sheet planned, crawler not implemented yet.
- Food Lover's Market: catalogue sheet planned, crawler not implemented yet.

## Refresh Command

Run a known-product price refresh with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Update-CataloguePrices.ps1
```

Useful options:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Update-CataloguePrices.ps1 -StoreId pick-n-pay -Limit 20
powershell -NoProfile -ExecutionPolicy Bypass -File .\Update-CataloguePrices.ps1 -StoreId checkers,woolworths -NoWorkbook
```

The refresh updates `data/catalogue.json`, then exports `data/catalogue/products.csv` and `data/catalogue/grocery-catalogue.xlsx`.

## Discovery Command

Run a controlled discovery scrape into a review queue with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Discover-CatalogueProducts.ps1 -Terms "milk 2l" -LimitPerTerm 5
```

The discovery output is:

- `data/catalogue/discovery-candidates.json`
- `data/catalogue/discovery-candidates.csv`

Discovery candidates are not automatically added to the live catalogue. They should be reviewed first, because retailer search pages can return near-matches, sponsored products, unavailable items, and product links that need store-specific matching.

## Notes

Bulk crawling every product from each retailer should be treated as a backend ingestion task with rate limits, logging, retry handling, freshness timestamps, and a review of retailer terms. Public price accuracy should be shown as "last checked at" because prices can vary by delivery area, store fulfilment, loyalty status, app-only promotions, and stock availability.

The first market-ready milestone is accurate refreshes for verified catalogue URLs. The second milestone is discovery crawlers that add new products into a review queue before they become visible in the app.
