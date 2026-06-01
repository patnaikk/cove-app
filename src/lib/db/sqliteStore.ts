import { getDb, commit } from './db';
import {
	CYCLE_ENTRIES_TABLE,
	type CycleEntry,
	type CycleEntryRow,
	type FlowIntensity,
	type LoggedSymptom,
	type Mood
} from './schema';
import type { CycleStore } from './store';
import type { CycleEntryInput } from './cycleRepository';

function rowToEntry(row: CycleEntryRow): CycleEntry {
	return {
		id: row.id,
		date: row.date,
		flow_intensity: row.flow_intensity as FlowIntensity,
		symptoms: JSON.parse(row.symptoms) as LoggedSymptom[],
		mood: JSON.parse(row.mood) as Mood[],
		weight: row.weight,
		notes: row.notes,
		exclude_from_stats: row.exclude_from_stats === 1,
		created_at: row.created_at,
		updated_at: row.updated_at
	};
}

export const sqliteStore: CycleStore = {
	async addEntry(input: CycleEntryInput): Promise<CycleEntry> {
		// One logical entry per calendar day. The unique index enforces this, but we
		// check first so callers get a clear error instead of a raw SQLite violation
		// (mirrors localStore so both backends behave identically).
		const existing = await this.getEntryByDate(input.date);
		if (existing) {
			throw new Error(`Entry already exists for date ${input.date}`);
		}
		const now = new Date().toISOString();
		const entry: CycleEntry = {
			id: crypto.randomUUID(),
			date: input.date,
			flow_intensity: input.flow_intensity,
			symptoms: input.symptoms,
			mood: input.mood,
			weight: input.weight ?? null,
			notes: input.notes ?? null,
			exclude_from_stats: input.exclude_from_stats ?? false,
			created_at: now,
			updated_at: now
		};
		await getDb().run(
			`INSERT INTO ${CYCLE_ENTRIES_TABLE}
				(id, date, flow_intensity, symptoms, mood, weight, notes, exclude_from_stats, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
			[
				entry.id,
				entry.date,
				entry.flow_intensity,
				JSON.stringify(entry.symptoms),
				JSON.stringify(entry.mood),
				entry.weight,
				entry.notes,
				entry.exclude_from_stats ? 1 : 0,
				entry.created_at,
				entry.updated_at
			]
		);
		await commit();
		return entry;
	},

	async updateEntry(id: string, patch: Partial<CycleEntryInput>): Promise<void> {
		const fields: string[] = [];
		const values: unknown[] = [];
		if (patch.date !== undefined) {
			fields.push('date = ?');
			values.push(patch.date);
		}
		if (patch.flow_intensity !== undefined) {
			fields.push('flow_intensity = ?');
			values.push(patch.flow_intensity);
		}
		if (patch.symptoms !== undefined) {
			fields.push('symptoms = ?');
			values.push(JSON.stringify(patch.symptoms));
		}
		if (patch.mood !== undefined) {
			fields.push('mood = ?');
			values.push(JSON.stringify(patch.mood));
		}
		if (patch.weight !== undefined) {
			fields.push('weight = ?');
			values.push(patch.weight);
		}
		if (patch.notes !== undefined) {
			fields.push('notes = ?');
			values.push(patch.notes);
		}
		if (patch.exclude_from_stats !== undefined) {
			fields.push('exclude_from_stats = ?');
			values.push(patch.exclude_from_stats ? 1 : 0);
		}
		if (fields.length === 0) return;
		fields.push('updated_at = ?');
		values.push(new Date().toISOString());
		values.push(id);
		await getDb().run(
			`UPDATE ${CYCLE_ENTRIES_TABLE} SET ${fields.join(', ')} WHERE id = ?;`,
			values
		);
		await commit();
	},

	async deleteEntry(id: string): Promise<void> {
		await getDb().run(`DELETE FROM ${CYCLE_ENTRIES_TABLE} WHERE id = ?;`, [id]);
		await commit();
	},

	async deleteAllEntries(): Promise<void> {
		await getDb().run(`DELETE FROM ${CYCLE_ENTRIES_TABLE};`);
		await commit();
	},

	async getEntryById(id: string): Promise<CycleEntry | null> {
		const res = await getDb().query(
			`SELECT * FROM ${CYCLE_ENTRIES_TABLE} WHERE id = ?;`,
			[id]
		);
		const rows = (res.values ?? []) as CycleEntryRow[];
		return rows.length ? rowToEntry(rows[0]) : null;
	},

	async getEntryByDate(date: string): Promise<CycleEntry | null> {
		const res = await getDb().query(
			`SELECT * FROM ${CYCLE_ENTRIES_TABLE} WHERE date = ?;`,
			[date]
		);
		const rows = (res.values ?? []) as CycleEntryRow[];
		return rows.length ? rowToEntry(rows[0]) : null;
	},

	async getAllEntries(): Promise<CycleEntry[]> {
		const res = await getDb().query(
			`SELECT * FROM ${CYCLE_ENTRIES_TABLE} ORDER BY date DESC;`
		);
		return ((res.values ?? []) as CycleEntryRow[]).map(rowToEntry);
	},

	async getEntriesInRange(startDate: string, endDate: string): Promise<CycleEntry[]> {
		const res = await getDb().query(
			`SELECT * FROM ${CYCLE_ENTRIES_TABLE}
			 WHERE date >= ? AND date <= ?
			 ORDER BY date ASC;`,
			[startDate, endDate]
		);
		return ((res.values ?? []) as CycleEntryRow[]).map(rowToEntry);
	}
};
