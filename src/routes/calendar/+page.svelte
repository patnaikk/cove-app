<script lang="ts">
	import { ensureDb } from '$lib/db/init';
	import { getEntriesInRange, getAllEntries } from '$lib/db/cycleRepository';
	import { cycleStatusFor } from '$lib/report/analyze';
	import { type CycleEntry, type FlowIntensity } from '$lib/db/schema';
	import {
		todayISO,
		monthGridDates,
		monthGridStart,
		monthLabel,
		isoMonth,
		isoDay,
		shiftISO,
		mediumDate
	} from '$lib/ui/format';
	import { goto } from '$app/navigation';
	import { selectionTick } from '$lib/ui/haptics';
	import { swipeX } from '$lib/ui/swipe';

	const flowColors: Record<FlowIntensity, string> = {
		none: 'transparent',
		light: 'var(--flow-light)',
		medium: 'var(--flow-medium)',
		heavy: 'var(--flow-heavy)'
	};
	// Light flow days keep dark ink; deeper days need light ink for contrast.
	const flowInk: Record<FlowIntensity, string> = {
		none: 'var(--ink)',
		light: 'var(--ink)',
		medium: '#fff',
		heavy: '#fff'
	};

	const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
	// Reactive so the "today" ring moves if the date rolls over while the app is
	// suspended on this tab overnight and then foregrounded.
	let today = $state(todayISO());
	$effect(() => {
		const onVisible = () => {
			if (document.visibilityState === 'visible') today = todayISO();
		};
		document.addEventListener('visibilitychange', onVisible);
		return () => document.removeEventListener('visibilitychange', onVisible);
	});

	const now = new Date();
	let year = $state(now.getFullYear());
	let month = $state(now.getMonth());
	let yearPickerOpen = $state(false);

	// Years from 2020 to this year — enough history without an infinite list.
	const MIN_YEAR = 2020;
	const years = Array.from({ length: now.getFullYear() - MIN_YEAR + 1 }, (_, i) => MIN_YEAR + i).reverse();

	const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

	function toggleYearPicker() {
		selectionTick();
		yearPickerOpen = !yearPickerOpen;
	}
	function pickYear(y: number) {
		selectionTick();
		year = y;
		yearPickerOpen = false;
	}
	function pickMonth(y: number, m: number) {
		selectionTick();
		year = y;
		month = m;
		yearPickerOpen = false;
	}
	let loading = $state(true);
	let loadingShown = $state(false);
	let loadTimer: ReturnType<typeof setTimeout>;
	let loadError = $state(false);
	let byDate = $state<Record<string, CycleEntry>>({});
	// Full history, for the cycle-status pill — the episode walk-back in
	// cycleStatusFor needs bleeding days that may precede the visible month.
	let allEntries = $state<CycleEntry[]>([]);

	// Same reflection shown on Today — keeps the two data views connected.
	const status = $derived(cycleStatusFor(allEntries, today));
	const statusText = $derived(
		status.kind === 'period'
			? `Period · Day ${status.day}`
			: status.kind === 'between'
				? `${status.daysSince} ${status.daysSince === 1 ? 'day' : 'days'} since your last period`
				: null
	);

	const cells = $derived(monthGridDates(year, month));
	const label = $derived(monthLabel(year, month));
	const isCurrentMonth = $derived(year === now.getFullYear() && month === now.getMonth());

	async function load(y: number, m: number) {
		loading = true;
		loadError = false;
		clearTimeout(loadTimer);
		loadTimer = setTimeout(() => {
			if (loading) loadingShown = true;
		}, 180);
		try {
			await ensureDb();
			const start = monthGridStart(y, m);
			const end = shiftISO(start, 41);
			const entries = await getEntriesInRange(start, end);
			byDate = Object.fromEntries(entries.map((e) => [e.date, e]));
			allEntries = await getAllEntries();
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
		load(year, month);
	});

	function goPrevMonth() {
		selectionTick();
		if (month === 0) {
			month = 11;
			year -= 1;
		} else {
			month -= 1;
		}
	}
	function goNextMonth() {
		selectionTick();
		if (month === 11) {
			month = 0;
			year += 1;
		} else {
			month += 1;
		}
	}
	function goToday() {
		if (isCurrentMonth) return;
		selectionTick();
		year = now.getFullYear();
		month = now.getMonth();
		yearPickerOpen = false;
	}
	function openDay(iso: string) {
		selectionTick();
		goto(`/?date=${iso}`);
	}
</script>

