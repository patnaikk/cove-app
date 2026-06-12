import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite } from '@capacitor-community/sqlite';
import { openDb } from './db';

// The database is encrypted with SQLCipher (AES-256). The key is a 32-byte
// (256-bit) cryptographically-random value generated ONCE, on first launch, and
// registered with the SQLite plugin via setEncryptionSecret — which stores it in
// the iOS Keychain, Apple's hardware-protected store for passwords and keys.
//
// The key lives ONLY in the Keychain. It is never written to disk in plaintext,
// never sent off the device, and we (the developers) have no copy and no way to
// read it. Offline extraction of the database file alone cannot decrypt it.
//
// Earlier builds also seeded the key into @capacitor/preferences — which uses
// UserDefaults, NOT the Keychain, and so could ride along in an unencrypted device
// backup. We no longer write it there, and we purge any leftover copy on launch
// (see ensureEncryptionSecret) so no key material survives outside the Keychain.
const LEGACY_KEY_NAME = 'cove.db.key';

async function ensureEncryptionSecret(): Promise<void> {
	const stored = (await CapacitorSQLite.isSecretStored()).result;
	if (!stored) {
		// First launch — generate a 256-bit random key and register it in the Keychain.
		const bytes = crypto.getRandomValues(new Uint8Array(32));
		const passphrase = Array.from(bytes)
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');
		try {
			await CapacitorSQLite.setEncryptionSecret({ passphrase });
		} catch (e: any) {
			// Edge: the secret was registered between the check above and this call.
			// The Keychain copy is authoritative, so a redundant call that throws
			// "already stored in keychain" is fine to swallow.
			if (!String(e?.message ?? e?.errorMessage ?? '').includes('already stored in keychain')) {
				throw e;
			}
		}
	}

	// Best-effort hygiene: delete the legacy plaintext key seed from Preferences
	// (UserDefaults) so it can no longer appear in a device backup. Safe to run every
	// launch — a missing key is a no-op, and the Keychain copy is what actually matters.
	try {
		const { Preferences } = await import('@capacitor/preferences');
		await Preferences.remove({ key: LEGACY_KEY_NAME });
	} catch {
		// Non-fatal: this is cleanup, not part of opening the database.
	}
}

let ready: Promise<void> | null = null;

// On device, register the Keychain-backed key (first launch only) and open the
// encrypted SQLite database. In the browser, the localStorage dev store needs no
// initialisation.
export function ensureDb(): Promise<void> {
	if (!ready) {
		const attempt = Capacitor.isNativePlatform()
			? ensureEncryptionSecret()
					.then(() => openDb())
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
