<script module lang="ts">
	// Persists across remounts (tab switches) but resets on app launch — so the
	// entrance animation plays once per session, not every time you tap Today.
	let introSeen = false;
</script>

<script lang="ts">
	import { ensureDb } from '$lib/db/init';
	import {
		addEntry,
		updateEntry,
		deleteEntry,
		getEntryByDate,
		getAllEntries
	} from '$lib/db/cycleRepository';
	import { cycleStatusFor, detectEpisodesPublic } from '$lib/report/analyze';
	import { maybeRequestReview } from '$lib/ui/review';
	import {
		FLOW_INTENSITIES,
		SYMPTOM_GROUPS,
		SYMPTOM_TIPS,
		MOOD_OPTIONS,
		SEVERITY_LABELS,
		type FlowIntensity,
		type Symptom,
		type Severity,
		type Mood
	} from '$lib/db/schema';
	import { humanize, todayISO, shiftISO, friendlyDate, longDate, daysBetween } from '$lib/ui/format';
	import { getWeightUnit, kgToDisplay, displayToKg, isBackupNudgeDismissed, dismissBackupNudge } from '$lib/ui/preferences.svelte';
	import { buildCsv } from '$lib/report/csv';
	import { downloadText } from '$lib/report/export';
	import { selectionTick, successTick } from '$lib/ui/haptics';
	import { swipeX, longPress } from '$lib/ui/swipe';
	import { page } from '$app/state';
	import { beforeNavigate } from '$app/navigation';
	import { untrack } from 'svelte';

	const flowColors: Record<FlowIntensity, string> = {
		none: 'var(--flow-none)',
		light: 'var(--flow-light)',
		medium: 'var(--flow-medium)',
		heavy: 'var(--flow-heavy)'
	};

	// Cove is a historical mirror, not a planner — you can never log a future day.
	const clampToToday = (iso: string): string => (iso > todayISO() ? todayISO() : iso);

	let selectedDate = $state(clampToToday(page.url.searchParams.get('date') ?? todayISO()));
	let loading = $state(true);

	// Sync to the URL on navigation: jump to ?date=… when arriving from the
	// calendar, and fall back to today for a bare "/" (e.g. tapping the Today
	// tab). selectedDate is read untracked so this only re-runs on a real URL
	// change — otherwise it would fight the day stepper, which moves the date
	// without touching the URL.
	$effect(() => {
		const param = page.url.searchParams.get('date');
		const target = param ? clampToToday(param) : todayISO();
		untrack(() => {
			if (target !== selectedDate) {
				flushSave(); // payload is built synchronously, so it captures the OLD day
				selectedDate = target;
			}
		});
	});
	let existingId = $state<string | null>(null);

	let flow = $state<FlowIntensity>('none');
	// symptom key -> severity (absent key = not logged)
	let symptomMap = $state<Record<string, Severity>>({});
	let activeTip = $state<string | null>(null);
	let mood = $state<Mood[]>([]);
	let weight = $state<string>('');
	// Track the original kg value loaded from DB so saves that only edit symptoms/mood
	// don't re-convert the display string and introduce rounding drift.
	let weightKgOriginal = $state<number | null>(null);
	let weightDirty = $state(false);
	let notes = $state('');

	// Occasional-use sections stay collapsed to keep the daily scroll short; they
	// auto-open when the loaded day already has a value (so data is never hidden).
	let weightOpen = $state(false);
	let notesOpen = $state(false);

	let saving = $state(false);
	let savingShown = $state(false);
	let savingShowTimer: ReturnType<typeof setTimeout> | undefined;
	let justSaved = $state(false);
	let loadError = $state(false);
	let saveError = $state(false);
	let loadingShown = $state(false); // gated so instant loads never flash "Loading…"
	let loadTimer: ReturnType<typeof setTimeout>;
	// Incremented on every load() call so concurrent loads can detect they're stale.
	let loadGen = 0;

	// Pain and Physical open by default; specialist groups collapsed until needed.
	const DEFAULT_OPEN = new Set(['Pain', 'Physical']);
	let groupOpen = $state<Record<string, boolean>>(
		Object.fromEntries(SYMPTOM_GROUPS.map((g) => [g.label, DEFAULT_OPEN.has(g.label)]))
	);
	function toggleGroup(label: string) {
		selectionTick();
		groupOpen = { ...groupOpen, [label]: !groupOpen[label] };
	}
	// Reset which groups are open for a freshly-loaded day: the defaults, plus any
	// group that has logged symptoms (so the user sees their data). Computed once per
	// load — NOT a reactive effect, so the user can freely collapse a group with data
	// without it springing back open.
	function syncGroupOpen() {
		groupOpen = Object.fromEntries(
			SYMPTOM_GROUPS.map((g) => [
				g.label,
				DEFAULT_OPEN.has(g.label) || g.keys.some((k) => symptomMap[k])
			])
		);
	}

	// Play the entrance settle only the first time Today is shown this session.
	const playIntro = !introSeen;
	if (playIntro) introSeen = true;

	const isToday = $derived(selectedDate === todayISO());
	const weightUnit = $derived(getWeightUnit());
	const countIn = (keys: readonly string[]) => keys.filter((k) => symptomMap[k]).length;

	// Soft plausibility check: outside 25–250 kg (55–551 lb) the value is almost
	// certainly a typo (e.g. 638 instead of 63.8). Block nothing — just ask.
	const weightWarning = $derived.by(() => {
		const raw = String(weight ?? '').trim().replace(',', '.');
		if (!raw) return null;
		const v = Number(raw);
		if (!Number.isFinite(v) || v <= 0) return "That doesn't look like a valid number.";
		const kg = displayToKg(v);
		if (kg < 25 || kg > 250) {
			return weightUnit === 'lb'
				? 'That looks outside the typical range (55–551 lb) — double-check the value.'
				: 'That looks outside the typical range (25–250 kg) — double-check the value.';
		}
		return null;
	});

	// Focus only when the section was just opened by an "Add …" tap — never on a
	// day load that happens to have data, which would pop the keyboard uninvited.
	let wantFocus = false;
	function openWeight() {
		selectionTick();
		wantFocus = true;
		weightOpen = true;
	}
	function openNotes() {
		selectionTick();
		wantFocus = true;
		notesOpen = true;
	}
	function focusOnMount(el: HTMLElement) {
		if (!wantFocus) return;
		wantFocus = false;
		setTimeout(() => el.focus(), 30);
	}

	function onWeightInput() {
		weightDirty = true;
		scheduleSave();
	}

	// Export data directly from the backup nudge — no redirect to Settings needed.
	async function exportFromNudge() {
		try {
			await downloadText(`cove-export-${todayISO()}.csv`, buildCsv(allEntries), 'text/csv');
			dismissNudge();
		} catch (e) {
			console.error('[cove] nudge export failed:', e);
		}
	}

	// Keep a focused field visible above the keyboard (also helps in-browser).
	function scrollFocus(e: FocusEvent) {
		const el = e.target as HTMLElement;
		setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
	}

	// Reflection of the user's own data for the selected day — never a prediction.
	let allEntries = $state<Awaited<ReturnType<typeof getAllEntries>>>([]);
	const status = $derived(cycleStatusFor(allEntries, selectedDate));
	const statusText = $derived(
		status.kind === 'period'
			? `Period · Day ${status.day}`
			: status.kind === 'between'
				? `Cycle day ${status.daysSince + 1}`
				: 'No period logged yet'
	);

	function reset() {
		flow = 'none';
		symptomMap = {};
		mood = [];
		weight = '';
		weightKgOriginal = null;
		weightDirty = false;
		notes = '';
		existingId = null;
	}

	async function load(date: string) {
		// Drain any pending write before reading so a fast day-step never loads stale data.
		await saveChain;
		const gen = ++loadGen;
		loading = true;
		loadError = false;
		justSaved = false;
		confirmingDelete = false;
		clearTimeout(loadTimer);
		loadTimer = setTimeout(() => {
			if (loading) loadingShown = true;
		}, 180);
		try {
			await ensureDb();
			if (gen !== loadGen) return; // a newer load started; discard this result
			allEntries = await getAllEntries();
			if (gen !== loadGen) return;
			const entry = await getEntryByDate(date);
			if (gen !== loadGen) return;
			if (entry) {
				existingId = entry.id;
				flow = entry.flow_intensity;
				symptomMap = Object.fromEntries(entry.symptoms.map((s) => [s.key, s.severity]));
				mood = entry.mood;
				weight = entry.weight != null ? String(kgToDisplay(entry.weight)) : '';
				weightKgOriginal = entry.weight ?? null;
				weightDirty = false;
				notes = entry.notes ?? '';
			} else {
				reset();
			}
			weightOpen = weight !== '';
			notesOpen = notes.trim().length > 0;
			syncGroupOpen();
		} catch (e) {
			if (gen !== loadGen) return;
			console.error('[vault/db] load failed:', e);
			loadError = true;
		} finally {
			if (gen === loadGen) {
				loading = false;
				clearTimeout(loadTimer);
				loadingShown = false;
			}
		}
	}

	$effect(() => {
		load(selectedDate);
	});

	// ── Autosave ──────────────────────────────────────────────────────────────
	// Every edit schedules a debounced save; navigating away (day step, tab
	// switch, app background) flushes it immediately. There is no Save button —
	// edits can never be silently lost.
	const AUTOSAVE_MS = 600;
	let saveTimer: ReturnType<typeof setTimeout> | undefined;

	function scheduleSave() {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			saveTimer = undefined;
			void save();
		}, AUTOSAVE_MS);
	}

	// save() builds its payload synchronously from current state, so calling this
	// right BEFORE selectedDate changes still writes to the day being left.
	function flushSave() {
		if (saveTimer === undefined) return;
		clearTimeout(saveTimer);
		saveTimer = undefined;
		void save();
	}

	beforeNavigate(() => flushSave());

	// Flush when iOS backgrounds the webview — the OS may kill it at any point after.
	// On foreground, snap to today if the date rolled over while the app was suspended
	// (e.g. app left open overnight): if the user was on "today" and today changed,
	// advance so they're logging the correct day rather than yesterday.
	$effect(() => {
		let wasOnToday = selectedDate === todayISO();
		const onVisibility = () => {
			if (document.visibilityState === 'hidden') {
				wasOnToday = selectedDate === todayISO();
				flushSave();
			} else {
				const today = todayISO();
				if (wasOnToday && selectedDate !== today) {
					flushSave();
					selectedDate = today;
				}
			}
		};
		document.addEventListener('visibilitychange', onVisibility);
		return () => document.removeEventListener('visibilitychange', onVisibility);
	});

	// Tap cycles a symptom: off -> mild -> moderate -> severe -> off
	function cycleSymptom(key: Symptom) {
		selectionTick();
		const current = symptomMap[key];
		const next = current === undefined ? 1 : current === 3 ? undefined : ((current + 1) as Severity);
		const copy = { ...symptomMap };
		if (next === undefined) {
			delete copy[key];
			if (activeTip === key) activeTip = null;
		} else {
			copy[key] = next;
			activeTip = SYMPTOM_TIPS[key] ? key : null;
		}
		symptomMap = copy;
		scheduleSave();
	}

	// Long-press clears a logged symptom instantly — no need to cycle through severities.
	function clearSymptom(key: Symptom) {
		if (!symptomMap[key]) return; // not logged — nothing to clear
		selectionTick();
		const copy = { ...symptomMap };
		delete copy[key];
		if (activeTip === key) activeTip = null;
		symptomMap = copy;
		scheduleSave();
	}

	function selectFlow(level: FlowIntensity) {
		selectionTick();
		flow = level;
		scheduleSave();
	}

	function toggleMood(value: Mood) {
		selectionTick();
		mood = mood.includes(value) ? mood.filter((v) => v !== value) : [...mood, value];
		scheduleSave();
	}

	function goPrev() {
		selectionTick();
		flushSave();
		selectedDate = shiftISO(selectedDate, -1);
	}
	function goNext() {
		if (isToday) return;
		selectionTick();
		flushSave();
		selectedDate = shiftISO(selectedDate, 1);
	}

	// Saves are serialized on a chain: each builds its payload synchronously (so a
	// flush right before a day change still captures the day being left), then
	// awaits any earlier write. The target row is resolved from the DB by DATE at
	// write time, never from component state — so a queued save for yesterday can
	// never update today's row, and a flush during a debounced create can never
	// insert the same day twice.
	let saveChain: Promise<void> = Promise.resolve();

	function save(): Promise<void> {
		// If the weight field wasn't edited this session, pass the original kg value
		// straight through — avoids display-rounding drift on every non-weight save.
		let weightKg: number | null;
		if (!weightDirty && weightKgOriginal !== null) {
			weightKg = weightKgOriginal;
		} else {
			// Normalise: comma decimal separators (common outside US) become dots.
			const rawWeight = String(weight ?? '').trim().replace(',', '.');
			const parsedWeight = rawWeight === '' ? null : Number(rawWeight);
			// Treat 0, negative, and non-numeric as unset — no human weighs 0 kg/lb,
			// and a parse failure (NaN) should not silently drop to null without warning.
			weightKg =
				parsedWeight != null && Number.isFinite(parsedWeight) && parsedWeight > 0
					? displayToKg(parsedWeight)
					: null;
		}

		// Don't create a blank record for a day the user never actually logged anything on.
		// Weight only counts if it parsed to a valid, positive number.
		const hasContent =
			flow !== 'none' ||
			Object.keys(symptomMap).length > 0 ||
			mood.length > 0 ||
			weightKg !== null ||
			notes.trim().length > 0;
		const hadEntry = existingId !== null;

		const symptoms = (Object.entries(symptomMap) as [Symptom, Severity][]).map(
			([key, severity]) => ({ key, severity })
		);
		const payload = {
			date: selectedDate,
			flow_intensity: flow,
			symptoms,
			mood,
			weight: weightKg,
			notes
		};

		saveChain = saveChain.then(() => doSave(payload, hasContent, hadEntry));
		return saveChain;
	}

	async function doSave(
		payload: Parameters<typeof addEntry>[0],
		hasContent: boolean,
		hadEntry: boolean
	) {
		saving = true;
		savingShowTimer = setTimeout(() => { savingShown = true; }, 400);
		saveError = false;
		try {
			const existing = await getEntryByDate(payload.date);
			if (existing) {
				if (!hasContent) {
					await deleteEntry(existing.id);
					if (selectedDate === payload.date) existingId = null;
				} else {
					await updateEntry(existing.id, payload);
				}
			} else {
				if (!hasContent && !hadEntry) return; // nothing logged, nothing stored
				const created = await addEntry(payload);
				if (selectedDate === payload.date) existingId = created.id;
			}
			allEntries = await getAllEntries();
			justSaved = true;
			successTick();
			setTimeout(() => (justSaved = false), 2000);

			// Fire the native review prompt when the user logs the FIRST day of their
			// second period, AS IT HAPPENS (selectedDate is today). The guards together
			// make this fire exactly once, at the right moment:
			//   - flow !== 'none': only on a bleeding save, not symptom-only
			//   - selectedDate === todayISO(): live logging, not historical backfill
			//     or an edit of a past entry (which would waste Apple's limited prompt
			//     allowance on a user who hasn't yet lived a full cycle)
			//   - episodes[1].start === selectedDate: the day being saved IS the start
			//     of the second episode (not a later day within it)
			//   - gap >= 14 days between the two episode starts: confirms this is a
			//     genuine NEW period, not a logging gap. detectEpisodes now merges runs
			//     split by ≤ 1 missed day, so a single skipped mid-period day no longer
			//     fabricates a second episode. The 14-day guard is belt-and-suspenders
			//     for gaps > 1 day; no real cycle is < 21 days.
			if (payload.flow_intensity !== 'none' && payload.date === todayISO()) {
				const episodes = detectEpisodesPublic(allEntries);
				if (
					episodes.length === 2 &&
					episodes[1].start === payload.date &&
					daysBetween(episodes[0].start, episodes[1].start) >= 14
				) {
					// Small delay so the save confirmation animates first.
					setTimeout(() => { void maybeRequestReview(); }, 1500);
				}
			}
		} catch (e) {
			console.error('[vault/db] save failed:', e);
			saveError = true;
		} finally {
			saving = false;
			clearTimeout(savingShowTimer);
			savingShown = false;
		}
	}

	let confirmingDelete = $state(false);

	// Backup nudge: shown once on Today after ≥30 logged days, dismissed permanently.
	const BACKUP_THRESHOLD = 30;
	let backupNudgeDismissed = $state(isBackupNudgeDismissed());
	const showBackupNudge = $derived(
		!backupNudgeDismissed && allEntries.length >= BACKUP_THRESHOLD
	);
	function dismissNudge() {
		dismissBackupNudge();
		backupNudgeDismissed = true;
	}

	async function remove() {
		if (!existingId) return;
		// Cancel the debounce timer and wait for any in-flight write to land before
		// deleting — an in-flight save resolves by date and would re-insert the row.
		clearTimeout(saveTimer);
		saveTimer = undefined;
		await saveChain;
		saveError = false;
		try {
			await deleteEntry(existingId);
			reset();
			allEntries = await getAllEntries();
			justSaved = false;
			confirmingDelete = false;
		} catch (e) {
			console.error('[vault/db] delete failed:', e);
			saveError = true;
		}
	}
