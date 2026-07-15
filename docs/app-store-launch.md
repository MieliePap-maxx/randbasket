# App Store Launch Checklist

This is the release checklist for SA Grocery Price Checker. The local PowerShell server is a development tool only; the public app must use the hosted API described below.

## Decisions Made

- [x] One native Expo app for iPhone and Android.
- [x] Cloudflare manages the domain and DNS.
- [x] Free-first production stack: Cloudflare Pages, Workers Free, D1 Free, and R2 Free.
- [x] Expo EAS Free for early builds, internal testing, and low-volume updates.
- [x] Pick n Pay, Checkers, and Woolworths are the initial retailers.
- [x] Public brand and domain: RandBasket / `randbasket.co.za`.
- [ ] Decide whether Apple developer enrolment is individual or organisation.

## Release Architecture

```text
Mobile app (iOS / Android)
        |
        v
api.randbasket.co.za  -> Cloudflare Worker
                                |- D1: users, baskets, price metadata, search requests
                                |- R2: versioned catalogue search shards and import files
                                |- scheduled import publisher (approved retailer data only)

www.randbasket.co.za  -> Cloudflare Pages
                                |- landing page
                                |- privacy policy
                                |- terms and support pages
```

The customer app only reads a published, timestamped catalogue. It never triggers a retailer scrape while the customer waits. This keeps the experience fast and avoids the current PC-dependent flow.

## Phase 1: Accounts And Domain

- [ ] Create or select the owner Cloudflare account. Do not share the password; invite collaborators later.
- [ ] Buy the chosen domain and add it to Cloudflare DNS. A domain is not free, but Cloudflare DNS can be free.
- [ ] Create the DNS records after deployment:
  - `www` -> Cloudflare Pages project.
  - `api` -> Cloudflare Worker custom domain.
- [ ] Create a dedicated support email on the domain, for example `support@<your-domain>`.
- [ ] Create the Expo owner account or organisation that will own the app project.
- [ ] Register the Apple Developer Program owner account. Apple App Store distribution requires the annual membership.
- [ ] Register the Google Play Console owner account. Full public distribution requires the one-time registration fee.

## Phase 2: Cloudflare Backend

- [ ] Create a Cloudflare Workers project from `cloudflare/`.
- [ ] Create a D1 database and apply `cloudflare/schema.sql`.
- [ ] Create an R2 bucket named `grocery-catalogue-production`.
- [ ] Set Worker secrets using the Cloudflare dashboard or Wrangler. Never put secrets in the Expo app or Git.
- [ ] Deploy the Worker first on a `workers.dev` URL, then attach `api.<your-domain>`.
- [ ] Upload a small reviewed catalogue and verify `/v1/health` and `/v1/catalogue` from a phone on mobile data.
- [ ] Add rate limits, CORS restricted to the app/site, request IDs, and error monitoring before public testing.

## Phase 3: Data Accuracy And Retailer Compliance

- [ ] Obtain written permission, an affiliate/product feed, or another approved data source for each retailer before large-scale public rollout.
- [ ] Keep source import data separate from the public catalogue.
- [ ] Publish only products with a retailer URL, price, pack size, image, and `lastSeenAt` timestamp.
- [ ] Record price freshness and show a clear "prices may vary by store, location, stock, delivery method, and specials" notice.
- [ ] Make user location optional. Do not claim location-specific pricing until retailer data supports it.
- [ ] Add an operations dashboard for failed imports, stale retailer prices, and product-match reports.
- [ ] Create a takedown/contact process for retailers.

## Phase 4: Mobile Production Build

- [ ] Choose final application name, icon, splash image, bundle ID/package name, and support URL.
- [ ] Confirm the production EAS environment points to `https://api.randbasket.co.za`.
- [ ] Add a privacy-policy link and terms link inside the app.
- [ ] Add account deletion only if accounts are introduced. Do not add accounts until they solve a real user need.
- [ ] Build iOS and Android release candidates with EAS.
- [ ] Test iOS through TestFlight and Android through Play internal testing using real devices and mobile data.
- [ ] Test offline, slow-network, no-result, stale-price, special-price, and retailer-link behaviour.

## Phase 5: Store Submission

- [ ] Prepare 6.7-inch iPhone screenshots and Android phone screenshots from the production build.
- [ ] Write the store title, subtitle/short description, full description, keywords, support URL, and privacy URL.
- [ ] Complete Apple privacy nutrition labels based on what the released app actually collects.
- [ ] Complete Google Data safety accurately based on what the released app actually collects.
- [ ] Give reviewers a working public API, test instructions, and a short note explaining the retailer price freshness disclaimer.
- [ ] For a new personal Play account, complete Google's required closed testing and device-verification steps before production access.
- [ ] Submit Android first to internal/closed testing, then Apple TestFlight, then production after feedback.

## Phase 6: How-To Videos

- [ ] Record a short website walkthrough showing location consent, a generic search, an exact-size search, best-price ordering, per-unit pricing, pagination, and adding an individual product to the basket.
- [ ] Record a short mobile walkthrough showing location consent, catalogue search, choosing a retailer result, adding an item, scan progress, comparing basket totals, and updating or removing an item.
- [ ] Record a correction walkthrough showing how a user reports a missing product, incorrect match, stale price, or wrong pack size.
- [ ] Produce portrait versions for the mobile app and social channels, plus a landscape website version.
- [ ] Add captions and a written transcript to every video. Keep each task-focused video under two minutes where possible.
- [ ] Use production-like sample data without exposing account details, precise location, retailer credentials, API keys, or private browser history.
- [ ] Publish the videos on the website help page and link them from app support, onboarding, and the store-review instructions where useful.
- [ ] Re-record affected clips whenever a release materially changes search, location consent, basket controls, or price comparison.

## Cost Guardrails

- Cloudflare Workers Free, D1 Free, and R2 Free are appropriate for an early public beta. Set usage alerts and hard operational limits.
- R2 includes 10 GB-month storage and free egress; do not serve the full catalogue file to every user. Search compact server-side shards instead.
- D1 Free has daily read/write/storage limits, so indexes and cached search responses are mandatory.
- Expo EAS has a limited free tier. Use it for release candidates; pay only if build queues or update limits become a real constraint.
- Unavoidable app-store costs: Apple Developer Program membership and Google Play registration. The domain is also a recurring cost.

## Do Not Do

- Do not expose the current home-PC address or Cloudflare Quick Tunnel as the public production API.
- Do not publish retailer credentials in code, app configuration, screenshots, or support documentation.
- Do not represent retailer prices as guaranteed or real-time unless the data contract actually guarantees it.
- Do not submit until the backend has public HTTPS, a health endpoint, a privacy policy, and reviewer-ready sample data.
