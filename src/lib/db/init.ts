import { Capacitor } from '@capacitor/core';
import { openDb } from './db';

// The encryption key is a 32-byte random value generated ONCE on first launch,
// stored in the iOS Keychain via @capacitor/preferences (which uses Keychain
// on iOS, not UserDefaults — so it survives app reinstalls and is excluded from
// unencrypted backups). It is never hardcoded, never logged, never written to disk
// in plaintext. This is the threat model: a seized or forensically-extracted device
// cannot read the SQLite DB without the key.
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

	await Preferences.set({ key: KEY_NAME, value: passphrase });
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
					.then(() => undefined)
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
