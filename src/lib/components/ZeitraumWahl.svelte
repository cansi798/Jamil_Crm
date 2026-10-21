<script lang="ts">
	import { untrack } from 'svelte';
	import Segmente from './ui/Segmente.svelte';
	import DatumWahl from './ui/DatumWahl.svelte';

	/**
	 * Tag oder Zeitraum einer Aufgabe (Jamil msg 2977): Umschalter „Ein Tag | Zeitraum“, dazu Datum-Chips und optionale
	 * Uhrzeiten. Felder: `faellig` (+ `faelligZeit`) = der Tag bzw. das Ende, `vonTag` (+ `vonZeit`) = der Beginn.
	 * Im Modus „Ein Tag“ gehen `vonTag`/`vonZeit` leer mit (ein vorhandener Zeitraum wird so aufgehoben).
	 */
	let {
		faellig = $bindable(''),
		faelligZeit = $bindable(''),
		vonTag = $bindable(''),
		vonZeit = $bindable(''),
		/** z. B. bei wiederkehrenden Aufgaben: nur ein Tag */
		nurTag = false
	}: { faellig?: string; faelligZeit?: string; vonTag?: string; vonZeit?: string; nurTag?: boolean } = $props();

	let art = $state(untrack(() => (vonTag ? 'zeitraum' : 'tag')));
	const zeitraum = $derived(art === 'zeitraum' && !nurTag);
</script>

<span class="zr" role="group" aria-label="Tag oder Zeitraum">
	{#if !nurTag}
		<Segmente label="Ein Tag oder Zeitraum" optionen={[{ wert: 'tag', text: 'Ein Tag' }, { wert: 'zeitraum', text: 'Zeitraum' }]} bind:wert={art} />
	{/if}
	{#if zeitraum}
		<DatumWahl name="vonTag" label="Von" bind:wert={vonTag} />
		{#if vonTag}
			<input class="zr-zeit" type="time" name="vonZeit" bind:value={vonZeit} aria-label="Uhrzeit von (optional)" step="300" />
		{:else}
			<input type="hidden" name="vonZeit" value="" />
		{/if}
		<DatumWahl name="faellig" label="Bis" bind:wert={faellig} />
	{:else}
		<input type="hidden" name="vonTag" value="" />
		<input type="hidden" name="vonZeit" value="" />
		<DatumWahl name="faellig" bind:wert={faellig} />
	{/if}
	{#if faellig}
		<input class="zr-zeit" type="time" name="faelligZeit" bind:value={faelligZeit} aria-label={zeitraum ? 'Uhrzeit bis (optional)' : 'Uhrzeit (optional)'} step="300" />
	{:else}
		<input type="hidden" name="faelligZeit" value="" />
	{/if}
</span>

<style>
	.zr {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}
	.zr-zeit {
		min-height: 2.5rem;
		width: auto !important;
	}
</style>
