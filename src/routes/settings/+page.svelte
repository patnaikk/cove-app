<script lang="ts">
	import {
		WEIGHT_UNITS,
		getWeightUnit,
		setWeightUnit,
		type WeightUnit,
		APPEARANCES,
		getAppearance,
		setAppearance,
		type Appearance,
		getReminderEnabled,
		setReminderEnabled,
		getReminderTime,
		setReminderTime
	} from '$lib/ui/preferences.svelte';
	import { selectionTick, successTick } from '$lib/ui/haptics';
	import { getAllEntries, deleteAllEntries } from '$lib/db/cycleRepository';
	import { ensureDb } from '$lib/db/init';
	import { buildCsv } from '$lib/report/csv';
	import { downloadText } from '$lib/report/export';
	import { isPdfUnlocked, restorePurchases, getBillingCacheReady } from '$lib/billing/entitlement';
	import { todayISO } from '$lib/ui/format';
	import { Capacitor } from '@capacitor/core';

	const UNIT_LABEL: Record<WeightUnit, string> = { kg: 'kg', lb: 'lb' };
	const UNIT_LONG: Record<WeightUnit, string> = {
		kg: 'kilograms',
		lb: 'pounds'
	};
	const APPEARANCE_LABEL: Record<Appearance, string> = {
		system: 'System',
		light: 'Light',
		dark: 'Dark'
	};

	const unit = $derived(getWeightUnit());
	const appearance = $derived(getAppearance());
	const reminderOn = $derived(getReminderEnabled());
	const reminderTime = $derived(getReminderTime());
	let appVersion = $state('1.0');
	$effect(() => {
		if (Capacitor.isNativePlatform()) {
			import('@capacitor/app').then(({ App }) =>
				App.getInfo().then((info) => { appVersion = info.version; }).catch(() => {})
			);
		}
	});

	let reminderMsg = $state<string | null>(null);

	async function toggleReminder() {
		selectionTick();
		try {
			await setReminderEnabled(!reminderOn);
			reminderMsg = null;
		} catch {
			reminderMsg = 'Could not update reminder — please try again.';
		}
	}
	async function onReminderTime(e: Event) {
		const v = (e.target as HTMLInputElement).value;
		if (!v) return;
		try {
			await setReminderTime(v);
			reminderMsg = null;
		} catch {
			reminderMsg = 'Could not update reminder time — please try again.';
		}
	}

	function choose(u: WeightUnit) {
		if (u === unit) return;
		selectionTick();
		setWeightUnit(u);
	}

	function chooseAppearance(a: Appearance) {
		if (a === appearance) return;
		selectionTick();
		setAppearance(a);
	}

	let pdfUnlocked = $state(isPdfUnlocked());
	// Re-read once the persisted entitlement cache has loaded — on a cold launch the
	// synchronous read above can run before billing init restores the cached unlock.
	$effect(() => {
		getBillingCacheReady().then(() => { pdfUnlocked = isPdfUnlocked(); });
	});
	let restoreMsg = $state<string | null>(null);
	let restoreBusy = $state(false);

	async function doRestore() {
		restoreBusy = true;
		restoreMsg = null;
		try {
			const found = await restorePurchases();
			pdfUnlocked = isPdfUnlocked(); // refresh row immediately after restore
			restoreMsg = found ? 'Purchase restored.' : 'No previous purchase found.';
		} catch {
			restoreMsg = 'Restore failed — please try again.';
		} finally {
			restoreBusy = false;
		}
	}

	let confirmingWipe = $state(false);
	let busy = $state(false);
	let dataMsg = $state<string | null>(null);

	async function exportData() {
		busy = true;
		dataMsg = null;
		try {
			await ensureDb();
			const entries = await getAllEntries();
			if (entries.length === 0) {
				dataMsg = 'Nothing to export yet.';
				return;
			}
			await downloadText(`cove-export-${todayISO()}.csv`, buildCsv(entries), 'text/csv');
			dataMsg = `Exported ${entries.length} ${entries.length === 1 ? 'day' : 'days'}.`;
		} catch (e) {
			console.error('[vault] export failed:', e);
			dataMsg = 'Export failed — please try again.';
		} finally {
			busy = false;
		}
	}

	async function wipeAll() {
		busy = true;
		dataMsg = null;
		try {
			await ensureDb();
			await deleteAllEntries();
			successTick();
			confirmingWipe = false;
			dataMsg = 'All data deleted from this device.';
		} catch (e) {
			console.error('[vault] delete-all failed:', e);
			dataMsg = 'Delete failed — please try again.';
		} finally {
			busy = false;
		}
	}
</script>

