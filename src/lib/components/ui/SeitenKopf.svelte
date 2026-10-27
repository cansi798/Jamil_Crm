<script lang="ts">
	import type { Snippet } from 'svelte';
	import InfoFenster from './InfoFenster.svelte';

	/**
	 * Seitenkopf – auf JEDER Seite gleich (docs/design-regeln.md): optional Zurück-Link und Überzeile, Titel und
	 * Kennzahl links, Hauptaktionen IMMER rechts (bricht am Handy unter den Titel, bleibt rechtsbündig).
	 */
	let {
		titel,
		meta,
		ueberzeile,
		zurueck,
		aktionen,
		zusatz,
		info
	}: {
		titel: string;
		/** kurze Zeile unter dem Titel (Nummer, Anzahl, Zeitraum …) */
		meta?: string | null;
		/** kleine Überzeile in Großbuchstaben (z. B. Bereich) */
		ueberzeile?: string | null;
		/** Zurück-Link über dem Titel */
		zurueck?: { href: string; text: string } | null;
		aktionen?: Snippet;
		/** Inhalt unter Titel/Meta (z. B. Abzeichen) */
		zusatz?: Snippet;
		/** Schlüssel in `$lib/einstellungs-infos.ts`: ⓘ am Ende der Meta-Zeile (Jamil msg 3423) */
		info?: string;
	} = $props();
</script>

{#if zurueck}<a href={zurueck.href} class="kd-zurueck">← {zurueck.text}</a>{/if}
<header class="seiten-kopf">
	<div class="sk-titel">
		{#if ueberzeile}<span class="ui-eyebrow">{ueberzeile}</span>{/if}
		<h1>{titel}</h1>
		{#if meta || info}<p class="seiten-meta">{meta ?? ''}{#if info}<InfoFenster id={info} />{/if}</p>{/if}
		{#if zusatz}{@render zusatz()}{/if}
	</div>
	{#if aktionen}
		<div class="seiten-aktionen">{@render aktionen()}</div>
	{/if}
</header>

<style>
	.sk-titel {
		min-width: 0;
	}
</style>
