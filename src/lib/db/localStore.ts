import type { CycleEntry } from './schema';
import type { CycleStore } from './store';
import type { CycleEntryInput } from './cycleRepository';

// Browser dev/preview only. NOT used on device — the device uses the encrypted
// SQLite path (see sqliteStore). Persisted to localStorage so dev data survives
// reloads. This intentionally never touches the network.
const KEY = 'vault.dev.entries';

function readAll(): CycleEntry[] {
	try {
		const raw = localStorage.getItem(KEY);
		return raw ? (JSON.parse(raw) as CycleEntry[]) : [];
	} catch {
		return [];
	}
}

function writeAll(entries: CycleEntry[]): void {
	localStorage.setItem(KEY, JSON.stringify(entries));
}

export const localStore: CycleStore = {
	async addEntry(input: CycleEntryInput): Promise<CycleEntry> {
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
		const all = readAll();
		if (all.some((e) => e.date === entry.date)) {
			throw new Error(`Entry already exists for date ${entry.date}`);
		}
		all.push(entry);
		writeAll(all);
		return entry;
	},

	async updateEntry(id: string, patch: Partial<CycleEntryInput>): Promise<void> {
		const all = readAll();
		const i = all.findIndex((e) => e.id === id);
		if (i === -1) return;
		all[i] = {
			...all[i],
			...(patch.date !== undefined && { date: patch.date }),
			...(patch.flow_intensity !== undefined && { flow_intensity: patch.flow_intensity }),
			...(patch.symptoms !== undefined && { symptoms: patch.symptoms }),
			...(patch.mood !== undefined && { mood: patch.mood }),
			...(patch.weight !== undefined && { weight: patch.weight ?? null }),
			...(patch.notes !== undefined && { notes: patch.notes ?? null }),
			...(patch.exclude_from_stats !== undefined && {
				exclude_from_stats: patch.exclude_from_stats
			}),
			updated_at: new Date().toISOString()
		};
		writeAll(all);
	},

	async deleteEntry(id: string): Promise<void> {
		writeAll(readAll().filter((e) => e.id !== id));
	},

	async deleteAllEntries(): Promise<void> {
		writeAll([]);
	},

	async getEntryById(id: string): Promise<CycleEntry | null> {
		return readAll().find((e) => e.id === id) ?? null;
	},

	async getEntryByDate(date: string): Promise<CycleEntry | null> {
		return readAll().find((e) => e.date === date) ?? null;
	},

	async getAllEntries(): Promise<CycleEntry[]> {
		return readAll().sort((a, b) => b.date.localeCompare(a.date));
	},

	async getEntriesInRange(startDate: string, endDate: string): Promise<CycleEntry[]> {
		return readAll()
			.filter((e) => e.date >= startDate && e.date <= endDate)
			.sort((a, b) => a.date.localeCompare(b.date));
	}
};
