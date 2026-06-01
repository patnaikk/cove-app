import { CYCLE_ENTRIES_TABLE } from './schema';

export interface Migration {
	toVersion: number;
	statements: string[];
}

// Append-only. Never edit a shipped migration — add a new one with a higher
// toVersion. The plugin runs these in order to bring an existing DB up to date.
export const MIGRATIONS: Migration[] = [
	{
		toVersion: 1,
		statements: [
			`CREATE TABLE IF NOT EXISTS ${CYCLE_ENTRIES_TABLE} (
				id TEXT PRIMARY KEY NOT NULL,
				date TEXT NOT NULL,
				flow_intensity TEXT NOT NULL DEFAULT 'none',
				symptoms TEXT NOT NULL DEFAULT '[]',
				mood TEXT NOT NULL DEFAULT '[]',
				weight REAL,
				notes TEXT,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);`,
			`CREATE UNIQUE INDEX IF NOT EXISTS idx_${CYCLE_ENTRIES_TABLE}_date ON ${CYCLE_ENTRIES_TABLE} (date);`
		]
	},
	{
		toVersion: 2,
		statements: [
			`ALTER TABLE ${CYCLE_ENTRIES_TABLE} ADD COLUMN exclude_from_stats INTEGER NOT NULL DEFAULT 0;`
		]
	}
];

export const DB_VERSION = MIGRATIONS[MIGRATIONS.length - 1].toVersion;
