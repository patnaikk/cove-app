# Cove — Weekend Ship Checklist

Execute top to bottom. Nothing here needs code changes — the build is ready.
Each phase gates the next. Don't skip the sandbox purchase test (Phase 4).

---

## Phase 0 — Apple Developer account (do first, it gates everything)

- [ ] Enroll at https://developer.apple.com/enroll → **Individual** → $99
- [ ] Wait for activation email (usually 1–2 hrs, sometimes up to 48)
- [ ] Confirm you can sign in at https://appstoreconnect.apple.com

---

## Phase 1 — App Store Connect: create the app record

- [ ] App Store Connect → **My Apps** → **+** → **New App**
- [ ] Platform: **iOS**
- [ ] Name: **Cove — Private Cycle Tracker**
- [ ] Primary language: **English (U.S.)**
- [ ] Bundle ID: **app.cove.ios**  (must match capacitor.config.json appId)
      - If it's not in the dropdown: Certificates, IDs & Profiles → Identifiers →
        **+** → App IDs → App → description "Cove", bundle id `app.cove.ios`,
        enable **In-App Purchase** capability → Register. Then come back.
- [ ] SKU: `cove-ios-001` (any unique string, internal only)
- [ ] User Access: Full Access

---

## Phase 2 — Create the In-App Purchase product (THE paid feature)

- [ ] In the app record → **Monetization → In-App Purchases** → **+**
- [ ] Type: **Non-Consumable**
- [ ] Reference Name: `Cove Full Report`  (internal)
- [ ] Product ID: **app.cove.pdf_report**  ← MUST be exactly this. The code in
      src/lib/billing/entitlement.ts hardcodes it. A typo = "Product not available".
- [ ] Price: **$9.99** (Tier / price point 9.99 USD)
- [ ] Localization (English U.S.):
      - Display Name: `Full Report`
      - Description: `Unlock the clinician-formatted PDF report — your cycle
        patterns, flags, and history laid out for a doctor's appointment.`
- [ ] Review screenshot: a screenshot of the unlocked report screen (required —
      Apple reviewers need to see what's purchased)
- [ ] Save. Status will be **"Ready to Submit"** — it submits alongside the app build.

---

## Phase 3 — Xcode: capability + archive

- [ ] `npx cap sync ios` (refresh, just in case)
- [ ] Open `ios/App/App.xcworkspace` in Xcode (NOT the .xcodeproj)
      - If no .xcworkspace, open App.xcodeproj — this project is SPM-based so that's fine.
- [ ] Select **App** target → **Signing & Capabilities**
      - [ ] Team: your developer account
      - [ ] Signing: **Automatically manage signing**
      - [ ] **+ Capability** → **In-App Purchase**  (required for billing to work)
- [ ] Set build scheme to **Release**: Product → Scheme → Edit Scheme → Run → Release
- [ ] Set a real version + build number: target → General → Version `1.0`, Build `1`
- [ ] Plug in your iPhone, select it as destination

---

## Phase 4 — Sandbox purchase test (DO NOT SKIP — this is why we didn't ship Thursday)

- [ ] App Store Connect → **Users and Access → Sandbox → Testers** → **+**
      - Create a sandbox tester (use a NEW email you don't use for real Apple ID)
- [ ] On your iPhone: Settings → **Developer → Sandbox Apple Account** (iOS 16+)
      sign in with the sandbox tester. (Older iOS: it prompts at purchase time.)
- [ ] In Xcode: **Run** the app on your device (Release build)
- [ ] In the app: build up to / navigate to the report → tap **Unlock · $9.99**
      - [ ] The StoreKit purchase sheet appears (says [Environment: Sandbox])
      - [ ] Complete the purchase with the sandbox account
      - [ ] The report **unlocks** — you see the full report + "Save PDF report"
- [ ] Force-quit the app, reopen → report is **still unlocked** (persistence works)
- [ ] Settings → **Restore Purchases** → confirm it reports success and stays unlocked
- [ ] Delete the app, reinstall via Xcode, tap **Restore Purchases** → unlocks again

If any of these fail, STOP and fix before submitting. A broken purchase = rejection
or paying users getting nothing.

---

## Phase 5 — Screenshots (6.7" — your 15 Pro Max)

Take FULL screenshots (don't crop). Clean status bar: Airplane Mode + Do Not Disturb on.
- [ ] Today — a logged day
- [ ] Today — empty / first-run state
- [ ] Calendar
- [ ] Report — free view (shows the lock card + insight)
- [ ] PDF report (the paid artifact)
Upload under the **6.7" Display** slot in App Store Connect.

---

## Phase 6 — App Store listing (copy is in STORE_COPY.md)

- [ ] Name: `Cove — Private Cycle Tracker`
- [ ] Subtitle: `Private. No account. No cloud.`
- [ ] Keywords: `period,cycle,tracker,private,offline,endo,pcos,cramps,symptom,pain,irregular,report,doctor`
- [ ] Promotional text + Description: paste from STORE_COPY.md
- [ ] Support URL: your privacy page (https://patnaikk.github.io/cove-app/privacy or a support page)
- [ ] Category: Primary **Health & Fitness**, Secondary **Medical** (optional)
- [ ] Age Rating: complete questionnaire (no objectionable content → should be 4+)
- [ ] **Privacy Nutrition Label: "Data Not Collected"** — check NOTHING. This is true
      and is Cove's whole pitch. If asked to justify: all data is stored locally via
      SQLCipher; the only network call is to Apple's StoreKit for IAP.
- [ ] Copyright: `© 2026 <your name>`

---

## Phase 7 — Upload & submit

- [ ] Xcode → Product → **Archive**
- [ ] Organizer → **Distribute App** → **App Store Connect** → Upload
- [ ] Wait for the build to process in App Store Connect (~5–30 min)
- [ ] In the app version: select the processed build
- [ ] Attach the In-App Purchase to the submission (it submits with the app the first time)
- [ ] **Submit for Review**

Apple review: typically 24–72 hrs. You'll get an email on approval/rejection.

---

## Sanity checks before you hit Submit
- [ ] Sandbox purchase worked end-to-end (Phase 4) ← the one that matters most
- [ ] Restore Purchases worked after a reinstall
- [ ] Product ID in App Store Connect is EXACTLY `app.cove.pdf_report`
- [ ] Privacy label says Data Not Collected
- [ ] Screenshots are uncropped 6.7"

---

## Known notes
- Review prompt: fires natively on the user's 2nd period start (already built/verified).
- CSV export: free, always available.
- PDF report: the only paid feature ($9.99 one-time, non-consumable).
