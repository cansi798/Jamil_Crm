<script lang="ts">
	import type { Snippet } from 'svelte';
	import { enhance } from '$app/forms';
	import LoeschenKnopf from './LoeschenKnopf.svelte';
	import LoeschenPanel from './LoeschenPanel.svelte';

	/**
	 * Eine hinterlegte Datei (Logo, helle Logo-Variante, AGB-PDF …) – überall gleich (Jamil msgs 3090, 3097):
	 * Vorschau, Dateifeld, darunter EINE Knopfzeile „<hochladen>“ und „<entfernen>“ nebeneinander. Entfernen fragt
	 * immer erst nach (msg 3091) – Rückfrage wie beim Löschen (`LoeschenPanel`) direkt darunter.
	 */
	let {
		id,
		vorschau,
		vorhanden,
		feldLabel,
		feldName = 'datei',
		accept,
		hochladenAktion,
		hochladenText,
		entfernenAktion,
		entfernenText,
		ding,
		warnung,
		fehler = null,
		meldung = null,
		entfernenFehler = null
	}: {
		/** eindeutig je Seite (für die Rückfrage) */
		id: string;
		vorschau: Snippet;
		vorhanden: boolean;
		feldLabel: string;
		feldName?: string;
		accept: string;
		hochladenAktion: string;
		hochladenText: string;
		entfernenAktion: string;
		entfernenText: string;
		/** z. B. „Logo“ – für die Rückfrage */
		ding: string;
		/** Satz in der Rückfrage */
		warnung: string;
		fehler?: string | null;
		meldung?: string | null;
		entfernenFehler?: string | null;
	} = $props();
	let offen = $state(false);
</script>

<div class="df">
	{@render vorschau()}
	{#if fehler}
		<p role="alert" class="kd-fehler">{fehler}</p>
	{:else if meldung}
		<p role="status" class="df-ok">{meldung}</p>
	{/if}
	<form method="POST" action={hochladenAktion} enctype="multipart/form-data" use:enhance class="df-form">
		<label class="df-feld">
			{feldLabel}
			<input type="file" name={feldName} {accept} required />
		</label>
		<div class="df-knoepfe">
			<button type="submit" class="kd-knopf">{hochladenText}</button>
			{#if vorhanden}<LoeschenKnopf ding={ding} label={entfernenText} ziel={`${id}-entfernen`} bind:offen />{/if}
		</div>
	</form>
	{#if vorhanden}
		<LoeschenPanel id={`${id}-entfernen`} {ding} bind:offen aktion={entfernenAktion} fehler={entfernenFehler} knopf="Ja, entfernen">
			{warnung}
		</LoeschenPanel>
	{/if}
</div>

<style>
	.df {
		display: grid;
		gap: var(--ui-a3);
		margin-bottom: var(--ui-a4);
	}
	.df-form {
		display: grid;
		gap: var(--ui-a3);
	}
	.df-feld {
		display: grid;
		gap: 0.25rem;
		color: var(--ui-text-leise);
		font-size: var(--ui-schrift-s);
		font-weight: 600;
	}
	.df-knoepfe {
		display: flex;
		flex-wrap: wrap;
		gap: var(--ui-a2);
	}
	.df-ok {
		margin: 0;
		color: var(--ui-gruen);
		font-weight: 600;
	}
	.df :global(.lo-oben) {
		margin: 0;
	}
</style>
