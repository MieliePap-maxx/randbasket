# RandBasket Mobile Release Checklist

## Blocking before store submission

- [ ] `https://api.randbasket.co.za/v1/health` is publicly reachable over HTTPS.
- [ ] Search and scan return stable reviewer-ready data on Wi-Fi and mobile data.
- [ ] Privacy, Terms and Support URLs are publicly reachable.
- [ ] Production backend retention and logging match the store privacy declarations.
- [ ] Retailer data sources and permitted public use have been reviewed.
- [ ] Apple Developer and Google Play Console legal names match the publisher identity.
- [ ] Expo/EAS project is owned by the long-term RandBasket owner account or organisation.

## Release candidate QA

- [ ] Fresh install on a supported iPhone.
- [ ] Fresh install on a supported Android phone.
- [ ] Location allowed, denied and later enabled from settings.
- [ ] Empty basket, no results, API offline and slow network.
- [ ] Product images missing or slow.
- [ ] Search, pagination, add, edit, remove, save, scan and rescan.
- [ ] Retailer links open correctly.
- [ ] Text remains readable with larger accessibility font settings.
- [ ] VoiceOver/TalkBack labels and focus order are usable.
- [ ] No clipped content, keyboard obstruction or unsafe-area overlap.
- [ ] Privacy, Terms and Support links work inside release builds.

## Store assets

- [x] 1024 × 1024 app icon source and PNG.
- [x] Android adaptive foreground icon.
- [x] Splash icon.
- [ ] Apple screenshots captured from the production build.
- [ ] Android phone screenshots captured from the production build.
- [ ] Optional preview video recorded without private data.
- [ ] Store listing proofread on a phone and desktop.

## Release

- [ ] Run `eas init` once and commit the generated EAS project ID.
- [ ] Build preview binaries and complete device testing.
- [ ] Build production Android App Bundle.
- [ ] Upload to Google internal testing, then required closed testing.
- [ ] Build production iOS archive.
- [ ] Upload to TestFlight and complete internal/external testing.
- [ ] Complete Apple App Privacy and Google Data Safety from verified production behaviour.
- [ ] Paste the reviewer notes and submit.

