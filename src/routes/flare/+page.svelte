<script lang="ts">
	import { ensureDb } from '$lib/db/init';
	import { addEntry, updateEntry, getEntryByDate } from '$lib/db/cycleRepository';
	import {
		SYMPTOM_GROUPS,
		SEVERITY_LABELS,
		type Symptom,
		type Severity,
		type LoggedSymptom
	} from '$lib/db/schema';
	import { humanize, todayISO } from '$lib/ui/format';
	import { goto } from '$app/navigation';
	import { selectionTick, successTick } from '$lib/ui/haptics';

	// Flare logging is deliberately scoped to the Pain group only: someone mid-flare
	// needs a few big, high-contrast taps, not the full daily form.
	const PAIN_KEYS = (SYMPTOM_GROUPS.find((g) => g.label === 'Pain')?.keys ?? []) as readonly Symptom[];

	let isDirty = $state(false);
	let confirmBack = $state(false);
	let loading = $state(true);
	let loadingShown = $state(false);
	let loadTimer: ReturnType<typeof setTimeout>;
	let saving = $state(false);
	let justSaved = $state(false);
	let loadError = $state(false);
	let saveError = $state(false);
	let existingId = $state<string | null>(null);
	// Symptoms already logged today that aren't pain — preserved untouched on save.
	let otherSymptoms = $state<LoggedSymptom[]>([]);
	let painMap = $state<Record<string, Severity>>({});

	async function load() {
		loading = true;
		loadError = false;
		clearTimeout(loadTimer);
		loadTimer = setTimeout(() => {
			if (loading) loadingShown = true;
		}, 180);
		try {
			await ensureDb();
			const entry = await getEntryByDate(todayISO());
			if (entry) {
				existingId = entry.id;
				const pain: Record<string, Severity> = {};
				const other: LoggedSymptom[] = [];
				for (const s of entry.symptoms) {
					if ((PAIN_KEYS as readonly string[]).includes(s.key)) pain[s.key] = s.severity;
					else other.push(s);
				}
				painMap = pain;
				otherSymptoms = other;
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

	function cycle(key: Symptom) {
		selectionTick();
		isDirty = true;
		const current = painMap[key];
		const next =
			current === undefined ? 1 : current === 3 ? undefined : ((current + 1) as Severity);
		const copy = { ...painMap };
		if (next === undefined) delete copy[key];
		else copy[key] = next;
		painMap = copy;
	}

	async function save() {
		const pain = (Object.entries(painMap) as [Symptom, Severity][]).map(([key, severity]) => ({
			key,
			severity
		}));
		const symptoms = [...otherSymptoms, ...pain];
		// Nothing logged and no entry to update — don't create a blank day; just leave.
		if (symptoms.length === 0 && !existingId) {
			goto('/');
			return;
		}
		saving = true;
		saveError = false;
		try {
			// Re-resolve by date at write time rather than using the mount-time snapshot.
			// Today's debounced autosave may not have landed yet when Flare loads, so
			// existingId can be stale null even if a row already exists — causing addEntry
			// to fail with "Entry already exists" and leaving the user with no retry path.
			const today = todayISO();
			const current = await getEntryByDate(today);
			if (current) {
				// Re-derive non-pain symptoms from the live row so Today's autosave
				// (which may have landed after Flare loaded) isn't silently overwritten.
				const liveOther = current.symptoms.filter(
					(s) => !(PAIN_KEYS as readonly string[]).includes(s.key)
				);
				const merged = [...liveOther, ...pain];
				await updateEntry(current.id, { symptoms: merged });
				existingId = current.id;
			} else {
				const merged = [...otherSymptoms, ...pain];
				const created = await addEntry({ date: today, flow_intensity: 'none', symptoms: merged, mood: [] });
				existingId = created.id;
			}
			justSaved = true;
			successTick();
			setTimeout(() => goto('/'), 750);
		} catch (e) {
			console.error('[vault/db] save failed:', e);
			saveError = true;
		} finally {
			saving = false;
		}
	}
</script>

<div class="page">
	<header class="nav-bar">
		{#if confirmBack}
			<div class="back-confirm">
				<button class="back-cancel" onclick={() => (confirmBack = false)}>Keep editing</button>
				<button class="back-discard" onclick={() => goto('/')}>Discard</button>
			</div>
		{:else}
			<button class="back" onclick={() => (isDirty ? (confirmBack = true) : goto('/'))} aria-label="Back to log">
				<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
			</button>
		{/if}
	</header>

	<div class="head">
		<h1 class="large-title">Where does it hurt?</h1>
		<p class="sub">Tap a spot for mild, again to raise the level.</p>
	</div>

	{#if loading}
		{#if loadingShown}<div class="loading">Loading…</div>{/if}
	{:else if loadError}
		<div class="error-state">
			<p class="error-title">We couldn’t open your data</p>
			<p class="error-body">Your entries are safe on this device. Try again in a moment.</p>
			<button class="retry" onclick={load}>Try again</button>
		</div>
	{:else}
		<div class="grid">
			{#each PAIN_KEYS as key (key)}
				{@const sev = painMap[key]}
				<button
					class="pain"
					class:sev-1={sev === 1}
					class:sev-2={sev === 2}
					class:sev-3={sev === 3}
					aria-pressed={!!sev}
					aria-label={sev ? `${humanize(key)}, ${SEVERITY_LABELS[sev]}` : humanize(key)}
					onclick={() => cycle(key)}
				>
					<span class="name">{humanize(key)}</span>
					{#if sev}<span class="level">{SEVERITY_LABELS[sev]}</span>{/if}
				</button>
			{/each}
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
			{:else if saving}Saving…{:else}Save entry{/if}
		</button>
	</div>
{/if}

<style>
	.page {
		/* Clearance for the fixed Save footer, which grows with the home indicator. */
		padding: 0 16px calc(120px + var(--safe-bottom));
	}
	.nav-bar {
		display: flex;
		align-items: center;
		min-height: 44px;
		padding-top: 8px;
		margin-left: -8px;
	}
	.back {
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		border: none;
		background: transparent;
		color: var(--accent);
		transition: opacity 0.12s;
	}
	.back:active {
		opacity: 0.4;
	}
	.back-confirm {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
	}
	.back-cancel {
		min-height: 36px;
		padding: 0 14px;
		border-radius: var(--radius-control);
		border: 1px solid var(--line);
		background: var(--surface);
		color: var(--ink);
		font-size: 14px;
		font-weight: 600;
	}
	.back-discard {
		min-height: 36px;
		padding: 0 14px;
		border-radius: var(--radius-control);
		border: none;
		background: color-mix(in srgb, var(--flow-heavy) 12%, transparent);
		color: var(--flow-heavy-ink);
		font-size: 14px;
		font-weight: 600;
	}

	.head {
		padding: 8px 0 20px;
	}
	.sub {
		margin-top: 8px;
		font-size: 15px;
		line-height: 1.4;
		color: var(--ink-soft);
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
	.save-error {
		margin: 0 0 10px;
		text-align: center;
		font-size: 13px;
		color: var(--flow-heavy-ink);
	}

	.grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
	.pain {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		justify-content: center;
		gap: 4px;
		min-height: 96px;
		padding: 16px;
		border-radius: var(--radius-card);
		border: 1px solid var(--line);
		background: var(--surface);
		color: var(--ink);
		text-align: left;
		transition:
			border-color 0.18s ease,
			background 0.18s ease,
			color 0.18s ease,
			transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
	}
	.pain:active {
		transform: scale(0.96);
	}
	.name {
		font-size: 17px;
		font-weight: 600;
		letter-spacing: -0.2px;
		line-height: 1.15;
	}
	.level {
		font-size: 13px;
		font-weight: 600;
		letter-spacing: 0.02em;
		opacity: 0.9;
	}
	/* High-contrast severity ramp — deeper = worse, readable at a glance mid-flare. */
	.pain.sev-1 {
		border-color: var(--sev-1-bg);
		background: var(--sev-1-bg);
		color: var(--sev-1-ink);
	}
	.pain.sev-2 {
		border-color: var(--sev-2-bg);
		background: var(--sev-2-bg);
		color: var(--sev-2-ink);
	}
	.pain.sev-3 {
		border-color: var(--sev-3-bg);
		background: var(--sev-3-bg);
		color: var(--sev-3-ink);
	}

	.footer {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		max-width: 480px;
		margin: 0 auto;
		padding: 14px 16px calc(14px + var(--safe-bottom));
		background: linear-gradient(to top, var(--bg) 78%, transparent);
	}
	.save {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		width: 100%;
		min-height: 50px;
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
	.save.saved {
		filter: brightness(0.9);
	}
	.save .check {
		animation: check-pop 0.34s cubic-bezier(0.34, 1.56, 0.64, 1);
	}
	@keyframes check-pop {
		from {
			transform: scale(0.4);
			opacity: 0;
		}
		to {
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
