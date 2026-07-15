# Cloudflare Production Scaffold

This folder is the starting point for the hosted API. It intentionally does not run retailer browser automation. Production price data must be published here from a permitted, rate-limited ingestion process.

## Setup

1. Create a Cloudflare account and install Wrangler on a development machine.
2. Create the D1 database and insert its ID in `wrangler.toml`.
3. Create an R2 bucket called `grocery-catalogue-production`.
4. Apply the schema with `wrangler d1 execute grocery-price-checker --file=schema.sql --remote`.
5. Deploy the Worker with `wrangler deploy`.
6. Attach `api.<your-domain>` as the Worker custom domain.

The Worker is a contract scaffold. The current local catalogue/search engine must be migrated in stages: publish reviewed catalogue rows into D1/R2, then point the Expo production build at the Worker.

## Secrets

Keep provider keys and import credentials in Cloudflare Worker secrets. Do not add them to source control or `EXPO_PUBLIC_*` variables.
