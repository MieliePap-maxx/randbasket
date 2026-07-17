# RandBasket Google Play AAB handoff

## Objective

Continue from the linked Expo/EAS project, create a signed production Android App Bundle (`.aab`), upload it to Google Play Console internal testing, and preserve the signing credentials for future releases.

## Repository and Git state

- Repository: `https://github.com/MieliePap-maxx/randbasket.git`
- Working directory on the current PC: `C:\Users\aamann\Documents\Codex\2026-07-16\push-randbasket-commit-e371211-to-main\work\randbasket`
- Current local branch: `seo-release`, tracking `origin/main`
- Current remote commit before the Expo link: `bd57de4 Create D1 schema before catalogue import`
- `mobile/app.json` is modified by `eas init` and must be committed.
- `.gitignore` now excludes `work-expo-home/`, a disposable local Expo/pnpm cache. Never commit that directory.

Before continuing on another computer, clone/pull `main`. If this handoff and `mobile/app.json` have not yet been committed, commit them from the current PC first.

## Expo/EAS identity

- Expo owner/account: `randbasket.co.za`
- Expo project ID: `c95f0ee4-0323-40d2-bf2c-91d44593d2a3`
- App name: `RandBasket`
- Expo slug: `randbasket`
- Android application ID: `za.co.randbasket.app`
- Version: `1.0.0`
- Android version code in source: `1`; EAS production builds use remote auto-incrementing.
- Production API: `https://api.randbasket.co.za`

`mobile/app.json` already contains:

```json
"extra": {
  "eas": {
    "projectId": "c95f0ee4-0323-40d2-bf2c-91d44593d2a3"
  }
},
"owner": "randbasket.co.za"
```

Do not create a second Expo project and do not change `za.co.randbasket.app` after creating the Google Play application.

## Validation already completed

- TypeScript `tsc --noEmit`: passed.
- Expo public configuration: passed.
- `icon.png`, `adaptive-icon.png`, and `splash-icon.png`: all valid 1024 x 1024 RGBA PNGs.
- Production build profile exists in `mobile/eas.json`.
- Production builds default to Android App Bundle (`.aab`); preview builds deliberately produce `.apk`.
- Location permissions are foreground-only and have user-facing explanations.
- Privacy, Terms and Support links are configured in `mobile/App.tsx`.

The Codex sandbox could not download `eas-cli` because outbound npm access was blocked. The user's normal PowerShell successfully downloaded it with `pnpm dlx`.

## Exact next step

The user created the Expo account with Google/Gmail. At the last prompt, EAS requested an email/username login. Use browser login so the Google password is never entered into PowerShell.

The first queued build later failed Expo Doctor. The source fix resets `mobile/metro.config.js` to Expo's default configuration and requires Expo `~54.0.36`. The lockfile was refreshed successfully with pnpm. Local Expo Doctor then passed 15/18 checks; the remaining three checks failed only because the bundled Codex runtime has no `npm` executable (`spawn npm ENOENT`). EAS builders include npm and will perform the authoritative validation.

```powershell
cd mobile
pnpm install
pnpm dlx expo-doctor
```

Do not rebuild if Metro or Expo dependency-version checks fail. The known local-only `spawn npm ENOENT` checks are an environment limitation, not a source failure.

From `mobile`:

```powershell
$runtime = "C:\Users\aamann\.cache\codex-runtimes\codex-primary-runtime\dependencies"
$env:Path = "$runtime\node\bin;$runtime\bin\fallback;$env:Path"

cd "C:\Users\aamann\Documents\Codex\2026-07-16\push-randbasket-commit-e371211-to-main\work\randbasket\mobile"

pnpm dlx eas-cli login --browser
pnpm dlx eas-cli whoami
```

If the home PC has Node.js and EAS CLI installed normally, use `npx eas-cli@latest` or `eas` instead of the bundled-runtime setup.

Confirm that `whoami` returns the account that owns `randbasket.co.za`. The project is already linked, but this command may be used to verify it:

```powershell
pnpm dlx eas-cli project:info
```

Then start the production Android build:

```powershell
pnpm dlx eas-cli build --platform android --profile production
```

Interactive answers:

- If pnpm asks which dependency build scripts to approve, select `dtrace-provider` with `a`, press Enter, then confirm Yes.
- If EAS asks to generate an Android keystore, choose Yes and let EAS manage it.
- Do not enable automatic Play submission for the first build; download and upload the first `.aab` manually.

When the cloud build finishes, download the bundle from the build URL or run:

```powershell
pnpm dlx eas-cli build:download --platform android
```

Save the `.aab` outside Git. The repository ignores release artefacts.

## Commit the EAS link

After confirming `project:info`, commit the linked project configuration:

```powershell
cd "C:\Users\aamann\Documents\Codex\2026-07-16\push-randbasket-commit-e371211-to-main\work\randbasket"
git add .gitignore mobile/app.json HANDOFF-GOOGLE-PLAY-AAB.md
git commit -m "Link RandBasket mobile app to EAS"
git push origin HEAD:main
```

Never commit keystores, passwords, Expo access tokens, Google service-account JSON, or downloaded `.aab` files.

## Google Play Console upload

For the first release:

1. Open the RandBasket application in Google Play Console. Its package must be `za.co.randbasket.app`.
2. Complete the required app-content declarations, privacy policy and Data Safety form using `mobile/store/PRIVACY_AND_DATA_SAFETY.md`.
3. Open **Test and release > Testing > Internal testing**.
4. Create a new release and enable Play App Signing when prompted.
5. Upload the production `.aab` downloaded from EAS.
6. Add concise release notes such as `Initial RandBasket internal test release.`
7. Save, review and roll out to internal testing.
8. Add tester email addresses or a Google Group, then use the tester opt-in link on a real Android phone.

Store copy is in `mobile/store/STORE_LISTING.md`, reviewer instructions are in `mobile/store/REVIEW_NOTES.md`, and the remaining QA work is in `mobile/store/RELEASE_CHECKLIST.md`.

## Required checks before production submission

- Verify `https://api.randbasket.co.za/v1/health` and catalogue search on mobile data and Wi-Fi.
- Test a fresh install, location allowed/denied, empty basket, search, add/remove, scan, retailer links and API-offline behaviour.
- Capture Android screenshots from the release candidate.
- Verify Privacy, Terms and Support pages are publicly reachable.
- Confirm Cloudflare logging/retention matches the Google Data Safety answers.

## Cloudflare/search context

Recent production work added the complete 1,283-product SPAR own-brand catalogue, Makro import tooling, permanent Ease of Access staple shortcuts, product-detail dialogs and stricter matching that rejects false positives such as milk chocolate, milk rolls, quail eggs, bread flour and prepared mince.

Cloudflare D1 initially lacked `search_vocabulary`. Commit `bd57de4` made catalogue deployments apply the idempotent schema first. A later retry created the schema and imported SPAR successfully. A repeated Makro crawl was blocked after milk, eggs and bread, but the previous attempt had already uploaded its Makro product batches before failing at vocabulary generation. The Cloudflare deploy command was restored to `npx wrangler deploy` afterward.

On the home Codex, verify the newest Worker deployment is green and test the live API before treating Makro coverage as complete. Do not rerun the full Makro crawl casually because its site can trigger human verification.
