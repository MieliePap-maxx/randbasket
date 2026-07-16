# App Review Notes

## Reviewer summary

RandBasket is an independent South African grocery price comparison app. It searches a published catalogue, compares supported retailer products and stores the user’s basket on the device. It does not sell groceries or process payments.

## Test flow

1. Launch the app and choose **Not now** when asked for location. The core app remains usable with national fallback data.
2. Tap **Check connection**.
3. Search for `full cream milk 2l`.
4. Add one or more results to the basket.
5. Open **Specials**, review a current verified offer and optionally add it to the basket.
6. Leave at least two retailers enabled.
7. Tap **Scan Fresh Prices**. Eligible promotional prices are included automatically.
8. Review the available per-item results and basket totals.
9. Open Privacy, Terms or Support from the bottom of the app.

## Location explanation

Foreground location is optional and requested only after an explanatory prompt. It is used while the app is open to improve relevant branch or area pricing. The app does not request background location, create a movement history or persist precise coordinates in saved device state.

## Price disclaimer

Retailer prices, promotions, stock and availability may vary by branch, location, account and fulfilment method. RandBasket tells users to confirm the final product and price with the retailer.

## Reviewer access

- No account is required.
- No payment is required.
- Production API: `https://api.randbasket.co.za`
- Support: `randbasketzar@gmail.com`

Before submission, confirm the production API returns stable reviewable sample results without relying on a private computer or temporary tunnel.
