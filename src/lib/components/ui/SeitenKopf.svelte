<script lang="ts">
	import type { Snippet } from 'svelte';

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
		zusatz
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
	} = $props();
</script>

{#if zurueck}<a href={zurueck.href} class="kd-zurueck">← {zurueck.text}</a>{/if}
<header class="seiten-kopf">
	<div class="sk-titel">
		{#if ueberzeile}<span class="ui-eyebrow">{ueberzeile}</span>{/if}
		<h1>{titel}</h1>
		{#if meta}<p class="seiten-meta">{meta}</p>{/if}
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
