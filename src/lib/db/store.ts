import type { CycleEntry } from './schema';
import type { CycleEntryInput } from './cycleRepository';

// The storage contract the UI depends on. Two implementations back it:
//   - sqliteStore  → real encrypted SQLite on device (the privacy-critical path)
//   - localStore   → localStorage, used only for browser dev/preview
export interface CycleStore {
	addEntry(input: CycleEntryInput): Promise<CycleEntry>;
	updateEntry(id: string, patch: Partial<CycleEntryInput>): Promise<void>;
	deleteEntry(id: string): Promise<void>;
	deleteAllEntries(): Promise<void>;
	getEntryById(id: string): Promise<CycleEntry | null>;
	getEntryByDate(date: string): Promise<CycleEntry | null>;
	getAllEntries(): Promise<CycleEntry[]>;
	getEntriesInRange(startDate: string, endDate: string): Promise<CycleEntry[]>;
}
