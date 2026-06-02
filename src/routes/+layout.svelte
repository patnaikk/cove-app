<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { hasOnboarded, applyTheme, applyReminder } from '$lib/ui/preferences.svelte';
	import { initBilling } from '$lib/billing/entitlement';
	import { Capacitor } from '@capacitor/core';
	import { resetDb, ensureDb } from '$lib/db/init';
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

	// Register IAP product and restore any prior purchase on launch.
	$effect(() => {
		initBilling();
	});

	// Reconnect the SQLite DB when iOS resumes the app from the background.
	// After a long suspension the native SQLite connection is dropped; we close
	// the stale handle and re-open so every screen gets a live connection.
	//
	// IMPORTANT: only reconnect on a genuine background→foreground transition.
	// Reconnecting on the *initial* active event would race the first page load's
	// own ensureDb() call and corrupt the open sequence. We require having seen a
	// background (isActive:false) first.
	$effect(() => {
		if (!Capacitor.isNativePlatform()) return;
		let cleanup: (() => void) | undefined;
		let wasBackgrounded = false;
		import('@capacitor/app').then(({ App }) => {
			const handle = App.addListener('appStateChange', async ({ isActive }) => {
				if (!isActive) {
					wasBackgrounded = true;
					return;
				}
				if (!wasBackgrounded) return; // initial activation — first load handles it
				wasBackgrounded = false;
				try {
					await resetDb();
					await ensureDb();
				} catch (e) {
					console.error('[cove] DB reconnect after resume failed:', e);
				}
			});
			cleanup = () => { handle.then(h => h.remove()); };
		});
		return () => cleanup?.();
	});

	// Use page.route.id (set by SvelteKit's router) rather than page.url.pathname
	// — on native Capacitor the URL may always be capacitor://localhost/ regardless
	// of which page is active, but route.id is always the correct route string.
	const routeId = $derived(page.route.id ?? '');

	// Routes that must stay reachable before onboarding completes.
	const PUBLIC = ['/welcome', '/privacy'];

	// Stack screens (full-screen, own chrome). Tab bar is hidden on these.
	const STACK_ROUTES = ['/welcome', '/privacy', '/flare'];

	// Synchronous so the gated screen never flashes before the redirect fires.
	const needsOnboarding = $derived(
		!hasOnboarded() && !PUBLIC.includes(routeId)
	);

	const isStack = $derived(STACK_ROUTES.some(r => routeId.startsWith(r)));
	const showTabBar = $derived(!needsOnboarding && !isStack);
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
