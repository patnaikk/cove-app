import {
	SYMPTOM_GROUPS,
	type CycleEntry,
	type Symptom,
	type Severity
} from '$lib/db/schema';
import { daysBetween, shiftISO, humanize } from '$lib/ui/format';

// A period is one bleeding run. Real bleeding — especially in irregular or long
// cycles — often pauses for a day or two and then resumes. We treat a gap of up
// to 2 missed days (≤ 3 calendar days between the last bleeding day and the next)
// as the SAME period, not a new one. Without this, stop-start bleeding fabricates
// a spurious short "cycle", a false "shortest cycle under 21" flag, and wrongly
// forces regularity to "irregular". No real cycle is < 21 days, so merging close
// runs can never swallow a genuine new period. All three walk-back sites
// (detectEpisodes, cycleStatusFor, the report's range filter) use this value so
// they always agree on where a period starts.
export const PERIOD_MERGE_GAP_DAYS = 3;

export interface PeriodEpisode {
	start: string;
	end: string;
	length: number; // bleeding days, inclusive
	heavyDays: number;
	excluded: boolean; // user marked this cycle out of length statistics
}

// One observed cycle: a period start and the gap to the next period start.
export interface CycleRecord {
	start: string;
	periodLength: number;
	heavyDays: number; // heavy-flow days within this period (HMB assessment)
	cycleLength: number | null; // null for the most recent (open) cycle
	excluded: boolean; // kept in the log, omitted from length stats/regularity
}

export interface SymptomStat {
	key: Symptom;
	days: number;
	peakSeverity: Severity;
	typicalSeverity: Severity; // median logged severity — "usually how bad", vs the peak
	onBleedingDays: number; // how many of those days fell during a period
}

export interface SymptomGroupStat {
	label: string;
	stats: SymptomStat[];
}

export type Regularity = 'regular' | 'irregular' | 'insufficient';

// A clinician-facing observation. `urgent` flags concern things a person may
// medically need to know now (e.g. a 90+ day absent period) — those stay FREE.
// The rest are part of the paid detailed analysis.
export interface ReportFlag {
	text: string;
	urgent: boolean;
}

export interface ReportSummary {
	entryCount: number;
	rangeStart: string | null;
	rangeEnd: string | null;

	lastPeriodStart: string | null;
	daysSinceLastPeriod: number | null;

	episodes: PeriodEpisode[];
	cycles: CycleRecord[];

	cycleLengthMin: number | null;
	cycleLengthMax: number | null;
	cycleLengthMedian: number | null;
	regularity: Regularity;
	flags: ReportFlag[]; // clinician-facing notes (long/short/irregular/heavy/…)

	periodLengthMin: number | null;
	periodLengthMax: number | null;
	periodLengthMedian: number | null;

	bleedingDays: number;
	heavyDays: number;

	symptomGroups: SymptomGroupStat[];
	moodCounts: { mood: string; days: number }[];
	weight: { min: number; max: number; latest: number } | null;
}

// Reflection, NOT prediction: describe where a given day sits relative to the
// user's own logged bleeding — nothing about the future.
export type CycleStatus =
	| { kind: 'period'; day: number } // currently bleeding: day N of this run
	| { kind: 'between'; daysSince: number } // N days since the last period started
	| { kind: 'none' }; // no bleeding ever logged on/before this day

export function cycleStatusFor(entries: CycleEntry[], dateISO: string): CycleStatus {
	const bleeding = new Set(
		entries.filter((e) => e.flow_intensity !== 'none').map((e) => e.date)
	);
	// Walk back to the episode start, hopping over short gaps the same way
	// detectEpisodes does (up to PERIOD_MERGE_GAP_DAYS calendar days apart merges
	// runs separated by one or two missed days). Nearest bleeding day first.
	const episodeStart = (day: string): string => {
		let start = day;
		outer: for (;;) {
			for (let gap = 1; gap <= PERIOD_MERGE_GAP_DAYS; gap++) {
				if (bleeding.has(shiftISO(start, -gap))) {
					start = shiftISO(start, -gap);
					continue outer;
				}
			}
			break;
		}
		return start;
	};

	if (bleeding.has(dateISO)) {
		return { kind: 'period', day: daysBetween(episodeStart(dateISO), dateISO) + 1 };
	}

	const prior = [...bleeding].filter((d) => d <= dateISO).sort();
	const lastBleed = prior[prior.length - 1];
	if (!lastBleed) return { kind: 'none' };
	return { kind: 'between', daysSince: daysBetween(episodeStart(lastBleed), dateISO) };
}

