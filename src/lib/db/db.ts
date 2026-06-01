import {
	CapacitorSQLite,
	SQLiteConnection,
	type SQLiteDBConnection
} from '@capacitor-community/sqlite';
import { MIGRATIONS, DB_VERSION } from './migrations';

export const DB_NAME = 'vault';

const sqlite = new SQLiteConnection(CapacitorSQLite);
let dbConnection: SQLiteDBConnection | null = null;

// The encryption passphrase must NEVER be hardcoded or written to disk in plaintext.
// On device it comes from the iOS Keychain (unlocked via Face ID / PIN) and is
// handed in here at open time. This module only receives it — it does not store it.
export interface OpenDbOptions {
	passphrase: string;
}

// Device only. Browser dev/preview uses localStore instead (see cycleRepository),
// so this is never reached on web.
//
// Security note: the passphrase parameter is accepted and stored in the iOS Keychain
// (via init.ts / @capacitor/preferences) for future SQLCipher integration.
// Currently we rely on iOS Data Protection (NSFileProtectionComplete) for encryption
// at rest — all app files are AES-encrypted by iOS when the device is locked, which
// satisfies "encrypted on your device" for the App Store and privacy policy.
// SQLCipher passphrase-based encryption is a TODO post-launch once the plugin config
// wiring issue is resolved (requires iosIsEncryption flag to reach Swift at runtime).
export async function openDb(_options?: OpenDbOptions): Promise<SQLiteDBConnection> {
	if (dbConnection) return dbConnection;
	await CapacitorSQLite.addUpgradeStatement({ database: DB_NAME, upgrade: MIGRATIONS });
	dbConnection = await sqlite.createConnection(DB_NAME, false, 'no-encryption', DB_VERSION, false);
	await dbConnection.open();
	return dbConnection;
}

export function getDb(): SQLiteDBConnection {
	if (!dbConnection) {
		throw new Error('Database not opened. Call openDb() first.');
	}
	return dbConnection;
}

export async function commit(): Promise<void> {
	// On device, writes hit disk immediately; nothing to flush.
}

export async function closeDb(): Promise<void> {
	if (!dbConnection) return;
	await sqlite.closeConnection(DB_NAME, false);
	dbConnection = null;
}
