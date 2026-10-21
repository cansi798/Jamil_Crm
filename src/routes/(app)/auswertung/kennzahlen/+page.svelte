<script lang="ts">
	import Umschalter from '$lib/components/ui/Umschalter.svelte';
	import { kennzahlText, ZEITRAUM_ARTEN, ZEITRAUM_NAMEN, type Kennzahl } from '$lib/kennzahlen';
	import { tagDeutsch, tagPlus } from '$lib/zeit';
	import type { PageData } from './$types';

	/**
	 * Kennzahlen-Cockpit (Jamil msg 2858): je Kennzahl Wert, Ampel nach Richtwert, Trend zum Vorzeitraum, Formel und
	 * „Warum kritisch“. Fehlt die Grundlage, steht das ausdrücklich da (keine irreführende Null).
	 */
	let { data }: { data: PageData } = $props();
	const z = $derived(data.zeitraum);
	const spanneText = $derived(z.spanne ? `${tagDeutsch(z.spanne.von)} – ${tagDeutsch(tagPlus(z.spanne.bis, -1))}` : 'alle Daten');
	const AMPEL_NAME = { gruen: 'Grün', gelb: 'Gelb', rot: 'Rot' } as const;

	function trendText(k: Kennzahl): string | null {
		if (!k.trend) return null;
		const pfeil = k.trend.richtung === 'hoch' ? '↑' : k.trend.richtung === 'runter' ? '↓' : '→';
		const vorher = kennzahlText(k.info.einheit, k.vorher);
		return `${pfeil} vorher ${vorher}`;
	}
	function grundlage(k: Kennzahl): string | null {
		if (k.fehlt || k.nenner === undefined) return null;
		switch (k.id) {
			case 'abschlussquote':
				return `${k.zaehler} von ${k.nenner} abgegebenen Angeboten beauftragt`;
			case 'durchlaufzeit':
				return `aus ${k.nenner} Aufträgen`;
			case 'termintreue':
				return `${k.zaehler} von ${k.nenner} Projekten termingerecht`;
			case 'produktivitaet':
				return `${k.zaehler} h Ist zu ${k.nenner} h kalkuliert`;
			case 'nacharbeit':
				return `${k.zaehler} h Nacharbeit von ${k.nenner} h`;
			case 'umsatz_mitarbeiter':
				return `${kennzahlText('euro', k.zaehler ?? 0)} Umsatz · ${k.nenner} Mitarbeiter`;
			default:
				return null;
		}
	}
</script>

<svelte:head><title>Kennzahlen</title></svelte:head>

