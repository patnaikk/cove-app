import { Capacitor } from '@capacitor/core';

// User display preferences. NOT health data — a non-sensitive UI choice — so it
// lives in localStorage (works in the device webview too) rather than the
// encrypted DB. Weight is always STORED in kilograms; this only controls display
// and input, so switching units never rewrites or loses logged data.

export const WEIGHT_UNITS = ['kg', 'lb'] as const;
export type WeightUnit = (typeof WEIGHT_UNITS)[number];

const KEY = 'vault.pref.weightUnit';
const LB_PER_KG = 2.2046226218;

function loadUnit(): WeightUnit {
	try {
		const v = localStorage.getItem(KEY);
		return v === 'lb' ? 'lb' : 'kg';
	} catch {
		return 'kg';
	}
}

let weightUnit = $state<WeightUnit>(loadUnit());

// Read via a function so cross-module reactivity works in Svelte 5.
export function getWeightUnit(): WeightUnit {
	return weightUnit;
}

export function setWeightUnit(unit: WeightUnit): void {
	weightUnit = unit;
	try {
		localStorage.setItem(KEY, unit);
	} catch {
		// ignore — preference is best-effort
	}
}

// Canonical kg → number shown in the active unit, rounded to one decimal.
export function kgToDisplay(kg: number, unit: WeightUnit = weightUnit): number {
	const v = unit === 'lb' ? kg * LB_PER_KG : kg;
	return Math.round(v * 10) / 10;
}

// A value the user typed in the active unit → canonical kg for storage.
export function displayToKg(value: number, unit: WeightUnit = weightUnit): number {
	const kg = unit === 'lb' ? value / LB_PER_KG : value;
	return Math.round(kg * 100) / 100;
}

// Appearance: follow the system, or force light/dark. Applied by setting
// data-theme on <html> (see applyTheme), which flips the token set in app.css.
export const APPEARANCES = ['system', 'light', 'dark'] as const;
export type Appearance = (typeof APPEARANCES)[number];

const APPEARANCE_KEY = 'vault.pref.appearance';

function loadAppearance(): Appearance {
	try {
		const v = localStorage.getItem(APPEARANCE_KEY);
		return v === 'light' || v === 'dark' ? v : 'system';
	} catch {
		return 'system';
	}
}

let appearance = $state<Appearance>(loadAppearance());

export function getAppearance(): Appearance {
	return appearance;
}

export function setAppearance(value: Appearance): void {
	appearance = value;
	try {
		localStorage.setItem(APPEARANCE_KEY, value);
	} catch {
		// best-effort
	}
	applyTheme();
}

// Resolve the preference against the OS setting and write it to the DOM.
export function applyTheme(): void {
	if (typeof document === 'undefined') return;
	const prefersDark =
		typeof window !== 'undefined' &&
		window.matchMedia?.('(prefers-color-scheme: dark)').matches;
	const dark = appearance === 'dark' || (appearance === 'system' && prefersDark);
	document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
	const meta = document.querySelector('meta[name="theme-color"]');
	if (meta) meta.setAttribute('content', dark ? '#16181a' : '#f4f1ec');
}

// Optional daily reminder. Entirely on-device via local notifications — no server,
// no push tokens. The notification text is deliberately discreet (no mention of
// periods/health) so nothing sensitive shows on a lock screen.
const REMINDER_ON_KEY = 'vault.pref.reminderEnabled';
const REMINDER_TIME_KEY = 'vault.pref.reminderTime';
const REMINDER_ID = 1;

let reminderEnabled = $state<boolean>(
	(() => {
		try {
			return localStorage.getItem(REMINDER_ON_KEY) === '1';
		} catch {
			return false;
		}
	})()
);
let reminderTime = $state<string>(
	(() => {
		try {
			return localStorage.getItem(REMINDER_TIME_KEY) || '20:00';
		} catch {
			return '20:00';
		}
	})()
);

export function getReminderEnabled(): boolean {
	return reminderEnabled;
}
export function getReminderTime(): string {
	return reminderTime;
}

export async function setReminderEnabled(on: boolean): Promise<void> {
	reminderEnabled = on;
	try {
		localStorage.setItem(REMINDER_ON_KEY, on ? '1' : '0');
	} catch {
		/* best-effort */
	}
	await applyReminder();
}

export async function setReminderTime(time: string): Promise<void> {
	reminderTime = time;
	try {
		localStorage.setItem(REMINDER_TIME_KEY, time);
	} catch {
		/* best-effort */
	}
	if (reminderEnabled) await applyReminder();
}

// Reconcile the OS schedule with the current preference. No-op in the browser.
export async function applyReminder(): Promise<void> {
	if (!Capacitor.isNativePlatform()) return;
	try {
		const { LocalNotifications } = await import('@capacitor/local-notifications');
		await LocalNotifications.cancel({ notifications: [{ id: REMINDER_ID }] });
		if (!reminderEnabled) return;

		const perm = await LocalNotifications.requestPermissions();
		if (perm.display !== 'granted') {
			// Permission refused — reflect reality back in the toggle.
			reminderEnabled = false;
			try {
				localStorage.setItem(REMINDER_ON_KEY, '0');
			} catch {
				/* ignore */
			}
			return;
		}

		const [hour, minute] = reminderTime.split(':').map(Number);
		await LocalNotifications.schedule({
			notifications: [
				{
					id: REMINDER_ID,
					title: 'Cove',
					body: 'Time for your daily check-in.',
					schedule: { on: { hour, minute }, repeats: true, allowWhileIdle: true }
				}
			]
		});
	} catch (e) {
		console.error('[vault] reminder scheduling failed:', e);
	}
}

// First-run flag. Drives the one-time privacy/welcome flow. Not health data.
const ONBOARDED_KEY = 'vault.pref.onboarded';

export function hasOnboarded(): boolean {
	try {
		return localStorage.getItem(ONBOARDED_KEY) === '1';
	} catch {
		return true; // never trap the user out of the app if storage is unavailable
	}
}

export function setOnboarded(): void {
	try {
		localStorage.setItem(ONBOARDED_KEY, '1');
	} catch {
		// best-effort
	}
}

// Backup nudge: shown once after ≥30 logged days, dismissed permanently.
const BACKUP_DISMISSED_KEY = 'vault.pref.backupNudgeDismissed';

export function isBackupNudgeDismissed(): boolean {
	try {
		return localStorage.getItem(BACKUP_DISMISSED_KEY) === '1';
	} catch {
		return true; // if storage is broken, stay out of the user's way
	}
}

export function dismissBackupNudge(): void {
	try {
		localStorage.setItem(BACKUP_DISMISSED_KEY, '1');
	} catch {
		// best-effort
	}
}
