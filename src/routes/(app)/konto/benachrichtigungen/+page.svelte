<script lang="ts">
	import { onMount } from 'svelte';
	import '$lib/stil/kunden.css';
	import type { PageData } from './$types';

	/**
	 * Push-Benachrichtigungen auf diesem Gerät (Wunsch Jamil msg 2679). Android/PC: im Browser erlauben. iPhone/iPad:
	 * erst „Zum Home-Bildschirm“ hinzufügen und die App von dort öffnen (Apple erlaubt Push nur so, ab iOS 16.4).
	 */
	let { data }: { data: PageData } = $props();

	type Zustand = 'pruefe' | 'nicht_moeglich' | 'ios_homescreen' | 'blockiert' | 'aus' | 'an';
	let zustand = $state<Zustand>('pruefe');
	let meldung = $state<{ art: 'ok' | 'fehler'; text: string } | null>(null);
	let laeuft = $state(false);
	let geraete = $state(0);
	$effect.pre(() => {
		geraete = data.geraete;
	});

	const istIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
	const istHomescreen = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
	const b64 = (s: string) => {
		const p = '='.repeat((4 - (s.length % 4)) % 4);
		const roh = atob((s + p).replace(/-/g, '+').replace(/_/g, '/'));
		return Uint8Array.from(roh, (c) => c.charCodeAt(0));
	};

	async function pruefe() {
		if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
			zustand = istIos() && !istHomescreen() ? 'ios_homescreen' : 'nicht_moeglich';
			return;
		}
		if (Notification.permission === 'denied') {
			zustand = 'blockiert';
			return;
		}
		const reg = await navigator.serviceWorker.ready;
		zustand = (await reg.pushManager.getSubscription()) ? 'an' : 'aus';
	}

	async function einschalten() {
		laeuft = true;
		meldung = null;
		try {
			const erlaubnis = await Notification.requestPermission();
			if (erlaubnis !== 'granted') {
				zustand = erlaubnis === 'denied' ? 'blockiert' : 'aus';
				return;
			}
			const { schluessel } = await (await fetch('/api/push')).json();
			const reg = await navigator.serviceWorker.ready;
			const abo = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(schluessel) }));
			const r = await fetch('/api/push', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ ...abo.toJSON(), geraet: navigator.userAgent.slice(0, 200) })
			});
			const d = await r.json();
			if (!r.ok) throw new Error(d.fehler ?? 'Hat nicht geklappt.');
			geraete = d.geraete;
			zustand = 'an';
			meldung = { art: 'ok', text: 'Eingeschaltet. Erinnerungen kommen jetzt auch auf dieses Gerät.' };
		} catch (e) {
			meldung = { art: 'fehler', text: (e as Error).message || 'Hat nicht geklappt.' };
		} finally {
			laeuft = false;
		}
	}

	async function ausschalten() {
		laeuft = true;
		try {
			const reg = await navigator.serviceWorker.ready;
			const abo = await reg.pushManager.getSubscription();
			if (abo) {
				const r = await fetch('/api/push', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: abo.endpoint }) });
				if (r.ok) geraete = (await r.json()).geraete;
				await abo.unsubscribe();
			}
			zustand = 'aus';
			meldung = { art: 'ok', text: 'Auf diesem Gerät ausgeschaltet.' };
		} finally {
			laeuft = false;
		}
	}

	async function testen() {
		laeuft = true;
		try {
			const r = await fetch('/api/push', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ test: true }) });
			const d = await r.json();
			meldung = r.ok ? { art: 'ok', text: `Test gesendet an ${d.gesendet} Gerät(e).` } : { art: 'fehler', text: d.fehler ?? 'Test fehlgeschlagen.' };
		} finally {
			laeuft = false;
		}
	}

	onMount(() => {
		void pruefe();
	});
</script>

<svelte:head>
	<title>Benachrichtigungen</title>
</svelte:head>

<main class="kd-seite">
	<h1>Benachrichtigungen</h1>
	<p class="kd-info">
		Erinnerungen zu To-dos und Terminen erscheinen immer in der Glocke oben. Hier schaltest du zusätzlich Push-Nachrichten auf diesem Gerät
		ein – dann klingelt das Handy bzw. der PC, auch wenn das CRM gerade nicht offen ist.
	</p>

	<section class="bn-karte" aria-label="Dieses Gerät">
		<h2>Dieses Gerät</h2>
		{#if zustand === 'pruefe'}
			<p class="kd-info">Prüfe …</p>
		{:else if zustand === 'ios_homescreen'}
			<p>Auf dem iPhone/iPad geht Push nur aus der App auf dem Home-Bildschirm:</p>
			<ol>
				<li>In Safari unten auf „Teilen“ (Quadrat mit Pfeil) tippen.</li>
				<li>„Zum Home-Bildschirm“ wählen.</li>
				<li>Das CRM über das neue Symbol öffnen und hier erneut „Einschalten“ tippen.</li>
			</ol>
		{:else if zustand === 'nicht_moeglich'}
			<p>Dieser Browser kann keine Push-Nachrichten. Die Glocke funktioniert trotzdem.</p>
		{:else if zustand === 'blockiert'}
			<p>Benachrichtigungen sind für diese Seite im Browser blockiert. Bitte in den Browser-Einstellungen für diese Seite erlauben und neu laden.</p>
		{:else}
			<p><strong>Push auf diesem Gerät: {zustand === 'an' ? 'an' : 'aus'}</strong></p>
			<div class="bn-knoepfe">
				{#if zustand === 'aus'}
					<button type="button" class="kd-knopf" disabled={laeuft} onclick={einschalten}>Einschalten</button>
				{:else}
					<button type="button" class="kd-knopf" disabled={laeuft} onclick={testen}>Test senden</button>
					<button type="button" class="kd-knopf hell" disabled={laeuft} onclick={ausschalten}>Ausschalten</button>
				{/if}
			</div>
		{/if}
		{#if meldung}<p class={meldung.art === 'ok' ? 'kd-info' : 'kd-fehler'} role={meldung.art === 'ok' ? 'status' : 'alert'}>{meldung.text}</p>{/if}
		<p class="kd-info">Angemeldete Geräte insgesamt: {geraete}</p>
	</section>

	<section class="bn-karte" aria-label="So funktioniert es">
		<h2>So funktioniert es</h2>
		<ul>
			<li>Beim Anlegen eines To-dos oder Termins „Erinnern“ wählen – bis zu zwei, z. B. „1 Tag vorher“ und „1 Stunde vorher“.</li>
			<li>Per Sprache: „… erinnere mich einen Tag vorher und eine Stunde vorher“.</li>
			<li>To-dos ohne Uhrzeit gelten für Erinnerungen als um 8:00 Uhr fällig.</li>
			<li>Per E-Mail kommen Erinnerungen, sobald die Mail-Anbindung eingerichtet ist.</li>
		</ul>
	</section>
</main>

<style>
	.bn-karte {
		margin: 1rem 0;
		padding: 1rem;
		border: 1px solid var(--m365-rand);
		border-radius: var(--m365-radius);
		background: var(--m365-flaeche);
	}
	.bn-karte h2 {
		margin: 0 0 0.5rem;
		font-size: 1.05rem;
	}
	.bn-knoepfe {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.bn-karte li {
		margin: 0.25rem 0;
	}
</style>