<!-- Swipe left/right anywhere on the month to page — stepper remains for a11y. -->
<div class="page" use:swipeX={{ onLeft: goNextMonth, onRight: goPrevMonth }}>
	<header class="cal-head">
		<button class="month-title" onclick={toggleYearPicker} aria-expanded={yearPickerOpen} aria-label="Jump to month">
			<h1 class="large-title">{label}</h1>
			<svg class="title-chevron" class:open={yearPickerOpen} viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
		</button>
		<div class="head-actions">
			<button class="today-btn" onclick={goToday} disabled={isCurrentMonth}>Today</button>
			<div class="stepper" role="group" aria-label="Change month">
				<button class="step" onclick={goPrevMonth} aria-label="Previous month">
					<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
				</button>
				<span class="step-divider" aria-hidden="true"></span>
				<button class="step" onclick={goNextMonth} aria-label="Next month">
					<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7" /></svg>
				</button>
			</div>
		</div>
	</header>

	{#if yearPickerOpen}
		<div class="year-picker" role="listbox" aria-label="Jump to month">
			{#each years as y (y)}
				<div class="yp-year">
					<button class="yp-year-label" class:current={y === year} onclick={() => pickYear(y)} role="option" aria-selected={y === year}>
						{y}
					</button>
					<div class="yp-months">
						{#each MONTH_NAMES as name, m (m)}
							{@const isFuture = y > now.getFullYear() || (y === now.getFullYear() && m > now.getMonth())}
							<button
								class="yp-month"
								class:active={y === year && m === month}
								disabled={isFuture}
								onclick={() => pickMonth(y, m)}
								role="option"
								aria-selected={y === year && m === month}
							>{name}</button>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{/if}

	{#if !loading && !loadError && statusText}
		<div class="cycle-status" class:bleeding={status.kind === 'period'}>{statusText}</div>
	{/if}

	{#if loadError}
		<div class="error-state">
			<p class="error-title">We couldn’t open your data</p>
			<p class="error-body">Your entries are safe on this device. Try again in a moment.</p>
			<button class="retry" onclick={() => load(year, month)}>Try again</button>
		</div>
	{:else}
	<div class="weekdays">
		{#each WEEKDAYS as d, i (i)}
			<span>{d}</span>
		{/each}
	</div>

	{#key `${year}-${month}`}
		<div class="grid" class:dim={loading && loadingShown}>
			{#each cells as iso (iso)}
				{@const inMonth = isoMonth(iso) === month}
				{@const entry = byDate[iso]}
				{@const flow = entry?.flow_intensity ?? 'none'}
				{@const future = iso > today}
				{@const hasData = !!(entry && (entry.symptoms.length > 0 || entry.mood.length > 0))}
				{@const cellLabel = [
					mediumDate(iso),
					flow !== 'none' ? `${flow} flow` : null,
					hasData ? 'has symptoms or mood logged' : null,
					future ? '(future)' : null
				].filter(Boolean).join(', ')}
				<button
					class="cell"
					class:out={!inMonth}
					class:today={iso === today}
					class:future={future}
					disabled={future}
					aria-disabled={future}
					aria-current={iso === today ? 'date' : undefined}
					aria-label={cellLabel}
					style="background: {flowColors[flow]}; color: {flow === 'none' ? '' : flowInk[flow]};"
					onclick={() => openDay(iso)}
				>
					<span class="num">{isoDay(iso)}</span>
					{#if entry && (entry.symptoms.length > 0 || entry.mood.length > 0)}
						<span class="mark" class:on-fill={flow !== 'none'}></span>
					{/if}
				</button>
			{/each}
		</div>
	{/key}

	{#if !loading && allEntries.length === 0}
		<!-- First run: the legend explains data that doesn't exist yet — swap it for
		     a pointer to the one action that makes the calendar come alive. -->
		<div class="cal-empty">
			<p>Days you log will fill in here, colored by flow.</p>
			<a class="cal-empty-cta" href="/">Log your first day</a>
		</div>
	{:else}
	<div class="legend">
		<span class="key"><span class="swatch" style="background: var(--flow-light)"></span>Light</span>
		<span class="key"><span class="swatch" style="background: var(--flow-medium)"></span>Medium</span>
		<span class="key"><span class="swatch" style="background: var(--flow-heavy)"></span>Heavy</span>
		<span class="key"><span class="swatch dot"></span>Symptoms / mood</span>
	</div>
	{/if}
	{/if}
</div>

<style>
	.page {
		padding: 0 16px calc(96px + var(--safe-bottom));
	}

	/* One header: month as the Large Title, with a smart Today button + stepper. */
	.cal-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 16px 0 20px;
	}
	.month-title {
		display: flex;
		align-items: center;
		gap: 6px;
		border: none;
		background: none;
		padding: 0;
		cursor: pointer;
		color: inherit;
	}
	.month-title:active .large-title {
		opacity: 0.6;
	}
	.title-chevron {
		color: var(--ink-faint);
		transition: transform 0.2s ease;
		margin-top: 6px; /* optically align with title baseline */
	}
	.title-chevron.open {
		transform: rotate(180deg);
	}

	/* Year/month jump picker — scrollable list of years, each with 12 month chips. */
	.year-picker {
		margin: -8px 0 16px;
		padding: 12px 0;
		border-radius: var(--radius-card);
		border: 1px solid var(--line);
		background: var(--surface);
		max-height: 320px;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
	}
	.yp-year {
		padding: 8px 16px;
	}
	.yp-year + .yp-year {
		border-top: 1px solid var(--line);
	}
	.yp-year-label {
		border: none;
		background: none;
		font-size: 13px;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--ink-faint);
		padding: 0 0 8px;
		cursor: pointer;
		transition: color 0.12s;
	}
	.yp-year-label.current {
		color: var(--accent);
	}
	.yp-months {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 6px;
	}
	.yp-month {
		min-height: 36px;
		border-radius: var(--radius-control);
		border: 1px solid transparent;
		background: transparent;
		font-size: 14px;
		font-weight: 500;
		color: var(--ink);
		transition: background 0.12s, color 0.12s;
	}
	.yp-month:disabled {
		color: var(--ink-faint);
		opacity: 0.4;
	}
	.yp-month:not(:disabled):active {
		background: var(--accent-tint);
	}
	.yp-month.active {
		background: var(--accent-fill);
		color: #fff;
		border-color: var(--accent-fill);
	}
	.head-actions {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.today-btn {
		min-height: 44px;
		padding: 0 14px;
		border-radius: var(--radius-control);
		border: 1px solid var(--line);
		background: var(--surface);
		color: var(--accent);
		font-size: 15px;
		font-weight: 600;
		letter-spacing: -0.2px;
		transition: opacity 0.12s;
	}
	.today-btn:active {
		opacity: 0.5;
	}
	.today-btn:disabled {
		color: var(--ink-faint);
		opacity: 0.5;
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
	.step-divider {
		width: 1px;
		align-self: stretch;
		background: var(--line);
	}

	/* Mirrors the Today screen's status pill — reflection of the log, no predictions. */
	.cycle-status {
		display: inline-block;
		margin: -8px 0 16px;
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

	.weekdays {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		margin-bottom: 8px;
	}
	.weekdays span {
		text-align: center;
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.02em;
		color: var(--ink-faint);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 6px;
		animation: month-in 0.26s ease;
	}
	.grid.dim {
		opacity: 0.4;
	}
	/* Native-feeling month change: grid settles in with a gentle rise + fade. */
	@keyframes month-in {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.grid {
			animation: none;
		}
	}
	.cell {
		position: relative;
		aspect-ratio: 1;
		border: none;
		border-radius: var(--radius-control);
		background: transparent;
		color: var(--ink);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 15px;
		transition: transform 0.1s;
	}
	.cell:active {
		transform: scale(0.92);
	}
	.cell.out .num {
		color: var(--ink-faint);
		opacity: 0.5;
	}
	.cell.future .num {
		opacity: 0.45;
	}
	.cell:disabled {
		cursor: default;
	}
	.cell:disabled:active {
		transform: none;
	}
	.cell.today {
		box-shadow: inset 0 0 0 1.5px var(--accent);
		font-weight: 600;
	}
	.num {
		line-height: 1;
	}
	.mark {
		position: absolute;
		bottom: 6px;
		width: 5px;
		height: 5px;
		border-radius: var(--radius-pill);
		background: var(--accent);
	}
	.mark.on-fill {
		background: rgba(255, 255, 255, 0.9);
	}

	.cal-empty {
		margin-top: 24px;
		padding: 20px 16px;
		border-radius: var(--radius-card);
		border: 1px solid var(--line);
		background: var(--surface);
		text-align: center;
	}
	.cal-empty p {
		font-size: 15px;
		line-height: 1.45;
		color: var(--ink-soft);
	}
	.cal-empty-cta {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		margin-top: 10px;
		padding: 0 20px;
		border-radius: var(--radius-pill);
		background: var(--accent-tint);
		color: var(--accent-ink);
		font-size: 15px;
		font-weight: 600;
		letter-spacing: -0.2px;
		text-decoration: none;
		transition: opacity 0.12s;
	}
	.cal-empty-cta:active {
		opacity: 0.6;
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
		margin-top: 24px;
		padding-top: 16px;
		border-top: 1px solid var(--line);
	}
	.key {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		color: var(--ink-soft);
	}
	.swatch {
		width: 14px;
		height: 14px;
		border-radius: 5px;
	}
	.swatch.dot {
		width: 7px;
		height: 7px;
		border-radius: var(--radius-pill);
		background: var(--accent);
	}
</style>
