import { Capacitor, registerPlugin } from '@capacitor/core';

// Ask iOS to show the native "Rate this app" prompt via our thin inline
// ReviewPlugin (ReviewPlugin.swift in the Xcode project).
//
// Rules:
// - Only fires on device (no-op in browser dev)
// - Only fires when the user has just started their SECOND period — they've
//   been through a full cycle, come back, and are clearly getting value.
//   This is a strong satisfaction signal; prompting earlier wastes the one
//   reliable shot we have at a 5-star review.
// - Apple's SKStoreReviewController internally suppresses the prompt if it
//   has already been shown recently (across all apps, 3x/year device-wide),
//   so duplicate calls are safe — Apple silently no-ops them.
// - We additionally guard with a localStorage flag so we never call the
//   plugin more than once per install, independent of Apple's throttle.

interface ReviewPlugin {
	requestReview(): Promise<void>;
}

// registerPlugin lazily binds to the native implementation by jsName.
// The name MUST match jsName in ReviewPlugin.swift ("ReviewPlugin").
const Review = registerPlugin<ReviewPlugin>('ReviewPlugin');

const REVIEW_ASKED_KEY = 'cove.review.asked';

export async function maybeRequestReview(): Promise<void> {
	if (!Capacitor.isNativePlatform()) return;

	try {
		// Belt-and-suspenders: don't call the plugin if we already did.
		if (localStorage.getItem(REVIEW_ASKED_KEY) === '1') return;

		await Review.requestReview();

		// Mark as asked so we never prompt again on this install.
		localStorage.setItem(REVIEW_ASKED_KEY, '1');
	} catch {
		// Best-effort — review prompt is never load-bearing.
	}
}
