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

// Reactive in-memory state — updated by the store listener below.
let _unlocked = false;

// Called once at app startup (from +layout.svelte or init.ts).
// Registers the product, restores any prior purchase, and wires the owned listener.
export async function initBilling(): Promise<void> {
	if (!Capacitor.isNativePlatform()) return;

	// cordova-plugin-purchase is a UMD global on native; import dynamically so
	// the web build never tries to resolve it.
	const { store, ProductType, Platform } = (window as any).CdvPurchase ?? {};
	if (!store) {
		console.warn('[cove] cordova-plugin-purchase not found — billing unavailable');
		return;
	}

	store.register([{
		id: PRODUCT_ID,
		type: ProductType.NON_CONSUMABLE,
		platform: Platform.APPLE_APP_STORE
	}]);

	store.when()
		.productUpdated(() => {
			const product = store.get(PRODUCT_ID, Platform.APPLE_APP_STORE);
			_unlocked = product?.owned ?? false;
		})
		.approved((transaction: any) => transaction.verify())
		.verified((receipt: any) => {
			receipt.finish();
			_unlocked = true;
		});

	await store.initialize([Platform.APPLE_APP_STORE]);
}

export function isPdfUnlocked(): boolean {
	if (Capacitor.isNativePlatform()) return _unlocked;
	// Browser dev fallback.
	try { return localStorage.getItem(DEV_KEY) === '1'; } catch { return false; }
}

// Triggers the StoreKit purchase sheet. Resolves when the transaction settles.
export async function purchasePdfUnlock(): Promise<void> {
	if (!Capacitor.isNativePlatform()) {
		throw new Error('Purchases only work on device');
	}
	const { store, Platform } = (window as any).CdvPurchase ?? {};
	const offer = store?.get(PRODUCT_ID, Platform.APPLE_APP_STORE)?.getOffer();
	if (!offer) throw new Error('Product not available');
	await store.order(offer);
}

// Restore prior purchases (called from Settings → "Restore Purchases").
// Returns true if the product was found and owned.
export async function restorePurchases(): Promise<boolean> {
	if (!Capacitor.isNativePlatform()) return isPdfUnlocked();
	const { store } = (window as any).CdvPurchase ?? {};
	if (!store) return false;
	await store.restorePurchases();
	return _unlocked;
}

// Dev-only — renders a toggle in the report screen during browser development.
export function devSetPdfUnlocked(unlocked: boolean): void {
	try { localStorage.setItem(DEV_KEY, unlocked ? '1' : '0'); } catch { /* ignore */ }
}
