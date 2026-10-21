<script lang="ts" module>
	/** Eine Zeile der Belegliste – für jede Belegart gleich aufgebaut (Jamil msgs 3054–3056). */
	export type BelegZeile = {
		id: string;
		/** Ziel beim Klick auf die Zeile */
		href: string;
		nummer: string;
		kunde: string;
		/** „AU-… · Titel“ oder null (→ „ohne Auftrag“) */
		auftrag: string | null;
		/** Datum (bereits deutsch formatiert) */
		datum: string;
		/** optionaler Zusatz am Ende der Unterzeile (z. B. „versendet 21.10.2026“) */
		zusatz?: string | null;
		status: { text: string; klasse: string };
		/** Betrag rechts in der Unterzeile (nur mit „Preise sehen“ – die ganze Seite verlangt das Recht) */
		betrag?: string | null;
		/** kleiner Warnhinweis unter der Unterzeile (z. B. „Preis fehlt“) */
		warnung?: string | null;
		/** PDF-Link rechts neben der Zeile */
		pdf?: string | null;
	};
</script>

<script lang="ts">
	/**
	 * EIN Seitenaufbau für alle Reiter der Ausgangsbelege (Jamil msgs 3054–3056 „bitte mehr Einheit“):
	 *   Seitenkopf → Filterleiste (Suche links, Belegart-Reiter, Status-Chips, Ansichten rechts)
	 *   → Kennzahl-Streifen „<TYP> · <ZEITRAUM>“ mit Zeitraum-Umschalter → Liste mit gleicher Zeile.
	 * Neue Belegarten benutzen diesen Baustein – keine eigene Variante bauen (docs/design-regeln.md „Einheitlichkeit“).
	 * `gesperrt`: Belegart noch nicht angebunden (Rechnungen/Lexware) – gleicher Rahmen, Suche und Status gesperrt,
	 * statt der Liste der Leerzustand `leer`.
	 */
	import type { Snippet } from 'svelte';
	import FilterLeiste from '$lib/components/ui/FilterLeiste.svelte';
	import SuchFeld from '$lib/components/ui/SuchFeld.svelte';
	import Umschalter from '$lib/components/ui/Umschalter.svelte';
	import KennzahlKacheln, { type Kachel } from '$lib/components/ui/KennzahlKacheln.svelte';
	import BelegReiter from './BelegReiter.svelte';
	import { BELEG_ARTEN, BELEG_SUCHE_PLATZHALTER, belegLink, type BelegArt, type BelegFilter } from '$lib/ausgangsbelege';

	let {
		art,
		meta,
		auswahl,
		statusListe,
		kacheln = null,
		zeilen = [],
		maxTreffer = null,
		gesperrt = false,
		fehler = null,
		aktionen,
		leer
	}: {
		art: BelegArt;
		meta: string;
		/** aktueller Filter aus der Adresse (suche, status, zeitraum) */
		auswahl: BelegFilter;
		/** Status-Chips dieser Belegart (ohne „Alle“ – kommt automatisch) */
		statusListe: readonly { wert: string; text: string }[];
		/** null = Kennzahlen für diesen Nutzer aus (Modul/Recht) */
		kacheln?: Kachel[] | null;
		zeilen?: BelegZeile[];
		maxTreffer?: number | null;
		gesperrt?: boolean;
		fehler?: string | null;
		aktionen?: Snippet;
		/** Leerzustand bei `gesperrt` */
		leer?: Snippet;
	} = $props();

	const name = $derived(BELEG_ARTEN.find((a) => a.wert === art)!.text);
	const link = (o: { status?: string | null; zeitraum?: BelegFilter['zeitraum'] }) => belegLink(art, auswahl, o);
	const leerText = $derived(auswahl.status || auswahl.suche ? `Keine ${name} für diesen Filter.` : `Noch keine ${name}.`);
</script>