<div class="page">
	<header class="topbar">
		<h1 class="large-title">Settings</h1>
	</header>

	<!-- APPEARANCE -->
	<p class="section-header">Appearance</p>
	<div class="group">
		<div class="row">
			<span class="row-label">Theme</span>
			<div class="segmented" role="group" aria-label="Appearance">
				{#each APPEARANCES as a (a)}
					<button class="segment" class:on={appearance === a} aria-pressed={appearance === a} onclick={() => chooseAppearance(a)}>
						{APPEARANCE_LABEL[a]}
					</button>
				{/each}
			</div>
		</div>
	</div>
	<p class="section-footer">System follows your device’s light or dark setting.</p>

	<!-- WEIGHT -->
	<p class="section-header">Weight</p>
	<div class="group">
		<div class="row">
			<span class="row-label">Unit</span>
			<div class="segmented" role="group" aria-label="Weight unit">
				{#each WEIGHT_UNITS as u (u)}
					<button class="segment" class:on={unit === u} aria-pressed={unit === u} onclick={() => choose(u)}>
						{UNIT_LABEL[u]}
					</button>
				{/each}
			</div>
		</div>
	</div>
	<p class="section-footer">
		Showing weight in {UNIT_LONG[unit]}. Stored measurements never change — this only
		switches how weight is displayed and entered.
	</p>

	<!-- REMINDERS -->
	<p class="section-header">Reminders</p>
	<div class="group reminders-group">
		<div class="row">
			<span class="row-label">Daily reminder</span>
			<button
				class="ios-switch"
				class:on={reminderOn}
				role="switch"
				aria-checked={reminderOn}
				aria-label="Daily reminder"
				onclick={toggleReminder}
			>
				<span class="knob"></span>
			</button>
		</div>
		{#if reminderOn}
			<div class="row">
				<label class="row-label" for="reminder-time">Time</label>
				<input id="reminder-time" class="time-input" type="time" value={reminderTime} onchange={onReminderTime} />
			</div>
		{/if}
	</div>
	{#if reminderMsg}
		<p class="reminder-error" role="alert">{reminderMsg}</p>
	{/if}
	<p class="section-footer">
		A gentle, private nudge to log — scheduled on this device only. The notification
		never mentions your health.
	</p>

	<!-- PRIVACY -->
	<p class="section-header">Privacy</p>
	<div class="group">
		<div class="text-row">
			<p>
				Your health data never leaves this device. There are no accounts, no cloud
				sync, no analytics, and no third-party trackers — everything you log is stored
				in an encrypted database on your phone.
			</p>
			<p>
				The only network request Cove ever makes is to Apple, and only when you choose
				to unlock the PDF report, so the purchase can be processed. Your logs are never
				part of it.
			</p>
		</div>
		<a class="row disclosure" href="/welcome?tour=1">
			<span class="row-label">How Cove works</span>
			<svg class="chevron" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
		</a>
		<a class="row disclosure" href="/privacy">
			<span class="row-label">Privacy Policy</span>
			<svg class="chevron" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
		</a>
	</div>

	<!-- PURCHASES -->
	<p class="section-header">Purchases</p>
	<div class="group">
		<div class="row">
			<span class="row-label">PDF Report</span>
			<span class="row-trail">{pdfUnlocked ? 'Unlocked' : 'Not purchased'}</span>
		</div>
		<button class="row tappable disclosure" onclick={doRestore} disabled={restoreBusy}>
			<span class="row-label">{restoreBusy ? 'Restoring…' : 'Restore purchases'}</span>
			<svg class="chevron" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
		</button>
	</div>
	{#if restoreMsg}
		<p class="section-footer" role="status">{restoreMsg}</p>
	{:else}
		<p class="section-footer">
			Already purchased on another device or after reinstalling? Tap to restore.
		</p>
	{/if}
	<p class="section-footer">
		Purchases are processed by Apple. By purchasing you agree to Apple's
		<a class="footer-link" href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/" target="_blank" rel="noopener">Standard EULA</a>.
	</p>

	<!-- DATA -->
	<p class="section-header">Data</p>
	<div class="group data-group">
		<button class="row tappable" onclick={exportData} disabled={busy}>
			<span class="row-label">Export all data</span>
			<span class="row-trail">CSV</span>
		</button>
		{#if confirmingWipe}
			<div class="row wipe-confirm">
				<button class="wipe-cancel" onclick={() => (confirmingWipe = false)} disabled={busy}>
					Cancel
				</button>
				<button class="wipe-go" onclick={wipeAll} disabled={busy}>
					{busy ? 'Deleting…' : 'Delete everything'}
				</button>
			</div>
		{:else}
			<button class="row tappable destructive" onclick={() => (confirmingWipe = true)} disabled={busy}>
				<span class="row-label">Delete all data</span>
			</button>
		{/if}
	</div>
	<p class="section-footer">
		{#if dataMsg}
			<span class="data-msg">{dataMsg}</span>
		{:else}
			Export saves a spreadsheet of everything you’ve logged. Deleting removes every entry
			from this device and can’t be undone.
		{/if}
	</p>

	<p class="version">Cove · Version {appVersion}</p>
</div>

<style>
	.page {
		padding: 0 16px calc(96px + var(--safe-bottom));
	}
	.topbar {
		display: flex;
		align-items: center;
		padding: 16px 0 8px;
	}

	/* Inset-grouped table: header above the group, footer below, hairline-inset rows. */
	.section-header {
		margin: 24px 4px 8px;
		font-size: 13px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--ink-soft);
	}
	.section-footer {
		margin: 8px 4px 0;
		font-size: 13px;
		line-height: 1.45;
		color: var(--ink-soft);
	}
	.reminder-error {
		margin: 6px 4px 0;
		font-size: 13px;
		color: var(--flow-heavy);
	}

	.group {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--radius-card);
		overflow: hidden;
	}

	.row {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		min-height: 50px;
		padding: 8px 16px;
	}
	.row-label {
		font-size: 17px;
		letter-spacing: -0.2px;
		color: var(--ink);
	}
	/* Leading-inset separator above the disclosure row — iOS Settings signature. */
	.disclosure::before {
		content: '';
		position: absolute;
		top: 0;
		left: 16px;
		right: 0;
		height: 1px;
		background: var(--line);
	}

	.disclosure {
		text-decoration: none;
		transition: background 0.12s;
	}
	.disclosure:active {
		background: var(--surface-sunken);
	}
	.chevron {
		color: var(--ink-faint);
	}

	/* Inset separator between stacked reminder rows. */
	.reminders-group .row + .row::before {
		content: '';
		position: absolute;
		top: 0;
		left: 16px;
		right: 0;
		height: 1px;
		background: var(--line);
	}

	/* iOS switch (matches the one in the report). */
	.ios-switch {
		display: inline-grid;
		place-items: center;
		width: 51px;
		min-height: 44px;
		padding: 0;
		border: none;
		background: transparent;
	}
	.ios-switch .knob {
		position: relative;
		display: block;
		width: 51px;
		height: 31px;
		border-radius: var(--radius-pill);
		background: var(--line);
		transition: background 0.2s ease;
	}
	.ios-switch.on .knob {
		background: var(--accent);
	}
	.ios-switch .knob::after {
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
	.ios-switch.on .knob::after {
		transform: translateX(20px);
	}

	/* Reads as a tappable value control, like iOS date/time fields. */
	.time-input {
		border: none;
		border-radius: 9px;
		background: var(--surface-sunken);
		color: var(--accent-ink);
		font-size: 16px;
		font-weight: 600;
		font-family: inherit;
		padding: 7px 12px;
		min-height: 36px;
	}
	.time-input::-webkit-datetime-edit {
		color: var(--accent-ink);
	}

	/* Tappable action rows (Data section). */
	/* Purchases section rows need an inset separator between them. */
	.group .row + .row.disclosure::before {
		content: '';
		position: absolute;
		top: 0;
		left: 16px;
		right: 0;
		height: 1px;
		background: var(--line);
	}

	.tappable {
		width: 100%;
		border: none;
		background: transparent;
		text-align: left;
		transition: background 0.12s;
	}
	.tappable:active {
		background: var(--surface-sunken);
	}
	.tappable:disabled {
		opacity: 0.5;
	}
	.row-trail {
		font-size: 17px;
		letter-spacing: -0.2px;
		color: var(--ink-faint);
	}
	.destructive .row-label {
		color: var(--flow-heavy);
	}
	/* Inset separator between the two data rows / the confirm row. */
	.data-group .row + .row::before {
		content: '';
		position: absolute;
		top: 0;
		left: 16px;
		right: 0;
		height: 1px;
		background: var(--line);
	}
	.wipe-confirm {
		gap: 8px;
	}
	.wipe-cancel,
	.wipe-go {
		flex: 1;
		min-height: 40px;
		border-radius: var(--radius-control);
		font-size: 15px;
		font-weight: 600;
	}
	.wipe-cancel {
		border: 1px solid var(--line);
		background: var(--surface);
		color: var(--ink);
	}
	.wipe-go {
		border: none;
		background: var(--flow-heavy);
		color: #fff;
	}
	.wipe-cancel:disabled,
	.wipe-go:disabled {
		opacity: 0.5;
	}
	.data-msg {
		color: var(--accent-ink);
		font-weight: 500;
	}

	.text-row {
		padding: 16px;
	}
	.text-row p {
		font-size: 15px;
		line-height: 1.55;
		color: var(--ink-soft);
	}
	.text-row p + p {
		margin-top: 12px;
	}

	/* iOS segmented control (matches Report). */
	.segmented {
		display: inline-grid;
		grid-auto-flow: column;
		gap: 2px;
		padding: 2px;
		border-radius: 9px;
		background: var(--surface-sunken);
	}
	.segment {
		min-width: 48px;
		min-height: 30px;
		padding: 0 12px;
		border: none;
		border-radius: 7px;
		background: transparent;
		color: var(--ink-soft);
		font-size: 14px;
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

	.footer-link {
		color: var(--accent);
		text-decoration: none;
		font-weight: 500;
	}
	.footer-link:active {
		opacity: 0.6;
	}

	.version {
		margin-top: 28px;
		text-align: center;
		font-size: 13px;
		color: var(--ink-faint);
	}
</style>
