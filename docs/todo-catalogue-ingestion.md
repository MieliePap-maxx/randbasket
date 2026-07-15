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
5. Investigate Spar and Food Lover's Market product pages and decide if stable catalogue crawling is viable.
6. Add ingredients and richer product metadata where retailer pages expose it.
7. Add a scheduled refresh job that updates the catalogue once or twice per week.
8. Add catalogue review controls so bad matches can be corrected before users see them.
9. Add category filters and better product grouping in the mobile app.
10. Move the catalogue from JSON/CSV into a hosted database before public launch.

## Important

The public app should not depend on users pasting product URLs. Product URLs should be collected by the backend catalogue job and hidden from the normal mobile flow.

For launch, every displayed price should include a source retailer, product URL, status, and `lastSeenAt`. If the app cannot refresh a product, it should keep the previous price but mark it stale instead of pretending it is current.
