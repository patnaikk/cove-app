<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { hasOnboarded, applyTheme, applyReminder } from '$lib/ui/preferences.svelte';
	import TabBar from '$lib/ui/TabBar.svelte';

	let { children } = $props();

	// Keep "System" appearance live when the OS toggles light/dark.
	$effect(() => {
		applyTheme();
		const mq = window.matchMedia('(prefers-color-scheme: dark)');
		const onChange = () => applyTheme();
		mq.addEventListener('change', onChange);
		return () => mq.removeEventListener('change', onChange);
	});

	// Reconcile any scheduled reminder with the saved preference on launch.
	$effect(() => {
		applyReminder();
	});

	// Routes that must stay reachable before onboarding completes.
	const PUBLIC = ['/welcome', '/privacy'];

	// The four primary destinations that carry the bottom tab bar. Everything else
	// (welcome, privacy, flare) is a full-screen stack/modal with its own chrome.
	const TAB_ROUTES = ['/', '/calendar', '/report', '/settings'];

	// Synchronous so the gated screen never flashes before the redirect fires.
	const needsOnboarding = $derived(
		!hasOnboarded() && !PUBLIC.includes(page.url.pathname)
	);

	const showTabBar = $derived(!needsOnboarding && TAB_ROUTES.includes(page.url.pathname));

	// Stack screens (flare/privacy/welcome) push in from the right like native iOS.
	// Tab routes switch instantly (correct iOS tab behavior).
	const isStack = $derived(!TAB_ROUTES.includes(page.url.pathname));
	const routeIn = $derived(
		isStack
			? { x: 320, duration: 300, opacity: 1, easing: cubicOut }
			: { duration: 0 }
	);

	// First run: send the user through the welcome/privacy flow before anything else.
	$effect(() => {
		if (needsOnboarding) goto('/welcome', { replaceState: true });
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Cove</title>
</svelte:head>

<div class="app-shell">
	{#if !needsOnboarding}
		{#key page.url.pathname}
			<div class="route" in:fly={routeIn}>
				{@render children()}
			</div>
		{/key}
	{/if}
</div>

{#if showTabBar}
	<TabBar />
{/if}

<style>
	.app-shell {
		max-width: 480px;
		margin: 0 auto;
		min-height: 100dvh;
		padding-top: var(--safe-top);
		padding-bottom: var(--safe-bottom);
	}
</style>
