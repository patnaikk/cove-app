import { Capacitor } from '@capacitor/core';

// Ask iOS to show the native "Rate this app" prompt.
//
// Rules:
// - Only fires on device (no-op in browser dev)
// - Only fires when the user has just started their SECOND period — they've
//   been through a full cycle, came back, and are clearly getting value.
//   This is a strong satisfaction signal; prompting earlier wastes the one
//   reliable shot we have at a 5-star review.
// - Apple's SKStoreReviewController internally suppresses the prompt if it
//   has already been shown recently (across all apps, 3x/year device-wide),
//   so duplicate calls are safe — Apple silently no-ops them.
// - We additionally guard with a localStorage flag so we never call the
//   plugin more than once per install, independent of Apple's throttle.

const REVIEW_ASKED_KEY = 'cove.review.asked';

export async function maybeRequestReview(): Promise<void> {
	if (!Capacitor.isNativePlatform()) return;

	try {
		// Belt-and-suspenders: don't call the plugin if we already did.
		if (localStorage.getItem(REVIEW_ASKED_KEY) === '1') return;

		const { RateApp } = await import('capacitor-rate-app');
		await RateApp.requestReview();

		// Mark as asked so we never prompt again on this install.
		localStorage.setItem(REVIEW_ASKED_KEY, '1');
	} catch {
		// Best-effort — review prompt is never load-bearing.
	}
}
