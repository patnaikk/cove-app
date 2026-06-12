// The PDF report is the one paid feature ($9.99 one-time). CSV export is always free.
//
// On device: backed by cordova-plugin-purchase (Fovea, StoreKit 2).
//   Product id: app.cove.pdf_report  (Non-Consumable, configured in App Store Connect)
//   Setup: npm install cordova-plugin-purchase && npx cap sync ios
//          Xcode → App target → + Capability → In-App Purchase
//
// In the browser: falls back to a localStorage dev flag so the gated UI works
// without a real Apple account. devSetPdfUnlocked() is only rendered in dev builds.

import { Capacitor } from '@capacitor/core';

const PRODUCT_ID = 'app.cove.pdf_report';
const DEV_KEY = 'cove.dev.pdfUnlocked';
// Persists confirmed ownership across launches so offline users stay unlocked.
// @capacitor/preferences uses UserDefaults on iOS (backed up, survives app updates,
// cleared on reinstall). StoreKit remains the authoritative source of truth; this is
// just a cache so we never show the paywall when the network is unreachable.
const ENTITLEMENT_CACHE_KEY = 'cove.pdf_unlocked';

// Reactive in-memory state — updated by the store listener below.
// .svelte.ts lets us use $state so callers can derive from isPdfUnlocked() and
// get automatic UI updates when StoreKit verification lands asynchronously.
let _unlocked = $state(false);
// Localized price string from StoreKit (e.g. "€9.99"). Falls back to the
// App Store Connect default tier price until billing initializes.
let _localizedPrice = $state('$9.99');

// Resolves once the persisted-entitlement cache has been read from disk.
// Report and settings screens await this before reading isPdfUnlocked() so
// a paid user never sees the paywall on a cold launch — even offline.
let _cacheReadyResolve: () => void;
let _billingCacheReady: Promise<void> = new Promise<void>((r) => {
	_cacheReadyResolve = r;
});

export function getBillingCacheReady(): Promise<void> {
	return _billingCacheReady;
}

async function loadCachedEntitlement(): Promise<void> {
	try {
		const { Preferences } = await import('@capacitor/preferences');
		const { value } = await Preferences.get({ key: ENTITLEMENT_CACHE_KEY });
		if (value === '1') _unlocked = true;
	} catch {
		// Cache miss is fine — StoreKit will confirm via the store listener.
	} finally {
		_cacheReadyResolve();
	}
}

async function persistEntitlement(owned: boolean): Promise<void> {
	try {
		const { Preferences } = await import('@capacitor/preferences');
		await Preferences.set({ key: ENTITLEMENT_CACHE_KEY, value: owned ? '1' : '0' });
	} catch {
		// Non-critical — StoreKit remains the authoritative source of truth.
	}
}

// Called once at app startup (from +layout.svelte or init.ts).
// Registers the product, restores any prior purchase, and wires the owned listener.
// cordova-plugin-purchase attaches window.CdvPurchase asynchronously (after
// the Cordova bridge fires `deviceready`), which can land AFTER the Svelte
// layout mounts and calls initBilling(). Poll briefly until it's present so we
// never skip product registration on a cold launch.
function waitForCdvPurchase(timeoutMs = 10000): Promise<any> {
	return new Promise((resolve) => {
		const start = Date.now();
		const tick = () => {
			const cdv = (window as any).CdvPurchase;
			if (cdv?.store) return resolve(cdv);
			if (Date.now() - start > timeoutMs) return resolve(null);
			setTimeout(tick, 100);
		};
		tick();
	});
}

let _billingInitStarted = false;

