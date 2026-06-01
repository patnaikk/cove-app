import type { CycleEntry } from '$lib/db/schema';

function escape(value: string): string {
	if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
	return value;
}

// One row per entry. Spreadsheet-friendly, with no data loss — a complete,
// portable copy of everything logged.
export function buildCsv(entries: CycleEntry[]): string {
	const header = ['date', 'flow', 'symptoms', 'mood', 'weight_kg', 'notes', 'excluded_from_stats'];
	const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
	const rows = sorted.map((e) => {
		const symptoms = e.symptoms.map((s) => `${s.key}:${s.severity}`).join('; ');
		const mood = e.mood.join('; ');
		return [
			e.date,
			e.flow_intensity,
			symptoms,
			mood,
			e.weight != null ? String(e.weight) : '',
			e.notes ?? '',
			e.exclude_from_stats ? 'yes' : ''
		]
			.map(escape)
			.join(',');
	});
	return [header.join(','), ...rows].join('\n');
}