</script>

<!-- Swipe anywhere on the day to page through history — buttons remain for a11y. -->
<div class="page" use:swipeX={{ onLeft: goNext, onRight: goPrev }}>
	<header class="nav-bar">
		<h1 class="large-title">{friendlyDate(selectedDate)}</h1>
	</header>
	<div class="date-row">
		<span class="long-date">{longDate(selectedDate)}</span>
		<div class="stepper" role="group" aria-label="Change day">
			<button class="step" onclick={goPrev} aria-label="Previous day">
				<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
			</button>
			<span class="step-divider" aria-hidden="true"></span>
			<button class="step" onclick={goNext} aria-label="Next day" disabled={isToday}>
				<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7" /></svg>
			</button>
		</div>
	</div>

	{#if !loading && !loadError}
		<div class="cycle-status" class:bleeding={status.kind === 'period'}>{statusText}</div>
	{/if}

	{#if showBackupNudge}
		<div class="backup-nudge" role="note">
			<div class="nudge-body">
				<div>
					<p class="nudge-title">Back up your data</p>
					<p class="nudge-sub">You've logged {allEntries.length} days — export a CSV so you don't lose it if something happens to this phone.</p>
				</div>
			</div>
			<div class="nudge-actions">
				<button class="nudge-cta" onclick={exportFromNudge}>Export data</button>
				<button class="nudge-dismiss" onclick={dismissNudge} aria-label="Dismiss backup reminder">Not now</button>
			</div>
		</div>
	{/if}

	{#if loading}
		{#if loadingShown}<div class="loading">Loading…</div>{/if}
	{:else if loadError}
		<div class="error-state">
			<p class="error-title">We couldn’t open your data</p>
			<p class="error-body">Your entries are safe on this device. Try again in a moment.</p>
			<button class="retry" onclick={() => load(selectedDate)}>Try again</button>
		</div>
	{:else}
		<div class="content" class:intro={playIntro}>
		<section class="card">
			<h2>Flow</h2>
			{#if allEntries.length === 0}
				<p class="hint">New here? Tap a flow level to log your period — that’s all it takes to start.</p>
			{/if}
			<div class="flow-row">
				{#each FLOW_INTENSITIES as level (level)}
					<button
						class="flow-opt"
						class:selected={flow === level}
						aria-pressed={flow === level}
						aria-label="Flow {humanize(level)}"
						onclick={() => selectFlow(level)}
					>
						<span class="dot" style="background: {flowColors[level]}"></span>
						<span class="flow-label">{humanize(level)}</span>
					</button>
				{/each}
			</div>
		</section>

		{#if isToday}
			<a class="flare-card" href="/flare">
				<span class="flare-title">Log a pain flare</span>
				<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
			</a>
		{/if}

		<section class="card">
			<h2>Symptoms</h2>
			<p class="hint">Tap to cycle: mild → moderate → severe</p>
			{#each SYMPTOM_GROUPS as group (group.label)}
				{@const n = countIn(group.keys)}
				{@const open = groupOpen[group.label]}
				<div class="group">
					<button class="group-header" onclick={() => toggleGroup(group.label)} aria-expanded={open}>
						<span class="group-title">
							{group.label}
							{#if n > 0}<span class="group-count">{n}</span>{/if}
						</span>
						<svg class="chevron" class:open={open} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M6 9l6 6 6-6"/>
						</svg>
					</button>
					{#if open}
						<div class="chips">
							{#each group.keys as key (key)}
								{@const sev = symptomMap[key]}
								{@const tip = SYMPTOM_TIPS[key]}
								<button
									class="chip"
									class:sev-1={sev === 1}
									class:sev-2={sev === 2}
									class:sev-3={sev === 3}
									aria-pressed={!!sev}
									aria-label={sev ? `${humanize(key)}, ${SEVERITY_LABELS[sev]}, long-press to clear` : humanize(key)}
									onclick={() => cycleSymptom(key)}
									use:longPress={() => clearSymptom(key)}
								>
									{humanize(key)}
									{#if sev}<span class="sev-tag">· {SEVERITY_LABELS[sev]}</span>{/if}
								</button>
								{#if activeTip === key && tip}
									<p class="sym-tip">{tip}</p>
								{/if}
							{/each}
						</div>
					{/if}
				</div>
			{/each}
		</section>

		<section class="card">
			<h2>Mood</h2>
			<div class="chips">
				{#each MOOD_OPTIONS as m (m)}
					<button class="chip" class:on={mood.includes(m)} aria-pressed={mood.includes(m)} onclick={() => toggleMood(m)}>
						{humanize(m)}
					</button>
				{/each}
			</div>
		</section>

		{#if weightOpen}
			<section class="card">
				<h2>Weight</h2>
				<div class="weight-row">
					<input
						type="text"
						inputmode="decimal"
						bind:value={weight}
						use:focusOnMount
						onfocus={scrollFocus}
						oninput={onWeightInput}
						placeholder="Optional"
						aria-label="Weight in {weightUnit}"
					/>
					<span class="unit">{weightUnit}</span>
				</div>
				{#if weightWarning}
					<p class="weight-warning" role="alert">{weightWarning}</p>
				{/if}
			</section>
		{:else}
			<button class="add-row" onclick={openWeight}>
				<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
				Add weight
			</button>
		{/if}

		{#if notesOpen}
			<section class="card">
				<h2>Notes</h2>
				<textarea bind:value={notes} use:focusOnMount onfocus={scrollFocus} oninput={scheduleSave} rows="3" placeholder="Anything worth remembering…" aria-label="Notes"></textarea>
			</section>
		{:else}
			<button class="add-row" onclick={openNotes}>
				<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
				Add note
			</button>
		{/if}

		{#if existingId}
			{#if confirmingDelete}
				<div class="confirm-row">
					<button class="confirm-cancel" onclick={() => (confirmingDelete = false)}>
						Cancel
					</button>
					<button class="confirm-delete" onclick={remove}>Delete entry</button>
				</div>
			{:else}
				<button class="delete" onclick={() => (confirmingDelete = true)}>
					Delete this day’s entry
				</button>
			{/if}
		{/if}
		</div>
	{/if}
</div>

{#if !loadError && !loading}
	<div class="autosave-bar" aria-live="polite" aria-atomic="true">
		{#if saveError}
			<span class="as-error">
				Couldn’t save —
				<button class="as-retry" onclick={() => void save()}>Retry</button>
			</span>
		{:else if savingShown}
			<span class="as-saving">Saving…</span>
		{:else if justSaved}
			<span class="as-saved">
				<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>
				Saved
			</span>
		{/if}
	</div>
{/if}

<style>
	.page {
		padding: 0 16px calc(72px + var(--safe-bottom));
	}

	/* Navigation bar with a left-aligned Large Title (34pt) + trailing bar button. */
	.nav-bar {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 12px;
		padding: 16px 0 0;
	}
	/* Subheadline date + a grouped two-button day stepper (each cell ≥ 44pt). */
	.date-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 4px;
		margin-bottom: 16px;
	}
	/* Reflection of the user's own log — calm, factual, never a prediction. */
	.cycle-status {
		display: inline-block;
		margin-bottom: 20px;
		padding: 7px 14px;
		border-radius: var(--radius-pill);
		background: var(--accent-tint);
		color: var(--accent-ink);
		font-size: 14px;
		font-weight: 600;
		letter-spacing: -0.2px;
	}
	.cycle-status.bleeding {
		background: color-mix(in srgb, var(--flow-medium) 22%, transparent);
		color: var(--flow-heavy-ink);
	}
	.long-date {
		font-size: 15px;
		font-weight: 400;
		letter-spacing: -0.2px;
		color: var(--ink-soft);
	}
	.stepper {
		display: flex;
		align-items: center;
		border: 1px solid var(--line);
		border-radius: var(--radius-control);
		background: var(--surface);
		overflow: hidden;
	}
	.step {
		width: 44px;
		height: 44px;
		display: grid;
		place-items: center;
		border: none;
		background: transparent;
		color: var(--accent);
		transition:
			background 0.12s,
			opacity 0.12s;
	}
	.step:active {
		background: var(--accent-tint);
	}
	.step:disabled {
		color: var(--ink-faint);
		opacity: 0.5;
	}
	.step-divider {
		width: 1px;
		align-self: stretch;
		background: var(--line);
	}

	/* One-time backup nudge — warm amber attention callout, matches the clinical flag
	   palette already defined in app.css (--attn-*). */
	.backup-nudge {
		margin-bottom: 20px;
		padding: 14px 16px;
		border-radius: var(--radius-card);
		border: 1px solid var(--attn-line);
		background: var(--attn-bg);
	}
	.nudge-body {
		display: flex;
		align-items: flex-start;
	}
	.nudge-title {
		font-size: 14px;
		font-weight: 600;
		color: var(--attn-ink);
		letter-spacing: -0.1px;
	}
	.nudge-sub {
		margin-top: 3px;
		font-size: 13px;
		line-height: 1.45;
		color: var(--attn-ink);
		opacity: 0.85;
	}
	.nudge-actions {
		display: flex;
		align-items: center;
		gap: 16px;
		margin-top: 12px;
		padding-left: 32px; /* align under text, past the icon */
	}
	.nudge-cta {
		font-size: 14px;
		font-weight: 600;
		color: var(--attn-ink);
		border: none;
		background: none;
		padding: 0;
		border-bottom: 1px solid var(--attn-ink);
		padding-bottom: 1px;
		min-height: 44px;
		transition: opacity 0.12s;
	}
	.nudge-cta:active { opacity: 0.6; }
	.nudge-dismiss {
		font-size: 13px;
		color: var(--attn-ink);
		opacity: 0.7;
		border: none;
		background: none;
		padding: 0;
		min-height: 44px;
		transition: opacity 0.12s;
	}
	.nudge-dismiss:active { opacity: 0.4; }

	.loading {
		padding: 48px 0;
		text-align: center;
		color: var(--ink-soft);
	}
	.error-state {
		margin-top: 48px;
		text-align: center;
		padding: 0 16px;
	}
	.error-title {
		font-size: 17px;
		font-weight: 600;
		color: var(--ink);
	}
	.error-body {
		margin-top: 6px;
		font-size: 15px;
		line-height: 1.4;
		color: var(--ink-soft);
	}
	.retry {
		margin-top: 20px;
		min-height: 44px;
		padding: 0 24px;
		border-radius: var(--radius-pill);
		border: 1px solid var(--line);
		background: var(--surface);
		color: var(--accent);
		font-size: 16px;
		font-weight: 600;
	}
	.retry:active {
		opacity: 0.6;
	}
	/* Passive autosave status strip — floats above the tab bar, invisible when idle. */
	.autosave-bar {
		position: fixed;
		bottom: calc(56px + var(--safe-bottom));
		left: 0;
		right: 0;
		max-width: 480px;
		margin: 0 auto;
		display: flex;
		justify-content: center;
		pointer-events: none;
		padding: 8px 20px;
	}
	.as-saved,
	.as-saving,
	.as-error {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 5px 12px;
		border-radius: var(--radius-pill);
		font-size: 13px;
		font-weight: 500;
	}
	.as-saved {
		background: var(--accent-tint);
		color: var(--accent-ink);
		animation: as-fade 0.2s ease;
	}
	.as-saving {
		color: var(--ink-faint);
	}
	.as-error {
		background: color-mix(in srgb, var(--flow-heavy) 12%, transparent);
		color: var(--flow-heavy-ink);
		pointer-events: auto;
	}
	.as-retry {
		border: none;
		background: none;
		color: var(--flow-heavy-ink);
		font-size: 13px;
		font-weight: 600;
		text-decoration: underline;
		padding: 0;
		pointer-events: auto;
	}
	@keyframes as-fade {
		from { opacity: 0; transform: translateY(4px); }
		to   { opacity: 1; transform: translateY(0); }
	}
	@media (prefers-reduced-motion: reduce) {
		.as-saved { animation: none; }
	}

	/* iOS inset-grouped section: flat fill + hairline, continuous corner, no shadow. */
	.card {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--radius-card);
		padding: 16px;
		margin-bottom: 16px;
		box-shadow: var(--shadow-card);
	}
	.card h2 {
		font-size: 13px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--ink-soft);
		margin-bottom: 8px;
	}
	.hint {
		font-size: 13px;
		color: var(--ink-soft);
		margin-bottom: 16px;
	}

	.group {
		margin-top: 8px;
	}
	.group-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		min-height: 36px;
		padding: 4px 0;
		border: none;
		background: transparent;
		cursor: pointer;
	}
	.group-title {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 13px;
		font-weight: 600;
		letter-spacing: -0.1px;
		color: var(--ink-soft);
	}
	.chevron {
		color: var(--ink-faint);
		transition: transform 0.2s ease;
		flex: none;
	}
	.chevron.open {
		transform: rotate(180deg);
	}
	.group-count {
		display: inline-grid;
		place-items: center;
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
		border-radius: var(--radius-pill);
		background: var(--accent);
		color: #fff;
		font-size: 11px;
		font-weight: 600;
	}
	.chips {
		padding-top: 4px;
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	/* One-time entrance settle when arriving at Today (per session). */
	.content.intro > .card,
	.content.intro > .add-row {
		opacity: 0;
		animation: card-in 0.4s cubic-bezier(0.22, 1, 0.36, 1) forwards;
	}
	.content.intro > :nth-child(1) {
		animation-delay: 0.02s;
	}
	.content.intro > :nth-child(2) {
		animation-delay: 0.07s;
	}
	.content.intro > :nth-child(3) {
		animation-delay: 0.12s;
	}
	.content.intro > :nth-child(4) {
		animation-delay: 0.17s;
	}
	.content.intro > :nth-child(5) {
		animation-delay: 0.22s;
	}
	@keyframes card-in {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.content.intro > .card,
		.content.intro > .add-row {
			opacity: 1;
			animation: none;
		}
	}

	.flow-row {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 8px;
		margin-top: 8px;
	}
	.flow-opt {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 12px 4px;
		border-radius: var(--radius-control);
		border: 1px solid var(--line);
		background: var(--surface);
		transition:
			border-color 0.15s,
			background 0.15s,
			transform 0.1s;
	}
	.flow-opt:active {
		transform: scale(0.97);
	}
	.flow-opt.selected {
		border-color: var(--accent);
		background: var(--accent-tint);
	}
	.dot {
		width: 22px;
		height: 22px;
		border-radius: var(--radius-pill);
		box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.06);
	}
	.flow-label {
		font-size: 12px;
		color: var(--ink-soft);
	}

	.chip {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 16px;
		border-radius: var(--radius-pill);
		border: 1px solid var(--line);
		background: var(--surface);
		color: var(--ink);
		font-size: 15px;
		letter-spacing: -0.2px;
		transition:
			border-color 0.18s ease,
			background 0.18s ease,
			color 0.18s ease,
			transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
	}
	.chip:active {
		transform: scale(0.94);
	}
	.chip.on {
		border-color: var(--accent);
		background: var(--accent-fill);
		color: #fff;
	}
	/* Severity ramp — one sage family deepening with intensity */
	.chip.sev-1 {
		border-color: var(--accent);
		background: var(--sev-1-bg);
		color: var(--sev-1-ink);
	}
	.chip.sev-2 {
		border-color: var(--sev-2-bg);
		background: var(--sev-2-bg);
		color: var(--sev-2-ink);
	}
	.chip.sev-3 {
		border-color: var(--sev-3-bg);
		background: var(--sev-3-bg);
		color: var(--sev-3-ink);
	}
	.sev-tag {
		opacity: 0.85;
		font-size: 12px;
	}
	.sym-tip {
		width: 100%;
		margin: 0;
		padding: 8px 12px;
		border-radius: var(--radius-control);
		background: var(--accent-tint);
		color: var(--accent-ink);
		font-size: 13px;
		line-height: 1.45;
		animation: tip-in 0.18s ease;
	}
	@keyframes tip-in {
		from { opacity: 0; transform: translateY(-4px); }
		to   { opacity: 1; transform: translateY(0); }
	}
	@media (prefers-reduced-motion: reduce) {
		.sym-tip { animation: none; }
	}

	/* Flare quick-action — slim inline row, visually subordinate to Flow + Symptoms. */
	.flare-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 10px 14px;
		margin-bottom: 12px;
		border: 1px solid var(--accent-tint);
		border-radius: var(--radius-control);
		background: var(--accent-tint);
		color: var(--accent);
		text-decoration: none;
		transition: opacity 0.12s;
	}
	.flare-card:active {
		opacity: 0.7;
	}
	.flare-title {
		font-size: 14px;
		font-weight: 600;
		letter-spacing: -0.1px;
		color: var(--accent);
	}

	/* Collapsed occasional-use section: reads like a slim card-row, opens on tap. */
	.add-row {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		min-height: 50px;
		padding: 0 16px;
		margin-bottom: 16px;
		border: 1px solid var(--line);
		border-radius: var(--radius-card);
		background: var(--surface);
		color: var(--accent);
		font-size: 15px;
		font-weight: 600;
		letter-spacing: -0.2px;
		text-align: left;
		transition: background 0.12s;
	}
	.add-row:active {
		background: var(--surface-sunken);
	}

	.weight-row {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-top: 8px;
	}
	.weight-row input {
		flex: 1;
		border: 1px solid var(--line);
		border-radius: var(--radius-control);
		padding: 12px;
		font-size: 15px;
		color: var(--ink);
		background: var(--surface);
		outline: none;
		-moz-appearance: textfield;
		appearance: textfield;
	}
	.weight-row input:focus {
		border-color: var(--accent);
	}
	.weight-row input::-webkit-outer-spin-button,
	.weight-row input::-webkit-inner-spin-button {
		-webkit-appearance: none;
		margin: 0;
	}
	.weight-warning {
		margin-top: 8px;
		font-size: 13px;
		line-height: 1.4;
		color: var(--attn-ink);
	}
	.unit {
		color: var(--ink-soft);
		font-size: 15px;
	}

	textarea {
		width: 100%;
		border: 1.5px solid var(--line);
		border-radius: var(--radius-control);
		padding: 12px;
		font-size: 15px;
		color: var(--ink);
		background: var(--surface);
		resize: none;
		outline: none;
		margin-top: 8px;
	}
	textarea:focus {
		border-color: var(--accent);
	}

	.delete {
		display: block;
		width: 100%;
		padding: 14px;
		background: none;
		border: none;
		color: var(--flow-heavy-ink);
		font-size: 14px;
		margin-top: 4px;
	}
	.confirm-row {
		display: flex;
		gap: 10px;
		margin-top: 4px;
	}
	.confirm-cancel,
	.confirm-delete {
		flex: 1;
		padding: 14px;
		border-radius: var(--radius-control);
		font-size: 15px;
		font-weight: 600;
		transition: transform 0.1s;
	}
	.confirm-cancel:active,
	.confirm-delete:active {
		transform: scale(0.98);
	}
	.confirm-cancel {
		background: var(--surface);
		border: 1.5px solid var(--line);
		color: var(--ink);
	}
	.confirm-delete {
		background: var(--flow-heavy);
		border: none;
		color: #fff;
	}

</style>
