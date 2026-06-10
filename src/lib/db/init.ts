import { Capacitor } from '@capacitor/core';
import { openDb } from './db';

// The encryption key is a 32-byte random value generated ONCE on first launch.
// We call CapacitorSQLite.setEncryptionSecret() which stores it in the iOS Keychain
// (survives reinstalls, excluded from unencrypted iCloud backups). The passphrase is
// also written to @capacitor/preferences as a seed for that first call — note that
// Preferences uses UserDefaults, NOT the Keychain, so it is included in backups.
// After the first launch, setEncryptionSecret throws "already stored in keychain" and
// the plugin's own Keychain entry is used; the Preferences copy becomes irrelevant.
// Practical threat model: the SQLite DB file is encrypted at rest with the Keychain-
// backed key, so offline forensic extraction of the DB file alone is not sufficient.
const KEY_NAME = 'cove.db.key';

async function getOrCreatePassphrase(): Promise<string> {
	const { Preferences } = await import('@capacitor/preferences');

	const { value } = await Preferences.get({ key: KEY_NAME });
	if (value) return value;

	// First launch — generate a cryptographically random 32-byte hex key.
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	const passphrase = Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');

	// Persist BEFORE returning. If this throws (e.g. Keychain locked at boot),
	// we propagate — better to surface "couldn't open" than to silently open a
	// blank DB on the next launch with a freshly-generated, non-matching key.
	await Preferences.set({ key: KEY_NAME, value: passphrase });
	// Verify the write landed — Keychain can accept the call but silently drop it
	// if the device is in a restricted state (e.g. before first unlock after reboot).
	const { value: written } = await Preferences.get({ key: KEY_NAME });
	if (!written) throw new Error('[cove] Passphrase write did not persist — Keychain unavailable');
	return passphrase;
}

let ready: Promise<void> | null = null;

// On device, open the encrypted SQLite database with the Keychain-backed key.
// In the browser, the localStorage dev store needs no initialisation.
export function ensureDb(): Promise<void> {
	if (!ready) {
		const attempt = Capacitor.isNativePlatform()
			? getOrCreatePassphrase()
					.then((passphrase) => openDb({ passphrase }))
					.then(() => undefined as void)
			: Promise.resolve();
		// If initialisation fails, clear the cached promise so the next ensureDb()
		// call retries — otherwise "Try again" buttons are permanently broken.
		ready = attempt.catch((e) => {
			ready = null;
			throw e;
		});
	}
	return ready;
}

// Call this before ensureDb() when you need to force a fresh connection —
// e.g. when iOS resumes the app from the background and the native SQLite
// handle has been dropped. Resets the cached promise so ensureDb() reopens.
export async function resetDb(): Promise<void> {
	try {
		const { closeDb } = await import('./db');
		await closeDb();
	} catch {
		// Ignore — closeDb is already defensive, but belt-and-suspenders here.
	} finally {
		// Always reset ready so the next ensureDb() forces a real re-open.
		ready = null;
	}
}
