<script lang="ts">
	import { page } from '$app/state';
	import { selectionTick } from '$lib/ui/haptics';

	const path = $derived(page.url.pathname);
	const isActive = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));
	// Light tick on tab change — only when actually switching sections.
	const tap = (href: string) => {
		if (!isActive(href)) selectionTick();
	};
</script>

<nav class="tabbar" aria-label="Primary">
	<!-- Active tab swaps to a filled icon (iOS convention) — the selected state no
	     longer relies on color alone, which also helps color-blind users. -->
	<a class="tab" class:on={isActive('/')} href="/" aria-current={isActive('/') ? 'page' : undefined} onclick={() => tap('/')}>
		{#if isActive('/')}
			<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
				<path d="M12 20h9" fill="none" />
				<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
			</svg>
		{:else}
			<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
				<path d="M12 20h9" />
				<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
			</svg>
		{/if}
		<span>Today</span>
	</a>

	<a class="tab" class:on={isActive('/calendar')} href="/calendar" aria-current={isActive('/calendar') ? 'page' : undefined} onclick={() => tap('/calendar')}>
		{#if isActive('/calendar')}
			<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
				<path d="M3 10.5h18v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z" stroke="none" />
				<path d="M3 9V7.5a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3V9z" stroke="none" />
				<path d="M8 2.5v3M16 2.5v3" fill="none" />
			</svg>
		{:else}
			<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
				<rect x="3" y="4.5" width="18" height="16" rx="3" />
				<path d="M3 9h18M8 2.5v4M16 2.5v4" />
			</svg>
		{/if}
		<span>Calendar</span>
	</a>

	<a class="tab" class:on={isActive('/report')} href="/report" aria-current={isActive('/report') ? 'page' : undefined} onclick={() => tap('/report')}>
		{#if isActive('/report')}
			<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
				<path d="M7 3h7l5 5v13H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
				<path d="M14 3v5h5" fill="none" stroke="var(--bg)" />
				<path d="M9 13h6M9 17h6" fill="none" stroke="var(--bg)" />
			</svg>
		{:else}
			<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
				<path d="M7 3h7l5 5v13H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
				<path d="M14 3v5h5M9 13h6M9 17h6" />
			</svg>
		{/if}
		<span>Report</span>
	</a>

	<a class="tab" class:on={isActive('/settings')} href="/settings" aria-current={isActive('/settings') ? 'page' : undefined} onclick={() => tap('/settings')}>
		{#if isActive('/settings')}
			<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
				<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
				<circle cx="12" cy="12" r="3" fill="var(--bg)" stroke="none" />
			</svg>
		{:else}
			<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
				<circle cx="12" cy="12" r="3" />
				<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
			</svg>
		{/if}
		<span>Settings</span>
	</a>
</nav>

<style>
	.tabbar {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		max-width: 480px;
		margin: 0 auto;
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		padding: 8px 8px var(--safe-bottom);
		background: color-mix(in srgb, var(--bg) 82%, transparent);
		backdrop-filter: saturate(180%) blur(20px);
		-webkit-backdrop-filter: saturate(180%) blur(20px);
		border-top: 1px solid var(--line);
		z-index: 50;
	}
	.tab {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3px;
		padding: 6px 0;
		color: var(--ink-faint);
		text-decoration: none;
		transition:
			color 0.15s,
			transform 0.1s;
	}
	.tab:active {
		transform: scale(0.92);
	}
	.tab span {
		font-size: 10.5px;
		font-weight: 600;
		letter-spacing: 0.01em;
	}
	.tab.on {
		color: var(--accent);
	}
</style>
