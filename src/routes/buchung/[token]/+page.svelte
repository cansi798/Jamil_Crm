<script lang="ts">
	/**
	 * Bestätigung und Verwaltung einer Online-Buchung: Termin, Kalenderdatei (.ics), absagen, verschieben.
	 * Die E-Mail-Bestätigung folgt, sobald der Mailversand angebunden ist – bis dahin: diese Seite merken/speichern.
	 */
	import { invalidateAll } from '$app/navigation';
	import Rahmen from '$lib/components/buchung/Rahmen.svelte';
	import TerminWahl from '$lib/components/buchung/TerminWahl.svelte';
	import { berlinTag, berlinUhrzeit, tagDeutsch, tagKurz } from '$lib/zeit';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const b = $derived(data.buchung);
	const basis = $derived(`/buchung/${data.token}`);

	let modus = $state<'ansicht' | 'verschieben' | 'absagen'>('ansicht');
	let neu = $state<string | null>(null);
	let fehler = $state<string | null>(null);
	let meldung = $state<string | null>(null);
	let sendet = $state(false);
	let terminWahl = $state<{ neuLaden: () => Promise<void> }>();

	const wann = (iso: string) => {
		const d = new Date(iso);
		return `${tagKurz(berlinTag(d)).split(' ')[0]}, ${tagDeutsch(berlinTag(d))}, ${berlinUhrzeit(d)} Uhr`;
	};
	const bis = (iso: string) => berlinUhrzeit(new Date(iso));

	async function senden(pfad: string, koerper: unknown, erfolg: string) {
		sendet = true;
		fehler = null;
		try {
			const r = await fetch(`${basis}/${pfad}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(koerper) });
			const x = await r.json().catch(() => ({}));
			if (!r.ok) {
				fehler = x.fehler ?? 'Das hat nicht geklappt. Bitte erneut versuchen.';
				if (r.status === 409 && pfad === 'verschieben') {
					neu = null;
					await terminWahl?.neuLaden();
				}
				return;
			}
			meldung = erfolg;
			modus = 'ansicht';
			neu = null;
			await invalidateAll();
		} catch {
			fehler = 'Keine Verbindung – bitte erneut versuchen.';
		} finally {
			sendet = false;
		}
	}
</script>

<svelte:head>
	<title>Ihr Termin – {b.betrieb.name}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<Rahmen betrieb={b.betrieb} farben={data.farben} logoUrl={`${basis}/logo?v=${b.betrieb.logoStand}`} datenschutzUrl={b.datenschutzUrl}>
	{#if b.status === 'storniert'}
		<section class="bv-kopf abgesagt" role="status">
			<h1>Termin abgesagt</h1>
			<p>Ihr Termin „{b.dienst.name}“ am {wann(b.beginn)} ist abgesagt.</p>
		</section>
	{:else}
		<section class="bv-kopf" role="status">
			{#if data.neu && !meldung}
				<p class="bv-haken" aria-hidden="true">✓</p>
				<h1>Vielen Dank, Ihr Termin ist gebucht!</h1>
			{:else}
				<h1>Ihr Termin</h1>
			{/if}
			{#if meldung}<p class="bv-ok">{meldung}</p>{/if}
		</section>
	{/if}

	<section class="bv-karte" aria-label="Termin">
		<dl>
			<dt>Termin</dt>
			<dd><strong>{b.dienst.name}</strong></dd>
			<dt>Wann</dt>
			<dd data-testid="termin-wann">{wann(b.beginn).replace(/ Uhr$/, '')}–{bis(b.ende)} Uhr</dd>
			<dt>Wo</dt>
			<dd>{b.dienst.ortName}{b.ort ? ` · ${b.ort}` : ''}</dd>
			<dt>Mit</dt>
			<dd>{b.mitarbeiterVorname} ({b.betrieb.name})</dd>
			<dt>Für</dt>
			<dd>{b.name}</dd>
		</dl>
		{#if b.status === 'aktiv'}
			<div class="bv-knoepfe">
				<a class="kd-knopf" href={`${basis}/kalender`} download="Termin.ics">In meinen Kalender (.ics)</a>
			</div>
			{#if data.neu}
				<p class="bv-hinweis">
					Bitte speichern Sie diese Seite als Lesezeichen: Über diesen Link können Sie den Termin später verschieben oder absagen.
				</p>
			{/if}
		{/if}
	</section>

	{#if b.aenderbar}
		<section class="bv-karte" aria-label="Termin ändern">
			{#if modus === 'ansicht'}
				<div class="bv-knoepfe">
					<button type="button" class="kd-knopf hell" onclick={() => ((modus = 'verschieben'), (fehler = null), (meldung = null))}>Termin verschieben</button>
					<button type="button" class="kd-knopf gefahr" onclick={() => ((modus = 'absagen'), (fehler = null), (meldung = null))}>Termin absagen</button>
				</div>
			{:else if modus === 'verschieben'}
				<h2>Neuen Termin wählen</h2>
				<TerminWahl url={`${basis}/termine`} bind:gewaehlt={neu} bind:this={terminWahl} />
				{#if fehler}<p class="kd-fehler" role="alert">{fehler}</p>{/if}
				<div class="bv-knoepfe">
					<button type="button" class="kd-knopf" disabled={!neu || sendet} onclick={() => senden('verschieben', { beginn: neu }, 'Ihr Termin wurde verschoben.')}>
						{neu ? `Auf ${wann(neu)} verschieben` : 'Bitte neuen Termin wählen'}
					</button>
					<button type="button" class="kd-knopf hell" onclick={() => (modus = 'ansicht')}>Abbrechen</button>
				</div>
			{:else}
				<h2>Termin wirklich absagen?</h2>
				<p>Der Termin am {wann(b.beginn)} wird abgesagt. Das lässt sich nicht rückgängig machen.</p>
				{#if fehler}<p class="kd-fehler" role="alert">{fehler}</p>{/if}
				<div class="bv-knoepfe">
					<button type="button" class="kd-knopf gefahr" disabled={sendet} onclick={() => senden('absagen', { absagen: true }, 'Ihr Termin wurde abgesagt.')}>Ja, absagen</button>
					<button type="button" class="kd-knopf hell" onclick={() => (modus = 'ansicht')}>Nein, Termin behalten</button>
				</div>
			{/if}
		</section>
	{/if}
</Rahmen>

<style>
	h1 {
		margin: 0;
		font-size: var(--ui-schrift-xxl);
		line-height: 1.25;
	}
	h2 {
		margin: 0 0 0.75rem;
		font-size: var(--ui-schrift-xl);
	}
	.bv-kopf {
		margin-bottom: 1rem;
		text-align: center;
	}
	.bv-haken {
		display: inline-grid;
		place-items: center;
		width: 3.5rem;
		height: 3.5rem;
		margin: 0 0 0.5rem;
		border-radius: 999px;
		background: var(--ui-gruen);
		color: #fff;
		font-size: 2rem;
	}
	.abgesagt h1 {
		color: var(--ui-gefahr);
	}
	.bv-ok {
		color: var(--ui-gruen);
		font-weight: 600;
	}
	.bv-karte {
		margin-bottom: 1rem;
		padding: 1rem;
		border: 1px solid var(--ui-rand);
		border-radius: var(--ui-radius-karte);
		background: var(--ui-flaeche);
		box-shadow: var(--ui-schatten);
	}
	dl {
		display: grid;
		grid-template-columns: 5rem 1fr;
		gap: 0.5rem 0.75rem;
		margin: 0;
		line-height: 1.6;
	}
	dt {
		color: var(--ui-text-leise);
		font-weight: 600;
	}
	dd {
		margin: 0;
	}
	.bv-knoepfe {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 1rem;
	}
	.bv-hinweis {
		margin: 1rem 0 0;
		color: var(--ui-text-leise);
		line-height: 1.6;
	}
</style>
