// Turn schema keys like "breast_tenderness" into "Breast tenderness".
export function humanize(key: string): string {
	const s = key.replace(/_/g, ' ');
	return s.charAt(0).toUpperCase() + s.slice(1);
}

const DAY = 86_400_000;

export function todayISO(): string {
	const d = new Date();
	return toISODate(d);
}

export function toISODate(d: Date): string {
	// Local calendar date, not UTC — avoids off-by-one near midnight.
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

export function shiftISO(iso: string, days: number): string {
	// Calendar-based shift (setDate) — DST-safe. Millisecond math (+days*DAY)
	// is off-by-one on the 23h/25h DST transition days.
	const d = new Date(iso + 'T00:00:00');
	d.setDate(d.getDate() + days);
	return toISODate(d);
}

// Whole days from a → b (b - a). Negative if b precedes a.
export function daysBetween(a: string, b: string): number {
	const da = new Date(a + 'T00:00:00').getTime();
	const db = new Date(b + 'T00:00:00').getTime();
	return Math.round((db - da) / DAY);
}

// First day (Monday) of the week-grid for a given month, as ISO.
// A month grid is 6 rows × 7 cols starting on the Monday on/before the 1st.
export function monthGridStart(year: number, month: number): string {
	const first = new Date(year, month, 1);
	const dow = (first.getDay() + 6) % 7; // 0 = Monday
	return toISODate(new Date(year, month, 1 - dow));
}

// 42 ISO dates covering the 6-week grid for the given month.
export function monthGridDates(year: number, month: number): string[] {
	const start = monthGridStart(year, month);
	return Array.from({ length: 42 }, (_, i) => shiftISO(start, i));
}

// "May 2026"
export function monthLabel(year: number, month: number): string {
	return new Date(year, month, 1).toLocaleDateString(undefined, {
		month: 'long',
		year: 'numeric'
	});
}

export function isoMonth(iso: string): number {
	return Number(iso.slice(5, 7)) - 1;
}
export function isoDay(iso: string): number {
	return Number(iso.slice(8, 10));
}

// "26 May 2026" — for the report headline and document range.
export function mediumDate(iso: string): string {
	const d = new Date(iso + 'T00:00:00');
	return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

// "26 May" — compact, for dense tables.
export function shortDate(iso: string): string {
	const d = new Date(iso + 'T00:00:00');
	return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

// "Thursday, 28 May 2026" — full context for the log subtitle.
export function longDate(iso: string): string {
	const d = new Date(iso + 'T00:00:00');
	return d.toLocaleDateString(undefined, {
		weekday: 'long',
		day: 'numeric',
		month: 'long',
		year: 'numeric'
	});
}

// "Today", "Yesterday", or "Wed, 28 May".
export function friendlyDate(iso: string): string {
	const today = todayISO();
	if (iso === today) return 'Today';
	if (iso === shiftISO(today, -1)) return 'Yesterday';
	const d = new Date(iso + 'T00:00:00');
	return d.toLocaleDateString(undefined, {
		weekday: 'short',
		day: 'numeric',
		month: 'long'
	});
}
