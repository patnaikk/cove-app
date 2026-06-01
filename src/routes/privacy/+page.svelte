<script lang="ts">
	import { goto } from '$app/navigation';
	import { hasOnboarded } from '$lib/ui/preferences.svelte';

	// Reachable both from onboarding (before the app) and from Settings (after).
	// Back goes wherever makes sense for where the user came from.
	function back() {
		if (history.length > 1) history.back();
		else goto(hasOnboarded() ? '/settings' : '/welcome');
	}
</script>

<div class="page">
	<header class="nav-bar">
		<button class="back" onclick={back} aria-label="Back">
			<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
		</button>
	</header>

	<article class="doc">
		<h1 class="large-title">Privacy Policy</h1>
		<p class="updated">Last updated 31 May 2026</p>

		<p class="intro">
			Cove is built so your health information stays yours. This policy explains, in
			plain language, exactly what the app does and does not do with your data.
		</p>

		<h2>What we collect</h2>
		<p>
			Nothing. Cove has no servers and no accounts. We — the people who make Cove —
			never receive, see, or store any information about you or your health. There is no
			sign-up, no email, no profile.
		</p>

		<h2>Where your data lives</h2>
		<p>
			Everything you log — cycle days, symptoms, mood, weight, and notes — is saved in a
			database on your own device. iOS encrypts app data at rest using Apple’s built-in
			Data Protection when your device is locked. Your data is never uploaded, backed up
			to a cloud by us, or synced to another device.
		</p>

		<h2>Network access</h2>
		<p>
			Cove works fully offline. The only time it contacts the network is when you choose
			to unlock the PDF report: that purchase is handled by Apple’s App Store so the
			payment can be processed. Even then, none of your health data is part of that
			request — Apple only confirms the purchase.
		</p>

		<h2>Notifications</h2>
		<p>
			If you turn on daily reminders in Settings, Cove schedules a local notification on
			your device at the time you choose. These notifications are generated entirely on
			your device — no data is sent anywhere, and the notification text never mentions
			your health.
		</p>

		<h2>Analytics and tracking</h2>
		<p>
			There are none. Cove contains no analytics, no advertising, no crash-reporting
			services, and no third-party tracking SDKs. Nothing about how you use the app is
			recorded or transmitted.
		</p>

		<h2>Your control</h2>
		<p>
			You can export all of your data to a CSV file at any time, for free, from the
			report screen. You can delete any single entry, or delete everything at once in
			Settings. When you delete the app, your health data is removed with it — because
			the device is the only place it ever existed.
		</p>

		<h2>Age</h2>
		<p>Cove is designed for users aged 12 and older and is not directed at children under 12.</p>

		<h2>Changes to this policy</h2>
		<p>
			If this policy ever changes, the updated version will appear here with a new date.
			Because we hold none of your data, changes can only ever affect how the app behaves
			on your device going forward.
		</p>

		<h2>Contact</h2>
		<p>
			Questions about privacy? Reach us at
			<a class="mail" href="mailto:reachcove@gmail.com">reachcove@gmail.com</a>.
		</p>
	</article>
</div>

<style>
	.page {
		padding: 0 16px 48px;
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

	/* A document to read, not a form: large title, title-case headings, 16px body. */
	.doc {
		padding-top: 8px;
		animation: doc-in 0.3s ease;
	}
	.updated {
		margin-top: 6px;
		font-size: 13px;
		color: var(--ink-soft);
	}
	.intro {
		margin-top: 20px;
		font-size: 17px;
		line-height: 1.5;
		letter-spacing: -0.2px;
		color: var(--ink);
	}
	.doc h2 {
		margin-top: 28px;
		font-size: 17px;
		font-weight: 600;
		letter-spacing: -0.2px;
		color: var(--ink);
	}
	.doc h2 + p {
		margin-top: 6px;
	}
	.doc p {
		font-size: 16px;
		line-height: 1.6;
		color: var(--ink-soft);
	}
	.mail {
		color: var(--accent-ink);
		font-weight: 600;
		text-decoration: none;
	}

	@keyframes doc-in {
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
		.doc {
			animation: none;
		}
	}
</style>
