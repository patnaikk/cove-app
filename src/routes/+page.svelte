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
	import { humanize, todayISO, shiftISO, friendlyDate, longDate } from '$lib/ui/format';
	import { getWeightUnit, kgToDisplay, displayToKg } from '$lib/ui/preferences.svelte';
	import { selectionTick, successTick } from '$lib/ui/haptics';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
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
			if (target !== selectedDate) selectedDate = target;
		});
	});
	let existingId = $state<string | null>(null);

	let flow = $state<FlowIntensity>('none');
	// symptom key -> severity (absent key = not logged)
	let symptomMap = $state<Record<string, Severity>>({});
	let activeTip = $state<string | null>(null);
	let mood = $state<Mood[]>([]);
	let weight = $state<string>('');
	let notes = $state('');

	let saving = $state(false);
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
				? `${status.daysSince} ${status.daysSince === 1 ? 'day' : 'days'} since your last period`
				: 'No period logged yet'
	);

	function reset() {
		flow = 'none';
		symptomMap = {};
		mood = [];
		weight = '';
		notes = '';
		existingId = null;
	}

	async function load(date: string) {
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
				notes = entry.notes ?? '';
			} else {
				reset();
			}
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

	// Tap cycles a symptom: off -> mild -> moderate -> severe -> off
	function cycleSymptom(key: Symptom) {
		selectionTick();
		const current = symptomMap[key];
		const next = current === undefined ? 1 : current === 3 ? undefined : ((current + 1) as Severity);
		const copy = { ...symptomMap };
		if (next === undefined) {
			delete copy[key];
			// Hide tip when symptom is deselected
			if (activeTip === key) activeTip = null;
		} else {
			copy[key] = next;
			// Show this symptom's tip (hides any other open tip)
			activeTip = SYMPTOM_TIPS[key] ? key : null;
		}
		symptomMap = copy;
	}

	function selectFlow(level: FlowIntensity) {
		selectionTick();
		flow = level;
	}

	function toggleMood(value: Mood) {
		selectionTick();
		mood = mood.includes(value) ? mood.filter((v) => v !== value) : [...mood, value];
	}

	function goPrev() {
		selectionTick();
		selectedDate = shiftISO(selectedDate, -1);
	}
	function goNext() {
		if (isToday) return;
		selectionTick();
		selectedDate = shiftISO(selectedDate, 1);
	}

	async function save() {
		// Don't create a blank record for a day the user never actually logged anything on.
		const hasContent =
			flow !== 'none' ||
			Object.keys(symptomMap).length > 0 ||
			mood.length > 0 ||
			String(weight ?? '').trim() !== '' ||
			notes.trim().length > 0;
		if (!existingId && !hasContent) return;

		saving = true;
		saveError = false;
		const symptoms = (Object.entries(symptomMap) as [Symptom, Severity][]).map(
			([key, severity]) => ({ key, severity })
		);
		// type="number" binding can hand back a number, '', or null — normalise first.
		const rawWeight = String(weight ?? '').trim();
		const parsedWeight = rawWeight === '' ? null : Number(rawWeight);
		// Treat 0 as unset — no human weighs 0 kg/lb, and it would corrupt the
		// weight range in the report. Negative values equally impossible.
		const weightKg =
			parsedWeight != null && Number.isFinite(parsedWeight) && parsedWeight > 0
				? displayToKg(parsedWeight)
				: null;
		const payload = {
			date: selectedDate,
			flow_intensity: flow,
			symptoms,
			mood,
			weight: weightKg,
			notes
		};
		try {
			if (existingId) {
				await updateEntry(existingId, payload);
			} else {
				const created = await addEntry(payload);
				existingId = created.id;
			}
			allEntries = await getAllEntries();
			justSaved = true;
			successTick();
			setTimeout(() => (justSaved = false), 2000);

			// Fire the native review prompt when the user logs the FIRST day of their
			// second period. By that point they've completed a full cycle and returned
			// — a strong satisfaction signal. We check that today's date is the start
			// of episode 2 (not just any day within it) so this only fires once even
			// if the localStorage guard is ever cleared by a reinstall.
			if (flow !== 'none') {
				const episodes = detectEpisodesPublic(allEntries);
				if (episodes.length === 2 && episodes[1].start === selectedDate) {
					// Small delay so the save confirmation animates first.
					setTimeout(() => { void maybeRequestReview(); }, 1500);
				}
			}
		} catch (e) {
			console.error('[vault/db] save failed:', e);
			saveError = true;
		} finally {
			saving = false;
		}
	}

	let confirmingDelete = $state(false);

	async function remove() {
		if (!existingId) return;
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

<div class="page">
	<header class="nav-bar">
		<h1 class="large-title">{friendlyDate(selectedDate)}</h1>
		<!-- The flare quick-log always records *today*, so only offer it on today —
		     otherwise it silently logs to the wrong day while you browse history. -->
		{#if isToday}
			<a class="bar-btn" href="/flare">Log pain</a>
		{/if}
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
									aria-label={sev ? `${humanize(key)}, ${SEVERITY_LABELS[sev]}` : humanize(key)}
									onclick={() => cycleSymptom(key)}
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

		<section class="card">
			<h2>Weight</h2>
			<div class="weight-row">
				<input
					type="number"
					inputmode="decimal"
					bind:value={weight}
					onfocus={scrollFocus}
					placeholder="Optional"
					aria-label="Weight in {weightUnit}"
					min="0"
					step="0.1"
				/>
				<span class="unit">{weightUnit}</span>
			</div>
		</section>

		<section class="card">
			<h2>Notes</h2>
			<textarea bind:value={notes} onfocus={scrollFocus} rows="3" placeholder="Anything worth remembering…" aria-label="Notes"></textarea>
		</section>

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

{#if !loadError}
	<div class="footer">
		{#if saveError}
			<p class="save-error" role="alert">Couldn’t save — please try again.</p>
		{/if}
		<button class="save" class:saved={justSaved} onclick={save} disabled={saving || loading}>
			{#if justSaved}
				<svg class="check" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
				<span>Saved</span>
			{:else if saving}Saving…{:else if existingId}Update entry{:else}Save entry{/if}
		</button>
	</div>
{/if}

<style>
	.page {
		padding: 0 16px 160px;
	}

	/* Navigation bar with a left-aligned Large Title (34pt) + trailing bar button. */
	.nav-bar {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 12px;
		padding: 16px 0 0;
	}
	.bar-btn {
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		min-width: 44px;
		padding: 0 4px 2px;
		color: var(--accent);
		font-size: 17px;
		font-weight: 600;
		letter-spacing: -0.2px;
		text-decoration: none;
		transition: opacity 0.12s;
	}
	.bar-btn:active {
		opacity: 0.4;
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
		color: var(--flow-heavy);
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
	.save-error {
		margin: 0 0 10px;
		text-align: center;
		font-size: 13px;
		color: var(--flow-heavy);
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
	.content.intro > .card {
		opacity: 0;
		animation: card-in 0.4s cubic-bezier(0.22, 1, 0.36, 1) forwards;
	}
	.content.intro > .card:nth-child(1) {
		animation-delay: 0.02s;
	}
	.content.intro > .card:nth-child(2) {
		animation-delay: 0.07s;
	}
	.content.intro > .card:nth-child(3) {
		animation-delay: 0.12s;
	}
	.content.intro > .card:nth-child(4) {
		animation-delay: 0.17s;
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
		.content.intro > .card {
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
		color: var(--flow-heavy);
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

	.footer {
		position: fixed;
		/* Sit directly above the persistent bottom tab bar. */
		bottom: calc(56px + var(--safe-bottom));
		left: 0;
		right: 0;
		max-width: 480px;
		margin: 0 auto;
		padding: 12px 20px 14px;
		background: linear-gradient(to top, var(--bg) 78%, transparent);
	}
	.save {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		width: 100%;
		min-height: 50px;
		padding: 0 16px;
		border: none;
		border-radius: var(--radius-pill);
		background: var(--accent-fill);
		color: #fff;
		font-size: 17px;
		font-weight: 600;
		letter-spacing: -0.2px;
		transition:
			background 0.2s ease,
			transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
	}
	.save:active {
		transform: scale(0.98);
	}
	.save:disabled {
		opacity: 0.6;
	}
	/* Success micro-interaction: confirm with a check that springs in. */
	.save.saved {
		filter: brightness(0.9);
	}
	.save .check {
		animation: check-pop 0.34s cubic-bezier(0.34, 1.56, 0.64, 1);
	}
	@keyframes check-pop {
		0% {
			transform: scale(0.4);
			opacity: 0;
		}
		100% {
			transform: scale(1);
			opacity: 1;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.save .check {
			animation: none;
		}
	}
</style>