export async function initBilling(): Promise<void> {
	if (!Capacitor.isNativePlatform()) {
		// Browser dev: seed _unlocked from localStorage so isPdfUnlocked() is
		// reactive even on web (devSetPdfUnlocked also writes here).
		try { if (localStorage.getItem(DEV_KEY) === '1') _unlocked = true; } catch { /* ignore */ }
		_cacheReadyResolve(); // unblock awaits on web
		return;
	}
	if (_billingInitStarted) return; // guard against $effect re-runs
	_billingInitStarted = true;

	// Load the persisted cache FIRST so isPdfUnlocked() returns true immediately
	// for offline launches — before StoreKit has a chance to respond.
	await loadCachedEntitlement();

	// Wait for the Cordova plugin to finish loading before touching it.
	const { store, ProductType, Platform } = (await waitForCdvPurchase()) ?? {};
	if (!store) {
		_billingInitStarted = false; // allow a later retry
		console.warn('[cove] cordova-plugin-purchase not found — billing unavailable');
		// Schedule one automatic retry in case the Cordova bridge was just slow.
		setTimeout(() => { if (!_billingInitStarted) initBilling(); }, 30_000);
		return;
	}

	store.register([{
		id: PRODUCT_ID,
		type: ProductType.NON_CONSUMABLE,
		platform: Platform.APPLE_APPSTORE
	}]);

	store.when()
		.productUpdated(() => {
			const product = store.get(PRODUCT_ID, Platform.APPLE_APPSTORE);
			const owned = product?.owned ?? false;
			// Only ever upgrade: never downgrade a confirmed purchase. StoreKit can
			// fire this event before receipt validation completes (owned=false), which
			// would clobber a valid entitlement we just loaded from the cache.
			if (owned) {
				_unlocked = true;
				void persistEntitlement(true);
			}
			const offer = product?.getOffer?.();
			if (offer?.pricing?.price) _localizedPrice = offer.pricing.price;
		})
		.approved((transaction: any) => transaction.verify())
		.verified((receipt: any) => {
			// Only unlock if this receipt actually contains our product — guard
			// against a future second product accidentally flipping the flag.
			// v13 hands either a VerifiedReceipt (purchases in .collection[].id) or a
			// raw Receipt (.transactions[].products[].id); if we can't extract any
			// product ids, fall back to trusting it (single-product app).
			const ids: string[] = [
				...(receipt.collection ?? []).map((p: any) => p.id),
				...(receipt.transactions ?? []).flatMap(
					(t: any) => (t.products ?? []).map((p: any) => p.id)
				)
			].filter(Boolean);
			if (ids.length > 0 && !ids.includes(PRODUCT_ID)) return;
			receipt.finish();
			_unlocked = true;
			void persistEntitlement(true);
		});

	await store.initialize([Platform.APPLE_APPSTORE]);
}

// Polls until _unlocked flips true or the timeout elapses.
// Used by purchasePdfUnlock to wait for the approved→verified chain.
function waitForUnlock(timeoutMs = 15000): Promise<boolean> {
	if (_unlocked) return Promise.resolve(true);
	return new Promise((resolve) => {
		const start = Date.now();
		const tick = () => {
			if (_unlocked) return resolve(true);
			if (Date.now() - start > timeoutMs) return resolve(false);
			setTimeout(tick, 250);
		};
		setTimeout(tick, 250);
	});
}

export function isPdfUnlocked(): boolean {
	return _unlocked;
}

// Triggers the StoreKit purchase sheet.
// Returns 'unlocked' when ownership is confirmed, 'cancelled' when the user
// dismissed the sheet, or 'timeout' when the order succeeded but verification
// took longer than 15 s (purchase is still in-flight — not lost).
export async function purchasePdfUnlock(): Promise<'unlocked' | 'cancelled' | 'timeout'> {
	if (!Capacitor.isNativePlatform()) {
		throw new Error('Purchases only work on device');
	}
	const cdv = (window as any).CdvPurchase ?? {};
	const { store, Platform, ErrorCode } = cdv;
	const offer = store?.get(PRODUCT_ID, Platform.APPLE_APPSTORE)?.getOffer();
	if (!offer) throw new Error('Product not available');
	// v13 API: order() RESOLVES with an IError on failure (it does not reject).
	const err = await store.order(offer);
	if (err) {
		// User tapped Cancel in the StoreKit sheet — not an error worth surfacing.
		const cancelled =
			err.code === (ErrorCode?.PAYMENT_CANCELLED ?? 6777006) ||
			(err.message ?? '').toLowerCase().includes('cancel');
		if (cancelled) return 'cancelled';
		throw new Error(err.message ?? 'Purchase failed');
	}
	// Wait for the StoreKit receipt verification chain to flip _unlocked.
	const didUnlock = await waitForUnlock(15000);
	return didUnlock ? 'unlocked' : 'timeout';
}

export function getPdfPrice(): string {
	return _localizedPrice;
}

// Restore prior purchases (called from Settings → "Restore Purchases").
// Returns true if the product was found and owned.
export async function restorePurchases(): Promise<boolean> {
	if (!Capacitor.isNativePlatform()) return _unlocked;
	const { store } = (window as any).CdvPurchase ?? {};
	if (!store) return false;
	// v13 API: resolves with an IError on failure (it does not reject).
	const err = await store.restorePurchases();
	if (err) throw new Error(err.message ?? 'Restore failed');
	// Receipt processing flips _unlocked via the productUpdated listener, which
	// can land a beat after restorePurchases() resolves — give it a short grace.
	if (!_unlocked) await waitForUnlock(2000);
	return _unlocked;
}

// Dev-only — renders a toggle in the report screen during browser development.
export function devSetPdfUnlocked(unlocked: boolean): void {
	_unlocked = unlocked;
	try { localStorage.setItem(DEV_KEY, unlocked ? '1' : '0'); } catch { /* ignore */ }
}
