export const FLOW_INTENSITIES = ['none', 'light', 'medium', 'heavy'] as const;
export type FlowIntensity = (typeof FLOW_INTENSITIES)[number];

// Severity for a logged symptom. Absence = not in the list at all.
// 1 = mild, 2 = moderate, 3 = severe. Fixes the Endo "five-star pain" complaint.
export const SEVERITIES = [1, 2, 3] as const;
export type Severity = (typeof SEVERITIES)[number];
export const SEVERITY_LABELS: Record<Severity, string> = {
	1: 'Mild',
	2: 'Moderate',
	3: 'Severe'
};

// Grouped clinical taxonomy. Deliberately covers PCOS (skin/hair, metabolic) and
// endometriosis (distinct pain types) — the things mainstream apps neglect — and
// contains zero fertility/pregnancy framing.
export const SYMPTOM_GROUPS = [
	{
		label: 'Pain',
		keys: [
			'cramps',
			'sharp_pelvic_pain',
			'bowel_pain',
			'radiating_back_pain',
			'nerve_pain',
			'endo_belly',
			'ovulation_pain'
		]
	},
	{
		label: 'Physical',
		keys: [
			'bloating',
			'headache',
			'nausea',
			'fatigue',
			'dizziness',
			'breast_tenderness',
			'insomnia',
			'diarrhea',
			'constipation',
			'spotting'
		]
	},
	{
		label: 'Skin & Hair',
		keys: ['cystic_acne', 'acne', 'hirsutism', 'hair_loss', 'oily_skin']
	},
	{
		label: 'Metabolic',
		keys: ['sugar_cravings', 'increased_appetite', 'hot_flashes']
	}
] as const;

export const SYMPTOM_OPTIONS = SYMPTOM_GROUPS.flatMap((g) => g.keys);
export type Symptom = (typeof SYMPTOM_OPTIONS)[number];

// Plain-English descriptions shown when a symptom is selected — helpful for
// anyone who isn't sure what a term means without being condescending.
export const SYMPTOM_TIPS: Partial<Record<Symptom, string>> = {
	cramps: 'Aching or squeezing pain in your lower belly during your period.',
	sharp_pelvic_pain: 'Sudden or stabbing pain in your pelvis, inside your hip bones.',
	bowel_pain: 'Pain or discomfort when using the toilet, often worse during your period.',
	radiating_back_pain: 'Pain that starts in your lower back or hips and spreads down your legs.',
	nerve_pain: 'Shooting, burning, or electric-feeling pain along a nerve path.',
	endo_belly: 'Severe bloating that makes your stomach visibly swell, often painful.',
	ovulation_pain: 'A twinge or ache on one side of your pelvis mid-cycle, around day 14.',
	bloating: 'A full, tight, or puffy feeling in your abdomen.',
	headache: 'Pain or pressure in your head — can be linked to hormonal changes.',
	nausea: 'An unsettled or queasy stomach feeling.',
	fatigue: 'Tiredness that rest does not fully fix.',
	dizziness: 'Feeling lightheaded, unsteady, or like the room is spinning.',
	breast_tenderness: 'Soreness or sensitivity in your breasts, common before your period.',
	insomnia: 'Trouble falling or staying asleep.',
	diarrhea: 'Loose or urgent stools, often worse just before or during your period.',
	constipation: 'Difficulty passing stools or going less often than usual.',
	spotting: 'Light bleeding or discharge between periods — not your main flow.',
	cystic_acne: 'Deep, painful spots under the skin, often along the jaw or chin.',
	acne: 'Spots or breakouts on your face, back, or chest.',
	hirsutism: 'Noticeable hair growth in places like the chin, upper lip, or stomach.',
	hair_loss: 'More hair than usual coming out when washing or brushing.',
	oily_skin: 'Skin that looks or feels greasy, especially on your face.',
	sugar_cravings: 'A strong urge to eat sweet or high-carb foods.',
	increased_appetite: 'Feeling hungrier than usual.',
	hot_flashes: 'Sudden waves of heat, often with sweating or flushing.',
};

export interface LoggedSymptom {
	key: Symptom;
	severity: Severity;
}

export const MOOD_OPTIONS = [
	'calm',
	'happy',
	'irritable',
	'anxious',
	'low',
	'tearful',
	'angry',
	'overwhelmed',
	'tired',
	'focused',
	'restless',
	'numb'
] as const;
export type Mood = (typeof MOOD_OPTIONS)[number];

export interface CycleEntry {
	id: string; // UUID generated on-device
	date: string; // ISO date, e.g. "2026-05-28" (one logical entry per calendar day)
	flow_intensity: FlowIntensity;
	symptoms: LoggedSymptom[]; // stored as a JSON string column
	mood: Mood[]; // stored as a JSON string column
	weight: number | null; // optional numeric metric (PCOS)
	notes: string | null;
	// When set on a period-start day, that cycle is kept in the log but excluded
	// from cycle/period-length statistics (e.g. a stress- or procedure-driven outlier).
	exclude_from_stats: boolean;
	created_at: string; // ISO timestamp
	updated_at: string; // ISO timestamp
}

// Shape exactly as it sits in SQLite: JSON arrays are TEXT columns, weight is REAL.
export interface CycleEntryRow {
	id: string;
	date: string;
	flow_intensity: string;
	symptoms: string;
	mood: string;
	weight: number | null;
	notes: string | null;
	exclude_from_stats: number; // 0 | 1
	created_at: string;
	updated_at: string;
}

export const CYCLE_ENTRIES_TABLE = 'cycle_entries';
