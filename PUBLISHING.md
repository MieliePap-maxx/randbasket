# Publishing To iPhone And Android

This repo now has two parts:

- `server.ps1` and `web/`: current desktop/local price checker and API.
- `mobile/`: native Expo app for iPhone and Android.

## Recommended launch path

1. Finish the native app UI and test it against the local API.
2. Move the price-check API to the Cloudflare Worker + D1/R2 production stack in `cloudflare/`.
3. Build iOS and Android binaries with Expo EAS.
4. Test privately with TestFlight and Google Play internal testing.
5. Submit to App Store review and Google Play review.

## Why Expo

Expo gives one React Native codebase for iPhone and Android. It can also use hosted EAS builds, which is useful from Windows because iOS App Store builds normally need macOS tooling.

## Accounts and costs

- Apple Developer Program: annual membership is required for App Store distribution.
- Google Play Console: one-time registration fee is required for Google Play distribution.

## Review risk to handle early

- The app should not look like a thin website wrapper.
- Backend services must be live during review.
- The app needs complete metadata, screenshots, support details, and a privacy policy.
- Price accuracy needs careful wording because retailer prices can vary by region, availability, delivery method, and specials.
- Retailer terms should be reviewed before public launch.

## Immediate next build tasks

- Node.js LTS and mobile npm packages are installed on `D:\SouthAfricaGroceryPriceCheckerDeps`.
- Run `.\Start-MobileApp.ps1` from the repo root to start Expo.
- Add real icon/splash assets.
- Decide the public app name.
- Host the API on HTTPS.
- Add a privacy policy page.

## Cloudflare Production Path

The public app must not depend on the local PowerShell server, a home-PC address, or a temporary tunnel. The selected production path is:

- Cloudflare DNS and domain management.
- Cloudflare Pages for the public website, support, privacy, and terms pages.
- Cloudflare Worker for `api.randbasket.co.za`.
- Cloudflare D1 for searchable published product metadata and user-facing request data.
- Cloudflare R2 for versioned catalogue files.

See [docs/app-store-launch.md](docs/app-store-launch.md) for the full owner checklist and [cloudflare/README.md](cloudflare/README.md) for the deploy scaffold.

## Temporary Development Exposure

For testing, Cloudflare Quick Tunnel is the easiest free option:

```powershell
cloudflared tunnel --url http://localhost:8765
```

It creates a temporary `trycloudflare.com` HTTPS URL that points to the local price checker. This is fine for development, demos, and internal testing.

For App Store and Google Play production, deploy the Cloudflare backend. A Cloudflare Tunnel is only appropriate for development demos and internal testing.
