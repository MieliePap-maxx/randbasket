# South Africa Grocery Price Checker

A personal local dashboard for checking weekly grocery prices across Pick n Pay, Checkers, and Woolworths.

## Start it

Double-click `Grocery Price Checker.vbs` for the clean app launch.

If you want a Desktop shortcut, double-click `Install Desktop Shortcut.bat` once. After that, use the `Grocery Price Checker` shortcut on your Desktop.

`Start Grocery Price Checker.bat` is still available as a visible fallback launcher.

To stop the local server, double-click `Stop Grocery Price Checker.bat`.

## Use it on iPhone

1. Start the app on your Windows machine.
2. Keep the Windows machine awake and connected to the same Wi-Fi as your iPhone.
3. In the dashboard, copy the `iPhone access` link.
4. Open that link in Safari on your iPhone.
5. In Safari, use `Share` then `Add to Home Screen` if you want it to feel like a phone app.

The phone version still uses your Windows machine as the price-checking server. If Windows Firewall asks about allowing PowerShell/Edge on private networks, allow it for your home Wi-Fi.

## Native iPhone and Android app

There is now a native Expo app in `mobile/` for App Store and Google Play work. It uses the same basket and price-check API, but it still needs a hosted HTTPS backend before public release.

See `PUBLISHING.md` and `mobile/README.md` for the iPhone/Android launch path.

You can also run the server manually:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\server.ps1
```

Then open:

```text
http://127.0.0.1:8765
```

## How to use it

1. Add the grocery items you actually buy.
2. Use specific search phrases like `milk 2l`, `eggs 18`, or `chicken fillets 1kg`.
3. Paste exact product page URLs for Pick n Pay, Checkers, and Woolworths when you know them.
4. Click `Scan Prices`.

Exact product URLs are preferred over search pages. Search phrases are only a fallback for vendors where the product URL is blank.

The dashboard saves your basket, scan history, and settings in the `data` folder.

## Notes

Retailer prices can vary by branch, delivery area, app-only specials, loyalty pricing, and time of day. Some retailer websites hide product data behind JavaScript or block automated reads, so the dashboard reports those cases instead of guessing.

There is also a Python backend in `grocery_price_checker.py` for later packaging, but the Windows launcher uses `server.ps1` so it can run without installing Python or Node.
