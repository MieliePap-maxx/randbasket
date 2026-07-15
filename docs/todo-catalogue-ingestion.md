# Catalogue Ingestion To-Do

## Done

- Added `data/catalogue.json` as the backend catalogue source.
- Added `data/catalogue/products.csv` for Excel-friendly review.
- Added `data/catalogue/grocery-catalogue.xlsx` export via `Export-CatalogueWorkbook.ps1`.
- Added `/api/catalogue?q=...` for product search.
- Changed the mobile basket flow so users can search the catalogue and add a product without pasting URLs.
- Added `Update-CataloguePrices.ps1` to refresh saved catalogue URLs and write current price, regular price, specials, status, normalised target-size price, and `lastSeenAt`.
- Added `Discover-CatalogueProducts.ps1` to scrape search terms into a review queue instead of auto-publishing unverified products.
- Fixed URL measurement parsing so retailer product codes such as `10888491KG` do not become fake product weights.
- Verified live refreshes for the first two catalogue products across Pick n Pay, Woolworths, and Checkers.
- Ran the full seeded catalogue refresh: 17 of 18 retailer rows returned prices.
- Ran a controlled `milk 2l` discovery: Pick n Pay returned matched product URLs; Woolworths returned names/prices but needs direct URL extraction; Checkers search discovery needs more work.

## Next

1. Replace or verify the Pick n Pay Gouda 700g URL, which currently returns `no-price-found`.
2. Improve Woolworths discovery so search candidates include direct product URLs.
3. Improve Checkers discovery so search pages return review candidates.
4. Add an approval/import command that turns reviewed discovery rows into canonical catalogue products.
5. Complete the retailer rollout gates below in order: SPAR, Makro, then Food Lover's Market.
6. Add ingredients and richer product metadata where retailer pages expose it.
7. Add a scheduled refresh job that updates the catalogue once or twice per week.
8. Add catalogue review controls so bad matches can be corrected before users see them.
9. Add category filters and better product grouping in the mobile app.
10. Move the catalogue from JSON/CSV into a hosted database before public launch.

## Retailer Rollout Gates

Adding a sitemap is discovery only. A retailer is not considered working until its products can be searched with accurate prices and the same quality controls used for Pick n Pay, Checkers, and Woolworths.

### Gate 1: SPAR

- [x] Import reviewed national SPAR specials with official artwork, prices, deal conditions, and validity dates.
- [ ] Connect an approved selected-store product and price source; the public SPAR sitemap alone is not a priced catalogue.
- [ ] Map the shopper's approved location to the matching current SPAR store/regional flipbook without combining prices from unrelated regions.
- [ ] Ask for location permission with a clear explanation, then resolve the user's area to a supported SPAR store without storing precise location or tracking in the background.
- [ ] Import product name, current and regular price, pack size, image, retailer URL, availability, store identifier, and freshness timestamp.
- [ ] Normalize grams, kilograms, millilitres, litres, multipacks, and each-item quantities before value comparison.
- [ ] Verify representative searches and the top shopping terms against the selected SPAR store before enabling SPAR publicly.

### Gate 2: Makro

- [x] Add public Makro catalogue discovery and an initial priced product batch.
- [x] Add a reviewed browser-capture import path for catalogue pages protected by human verification.
- [ ] Expand the resumable importer across grocery categories without bypassing retailer verification controls.
- [ ] Reach useful coverage comparable to Pick n Pay, Checkers, and Woolworths for the top shopping searches.
- [ ] Verify product links, images, stock, specials, pack sizes, unit normalization, result relevance, and freshness timestamps.
- [ ] Confirm Makro reliably appears in generic and exact-size searches before marking the retailer complete.

### Gate 3: Food Lover's Market

- [ ] Start only after SPAR passes Gate 1 and Makro passes Gate 2.
- [ ] Use `https://foodloversmarket.co.za/sitemap_index.xml` as the initial discovery index and identify an approved source for current product-level prices.
- [ ] Build resumable category discovery and import with deduplication, retries, freshness tracking, and reviewable failures.
- [ ] Import product name, current and regular price, pack size, image, direct product URL, availability, category, and freshness timestamp.
- [ ] Apply the shared measurement parser and value comparison rules before exposing results.
- [ ] Test representative fresh produce, meat, bakery, dairy, pantry, frozen, and household searches.
- [ ] Keep Food Lover's Market hidden from customer search until priced rows, images, links, matching, and sample-search quality all pass review.

## Important

The public app should not depend on users pasting product URLs. Product URLs should be collected by the backend catalogue job and hidden from the normal mobile flow.

For launch, every displayed price should include a source retailer, product URL, status, and `lastSeenAt`. If the app cannot refresh a product, it should keep the previous price but mark it stale instead of pretending it is current.
