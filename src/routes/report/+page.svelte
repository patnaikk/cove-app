<script lang="ts">
	import { ensureDb } from '$lib/db/init';
	import { getAllEntries, updateEntry } from '$lib/db/cycleRepository';
	import { SEVERITY_LABELS, type CycleEntry, type Severity } from '$lib/db/schema';
	import { buildSummary, type ReportSummary, type Regularity } from '$lib/report/analyze';
	import { buildCsv } from '$lib/report/csv';
	import { downloadText, printReport } from '$lib/report/export';
	import { isPdfUnlocked, devSetPdfUnlocked, purchasePdfUnlock } from '$lib/billing/entitlement';
	import { Capacitor } from '@capacitor/core';
	import { humanize, todayISO, shiftISO, daysBetween, friendlyDate, mediumDate } from '$lib/ui/format';
	import { getWeightUnit, kgToDisplay } from '$lib/ui/preferences.svelte';
	import { selectionTick, successTick } from '$lib/ui/haptics';

	type Range = '3m' | '6m' | 'all';
	const RANGES: { id: Range; label: string }[] = [
		{ id: '3m', label: '3 months' },
		{ id: '6m', label: '6 months' },
		{ id: 'all', label: 'All time' }
	];

	const RANGE_DAYS: Record<Range, number | null> = { '3m': 90, '6m': 180, all: null };

	let range = $state<Range>('3m');
	let rangeInitialized = false; // adaptive default is picked once, on first load
	let autoWidened = $state(false); // true when we widened past 3m to reveal an old period
	let loading = $state(true);
	let loadingShown = $state(false);
	let loadTimer: ReturnType<typeof setTimeout>;
	let loadError = $state(false);
	let allEntries = $state<CycleEntry[]>([]);
	let unlocked = $state(false);

	// The displayed report is scoped to the selected range, but it's filtered from
	// the full history in memory — so the whole-history signals below (last period,
	// "is there a report worth selling yet") stay consistent no matter the range.
	function rangeFilter(all: CycleEntry[], r: Range): CycleEntry[] {
		const days = RANGE_DAYS[r];
		if (days == null) return all;
		const start = shiftISO(todayISO(), -days);
		return all.filter((e) => e.date >= start && e.date <= todayISO());
	}
	const entries = $derived(rangeFilter(allEntries, range));

	const summary = $derived<ReportSummary>(buildSummary(entries, todayISO()));
	// Computed over ALL history, independent of the selected range.
	const allSummary = $derived<ReportSummary>(buildSummary(allEntries, todayISO()));
	const generatedOn = $derived(friendlyDate(todayISO()));
	const weightUnit = $derived(getWeightUnit());

	// One signal, evaluated over the whole log, drives both the adaptive range and
	// the paywall prominence — so they can't disagree about "is there enough yet".
	// A single first-period tap is NOT enough; we wait for a real, sellable report.
	const reportableHistory = $derived(allSummary.episodes.length >= 1 && allEntries.length >= 3);

	// Single-/open-cycle feedback: irregular users (the core audience) can't get a
	// cycle-LENGTH number until two periods, but we can still reflect an unusually
	// long open gap from a single period — the validation they came for, months early.
	const openCycleNote = $derived(
		summary.lastPeriodStart &&
			summary.daysSinceLastPeriod != null &&
			summary.cycleLengthMedian == null &&
			summary.daysSinceLastPeriod > 35
			? `It’s been ${summary.daysSinceLastPeriod} days since your last period began. A typical cycle runs about 21–35 days — worth mentioning to your doctor if that’s unusual for you.`
			: null
	);

	// Free: the cycle summary, flags, and cycle history — the at-a-glance picture
	// and the user's own factual data. Paid: the detailed symptom/mood/weight
	// analysis and the shareable PDF — the clinical artifact for a doctor.
	const locked = $derived(!unlocked);
	// A genuine, data-driven preview of what the full report contains — the first
	// symptom group shown in full, then an honest count of what's behind the lock.
	const previewGroup = $derived(summary.symptomGroups[0] ?? null);
	const lockedSymptomCount = $derived(
		summary.symptomGroups.reduce((n, g) => n + g.stats.length, 0) -
			(previewGroup?.stats.length ?? 0)
	);
	const lockedGroupCount = $derived(Math.max(0, summary.symptomGroups.length - 1));
	const moodDayTotal = $derived(summary.moodCounts.reduce((n, m) => n + m.days, 0));

	// Flags split: urgent health signals stay free; the analytical observations are
	// part of the paid detailed report (shown as a count when locked).
	// Urgent flags always derive from the FULL history so narrowing the range to 3m
	// can never hide a "no period in 90+ days" medical alert.
	const urgentFlags = $derived(allSummary.flags.filter((f) => f.urgent));
	const analyticalFlags = $derived(summary.flags.filter((f) => !f.urgent));

	// For the PDF: how many complete cycles back the length stats, and the user's
	// own dated notes (captured but never surfaced in the report until now).
	const completeCycles = $derived(
		summary.cycles.filter((c) => !c.excluded && c.cycleLength != null).length
	);
	const datedNotes = $derived(
		entries
			.filter((e) => e.notes && e.notes.trim().length > 0)
			.sort((a, b) => a.date.localeCompare(b.date))
	);
	function severityWord(sev: Severity): string {
		return SEVERITY_LABELS[sev];
	}
	// Weight trajectory (direction + magnitude + n) — PCOS-relevant, from the dated
	// weights we already store but previously reduced to just latest + min/max.
	const weightTrend = $derived.by(() => {
		const ws = entries
			.filter((e) => e.weight != null)
			.sort((a, b) => a.date.localeCompare(b.date));
		if (ws.length < 2) return null;
		const first = ws[0].weight as number;
		const last = ws[ws.length - 1].weight as number;
		return {
			count: ws.length,
			firstDate: ws[0].date,
			lastDate: ws[ws.length - 1].date,
			deltaKg: last - first
		};
	});

	const REGULARITY_LABEL: Record<Regularity, string> = {
		regular: 'Regular',
		irregular: 'Irregular',
		insufficient: 'Not enough data'
	};

	// A clinical metric leads with the typical value, then its variability.
	function metric(
		med: number | null,
		min: number | null,
		max: number | null
	): { big: string; sub: string } {
		if (med == null || min == null || max == null) return { big: '—', sub: '' };
		return { big: `${med}`, sub: min === max ? 'consistent' : `range ${min}–${max}` };
	}

	function severityLabel(sev: Severity): string {
		return `${SEVERITY_LABELS[sev]} (${sev}/3)`;
	}

	function daysAgo(n: number): string {
		if (n === 0) return 'today';
		return `${n} ${n === 1 ? 'day' : 'days'} ago`;
	}

	function setRange(r: Range) {
		selectionTick();
		autoWidened = false; // the user is now driving the range; drop the auto-note
		range = r;
	}

	// Pick the narrowest range that still contains the most recent period, so an
	// irregular user whose last period was months ago doesn't open the report to
	// an empty 3-month window. Regular users stay on the clean 3-month default.
	function pickInitialRange(all: CycleEntry[]): Range {
		const lp = buildSummary(all, todayISO()).lastPeriodStart;
		if (!lp) return '3m';
		const since = daysBetween(lp, todayISO());
		if (since <= 90) return '3m';
		if (since <= 180) return '6m';
		return 'all';
	}

	async function load() {
		loading = true;
		loadError = false;
		clearTimeout(loadTimer);
		loadTimer = setTimeout(() => {
			if (loading) loadingShown = true;
		}, 180);
		try {
			await ensureDb();
			allEntries = await getAllEntries();
			unlocked = isPdfUnlocked();
			if (!rangeInitialized) {
				rangeInitialized = true;
				const picked = pickInitialRange(allEntries);
				if (picked !== '3m') autoWidened = true;
				range = picked;
			}
		} catch (e) {
			console.error('[vault/db] load failed:', e);
			loadError = true;
		} finally {
			loading = false;
			clearTimeout(loadTimer);
			loadingShown = false;
		}
	}

	$effect(() => {
		load();
	});

	// The exclude flag lives on the period-start day's entry.
	const entryByDate = $derived<Record<string, CycleEntry>>(
		Object.fromEntries(entries.map((e) => [e.date, e]))
	);

	async function toggleExclude(startDate: string, exclude: boolean) {
		const entry = entryByDate[startDate];
		if (!entry) return;
		selectionTick();
		await updateEntry(entry.id, { exclude_from_stats: exclude });
		// Refresh in place (no global loading flash) — the derived summary recomputes
		// from the new data, so the stats update without the report blanking out.
		allEntries = await getAllEntries();
	}

	async function exportCsv() {
		try {
			// Always export the full history, not just the currently displayed range.
			await downloadText(`cove-export-${todayISO()}.csv`, buildCsv(allEntries), 'text/csv');
		} catch (e) {
			console.error('[cove] export failed:', e);
		}
	}

	function exportPdf() {
		if (!unlocked) return;
		printReport();
	}

	let purchasing = $state(false);
	let purchaseError = $state('');

	async function unlock() {
		purchaseError = '';
		if (Capacitor.isNativePlatform()) {
			purchasing = true;
			try {
				await purchasePdfUnlock();
				unlocked = isPdfUnlocked();
				if (unlocked) successTick();
			} catch (e: any) {
				purchaseError = e?.message ?? 'Purchase failed. Please try again.';
			} finally {
				purchasing = false;
			}
		} else {
			// Browser dev only.
			devSetPdfUnlocked(true);
			unlocked = true;
			successTick();
		}
	}
