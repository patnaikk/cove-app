import { Capacitor } from '@capacitor/core';
import type { CycleEntry, FlowIntensity, LoggedSymptom, Mood } from './schema';
import type { CycleStore } from './store';
import { sqliteStore } from './sqliteStore';
import { localStore } from './localStore';

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

export function addEntry(input: CycleEntryInput): Promise<CycleEntry> {
	return store.addEntry(input);
}
export function updateEntry(id: string, patch: Partial<CycleEntryInput>): Promise<void> {
	return store.updateEntry(id, patch);
}
export function deleteEntry(id: string): Promise<void> {
	return store.deleteEntry(id);
}
export function deleteAllEntries(): Promise<void> {
	return store.deleteAllEntries();
}
export function getEntryById(id: string): Promise<CycleEntry | null> {
	return store.getEntryById(id);
}
export function getEntryByDate(date: string): Promise<CycleEntry | null> {
	return store.getEntryByDate(date);
}
export function getAllEntries(): Promise<CycleEntry[]> {
	return store.getAllEntries();
}
export function getEntriesInRange(startDate: string, endDate: string): Promise<CycleEntry[]> {
	return store.getEntriesInRange(startDate, endDate);
}
