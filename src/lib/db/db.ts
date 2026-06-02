import {
	CapacitorSQLite,
	SQLiteConnection,
	type SQLiteDBConnection
} from '@capacitor-community/sqlite';
import { MIGRATIONS, DB_VERSION } from './migrations';

export const DB_NAME = 'vault';

const sqlite = new SQLiteConnection(CapacitorSQLite);
let dbConnection: SQLiteDBConnection | null = null;
// Guards against two concurrent openDb() calls (e.g. initial page load racing
// the app-resume listener) both trying to createConnection with the same name.
let opening: Promise<SQLiteDBConnection> | null = null;

// The encryption passphrase must NEVER be hardcoded or written to disk in plaintext.
// On device it comes from the iOS Keychain (unlocked via Face ID / PIN) and is
// handed in here at open time. This module only receives it — it does not store it.
export interface OpenDbOptions {
	passphrase: string;
}

// Device only. Browser dev/preview uses localStore instead (see cycleRepository),
// so this is never reached on web.
//
// SQLCipher: the Keychain-backed passphrase is registered via setEncryptionSecret
// before createConnection so the plugin passes it to SQLCipher at open time.
// capacitor.config.ts must have iosIsEncryption: true for the Swift layer to
// accept the secret — without it the plugin ignores the passphrase entirely.
export async function openDb(options: OpenDbOptions): Promise<SQLiteDBConnection> {
	if (dbConnection) return dbConnection;
	// If an open is already in flight, await it instead of starting a second one.
	if (opening) return opening;

	opening = (async () => {
		try {
			await CapacitorSQLite.setEncryptionSecret({ passphrase: options.passphrase });
		} catch (e: any) {
			// On every launch after the first, the passphrase is already stored in the
			// keychain — the plugin throws rather than silently succeeding. That's fine;
			// the key is already registered and SQLCipher will use it.
			if (!String(e?.message ?? e?.errorMessage ?? '').includes('already stored in keychain')) {
				throw e;
			}
		}
		await CapacitorSQLite.addUpgradeStatement({ database: DB_NAME, upgrade: MIGRATIONS });

		// The plugin keeps a native connection registry that can outlive this JS
		// module (e.g. across a webview reload while the app process survives). If a
		// connection for DB_NAME already exists, reuse it rather than throwing
		// "Connection already exists".
		const isConn = (await sqlite.isConnection(DB_NAME, false)).result;
		const conn = isConn
			? await sqlite.retrieveConnection(DB_NAME, false)
			: await sqlite.createConnection(DB_NAME, true, 'secret', DB_VERSION, false);

		// open() is idempotent-safe to call; guard in case it's already open.
		if (!(await conn.isDBOpen()).result) {
			await conn.open();
		}
		dbConnection = conn;
		return conn;
	})();

	try {
		return await opening;
	} finally {
		opening = null;
	}
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
	try {
		// Close via the native registry rather than the cached handle — the handle
		// may be null while a stale native connection still lingers (after a
		// suspend/resume). isConnection avoids throwing if nothing is registered.
		if ((await sqlite.isConnection(DB_NAME, false)).result) {
			await sqlite.closeConnection(DB_NAME, false);
		}
	} catch {
		// A stale/suspended connection may throw on close — that's fine.
		// We always null the handle so the next openDb() starts fresh.
	}
	dbConnection = null;
}
