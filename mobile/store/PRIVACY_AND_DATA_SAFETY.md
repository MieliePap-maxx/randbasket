# Privacy and Data Safety Answers

Complete the store forms against the exact release build. These answers describe the source after the Smart Basket update.

## Current data behaviour

- No user account or sign-in.
- Basket items, settings and the latest comparison are stored locally with AsyncStorage.
- Smart Basket personalisation is on-device and can be paused or cleared.
- Anonymous basket activity is off by default. If enabled, product, retailer, quantity, listed price, event type and time are sent with a random installation ID for aggregation and deletion. The backend stores a secret-keyed hash instead of the raw ID and expires events after 365 days.
- Precise coordinates are not persisted in local storage.
- Approximate/foreground location is optional and used while the app is open to improve relevant retailer results.
- Search terms, selected basket products, quantities, retailer settings and optional coordinates are sent to `https://api.randbasket.co.za` to provide searches and comparisons.
- The app opens external retailer links. Retailer sites have their own data practices.
- No advertising SDK, third-party analytics SDK, cross-app tracking SDK or background location is included in the current mobile dependencies.

## Apple App Privacy

Declare data only if the production backend receives or retains it. For the current request flow:

- Location > Precise Location: Collected only if the API receives exact latitude/longitude. Purpose: App Functionality. Not linked to identity. Not used for tracking.
- User Content > Other User Content: Search and basket queries may qualify. Purpose: App Functionality. Not linked to identity. Not used for tracking.
- Identifiers > User ID or Device ID: assess and declare the app-generated pseudonymous installation identifier for users who opt in, even though it is not an advertising ID and is hashed before database storage. Purpose: Analytics and App Functionality. Not linked to identity. Not used for tracking.
- Usage Data > Product Interaction: declare optional basket-add, quantity-change and removal activity. Purpose: Analytics and App Functionality. Not linked to identity. Not used for tracking.
- Tracking: `No`.

If coordinates are rounded on-device before transmission, document the rounding and assess whether Apple’s Approximate Location category is sufficient.

## Google Play Data Safety

Use these answers only after confirming production server logging and retention:

- Does the app collect or share required user data types? `Yes` if search/basket queries or location leave the device.
- Location: optional; collected for app functionality; not shared for advertising; not processed ephemerally unless the backend discards it immediately.
- App activity / Other user-generated content: use the category that Play Console presents for grocery search and basket input; collected for app functionality.
- App activity / App interactions: include optional anonymous basket activity used for analytics and service improvement. It is not shared for advertising and is not required to use the app.
- Data encrypted in transit: `Yes` when the production API is HTTPS-only.
- Users can request deletion: link to `https://randbasket.co.za/privacy.html` and support if the backend retains submitted data.
- Independent security review: leave blank unless one has actually been completed.
- Ads: `No`.

## Before answering either store

Confirm production logs, Cloudflare settings, backups, error monitoring and retention. Store declarations must cover data collected by the app, backend and every third-party SDK—not only data saved visibly in the UI.

