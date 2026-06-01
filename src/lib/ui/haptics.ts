import { Capacitor } from '@capacitor/core';

// Native-feeling tactile feedback. On device this routes to the iOS Taptic
// Engine via @capacitor/haptics; in the browser it falls back to the Web
// Vibration API (a no-op on desktop Safari). All calls are fire-and-forget and
// never throw, so UI handlers can call them freely.
//
// HIG: "Use haptics to complement other feedback" — selection + success only,
// never gratuitously.

async function impact(style: 'light' | 'medium', vibeMs: number): Promise<void> {
	try {
		if (Capacitor.isNativePlatform()) {
			// @vite-ignore so the web build never tries to resolve the native plugin.
			const mod = await import('@capacitor/haptics');
			await mod.Haptics.impact({ style: style === 'light' ? mod.ImpactStyle.Light : mod.ImpactStyle.Medium });
		} else if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
			navigator.vibrate(vibeMs);
		}
	} catch {
		// best-effort; feedback is never load-bearing
	}
}

/** A light tick — for selecting a chip, flow level, or stepping the date. */
export function selectionTick(): void {
	void impact('light', 8);
}

/** A firmer confirmation — for saving an entry. */
export function successTick(): void {
	(async () => {
		try {
			if (Capacitor.isNativePlatform()) {
				const mod = await import('@capacitor/haptics');
				await mod.Haptics.notification({ type: mod.NotificationType.Success });
			} else if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
				navigator.vibrate([12, 40, 12]);
			}
		} catch {
			/* best-effort */
		}
	})();
}
