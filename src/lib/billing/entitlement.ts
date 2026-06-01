// The PDF report is the one paid feature ($9.99 one-time). CSV export is free.
//
// NATIVE TODO (see NATIVE_SETUP.md §5): back this with StoreKit 2 via
// `cordova-plugin-purchase` (Fovea) — non-consumable product `app.cove.pdf_report`.
//   isPdfUnlocked()  → reflect the plugin's owned/verified state (restore on launch).
//   replace devSetPdfUnlocked() → store.order(product) + verification.
// Keep this module the ONLY place billing state is read, so the swap stays local.
// For now it reads a dev flag so the gated UI works in the browser.

const KEY = 'vault.dev.pdfUnlocked';

export function isPdfUnlocked(): boolean {
	try {
		return localStorage.getItem(KEY) === '1';
	} catch {
		return false;
	}
}

// Dev-only stand-in for the StoreKit purchase flow.
export function devSetPdfUnlocked(unlocked: boolean): void {
	localStorage.setItem(KEY, unlocked ? '1' : '0');
}

// Restore previous purchases.
// NATIVE TODO: replace body with `store.restorePurchases()` from cordova-plugin-purchase.
// On success the plugin fires the product's 'owned' event → isPdfUnlocked() reflects it.
// Return value: true = at least one purchase restored, false = nothing found.
export async function restorePurchases(): Promise<boolean> {
	// Stub — on device this will call StoreKit restore.
	// In the browser we can't restore anything real; just re-read the dev flag.
	return isPdfUnlocked();
}
