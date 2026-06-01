# Cove — Native (iOS) setup runbook

Everything in the app works in the browser today. This is the ordered checklist to
turn it into an installable iOS app. Run it on your Mac with Xcode.

Bundle id: `app.cove.ios` · App name: **Cove** (set in `capacitor.config.ts`).

---

## Status legend
✅ done · ⚠️ verify on device · ❌ needs Apple Developer account · ⬜ deferred

| Area | Status |
|---|---|
| UI / UX / dark mode | ✅ |
| Encryption key hardening (Keychain, random, never hardcoded) | ✅ |
| Export / share (CSV → iOS share sheet) | ✅ |
| Reminders (local notifications) | ✅ ⚠️ verify on device |
| Keyboard avoidance | ✅ ⚠️ verify on device |
| App icon (1024px PNG ready) | ✅ generate sizes — see §2 |
| iOS platform scaffold (`ios/`) | ✅ `npx cap add ios` done |
| Restore Purchases UI (Settings) | ✅ |
| Privacy policy hosted at public URL | ⚠️ see §9 |
| StoreKit purchase wiring | ❌ Apple account + App Store Connect |
| Face ID / app lock | ⬜ deferred |
| Dynamic Type (text scaling) | ⬜ deferred |

---

## 0. Prerequisites
- **Xcode** — download from Mac App Store, then:
  ```sh
  sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
  ```
- **No CocoaPods needed** — the SQLite plugin uses Swift Package Manager (SPM).
  The `ios/App/CapApp-SPM/` folder is the SPM integration. Do not run `pod install`.

---

## 1. Sync web build to iOS
Run this every time you change the SvelteKit code:
```sh
npm run build
npx cap sync ios
```

---

## 2. App icon
Source: `assets/icon.png` (1024px, the Cove "C" mark). Generate all iOS sizes:
```sh
npx capacitor-assets generate --ios
```

---

## 3. Open in Xcode
```sh
npx cap open ios
```
Or double-click `ios/App/App.xcodeproj`.

---

## 4. Signing  ❌ needs Apple Developer account
Xcode → **App** target → **Signing & Capabilities** → set your Team.
Bundle id should read `app.cove.ios`.

---

## 5. Encryption key — ✅ DONE
`src/lib/db/init.ts`:
- Generates a cryptographically random 32-byte hex key on first launch
- Stores it in the **iOS Keychain** via `@capacitor/preferences`
- Never hardcodes the key; never logs it

Device test: delete + reinstall the app, confirm data is gone (key was cleared).

---

## 6. StoreKit — $9.99 PDF unlock  ❌ needs Apple account
Decision: use **Fovea `cordova-plugin-purchase`** (StoreKit 2, no RevenueCat).

When you have the account:
```sh
npm install cordova-plugin-purchase
npx cap sync ios
```
- Xcode → App target → **+ Capability** → In-App Purchase
- App Store Connect: create **Non-Consumable**, product id `app.cove.pdf_report`, $9.99
- Wire `src/lib/billing/entitlement.ts`:
  - `isPdfUnlocked()` → plugin's owned/verified state (restore on launch)
  - `restorePurchases()` → call `store.restorePurchases()` (Settings UI already wired)
  - Replace the dev `devSetPdfUnlocked` button in `src/routes/report/+page.svelte`
- Test with a **Sandbox Apple ID** on device

---

## 7. Run on device / simulator
```sh
npx cap open ios   # pick device → ▶ Run
```
Every change after: `npm run build && npx cap sync ios`

---

## 8. App Store submission checklist
- [ ] Host `static/privacy.html` at a public URL (see §9)
- [ ] Paste URL into App Store Connect → App Information → Privacy Policy URL
- [ ] App privacy nutrition label → **Data Not Collected**
- [ ] Screenshots: 6.7" (iPhone 16 Pro Max) + 5.5" (iPhone 8 Plus) — both required
- [ ] Age rating: 12+ (infrequent/mild medical content)
- [ ] Support URL (can point to the same privacy policy page)
- [ ] Sign + archive + upload via Xcode → Organizer

---

## 9. Hosting the privacy policy (free, ~5 min)
`static/privacy.html` is a self-contained page. Two easy options:

**Option A — GitHub Pages (recommended):**
1. Push this repo to GitHub
2. Repo Settings → Pages → Source: `main` branch / `/(root)` folder
3. URL: `https://YOUR-USERNAME.github.io/REPO-NAME/privacy.html`

**Option B — Vercel/Netlify (whole app):**
Deploy the SvelteKit app for free → the `/privacy` route becomes public.
Use that URL in App Store Connect.

Paste the URL into App Store Connect and into `src/routes/privacy/+page.svelte`
("Last updated" date is already correct).