</script>

<div class="page">
	<div class="topbar no-print">
		<h1 class="large-title">Report</h1>
	</div>

	{#if !loading && !loadError && allEntries.length > 0}
		<div class="segmented no-print" role="group" aria-label="Time range">
			{#each RANGES as r (r.id)}
				<button class="segment" class:on={range === r.id} aria-pressed={range === r.id} onclick={() => setRange(r.id)}>
					{r.label}
				</button>
			{/each}
		</div>
	{/if}

	{#if autoWidened && !loading && !loadError}
		<p class="range-note no-print">Showing a wider range — your last period was over 3 months ago.</p>
	{/if}

	{#if loading}
		{#if loadingShown}<div class="loading">Loading…</div>{/if}
	{:else if loadError}
		<div class="error-state">
			<p class="error-title">We couldn’t open your data</p>
			<p class="error-body">Your entries are safe on this device. Try again in a moment.</p>
			<button class="retry" onclick={() => load()}>Try again</button>
		</div>
	{:else if allEntries.length === 0}
		<div class="first-run">
			<div class="fr-icon" aria-hidden="true">
				<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V5M4 19h16M8 16v-4M12 16V8M16 16v-6" /></svg>
			</div>
			<h2>Your report builds itself</h2>
			<p>Log a few days on the Today screen and your cycle summary, patterns worth discussing, and a doctor-ready report will appear here automatically.</p>
			<a class="fr-cta" href="/">Start logging</a>
		</div>
	{:else}
		{#key range}
		<div class="report-doc">
			<div class="doc-head">
				<h1>Cycle &amp; symptom report</h1>
				<p class="meta">
					Generated {generatedOn} · {summary.entryCount} day{summary.entryCount === 1 ? '' : 's'} logged
					{#if summary.rangeStart && summary.rangeEnd}
						· {mediumDate(summary.rangeStart)} – {mediumDate(summary.rangeEnd)}
					{/if}
				</p>
				<p class="disclaimer">
					A record of what was logged. It describes observed history and makes no predictions.
				</p>
			</div>

			{#if summary.entryCount === 0}
				<p class="empty">No entries in this range yet.</p>
			{:else}
				<section class="headline">
					<div class="headline-main">
						<span class="hl-label">Last period</span>
						<span class="hl-value">
							{#if summary.lastPeriodStart}
								{mediumDate(summary.lastPeriodStart)}
								<span class="hl-sub">· {daysAgo(summary.daysSinceLastPeriod!)}</span>
							{:else}
								No period logged
							{/if}
						</span>
					</div>
				</section>

				{@const cyc = metric(summary.cycleLengthMedian, summary.cycleLengthMin, summary.cycleLengthMax)}
				{@const per = metric(summary.periodLengthMedian, summary.periodLengthMin, summary.periodLengthMax)}
				<section class="stat-row">
					<div class="stat">
						<span class="stat-num">{cyc.big}</span>
						<span class="stat-sub">{cyc.sub || ' '}</span>
						<span class="stat-lbl">Cycle length · days</span>
					</div>
					<div class="stat">
						<span class="stat-num reg reg-{summary.regularity}">
							{REGULARITY_LABEL[summary.regularity]}
						</span>
						<span class="stat-sub">&nbsp;</span>
						<span class="stat-lbl">Regularity</span>
					</div>
					<div class="stat">
						<span class="stat-num">{per.big}</span>
						<span class="stat-sub">{per.sub || ' '}</span>
						<span class="stat-lbl">Period length · days</span>
					</div>
				</section>
					{#if completeCycles > 0}
						<p class="cycle-basis">Based on {completeCycles} complete cycle{completeCycles === 1 ? '' : 's'}</p>
					{/if}

				{#if openCycleNote}
					<p class="observation">{openCycleNote}</p>
				{/if}

				{#if summary.regularity === 'insufficient'}
					<p class="nudge">
						Cycle length and regularity appear once you’ve logged a second period — keep
						logging and your patterns will build here.
					</p>
				{/if}

				{@const shownFlags = unlocked ? summary.flags : urgentFlags}
				{#if shownFlags.length > 0}
					<section class="flags">
						<h2>Worth discussing</h2>
						<ul>
							{#each shownFlags as f, i (i)}
								<li>{f.text}</li>
							{/each}
						</ul>
						{#if !unlocked && analyticalFlags.length > 0}
							<p class="flags-locked">
								+{analyticalFlags.length} more observation{analyticalFlags.length === 1 ? '' : 's'} worth
								discussing in your full report.
							</p>
						{/if}
					</section>
				{:else if !unlocked && analyticalFlags.length > 0}
					<section class="flags">
						<h2>Worth discussing</h2>
						<p class="flags-locked flags-locked-solo">
							{analyticalFlags.length} observation{analyticalFlags.length === 1 ? '' : 's'} worth
							discussing with your doctor — unlock your full report to see {analyticalFlags.length === 1
								? 'it'
								: 'them'}.
						</p>
					</section>
				{/if}

				<section class="block">
					<h2>Cycle history</h2>
					{#if summary.cycles.length === 0}
						<p class="muted">No bleeding days in this range.</p>
					{:else}
						<table>
							<thead>
								<tr>
									<th>Period start</th>
									<th>Period (days)</th>
									<th>Cycle (days)</th>
									<th class="no-print">In stats</th>
								</tr>
							</thead>
							<tbody>
								{#each summary.cycles as c (c.start)}
									<tr class:excluded={c.excluded}>
										<td>
											{mediumDate(c.start)}
											{#if c.excluded}<span class="ex-tag">excluded</span>{/if}
										</td>
										<td>{c.periodLength}</td>
										<td>{c.cycleLength ?? '—'}</td>
										<td class="no-print toggle-cell">
											<button
												class="mini-toggle"
												class:on={!c.excluded}
												role="switch"
												aria-checked={!c.excluded}
												aria-label="Include this cycle in statistics"
												onclick={() => toggleExclude(c.start, !c.excluded)}
											>
												<span class="knob"></span>
											</button>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
						<p class="muted note">
							Turn a cycle off to keep it in your log but exclude it from the length
							ranges and regularity above — useful for an unusual cycle (stress, a
							procedure, a medication change) that would otherwise skew your baseline.
						</p>
						{#if summary.heavyDays > 0}
							<p class="muted note">
								{summary.heavyDays} heavy-flow day{summary.heavyDays === 1 ? '' : 's'} across
								{summary.bleedingDays} bleeding day{summary.bleedingDays === 1 ? '' : 's'}.
							</p>
						{/if}
					{/if}
				</section>

				{#if unlocked}
					{#if summary.symptomGroups.length === 0}
						<section class="block">
							<h2>Symptoms</h2>
							<p class="muted">No symptoms logged.</p>
						</section>
					{:else}
						{#each summary.symptomGroups as group (group.label)}
							<section class="block">
								<h2>{group.label}</h2>
								<table>
									<thead>
										<tr><th>Symptom</th><th>Days</th><th>Peak</th><th>On period</th></tr>
									</thead>
									<tbody>
										{#each group.stats as s (s.key)}
											<tr>
												<td>{humanize(s.key)}</td>
												<td>{s.days}</td>
												<td>{severityLabel(s.peakSeverity)}</td>
												<td>{s.onBleedingDays}/{s.days}</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</section>
						{/each}
					{/if}

					{#if summary.moodCounts.length > 0}
						<section class="block">
							<h2>Mood</h2>
							<p class="inline-list">
								{#each summary.moodCounts as m (m.mood)}
									<span class="pill">{humanize(m.mood)} · {m.days}</span>
								{/each}
							</p>
						</section>
					{/if}

					{#if summary.weight}
						<section class="block">
							<h2>Weight</h2>
							<p class="muted">
								Latest {kgToDisplay(summary.weight.latest)} {weightUnit} · range
								{kgToDisplay(summary.weight.min)}–{kgToDisplay(summary.weight.max)} {weightUnit}
							</p>
						</section>
					{/if}
				{:else}
					<!-- Locked: one real symptom group shown in full as a genuine preview,
					     then an honest, data-driven list of what the full report adds. -->
					{#if previewGroup}
						<section class="block">
							<h2>{previewGroup.label}</h2>
							<table>
								<thead>
									<tr><th>Symptom</th><th>Days</th><th>Peak</th><th>On period</th></tr>
								</thead>
								<tbody>
									{#each previewGroup.stats as s (s.key)}
										<tr>
											<td>{humanize(s.key)}</td>
											<td>{s.days}</td>
											<td>{severityLabel(s.peakSeverity)}</td>
											<td>{s.onBleedingDays}/{s.days}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</section>
					{/if}

					{#if reportableHistory}
					<section class="block no-print">
						<div class="lock-card">
							<div class="lock-head">
								<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="3" /><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" /></svg>
								<span>Your full report</span>
							</div>
							<ul class="lock-list">
								{#if analyticalFlags.length > 0}
									<li>
										{analyticalFlags.length} observation{analyticalFlags.length === 1 ? '' : 's'} worth
										discussing with your doctor
									</li>
								{/if}
								{#if lockedSymptomCount > 0}
									<li>
										{lockedSymptomCount} more symptom{lockedSymptomCount === 1 ? '' : 's'}
										{#if lockedGroupCount > 0}
											across {lockedGroupCount} more categor{lockedGroupCount === 1 ? 'y' : 'ies'}
										{/if}, each ranked by peak severity and timing against your period
									</li>
								{:else if previewGroup}
									<li>Every symptom ranked by peak severity and timing against your period</li>
								{:else}
									<li>Every symptom you log, ranked by severity and timing against your period</li>
								{/if}
								{#if summary.moodCounts.length > 0}
									<li>Mood patterns across {moodDayTotal} logged day{moodDayTotal === 1 ? '' : 's'}</li>
								{/if}
								{#if summary.weight}
									<li>Your weight trend over the selected range</li>
								{/if}
								<li>A clean, formatted PDF to share with your doctor</li>
							</ul>
							<p class="lock-privacy">
								Unlocking only verifies your purchase with Apple — your logs never leave this device.
							</p>
						</div>
					</section>
					{/if}
				{/if}
			{/if}
		</div>
		{/key}

		<div class="actions no-print">
			<button class="btn ghost" onclick={exportCsv}>
				Export CSV
				<span class="badge">Free</span>
			</button>

			{#if unlocked}
				<button class="btn primary" onclick={exportPdf}>Save PDF report</button>
			{:else if reportableHistory}
				<button class="btn primary" onclick={unlock} disabled={purchasing}>
					{purchasing ? 'Opening…' : 'Unlock full report · $9.99'}
				</button>
				{#if purchaseError}<p class="purchase-error">{purchaseError}</p>{/if}
			{/if}
		</div>

		{#if !unlocked && reportableHistory}
			<p class="paywall-note no-print">One-time $9.99 — no subscription, ever. Processed by Apple — <a class="paywall-eula" href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/" target="_blank" rel="noopener">Terms apply</a>.</p>
		{:else if !unlocked}
			<p class="paywall-note no-print">Your shareable report unlocks as you log — keep going.</p>
		{/if}
	{/if}
</div>

<!--
	The paid artifact: a standalone, paper-designed clinical document — NOT the app
	UI. It's hidden on screen (the interactive .page is what you see) and only
	rendered to the page when printing / saving to PDF, which is gated behind the
	unlock. WKWebView routes window.print() to the iOS print / share sheet.
-->
{#if unlocked && !loading && !loadError && summary.entryCount > 0}
	<article class="print-doc" aria-hidden="true">

		<!-- ── Cover header ── -->
		<header class="pd-head">
			<div class="pd-titleblock">
				<p class="pd-brand">Cove</p>
				<h1>Cycle &amp; Symptom Report</h1>
				<p class="pd-meta">
					Generated {mediumDate(todayISO())}
					{#if summary.rangeStart && summary.rangeEnd}
						&middot; {mediumDate(summary.rangeStart)} – {mediumDate(summary.rangeEnd)}
					{/if}
					&middot; {summary.entryCount} day{summary.entryCount === 1 ? '' : 's'} logged
				</p>
			</div>
			<div class="pd-patient">
				<span class="pd-field">Patient name <span class="pd-rule"></span></span>
				<span class="pd-field">Date of birth <span class="pd-rule"></span></span>
				<span class="pd-field">Clinician <span class="pd-rule"></span></span>
				<span class="pd-field">Appointment date <span class="pd-rule"></span></span>
			</div>
		</header>

		<!-- ── At a glance: 4-stat hero grid ── -->
		<section class="pd-section">
			<h2>At a glance</h2>
			<div class="pd-stats">
				<div class="pd-stat">
					<span class="pd-stat-label">Last period</span>
					{#if summary.lastPeriodStart}
						<span class="pd-stat-date">{mediumDate(summary.lastPeriodStart)}</span>
						<span class="pd-stat-sub">{daysAgo(summary.daysSinceLastPeriod!)}</span>
					{:else}
						<span class="pd-stat-nil">—</span>
						<span class="pd-stat-sub">not logged</span>
					{/if}
				</div>

				<div class="pd-stat">
					<span class="pd-stat-label">Cycle length</span>
					{#if summary.cycleLengthMedian != null}
						<span class="pd-stat-big">{summary.cycleLengthMedian}<span class="pd-stat-unit"> days</span></span>
						{#if summary.cycleLengthMin != null && summary.cycleLengthMax != null && summary.cycleLengthMin !== summary.cycleLengthMax}
							<span class="pd-stat-sub">range {summary.cycleLengthMin}–{summary.cycleLengthMax}</span>
						{:else}
							<span class="pd-stat-sub">consistent</span>
						{/if}
					{:else}
						<span class="pd-stat-nil">—</span>
						<span class="pd-stat-sub">not enough data yet</span>
					{/if}
				</div>

				<div class="pd-stat">
					<span class="pd-stat-label">Period length</span>
					{#if summary.periodLengthMedian != null}
						<span class="pd-stat-big">{summary.periodLengthMedian}<span class="pd-stat-unit"> days</span></span>
						{#if summary.periodLengthMin != null && summary.periodLengthMax != null && summary.periodLengthMin !== summary.periodLengthMax}
							<span class="pd-stat-sub">range {summary.periodLengthMin}–{summary.periodLengthMax}</span>
						{:else}
							<span class="pd-stat-sub">consistent</span>
						{/if}
					{:else}
						<span class="pd-stat-nil">—</span>
						<span class="pd-stat-sub">not enough data yet</span>
					{/if}
				</div>

				<div class="pd-stat pd-stat-edge">
					<span class="pd-stat-label">Regularity</span>
					<span class="pd-reg pd-reg-{summary.regularity}">{REGULARITY_LABEL[summary.regularity]}</span>
					{#if completeCycles > 0}
						<span class="pd-stat-sub">{completeCycles} complete cycle{completeCycles === 1 ? '' : 's'}</span>
					{:else}
						<span class="pd-stat-sub">&nbsp;</span>
					{/if}
				</div>
			</div>
			{#if summary.bleedingDays > 0}
				<p class="pd-bleed-note">{summary.bleedingDays} bleeding day{summary.bleedingDays === 1 ? '' : 's'} in this range{summary.heavyDays > 0 ? ` · ${summary.heavyDays} heavy` : ''}</p>
			{/if}
		</section>

		<!-- ── Worth discussing: amber callout ── -->
		{#if summary.flags.length > 0}
			<section class="pd-section">
				<h2>Worth discussing with your doctor</h2>
				<div class="pd-callout">
					<ul class="pd-flags">
						{#each summary.flags as f, i (i)}
							<li>{f.text}</li>
						{/each}
					</ul>
				</div>
			</section>
		{/if}

		<!-- ── Cycle history ── -->
		{#if summary.cycles.length > 0}
			{@const showHeavy = summary.heavyDays > 0}
			<section class="pd-section">
				<h2>Cycle history</h2>
				<table class="pd-table pd-zebra">
					<thead>
						<tr>
							<th>Period start</th>
							<th class="num">Period length</th>
							{#if showHeavy}<th class="num">Heavy days</th>{/if}
							<th class="num">Cycle length</th>
						</tr>
					</thead>
					<tbody>
						{#each summary.cycles as c (c.start)}
							<tr class:pd-excluded={c.excluded}>
								<td>{mediumDate(c.start)}{#if c.excluded}<span class="pd-ex-tag">excluded</span>{/if}</td>
								<td class="num">{c.periodLength} days</td>
								{#if showHeavy}<td class="num">{c.heavyDays}</td>{/if}
								<td class="num">{c.cycleLength != null ? `${c.cycleLength} days` : 'In progress'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</section>
		{/if}

		<!-- ── Symptoms (grouped) ── -->
		{#if summary.symptomGroups.length > 0}
			<section class="pd-section">
				<h2>Symptoms</h2>
				{#each summary.symptomGroups as group (group.label)}
					<h3 class="pd-group-head">{group.label}</h3>
					<table class="pd-table pd-zebra">
						<thead>
							<tr>
								<th>Symptom</th>
								<th class="num">Days</th>
								<th class="num">Worst severity</th>
								<th class="num">During period</th>
							</tr>
						</thead>
						<tbody>
							{#each group.stats as s (s.key)}
								<tr>
									<td>{humanize(s.key)}</td>
									<td class="num">{s.days}</td>
									<td class="num pd-sev pd-sev-{s.peakSeverity}">{severityWord(s.peakSeverity)}</td>
									<td class="num">{s.onBleedingDays} of {s.days}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/each}
			</section>
		{/if}

		<!-- ── Mood + Weight (side by side when both present) ── -->
		{#if summary.moodCounts.length > 0 || summary.weight}
			<div class="pd-wellbeing">
				{#if summary.moodCounts.length > 0}
					<section class="pd-section">
						<h2>Mood</h2>
						<table class="pd-table pd-zebra pd-narrow">
							<thead>
								<tr><th>Mood</th><th class="num">Days</th></tr>
							</thead>
							<tbody>
								{#each summary.moodCounts as m (m.mood)}
									<tr>
										<td>{humanize(m.mood)}</td>
										<td class="num">{m.days}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</section>
				{/if}

				{#if summary.weight}
					<section class="pd-section">
						<h2>Weight</h2>
						<table class="pd-table pd-narrow">
							<tbody>
								<tr>
									<td class="pd-wkey">Latest</td>
									<td>{kgToDisplay(summary.weight.latest)} {weightUnit}</td>
								</tr>
								<tr>
									<td class="pd-wkey">Range</td>
									<td>{kgToDisplay(summary.weight.min)}–{kgToDisplay(summary.weight.max)} {weightUnit}</td>
								</tr>
								{#if weightTrend}
									{@const d = kgToDisplay(Math.abs(weightTrend.deltaKg))}
									<tr>
										<td class="pd-wkey">Trend</td>
										<td>
											{#if weightTrend.deltaKg === 0}
												No net change over {weightTrend.count} readings
											{:else}
												{weightTrend.deltaKg > 0 ? '+' : '−'}{d} {weightUnit} over {weightTrend.count} readings
											{/if}
										</td>
									</tr>
								{/if}
							</tbody>
						</table>
					</section>
				{/if}
			</div>
		{/if}

		<!-- ── Notes ── -->
		{#if datedNotes.length > 0}
			<section class="pd-section">
				<h2>Notes</h2>
				<table class="pd-table pd-zebra">
					<thead>
						<tr><th class="pd-note-date">Date</th><th>Note</th></tr>
					</thead>
					<tbody>
						{#each datedNotes as e (e.id)}
							<tr>
								<td class="pd-note-date">{mediumDate(e.date)}</td>
								<td>{e.notes}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</section>
		{/if}

		<footer class="pd-foot">
			This report describes self-logged history only. It makes no predictions and is
			not a medical diagnosis. Generated with Cove — all data is stored privately on
			this device and never uploaded.
		</footer>

		<div class="pd-running" aria-hidden="true">
			<span>Cove · Cycle &amp; Symptom Report</span>
			<span>{mediumDate(todayISO())}</span>
		</div>

	</article>
{/if}

<style>
	.page {
		padding: 0 16px calc(96px + var(--safe-bottom));
	}

	.topbar {
		display: flex;
		align-items: center;
		padding-top: 16px;
	}

	/* iOS segmented control: one track, the selected segment lifts to a fill. */
	.segmented {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 2px;
		margin: 16px 0 0;
		padding: 2px;
		border-radius: var(--radius-control);
		background: var(--surface-sunken);
	}
	.segment {
		min-height: 40px;
		border: none;
		border-radius: 9px;
		background: transparent;
		color: var(--ink-soft);
		font-size: 13px;
		font-weight: 600;
		letter-spacing: -0.1px;
		transition:
			background 0.2s ease,
			color 0.2s ease,
			box-shadow 0.2s ease;
	}
	.segment.on {
		background: var(--surface);
		color: var(--ink);
		box-shadow: 0 1px 3px rgba(28, 27, 25, 0.12);
	}

	.loading {
		padding: 48px 0;
		text-align: center;
		color: var(--ink-soft);
	}
	.error-state {
		margin-top: 48px;
		text-align: center;
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

	.report-doc {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--radius-card);
		padding: 20px;
		margin-top: 16px;
		box-shadow: var(--shadow-card);
		animation: doc-in 0.24s ease;
	}
	/* Range change settles the document in, rather than hard-swapping. */
	@keyframes doc-in {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.report-doc {
			animation: none;
		}
	}
	.doc-head h1 {
		font-size: 19px;
		font-weight: 650;
		letter-spacing: -0.2px;
		color: var(--ink);
	}
	.meta {
		font-size: 13px;
		color: var(--ink-soft);
		margin-top: 6px;
	}
	.disclaimer {
		font-size: 13px;
		color: var(--ink-faint);
		margin-top: 8px;
		line-height: 1.4;
	}
	.cycle-basis {
		margin-top: 8px;
		font-size: 12px;
		color: var(--ink-faint);
		text-align: center;
	}

	.nudge {
		margin-top: 14px;
		padding: 12px 14px;
		border-radius: var(--radius-control);
		background: var(--accent-tint);
		color: var(--accent-ink);
		font-size: 14px;
		line-height: 1.45;
	}
	/* An observation drawn from a single open cycle — reflection, framed as
	   non-diagnostic. Calmer than a flag, warmer than the muted nudge. */
	.observation {
		margin-top: 14px;
		padding: 12px 14px;
		border-radius: var(--radius-control);
		background: var(--attn-bg);
		border: 1px solid var(--attn-line);
		color: var(--ink);
		font-size: 14px;
		line-height: 1.45;
	}
	/* Quiet note under the range control when we auto-widened to show an old period. */
	.range-note {
		margin: 8px 4px 0;
		font-size: 12px;
		color: var(--ink-faint);
		line-height: 1.4;
	}
	.empty {
		color: var(--ink-soft);
		padding: 24px 0;
		text-align: center;
	}

	/* Warm first-run state: a brand-new user opening Report before logging. */
	.first-run {
		margin-top: 48px;
		text-align: center;
		padding: 0 12px;
		animation: doc-in 0.3s ease;
	}
	.fr-icon {
		display: grid;
		place-items: center;
		width: 64px;
		height: 64px;
		margin: 0 auto 20px;
		border-radius: 18px;
		background: var(--accent-tint);
		color: var(--accent);
	}
	.first-run h2 {
		font-size: 20px;
		font-weight: 700;
		letter-spacing: -0.3px;
		color: var(--ink);
	}
	.first-run p {
		margin: 10px auto 0;
		max-width: 20rem;
		font-size: 15px;
		line-height: 1.5;
		color: var(--ink-soft);
	}
	.fr-cta {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		margin-top: 24px;
		min-height: 50px;
		padding: 0 28px;
		border-radius: var(--radius-pill);
		background: var(--accent-fill);
		color: #fff;
		font-size: 16px;
		font-weight: 600;
		letter-spacing: -0.2px;
		text-decoration: none;
		transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
	}
	.fr-cta:active {
		transform: scale(0.97);
	}

	.headline {
		margin-top: 16px;
	}
	.headline-main {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 14px 16px;
		border-radius: var(--radius-control);
		background: var(--accent-tint);
	}
	.hl-label {
		font-size: 12px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--accent-ink);
	}
	.hl-value {
		font-size: 18px;
		font-weight: 650;
		color: var(--ink);
	}
	.hl-sub {
		font-size: 13px;
		font-weight: 500;
		color: var(--ink-soft);
	}

	.stat-row {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
		margin: 16px 0 0;
	}
	.stat {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: flex-start;
		text-align: center;
		padding: 14px 8px;
		border-radius: var(--radius-control);
		background: var(--surface-sunken);
	}
	.stat-num {
		display: block;
		font-size: 28px;
		font-weight: 700;
		letter-spacing: -0.4px;
		line-height: 1.1;
		color: var(--accent-ink);
	}
	.stat-sub {
		font-size: 11px;
		font-weight: 500;
		color: var(--ink-soft);
		margin-top: 2px;
		min-height: 14px;
	}
	.stat-lbl {
		font-size: 12px;
		color: var(--ink-soft);
		margin-top: 6px;
	}
	.stat-num.reg {
		font-size: 18px;
		padding-top: 5px;
	}
	.reg-irregular {
		color: var(--flow-heavy);
	}
	.reg-insufficient {
		color: var(--ink-faint);
	}

	.flags {
		margin-top: 16px;
		padding: 16px;
		border-radius: var(--radius-control);
		background: var(--attn-bg);
		border: 1px solid var(--attn-line);
	}
	.flags h2 {
		font-size: 12px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--attn-ink);
		margin-bottom: 8px;
	}
	.flags ul {
		margin: 0;
		padding-left: 18px;
	}
	.flags li {
		font-size: 15px;
		color: var(--ink);
		line-height: 1.45;
		margin: 4px 0;
	}
	.flags-locked {
		margin: 10px 0 0;
		font-size: 13px;
		font-weight: 600;
		color: var(--accent-ink);
	}
	.flags-locked-solo {
		margin: 0;
		font-weight: 500;
	}

	.block {
		margin-top: 24px;
	}
	.note {
		margin-top: 12px;
		font-size: 13px;
		line-height: 1.45;
	}
	.block h2 {
		font-size: 13px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--ink-soft);
		margin-bottom: 12px;
	}
	.muted {
		color: var(--ink-soft);
		font-size: 14px;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 15px;
	}
	th {
		text-align: left;
		font-weight: 600;
		color: var(--ink-soft);
		font-size: 13px;
		padding: 8px;
		border-bottom: 1px solid var(--line);
	}
	td {
		padding: 10px 8px;
		border-bottom: 1px solid var(--line);
		color: var(--ink);
	}
	th:not(:first-child),
	td:not(:first-child) {
		text-align: right;
	}

	tr.excluded td:not(.toggle-cell) {
		color: var(--ink-faint);
		text-decoration: line-through;
		text-decoration-color: var(--ink-faint);
	}
	.ex-tag {
		display: inline-block;
		margin-left: 6px;
		padding: 1px 7px;
		border-radius: var(--radius-pill);
		background: var(--surface-sunken);
		color: var(--ink-soft);
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		text-decoration: none;
		vertical-align: middle;
	}
	.toggle-cell {
		text-align: right;
		width: 60px;
	}
	/* Real iOS switch proportions (51×31) inside a ≥44pt tap target. */
	.mini-toggle {
		display: inline-grid;
		place-items: center;
		width: 51px;
		min-height: 44px;
		padding: 0;
		border: none;
		background: transparent;
	}
	.mini-toggle .knob {
		position: relative;
		display: block;
		width: 51px;
		height: 31px;
		border-radius: var(--radius-pill);
		background: var(--line);
		transition: background 0.2s ease;
	}
	.mini-toggle.on .knob {
		background: var(--accent);
	}
	.mini-toggle .knob::after {
		content: '';
		position: absolute;
		top: 2px;
		left: 2px;
		width: 27px;
		height: 27px;
		border-radius: var(--radius-pill);
		background: #fff;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.22);
		transition: transform 0.2s cubic-bezier(0.34, 1.4, 0.64, 1);
	}
	.mini-toggle.on .knob::after {
		transform: translateX(20px);
	}

	.inline-list {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.pill {
		padding: 7px 12px;
		border-radius: var(--radius-pill);
		background: var(--accent-tint);
		color: var(--accent-ink);
		font-size: 13px;
	}

	.actions {
		display: flex;
		gap: 8px;
		margin-top: 24px;
	}
	.btn {
		flex: 1;
		min-height: 50px;
		border-radius: var(--radius-pill);
		border: none;
		font-size: 16px;
		font-weight: 600;
		letter-spacing: -0.2px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
	}
	.btn:active {
		transform: scale(0.98);
	}
	.btn.ghost {
		background: var(--surface);
		border: 1px solid var(--line);
		color: var(--ink);
	}
	.btn.primary {
		background: var(--accent-fill);
		color: #fff;
	}
	.badge {
		font-size: 11px;
		font-weight: 600;
		padding: 2px 8px;
		border-radius: var(--radius-pill);
		background: var(--accent-tint);
		color: var(--accent-ink);
	}
	/* Locked-state card: sits inside the report doc, below the free preview group. */
	.lock-card {
		border: 1px solid var(--line);
		border-radius: var(--radius-control);
		background: var(--surface-sunken);
		padding: 16px;
	}
	.lock-head {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 15px;
		font-weight: 650;
		letter-spacing: -0.2px;
		color: var(--ink);
	}
	.lock-head svg {
		color: var(--accent);
		flex: none;
	}
	.lock-list {
		margin: 12px 0 0;
		padding-left: 20px;
	}
	.lock-list li {
		font-size: 14px;
		line-height: 1.45;
		color: var(--ink-soft);
		margin: 6px 0;
	}
	.lock-privacy {
		margin-top: 14px;
		padding-top: 12px;
		border-top: 1px solid var(--line);
		font-size: 12px;
		line-height: 1.45;
		color: var(--ink-faint);
	}
	.paywall-note {
		margin-top: 12px;
		font-size: 13px;
		color: var(--ink-soft);
		text-align: center;
		line-height: 1.45;
	}
	.purchase-error {
		margin-top: 8px;
		font-size: 13px;
		color: var(--color-error, #c0392b);
		text-align: center;
	}
	.paywall-eula {
		color: var(--ink-soft);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	/* The print document is hidden on screen — it exists only to be printed. */
	.print-doc {
		display: none;
	}

	@media print {
		/* Swap the interactive app for the paper document */
		:global(html),
		:global(body) { background: #fff; }
		:global(nav.tabbar) { display: none !important; }
		:global(.app-shell) { max-width: none; margin: 0; padding: 0; }
		.page { display: none !important; }

		.print-doc {
			display: block;
			font-family: -apple-system, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif;
			font-size: 10pt;
			line-height: 1.5;
			color: #1a1a1a;
			-webkit-print-color-adjust: exact;
			print-color-adjust: exact;
		}

		@page { margin: 16mm 18mm; }

		/* ── Header ── */
		.pd-head {
			display: flex;
			justify-content: space-between;
			align-items: flex-end;
			gap: 20px;
			padding-bottom: 14px;
			border-bottom: 3px solid #3e5c50;
		}
		.pd-brand {
			font-size: 7pt;
			font-weight: 800;
			text-transform: uppercase;
			letter-spacing: 0.18em;
			color: #3e5c50;
			margin: 0 0 5px;
		}
		.pd-titleblock h1 {
			font-size: 22pt;
			font-weight: 700;
			letter-spacing: -0.5px;
			line-height: 1.1;
			color: #111;
			margin: 0 0 5px;
		}
		.pd-meta {
			font-size: 8.5pt;
			color: #777;
			margin: 0;
			line-height: 1.4;
		}
		.pd-patient {
			display: flex;
			flex-direction: column;
			gap: 11px;
			min-width: 200px;
			padding-bottom: 2px;
		}
		.pd-field {
			display: flex;
			align-items: baseline;
			gap: 7px;
			font-size: 7.5pt;
			font-weight: 600;
			text-transform: uppercase;
			letter-spacing: 0.06em;
			color: #999;
			white-space: nowrap;
		}
		.pd-rule {
			flex: 1;
			border-bottom: 1px solid #bbb;
			height: 0;
			min-width: 80px;
		}

		/* ── Section rhythm ── */
		.pd-section {
			margin-top: 22px;
			break-inside: avoid;
		}
		.pd-section h2 {
			font-size: 7pt;
			font-weight: 800;
			text-transform: uppercase;
			letter-spacing: 0.12em;
			color: #3e5c50;
			margin: 0 0 10px;
			padding-bottom: 5px;
			border-bottom: 1.5px solid #3e5c50;
		}
		.pd-group-head {
			font-size: 9.5pt;
			font-weight: 700;
			color: #333;
			margin: 18px 0 6px;
			padding: 0;
			border: none;
		}

		/* ── Stat hero grid ── */
		.pd-stats {
			display: grid;
			grid-template-columns: repeat(4, 1fr);
			border: 1px solid #c5dbd3;
			border-radius: 5px;
			overflow: hidden;
			background: #f2f7f5;
		}
		.pd-stat {
			padding: 14px 15px 12px;
			border-right: 1px solid #c5dbd3;
			display: flex;
			flex-direction: column;
		}
		.pd-stat-edge { border-right: none; }
		.pd-stat-label {
			font-size: 6.5pt;
			font-weight: 800;
			text-transform: uppercase;
			letter-spacing: 0.09em;
			color: #3e5c50;
			margin-bottom: 5px;
		}
		/* Large numeric value (cycle/period length) */
		.pd-stat-big {
			font-size: 22pt;
			font-weight: 700;
			letter-spacing: -0.5px;
			line-height: 1;
			color: #111;
		}
		.pd-stat-unit {
			font-size: 9pt;
			font-weight: 400;
			color: #777;
			letter-spacing: 0;
		}
		/* Full-date value (last period) */
		.pd-stat-date {
			font-size: 11pt;
			font-weight: 700;
			color: #111;
			line-height: 1.2;
		}
		/* Dash placeholder when no data */
		.pd-stat-nil {
			font-size: 20pt;
			font-weight: 300;
			color: #ccc;
			line-height: 1;
		}
		.pd-stat-sub {
			font-size: 7.5pt;
			color: #888;
			margin-top: 4px;
		}
		/* Regularity word — colored by value */
		.pd-reg {
			font-size: 11.5pt;
			font-weight: 700;
			line-height: 1.2;
		}
		.pd-reg-regular   { color: #2a6647; }
		.pd-reg-irregular { color: #8c3520; }
		.pd-reg-insufficient { color: #888; font-size: 10pt; font-weight: 600; }

		.pd-bleed-note {
			margin: 8px 0 0;
			font-size: 7.5pt;
			color: #999;
			font-style: italic;
		}

		/* ── "Worth discussing" callout ── */
		.pd-callout {
			border-left: 3.5px solid #b06a38;
			background: #fdf4ee;
			padding: 11px 16px;
			break-inside: avoid;
		}
		.pd-flags {
			margin: 0;
			padding-left: 0;
			list-style: none;
		}
		.pd-flags li {
			font-size: 10pt;
			color: #1f0f08;
			line-height: 1.55;
			padding: 3px 0 3px 18px;
			position: relative;
		}
		.pd-flags li::before {
			content: '▸';
			position: absolute;
			left: 0;
			top: 4px;
			color: #b06a38;
			font-size: 8pt;
		}

		/* ── Data tables ── */
		.pd-table {
			width: 100%;
			border-collapse: collapse;
			font-size: 9.5pt;
			margin-top: 2px;
		}
		.pd-table thead { display: table-header-group; }
		.pd-table th {
			text-align: left;
			font-size: 7pt;
			font-weight: 800;
			text-transform: uppercase;
			letter-spacing: 0.05em;
			color: #666;
			border-bottom: 1.5px solid #3e5c50;
			padding: 5px 10px 5px 0;
		}
		.pd-table td {
			padding: 6px 10px 6px 0;
			border-bottom: 1px solid #e6ede8;
			color: #222;
			vertical-align: top;
		}
		.pd-table th.num,
		.pd-table td.num {
			text-align: right;
			padding-right: 0;
			padding-left: 14px;
		}
		.pd-table tr { break-inside: avoid; }
		/* Alternating row tint */
		.pd-zebra tbody tr:nth-child(even) td { background: #f5faf6; }
		/* Worst severity — colour-coded so critical entries pop on a scan */
		.pd-sev { font-weight: 700; }
		.pd-sev-1 { color: #666; font-weight: 600; }   /* Mild — muted */
		.pd-sev-2 { color: #7a5520; }                   /* Moderate — warm amber */
		.pd-sev-3 { color: #8c3520; }                   /* Severe — warm red */
		/* Excluded cycles */
		.pd-excluded td { color: #bbb; }
		.pd-ex-tag {
			display: inline-block;
			margin-left: 8px;
			font-size: 6.5pt;
			font-weight: 800;
			text-transform: uppercase;
			letter-spacing: 0.06em;
			color: #ccc;
			text-decoration: none;
			vertical-align: middle;
		}
		.pd-narrow { max-width: 280px; }

		/* ── Mood + Weight side-by-side ── */
		.pd-wellbeing {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 28px;
			break-inside: avoid;
		}
		.pd-wellbeing .pd-section { margin-top: 22px; }
		/* Weight inline key column */
		.pd-wkey {
			font-size: 7.5pt;
			font-weight: 700;
			text-transform: uppercase;
			letter-spacing: 0.05em;
			color: #999;
			padding-right: 14px !important;
			width: 22%;
			vertical-align: top;
		}

		/* ── Notes ── */
		.pd-note-date {
			white-space: nowrap;
			width: 1%;
			padding-right: 18px !important;
			color: #777;
			font-size: 9pt;
		}

		/* ── Footer ── */
		.pd-foot {
			margin-top: 36px;
			padding-top: 10px;
			border-top: 1px solid #ddd;
			font-size: 7.5pt;
			line-height: 1.55;
			color: #aaa;
		}
		/* Running footer on every page */
		.pd-running {
			position: fixed;
			bottom: 0;
			left: 0;
			right: 0;
			display: flex;
			justify-content: space-between;
			font-size: 7pt;
			color: #bbb;
			padding-top: 5px;
			border-top: 1px solid #eaeaea;
		}
	}
</style>
