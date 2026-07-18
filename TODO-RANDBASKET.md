# RandBasket Product Roadmap

Updated: 18 July 2026

## P0 - Accuracy and current prices

- [ ] **Triple-check item categorisation for comparison baskets**
  - Build a retailer-independent category taxonomy.
  - Reclassify legacy rows whose imported category came from a search term rather than the product.
  - Require recognised product families to match; category-only fallback must not substitute unrelated products.
  - Add fixtures for eggs vs butternut, milk vs confectionery, bread vs flour, cereal vs snack bars, and human food vs pet food.
- [ ] **Fix app prices not fully working or updating**
  - Confirm the app always calls `https://api.randbasket.co.za` in production.
  - Refresh active searches and basket totals after location, quantity, retailer, and catalogue changes.
  - Display `lastSeenAt`, loading, stale, unavailable, and retry states consistently.
  - Verify service-worker cache upgrades do not leave an older API response or app shell active.
- [ ] **Complete five-retailer catalogue coverage**
  - Finish resumable Makro food-category batches from its published browse sitemap.
  - Audit Woolworths exact product IDs against its current 8,560-product food API.
  - Refresh Pick n Pay and Checkers data and suppress zero-price legacy placeholders.
  - Continue SPAR regional price coverage without inventing national prices.

## P1 - Discovery and local relevance

- [ ] **Add product categories**
  - Present simple shopper categories derived from the shared taxonomy, not retailer-specific navigation labels.
  - Add category filtering while keeping free-text search and autocomplete.
  - Store source category plus canonical RandBasket category for auditability.
- [ ] **Add an area selector for retailer-specific data**
  - Let users choose suburb, town, or postcode when GPS is declined or inaccurate.
  - Resolve the selection to coordinates and a retailer/store region.
  - Keep precise coordinates session-only; store only the user-selected area label when explicitly saved.
  - Show which area/store each regional price belongs to.
- [ ] **Add price tracking for users**
  - Save tracked products and target prices to a user account or anonymous device profile.
  - Record dated offer snapshots rather than overwriting history.
  - Notify only when a comparable current offer crosses the selected threshold.
  - Add price-history charts and promotion-expiry context.

## P2 - Trip economics and polish

- [ ] **Add fuel calculation for users**
  - Calculate round-trip distance to each selected store.
  - Let users enter vehicle consumption and fuel price, with editable defaults.
  - Show grocery total, estimated fuel cost, and combined trip cost separately.
  - Start with a privacy-conscious routing provider evaluation; Google Maps is an option, not a requirement.
- [ ] **Fix app text artifacts**
  - Audit encoding, line wrapping, punctuation, stale terminology, and compact-screen overflow.
  - Remove object-string artifacts such as `[object Object]` and malformed measurement labels.
  - Add automated text/encoding fixtures and mobile visual checks.

## Release rule

Do not describe a retailer as complete until source coverage, current positive prices, images, links, category quality, pagination, and comparison-basket matching have all been verified independently.
