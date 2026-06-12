import { Capacitor } from '@capacitor/core';
import type { CycleEntry, FlowIntensity, LoggedSymptom, Mood } from './schema';
import type { CycleStore } from './store';
import { sqliteStore } from './sqliteStore';
import { localStore } from './localStore';
import { ensureDb } from './init';

export interface CycleEntryInput {
	date: string;
	flow_intensity: FlowIntensity;
	symptoms: LoggedSymptom[];
	mood: Mood[];
	weight?: number | null;
	notes?: string | null;
	exclude_from_stats?: boolean;
}

// Device → encrypted SQLite. Browser dev → localStorage. Same contract either way.
const store: CycleStore = Capacitor.isNativePlatform() ? sqliteStore : localStore;

// Each function ensures the DB is open before delegating — guards against the
// resume-reconnect window where resetDb() has nulled the handle but the next
// ensureDb() hasn't fired yet, causing getDb() to throw "not opened".
export async function addEntry(input: CycleEntryInput): Promise<CycleEntry> {
	await ensureDb();
	return store.addEntry(input);
}
export async function updateEntry(id: string, patch: Partial<CycleEntryInput>): Promise<void> {
	await ensureDb();
	return store.updateEntry(id, patch);
}
export async function deleteEntry(id: string): Promise<void> {
	await ensureDb();
	return store.deleteEntry(id);
}
export async function deleteAllEntries(): Promise<void> {
	await ensureDb();
	return store.deleteAllEntries();
}
export async function getEntryById(id: string): Promise<CycleEntry | null> {
	await ensureDb();
	return store.getEntryById(id);
}
export async function getEntryByDate(date: string): Promise<CycleEntry | null> {
	await ensureDb();
	return store.getEntryByDate(date);
}
export async function getAllEntries(): Promise<CycleEntry[]> {
	await ensureDb();
	return store.getAllEntries();
}
export async function getEntriesInRange(startDate: string, endDate: string): Promise<CycleEntry[]> {
	await ensureDb();
	return store.getEntriesInRange(startDate, endDate);
}
