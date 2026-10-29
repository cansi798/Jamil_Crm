<script lang="ts">
	import InfoFenster from '$lib/components/ui/InfoFenster.svelte';
	import { onMount } from 'svelte';
	import '$lib/stil/kunden.css';
	import type { ActionData, PageData } from './$types';
	import { enhance } from '$app/forms';
	import Abschnitt from '$lib/components/Abschnitt.svelte';
	import Schalter from '$lib/components/ui/Schalter.svelte';
	import { BENACHRICHTIGUNGS_KATEGORIEN } from '$lib/benachrichtigungen';

	/**
	 * Push-Benachrichtigungen auf diesem Gerät (Wunsch Jamil msg 2679). Android/PC: im Browser erlauben. iPhone/iPad:
	 * erst „Zum Home-Bildschirm“ hinzufügen und die App von dort öffnen (Apple erlaubt Push nur so, ab iOS 16.4).
	 */
	let { data, form }: { data: PageData; form: ActionData } = $props();

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
		Erinnerungen zu Aufgaben und Terminen erscheinen immer in der Glocke oben – und eine Nachricht, sobald dich etwas betrifft (dir wird eine
		Aufgabe zugewiesen, du wirst für einen Termin eingeteilt …). Hier schaltest du zusätzlich Push-Nachrichten auf diesem Gerät ein – dann
		klingelt das Handy bzw. der PC, auch wenn das CRM gerade nicht offen ist.
	<InfoFenster id="benachrichtigungen.seite" /></p>

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

	<Abschnitt titel="Worüber benachrichtigen?" id="bn-wahl" info="benachrichtigungen.wahl">
		{#snippet aktionen()}<button type="submit" form="bn-wahl-form" class="kd-knopf klein" data-testid="bn-wahl-speichern">Speichern</button>{/snippet}
		{#if form && 'wahlGespeichert' in form}<p role="status" class="kd-info bn-ok">Gespeichert.</p>{/if}
		{#if form && 'fehler' in form}<p role="alert" class="kd-fehler">{form.fehler}</p>{/if}
		<p class="kd-info">Du bekommst eine Nachricht, wenn jemand anderes etwas tut, das dich betrifft – nie für deine eigenen Änderungen.</p>
		<form id="bn-wahl-form" method="POST" action="?/wahl" use:enhance={() => async ({ update }) => update({ reset: false })}>
			<ul class="bn-wahl">
				{#each BENACHRICHTIGUNGS_KATEGORIEN as kat (kat.id)}
					<li data-kategorie={kat.id}>
						<div class="bn-wahl-text"><strong>{kat.titel}</strong><span class="kd-info">{kat.wann}</span></div>
						<div class="bn-wahl-schalter">
							<Schalter name={`${kat.id}_glocke`} label="Glocke" an={data.wahl[kat.id].glocke} />
							<Schalter name={`${kat.id}_push`} label="Push" an={data.wahl[kat.id].push} />
						</div>
					</li>
				{/each}
			</ul>
		</form>
	</Abschnitt>

	<section class="bn-karte" aria-label="So funktioniert es">
		<h2>So funktioniert es</h2>
		<ul>
			<li>Beim Anlegen einer Aufgabe oder Termins „Erinnern“ wählen – bis zu zwei, z. B. „1 Tag vorher“ und „1 Stunde vorher“.</li>
			<li>Per Sprache: „… erinnere mich einen Tag vorher und eine Stunde vorher“.</li>
			<li>Aufgaben ohne Uhrzeit gelten für Erinnerungen als um 8:00 Uhr fällig.</li>
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
	.bn-ok {
		color: var(--ui-gruen);
		font-weight: 600;
	}
	.bn-wahl {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.bn-wahl li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem 1rem;
		padding: 0.6rem 0;
		border-top: 1px dashed var(--m365-rand);
	}
	.bn-wahl li:first-child {
		border-top: 0;
	}
	.bn-wahl-text {
		display: grid;
		gap: 0.15rem;
		flex: 1 1 16rem;
	}
	.bn-wahl-schalter {
		display: flex;
		gap: 1.25rem;
	}
</style>
