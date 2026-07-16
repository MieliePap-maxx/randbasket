# RandBasket Mobile

Native iPhone and Android app for RandBasket.

## What this app does

- Edits the same grocery basket as the desktop/web app.
- Saves item names, quantities, target sizes, and direct supplier URLs.
- Calls the existing price-check API endpoints:
  - `GET /api/state`
  - `POST /api/items`
  - `POST /api/settings`
  - `POST /api/scan`
- Shows basket totals, best store, matched products, direct links, and specials.

## Local development

Node and npm have been installed locally on the D drive:

```text
D:\SouthAfricaGroceryPriceCheckerDeps\node
```

The npm packages are also on D:

```text
D:\SouthAfricaGroceryPriceCheckerDeps\mobile-runtime\node_modules
```

The launch scripts sync the mobile source files into this D-drive runtime before starting Expo. This avoids Metro's Windows cross-drive junction resolver issues while keeping package installs off C.

From the repo root, use:

```powershell
.\Start-MobileApp.ps1
```

or double-click:

```text
Start Mobile App.bat
```

If the QR code says `No usable data` on iPhone Camera, or the `exp://192...` LAN link does not open, use tunnel mode instead:

```powershell
.\Start-MobileAppTunnel.ps1
```

or double-click:

```text
Start Mobile App Tunnel.bat
```

Tunnel mode is slower, but it avoids local Wi-Fi, firewall, and router discovery issues.

If you install Node.js globally, these commands also work:

```powershell
cd mobile
npm install
npm run start
```

For phone testing, start the existing desktop price checker and use its phone/LAN URL as the price server link in the mobile app, for example:

```text
http://192.168.20.123:8765
```

For store builds, set `EXPO_PUBLIC_API_URL` to a hosted HTTPS price server. Do not ship the production app pointed at a private LAN address.

## Free exposure options

For development and TestFlight/internal testing, the easiest free option is Cloudflare Quick Tunnel:

```powershell
cloudflared tunnel --url http://localhost:8765
```

That gives a temporary public HTTPS URL for the local price server. It is useful for testing, but not for production app-store release because it uses a random URL and has no uptime guarantee.

For a more stable free/cheap path, use a normal Cloudflare Tunnel with your own domain on Cloudflare's free plan. Your Windows machine must stay online, and this still is not ideal for a public app if many users depend on it.

## Production backend requirement

The mobile app cannot run the current PowerShell + Edge scraper on-device. For App Store and Google Play release, the price checker needs a live HTTPS backend that exposes the same `/api/*` contract.

Recommended first production backend:

- Host the existing scraper on a Windows VPS first, because it already works with rendered retailer pages.
- Put HTTPS in front of it.
- Lock down logs and avoid storing personal shopping data unless needed.
- Add a simple health endpoint before submission.

Later, the scraper can be ported to a Node/Playwright service if we want a cleaner cloud-native backend.

## Build and submit

After `npm install`, install and log into EAS CLI:

```powershell
npm install --global eas-cli
eas login
eas init
npm run build:preview
npm run check
npm run build:all
```

Submit builds:

```powershell
eas submit --platform ios
eas submit --platform android
```

Production identity:

```text
App name: RandBasket
iOS bundle ID: za.co.randbasket.app
Android package: za.co.randbasket.app
Production API: https://api.randbasket.co.za
```

The first `eas init` links this source to an Expo project and writes an EAS project ID into the Expo configuration. Make sure the permanent RandBasket owner account or organisation owns that project.

Store listing copy, privacy answers, review notes and the release checklist are in `mobile/store/`.

## Store checklist

- Apple Developer Program account.
- Google Play Console developer account.
- Production HTTPS price server link.
- App icon and splash assets.
- iPhone and Android screenshots.
- Privacy policy URL.
- App review notes explaining that prices are read from public retailer product pages and may vary by area, availability, and promotions.
- A demo mode or review-ready backend data so Apple/Google can test without your private PC being online.

## Release safety

- Never commit Apple credentials, Google service-account JSON, API secrets or signing files.
- Build the exact commit that was tested.
- Do not change `za.co.randbasket.app` after either store listing is created.
- Increment the marketing version for user-visible releases. EAS automatically increments production build numbers with the current configuration.
