<script lang="ts">
	import { ensureDb } from '$lib/db/init';
	import { getEntriesInRange } from '$lib/db/cycleRepository';
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
	const today = todayISO();

	const now = new Date();
	let year = $state(now.getFullYear());
	let month = $state(now.getMonth());
	let loading = $state(true);
	let loadingShown = $state(false);
	let loadTimer: ReturnType<typeof setTimeout>;
	let loadError = $state(false);
	let byDate = $state<Record<string, CycleEntry>>({});

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
	}
	function openDay(iso: string) {
		selectionTick();
		goto(`/?date=${iso}`);
	}
</script>

<div class="page">
	<header class="cal-head">
		<h1 class="large-title">{label}</h1>
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

	<div class="legend">
		<span class="key"><span class="swatch" style="background: var(--flow-light)"></span>Light</span>
		<span class="key"><span class="swatch" style="background: var(--flow-medium)"></span>Medium</span>
		<span class="key"><span class="swatch" style="background: var(--flow-heavy)"></span>Heavy</span>
		<span class="key"><span class="swatch dot"></span>Symptoms / mood</span>
	</div>
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