<main class="kd-seite breit beleg-seite">
	<header class="seiten-kopf">
		<div>
			<h1>Ausgangsbelege</h1>
			<p class="seiten-meta">{meta}</p>
		</div>
		{#if aktionen}{@render aktionen()}{/if}
	</header>
	{#if fehler}<p role="alert" class="kd-fehler">{fehler}</p>{/if}

	<FilterLeiste ansichten={art} label={`${name} filtern`}>
		{#snippet suche()}
			<SuchFeld wert={auswahl.suche} label={`${name} suchen`} placeholder={BELEG_SUCHE_PLATZHALTER} {gesperrt} />
			{#if auswahl.status}<input type="hidden" name="status" value={auswahl.status} />{/if}
			{#if auswahl.zeitraum !== 'monat'}<input type="hidden" name="zeitraum" value={auswahl.zeitraum} />{/if}
		{/snippet}
		{#snippet filter()}
			<BelegReiter aktiv={art} />
			<Umschalter
				label="Status"
				aktiv={auswahl.status ?? 'alle'}
				{gesperrt}
				eintraege={[{ wert: 'alle', text: 'Alle', href: link({ status: null }) }, ...statusListe.map((s) => ({ ...s, href: link({ status: s.wert }) }))]}
			/>
		{/snippet}
	</FilterLeiste>

	{#if kacheln && kacheln.length > 0}
		<KennzahlKacheln label={name} {kacheln} zeitraum={auswahl.zeitraum} zeitraumLink={(z) => link({ zeitraum: z })} aktiv={auswahl.status} />
	{/if}

	{#if gesperrt}
		<div class="kd-liste beleg-leer">
			<div class="kd-leer">{@render leer?.()}</div>
		</div>
	{:else}
		<ul class="kd-liste beleg-liste">
			{#each zeilen as z (z.id)}
				<li data-beleg={z.nummer}>
					<a href={z.href}>
						<span class="af-kopfzeile">
							<strong class="beleg-titel">{z.nummer} · {z.kunde}</strong>
							<span class={`an-status ${z.status.klasse}`}>{z.status.text}</span>
						</span>
						<span class="af-kopfzeile">
							<span class="kd-info">{z.auftrag ?? 'ohne Auftrag'} · {z.datum}{#if z.zusatz} · {z.zusatz}{/if}</span>
							{#if z.betrag}<span class="kt-preis">{z.betrag}</span>{/if}
						</span>
						{#if z.warnung}<span class="kt-preis-fehlt">{z.warnung}</span>{/if}
					</a>
					{#if z.pdf}
						<a class="kd-knopf hell klein beleg-pdf" href={z.pdf} target="_blank" rel="noopener" aria-label={`PDF ${z.nummer} öffnen`}>PDF</a>
					{/if}
				</li>
			{:else}
				<li class="kd-leer">{leerText}</li>
			{/each}
		</ul>
		{#if maxTreffer !== null && zeilen.length >= maxTreffer}
			<p class="kd-info">Es werden höchstens {maxTreffer} {name} angezeigt.</p>
		{/if}
	{/if}
</main>

<style>
	/* Filterleiste in jedem Reiter gleich, egal wie lang die Status-Chips sind:
	   Zeile 1 Suche links + Ansichten rechts, Zeile 2 Belegart-Reiter + Status-Chips (bricht sauber um) */
	.beleg-seite :global(.filter-leiste > .fl-rechts) {
		order: 1;
	}
	.beleg-seite :global(.filter-leiste > .fl-filter) {
		order: 2;
		flex-basis: 100%;
	}
	.beleg-liste li:not(.kd-leer) {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.beleg-liste li > a:first-child {
		flex: 1;
		min-width: 0;
	}
	/* Trennlinie über die ganze Zeile (auch unter dem PDF-Knopf) */
	.beleg-liste li:not(.kd-leer) + li {
		border-top: 1px solid var(--ui-rand);
	}
	.beleg-liste li > a:first-child {
		border-bottom: 0;
	}
	.beleg-titel {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.beleg-pdf {
		flex: none;
		margin-right: 8px;
	}
	/* Leerzustand (z. B. Rechnungen vor Lexware) als Karte wie die Liste, Inhalt mittig und umbrechend */
	.beleg-leer {
		padding: 0;
		list-style: none;
	}
	.beleg-leer :global(.kd-leer) {
		max-width: 40rem;
		margin: 0 auto;
		overflow-wrap: anywhere;
	}
	.beleg-leer :global(.kd-leer strong) {
		color: var(--ui-text);
		font-family: var(--ui-schrift-titel);
	}
</style>