function median(nums: number[]): number | null {
	if (nums.length === 0) return null;
	const s = [...nums].sort((a, b) => a - b);
	const mid = Math.floor(s.length / 2);
	return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

// Exported for the review-prompt trigger in the Today screen.
export function detectEpisodesPublic(entries: CycleEntry[]): PeriodEpisode[] {
	return detectEpisodes([...entries].sort((a, b) => a.date.localeCompare(b.date)));
}

function detectEpisodes(sorted: CycleEntry[]): PeriodEpisode[] {
	const bleeding = sorted.filter((e) => e.flow_intensity !== 'none');
	const episodes: PeriodEpisode[] = [];
	for (const e of bleeding) {
		const isHeavy = e.flow_intensity === 'heavy';
		const last = episodes[episodes.length - 1];
		// Merge consecutive bleeding days, hopping over up to 2 missed days.
		// No length cap — a 15-day bleed is one episode, not two. A cap here
		// fabricates a ~14-day "cycle" from a single long bleed and triggers
		// false "shortest cycle under 21" flags. The existing >7-day period flag
		// surfaces unusually long bleeds without splitting them.
		if (last && daysBetween(last.end, e.date) <= PERIOD_MERGE_GAP_DAYS) {
			last.end = e.date;
			last.length = daysBetween(last.start, e.date) + 1;
			if (isHeavy) last.heavyDays += 1;
		} else {
			episodes.push({
				start: e.date,
				end: e.date,
				length: 1,
				heavyDays: isHeavy ? 1 : 0,
				excluded: e.exclude_from_stats // flag lives on the period-start day
			});
		}
	}
	return episodes;
}

// Maps each symptom key to its clinical group label.
const GROUP_OF: Record<string, string> = {};
for (const g of SYMPTOM_GROUPS) for (const k of g.keys) GROUP_OF[k] = g.label;

export function buildSummary(entries: CycleEntry[], todayISO?: string): ReportSummary {
	const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
	const bleedingDates = new Set(
		sorted.filter((e) => e.flow_intensity !== 'none').map((e) => e.date)
	);

	const episodes = detectEpisodes(sorted);

	const cycles: CycleRecord[] = episodes.map((ep, i) => ({
		start: ep.start,
		periodLength: ep.length,
		heavyDays: ep.heavyDays,
		cycleLength:
			i < episodes.length - 1 ? daysBetween(ep.start, episodes[i + 1].start) : null,
		excluded: ep.excluded
	}));

	const gaps = cycles
		.filter((c) => !c.excluded)
		.map((c) => c.cycleLength)
		.filter((n): n is number => n != null);
	const cycleLengthMin = gaps.length ? Math.min(...gaps) : null;
	const cycleLengthMax = gaps.length ? Math.max(...gaps) : null;
	const cycleLengthMedian = median(gaps);

	let regularity: Regularity = 'insufficient';
	const flags: ReportFlag[] = [];
	const flag = (text: string, urgent = false) => flags.push({ text, urgent });
	if (gaps.length >= 2 && cycleLengthMin != null && cycleLengthMax != null) {
		const spread = cycleLengthMax - cycleLengthMin;
		const abnormal = cycleLengthMax > 35 || cycleLengthMin < 21 || spread > 9;
		regularity = abnormal ? 'irregular' : 'regular';
		if (cycleLengthMax > 35) flag(`Longest cycle ${cycleLengthMax} days (over 35).`);
		if (cycleLengthMin < 21) flag(`Shortest cycle ${cycleLengthMin} days (under 21).`);
		if (spread > 9) flag(`Cycle length varies by ${spread} days.`);
	}

	const lengths = episodes.filter((e) => !e.excluded).map((e) => e.length);
	const periodLengthMin = lengths.length ? Math.min(...lengths) : null;
	const periodLengthMax = lengths.length ? Math.max(...lengths) : null;
	const periodLengthMedian = median(lengths);
	if (periodLengthMax != null && periodLengthMax > 7)
		flag(`Longest period ${periodLengthMax} days (over 7).`);

	const heavyDays = episodes.reduce((sum, e) => sum + e.heavyDays, 0);
	// URGENT: ≥3 heavy days = possible heavy menstrual bleeding (HMB, anemia risk).
	// Stays free — a person needs to know this, not just learn it when they pay.
	if (heavyDays >= 3) flag(`${heavyDays} heavy-flow days recorded.`, true);

	const lastEp = episodes[episodes.length - 1] ?? null;
	const ref = todayISO ?? sorted[sorted.length - 1]?.date ?? null;
	const daysSinceLastPeriod =
		lastEp && ref ? daysBetween(lastEp.start, ref) : null;

	// Per-symptom: frequency, PEAK + TYPICAL (median) severity, and how often it
	// coincided with bleeding (cyclical vs non-cyclical — relevant for endo).
	const symAgg = new Map<Symptom, { sev: Severity[]; onBleed: number }>();
	for (const e of sorted) {
		const onBleed = bleedingDates.has(e.date);
		for (const s of e.symptoms) {
			const cur = symAgg.get(s.key) ?? { sev: [], onBleed: 0 };
			cur.sev.push(s.severity);
			if (onBleed) cur.onBleed += 1;
			symAgg.set(s.key, cur);
		}
	}

	const symptomGroups: SymptomGroupStat[] = SYMPTOM_GROUPS.map((g) => ({
		label: g.label,
		stats: g.keys
			.filter((k) => symAgg.has(k))
			.map((k) => {
				const a = symAgg.get(k)!;
				const peak = Math.max(...a.sev) as Severity;
				const typical = (median(a.sev) ?? peak) as Severity;
				return {
					key: k,
					days: a.sev.length,
					peakSeverity: peak,
					typicalSeverity: typical,
					onBleedingDays: a.onBleed
				};
			})
			.sort((a, b) => b.days - a.days)
	})).filter((g) => g.stats.length > 0);

	// Intermenstrual bleeding (spotting) — a gynaecologist flag.
	// Only count days that fall OUTSIDE bleeding: spotting during a period is
	// normal variation; spotting between periods is the clinical signal.
	const spottingDays = sorted.filter(
		(e) => e.symptoms.some((s) => s.key === 'spotting') && !bleedingDates.has(e.date)
	).length;
	if (spottingDays >= 2) flag(`Spotting logged on ${spottingDays} days outside your period.`);
	// Prolonged absence of a period (possible amenorrhoea) — open cycle only.
	// URGENT: something a person may need to act on now, so it stays free.
	if (daysSinceLastPeriod != null && daysSinceLastPeriod > 90)
		flag(`Last period started ${daysSinceLastPeriod} days ago (over 90 — worth discussing).`, true);
	// Non-cyclical pain — pain logged mostly OUTSIDE bleeding is an endometriosis
	// red flag clinicians look for. Derived from data we already record.
	for (const [key, a] of symAgg) {
		if (GROUP_OF[key] !== 'Pain') continue;
		const days = a.sev.length;
		if (days >= 4 && a.onBleed / days <= 1 / 3)
			flag(`${humanize(key)} logged on ${days} days, ${days - a.onBleed} outside your period.`);
	}

	const moodAgg = new Map<string, number>();
	for (const e of sorted) for (const m of e.mood) moodAgg.set(m, (moodAgg.get(m) ?? 0) + 1);
	const moodCounts = [...moodAgg.entries()]
		.map(([mood, days]) => ({ mood, days }))
		.sort((a, b) => b.days - a.days);

	const weights = sorted.filter((e) => e.weight != null).map((e) => e.weight as number);
	const weight =
		weights.length > 0
			? { min: Math.min(...weights), max: Math.max(...weights), latest: weights[weights.length - 1] }
			: null;

	return {
		entryCount: sorted.length,
		rangeStart: sorted[0]?.date ?? null,
		rangeEnd: sorted[sorted.length - 1]?.date ?? null,
		lastPeriodStart: lastEp?.start ?? null,
		daysSinceLastPeriod,
		episodes,
		cycles,
		cycleLengthMin,
		cycleLengthMax,
		cycleLengthMedian,
		regularity,
		flags,
		periodLengthMin,
		periodLengthMax,
		periodLengthMedian,
		bleedingDays: bleedingDates.size,
		heavyDays,
		symptomGroups,
		moodCounts,
		weight
	};
}