<main class="kd-seite breit kzc">
	<header class="seiten-kopf">
		<div>
			<h1>Kennzahlen</h1>
			<p class="seiten-meta">{ZEITRAUM_NAMEN[z.art]} · {spanneText}{z.vorher ? ' · Trend zum Zeitraum davor' : ''}</p>
		</div>
	</header>
	<Umschalter
		label="Zeitraum"
		aktiv={z.art}
		eintraege={ZEITRAUM_ARTEN.map((a) => ({ wert: a, text: ZEITRAUM_NAMEN[a], href: `?zeitraum=${a}` }))}
	/>

	<ul class="kzc-raster" aria-label="Kennzahlen">
		{#each data.kennzahlen as k (k.id)}
			<li class={`kzc-karte ampel-${k.ampel ?? 'keine'}`} aria-labelledby={`kz-${k.id}`}>
				<div class="kzc-kopf">
					<h2 id={`kz-${k.id}`}>{k.info.titel}</h2>
					{#if k.ampel}<span class="kzc-ampel" title={`Ampel: ${AMPEL_NAME[k.ampel]}`}><span class="kzc-punkt" aria-hidden="true"></span>{k.ampelText}</span>{/if}
				</div>
				{#if k.fehlt}
					<p class="kzc-fehlt">{k.fehlt}</p>
				{:else}
					<p class="kzc-wert">{kennzahlText(k.info.einheit, k.wert)}</p>
					{#if grundlage(k)}<p class="kzc-grundlage">{grundlage(k)}</p>{/if}
					{#if trendText(k)}
						<p class={`kzc-trend ${k.trend?.gut === true ? 'gut' : k.trend?.gut === false ? 'schlecht' : ''}`}>{trendText(k)}</p>
					{/if}
				{/if}
				{#if k.hinweis}<p class="kzc-hinweis">{k.hinweis}</p>{/if}
				<p class="kzc-formel"><span class="kd-info">Formel:</span> {k.info.formel}</p>
				<details class="kzc-warum">
					<summary>Warum wichtig?</summary>
					<p>{k.info.warum}</p>
					<p><strong>Richtwert:</strong> {k.info.richtwert ?? 'keiner vorgegeben – deshalb ohne Ampel'}</p>
				</details>
			</li>
		{/each}
	</ul>
	<p class="kd-info">
		Zeitmessung je Aufgabe aus Auftrags-Vorlagen: unter <a href="/auftrag-vorlagen">Auftrags-Vorlagen</a> bei der jeweiligen Vorlage.
		Nacharbeit markieren Sie in der Zeiterfassung (beim Nachtragen/Korrigieren) und an Aufgaben.
	</p>
</main>

<style>
	.kzc-raster {
		list-style: none;
		margin: var(--ui-a4) 0;
		padding: 0;
		display: grid;
		gap: var(--ui-a3);
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 18rem), 1fr));
	}
	.kzc-karte {
		display: grid;
		align-content: start;
		gap: 0.4rem;
		padding: var(--ui-a3);
		border: 1px solid var(--ui-rand);
		border-top: 4px solid var(--ui-grau);
		border-radius: var(--ui-radius-karte);
		background: var(--ui-flaeche);
		min-width: 0;
	}
	.kzc-karte.ampel-gruen {
		border-top-color: var(--ui-gruen);
	}
	.kzc-karte.ampel-gelb {
		border-top-color: var(--ui-orange);
	}
	.kzc-karte.ampel-rot {
		border-top-color: var(--ui-rot);
	}
	.kzc-kopf {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 0.25rem 0.5rem;
		align-items: baseline;
	}
	.kzc-kopf h2 {
		margin: 0;
		font-size: var(--ui-schrift-m);
	}
	.kzc-ampel {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: var(--ui-schrift-s);
		font-weight: 600;
	}
	.kzc-punkt {
		width: 0.7rem;
		height: 0.7rem;
		border-radius: 50%;
		background: var(--ui-grau);
	}
	.ampel-gruen .kzc-punkt {
		background: var(--ui-gruen);
	}
	.ampel-gelb .kzc-punkt {
		background: var(--ui-orange);
	}
	.ampel-rot .kzc-punkt {
		background: var(--ui-rot);
	}
	.kzc-wert {
		margin: 0;
		font-size: var(--ui-schrift-xxl);
		font-weight: 800;
		line-height: 1.1;
	}
	.kzc-karte p {
		margin: 0;
	}
	.kzc-grundlage,
	.kzc-formel,
	.kzc-hinweis {
		font-size: var(--ui-schrift-s);
		color: var(--ui-text-leise);
		overflow-wrap: anywhere;
	}
	.kzc-trend {
		font-size: var(--ui-schrift-s);
		font-weight: 600;
	}
	.kzc-trend.gut {
		color: var(--ui-gruen);
	}
	.kzc-trend.schlecht {
		color: var(--ui-rot);
	}
	.kzc-fehlt {
		padding: 0.5rem 0.6rem;
		border-radius: var(--ui-radius);
		background: var(--ui-grau-hell);
		font-size: var(--ui-schrift-s);
	}
	.kzc-warum summary {
		cursor: pointer;
		min-height: 44px;
		display: flex;
		align-items: center;
		color: var(--ui-akzent-text);
		font-weight: 600;
		font-size: var(--ui-schrift-s);
	}
	.kzc-warum p {
		font-size: var(--ui-schrift-s);
		margin-top: 0.25rem;
	}
</style>
