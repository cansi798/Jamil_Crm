<script lang="ts">
	/**
	 * Eine Erinnerung wählen (Wunsch Jamil msg 2679): keine, „… vorher“ (relativ zur Fälligkeit bzw. zum Terminbeginn)
	 * oder „zu festem Zeitpunkt“ (Tag + Uhrzeit). Sendet ein Feld `name` mit „60“ bzw. „zeit:JJJJ-MM-TTTHH:MM“.
	 */
	import { untrack } from 'svelte';
	import { VORLAUF_AUSWAHL } from '$lib/erinnerungen';

	let { name, label, wert = '' }: { name: string; label: string; wert?: string } = $props();

	const startFest = untrack(() => wert.startsWith('zeit:'));
	let auswahl = $state(untrack(() => (startFest ? 'fest' : wert)));
	let fest = $state(untrack(() => (startFest ? wert.slice(5) : '')));
	const feldwert = $derived(auswahl === 'fest' ? (fest ? `zeit:${fest}` : '') : auswahl);
</script>

<span class="ew">
	<label>
		<span class="ew-text">{label}</span>
		<select bind:value={auswahl} aria-label={label}>
			<option value="">keine</option>
			{#each VORLAUF_AUSWAHL as v (v.minuten)}<option value={String(v.minuten)}>{v.text}</option>{/each}
			<option value="fest">zu festem Zeitpunkt …</option>
		</select>
	</label>
	{#if auswahl === 'fest'}
		<input type="datetime-local" bind:value={fest} aria-label={`${label}: Tag und Uhrzeit`} step="300" />
	{/if}
	<input type="hidden" {name} value={feldwert} />
</span>

<style>
	.ew {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
	}
	.ew label {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.875rem;
	}
	.ew select,
	.ew input {
		min-height: 2.5rem;
		width: auto !important;
		font: inherit;
		font-size: 0.875rem;
	}
	.ew-text {
		white-space: nowrap;
	}
</style>
