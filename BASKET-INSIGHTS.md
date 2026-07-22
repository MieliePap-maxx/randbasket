# RandBasket Smart Basket and Basket Insights

## What ships

- Local Smart Basket profiles power “Your usuals” on web and mobile without an account.
- Local personalisation is enabled by default and can be paused or cleared.
- Anonymous basket activity is a separate, optional setting that is disabled by default.
- Consented events cover adds, quantity changes and removals. They contain product, retailer, quantity, listed price, source and time.
- Coordinates, names, emails, advertising IDs and raw installation IDs are not stored with basket events.
- The Worker hashes the random installation ID with a secret before D1 storage.
- Event IDs are idempotent and events expire after 365 days.
- Switching sharing off asks the Worker to delete the installation's pseudonymous history.

## Production rollout

From `cloudflare/`:

```powershell
npx wrangler d1 migrations apply randbasket-catalogue --remote
npx wrangler secret put BASKET_INSIGHTS_SECRET
npx wrangler deploy
```

Use a new high-entropy secret and store it only in Cloudflare. Do not add it to Git.

## Commercial attribution boundary

`basket_add` is a demand or shopping-intent signal. It is not evidence of checkout, payment, fulfilment or a retailer liability. Financial clawback requires a retailer or affiliate agreement with a conversion mechanism such as signed outbound attribution IDs, retailer postbacks or reconciled order reports.

Until that agreement exists, aggregate events may support product-demand reports but must not be presented as completed sales. Do not expose raw event rows through a public API. Administrative reporting should sit behind Cloudflare Access or another authenticated operator surface.

Example internal aggregation:

```sql
SELECT retailer_name, product_name, SUM(quantity) AS selected_quantity, COUNT(*) AS event_count
FROM basket_events
WHERE event_type IN ('basket_add', 'basket_quantity_increase')
  AND occurred_at >= datetime('now', '-30 days')
GROUP BY retailer_name, product_name
ORDER BY selected_quantity DESC;
```

The query is directional only because later decreases and removals must be reconciled before interpreting net basket intent.
