<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { setOnboarded } from '$lib/ui/preferences.svelte';
	import { selectionTick } from '$lib/ui/haptics';

	// Re-viewable from Settings (?tour=1): no gating, "Done" returns to Settings.
	const tour = $derived(page.url.searchParams.get('tour') === '1');

	type Panel = { icon: 'cycle' | 'lock' | 'sliders'; title: string; body: string };
	const PANELS: Panel[] = [
		{
			icon: 'cycle',
			title: 'A calmer way to\ntrack your cycle.',
			body: 'Log your period, symptoms, mood and weight — and see the patterns that matter. No ads, no pressure, no pink.'
		},
		{
			icon: 'lock',
			title: 'No account.\nWe never ask who you are.',
			body: 'Most cycle apps keep your data on their servers. Cove doesn’t have any. No name, no email, no sign-up — everything you log is encrypted and stays on this phone. Never uploaded, never synced, never seen by us.'
		},
		{
			icon: 'sliders',
			title: 'Your data,\nyour rules.',
			body: 'Export everything to CSV for free, and delete any entry — or all of it — whenever you want. It’s yours to keep or erase. One price, once — never a subscription.'
		}
	];
	const last = PANELS.length - 1;

	let scroller = $state<HTMLDivElement | null>(null);
	let active = $state(0);

	function onScroll() {
		if (!scroller) return;
		const i = Math.round(scroller.scrollLeft / scroller.clientWidth);
		if (i !== active) {
			active = i;
			selectionTick();
		}
	}

	function goTo(i: number) {
		if (!scroller) return;
		scroller.scrollTo({ left: i * scroller.clientWidth, behavior: 'smooth' });
	}

	function finish() {
		selectionTick();
		if (tour) {
			goto('/settings');
		} else {
			setOnboarded();
			goto('/', { replaceState: true });
		}
	}

	function primary() {
		if (active < last) goTo(active + 1);
		else finish();
	}
</script>

<div class="flow">
	<div class="topbar">
		<button class="skip" onclick={finish}>{tour ? 'Close' : 'Skip'}</button>
	</div>

	<div class="panels" bind:this={scroller} onscroll={onScroll}>
		{#each PANELS as p (p.title)}
			<section class="panel">
				<div class="mark" aria-hidden="true">
					{#if p.icon === 'cycle'}
						<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.3-5.6" /><path d="M20 4v3.5h-3.5" /><path d="M12 8v4l2.5 1.5" /></svg>
					{:else if p.icon === 'lock'}
						<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10" rx="3" /><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" /><path d="M12 14.5v2" /></svg>
					{:else}
						<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2.4" /><circle cx="9" cy="17" r="2.4" /></svg>
					{/if}
				</div>
				<h1>{p.title}</h1>
				<p class="body">{p.body}</p>
			</section>
		{/each}
	</div>

	<div class="footer">
		<div class="dots" aria-hidden="true">
			{#each PANELS as _, i (i)}
				<span class="dot" class:on={i === active}></span>
			{/each}
		</div>
		<button class="cta" onclick={primary}>
			{#if active < last}Continue{:else if tour}Done{:else}Start tracking{/if}
		</button>
	</div>
</div>

<style>
	.flow {
		display: flex;
		flex-direction: column;
		min-height: calc(100dvh - var(--safe-top) - var(--safe-bottom));
	}

	.topbar {
		flex: none;
		display: flex;
		justify-content: flex-end;
		padding: 8px 12px 0;
		min-height: 44px;
	}
	.skip {
		min-height: 44px;
		padding: 0 8px;
		border: none;
		background: transparent;
		color: var(--ink-soft);
		font-size: 17px;
		font-weight: 500;
		letter-spacing: -0.2px;
		transition: opacity 0.12s;
	}
	.skip:active {
		opacity: 0.4;
	}

	/* Swipeable, momentum-snapping panels — native iOS paging. */
	.panels {
		flex: 1;
		display: flex;
		overflow-x: auto;
		overflow-y: hidden;
		scroll-snap-type: x mandatory;
		scrollbar-width: none;
		-webkit-overflow-scrolling: touch;
	}
	.panels::-webkit-scrollbar {
		display: none;
	}
	.panel {
		flex: 0 0 100%;
		scroll-snap-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: 0 32px;
	}
	.mark {
		display: grid;
		place-items: center;
		width: 76px;
		height: 76px;
		margin-bottom: 28px;
		border-radius: 19px;
		background: var(--accent-fill);
		color: #fff;
	}
	.panel h1 {
		font-size: 28px;
		font-weight: 700;
		line-height: 1.2;
		letter-spacing: -0.4px;
		color: var(--ink);
		white-space: pre-line;
	}
	.body {
		margin-top: 14px;
		max-width: 19rem;
		font-size: 16px;
		line-height: 1.5;
		color: var(--ink-soft);
	}

	.footer {
		flex: none;
		padding: 16px 24px calc(16px + var(--safe-bottom));
	}
	.dots {
		display: flex;
		justify-content: center;
		gap: 7px;
		margin-bottom: 24px;
	}
	.dot {
		width: 7px;
		height: 7px;
		border-radius: var(--radius-pill);
		background: var(--line);
		transition:
			width 0.25s ease,
			background 0.25s ease;
	}
	.dot.on {
		width: 22px;
		background: var(--accent);
	}
	.cta {
		width: 100%;
		min-height: 50px;
		border: none;
		border-radius: var(--radius-pill);
		background: var(--accent-fill);
		color: #fff;
		font-size: 17px;
		font-weight: 600;
		letter-spacing: -0.2px;
		transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
	}
	.cta:active {
		transform: scale(0.98);
	}
</style>
