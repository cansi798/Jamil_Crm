<script lang="ts">
	import type { Snippet } from 'svelte';
	/**
	 * Umschalter mit Segmenten statt Optionsfeldern (docs/design-regeln.md), z. B. „Kunde aus der Datenbank /
	 * Einmal-Kunde / Ohne Kunde“. Darunter echte Radio-Felder (Formularwert, Tastatur, Screenreader, Tests).
	 */
	let {
		name,
		optionen,
		wert = $bindable(''),
		label,
		voll = false,
		onchange,
		symbol
	}: {
		/** Feldname im Formular; ohne Namen nur Anzeige-Umschalter (Wert über bind:wert) */
		name?: string;
		/** `aria`: abweichender Name für Screenreader/Tests (z. B. wenn der Text schon als Feldname vorkommt) */
		optionen: readonly { wert: string; text: string; aria?: string }[];
		wert?: string;
		/** Beschriftung der Gruppe (für Screenreader; sichtbar macht sie die Seite selbst) */
		label: string;
		/** über die ganze Breite (Segmente teilen sich den Platz) */
		voll?: boolean;
		onchange?: (wert: string) => void;
		/** optionales Symbol vor dem Text (bekommt den Wert der Option), z. B. Kontaktweg-Symbole */
		symbol?: Snippet<[string]>;
	} = $props();
</script>

<div class="seg" class:voll role="radiogroup" aria-label={label}>
	{#each optionen as o (o.wert)}
		<label class="seg-teil" class:an={wert === o.wert}>
			<input
				type="radio"
				{name}
				value={o.wert}
				aria-label={o.aria}
				checked={wert === o.wert}
				onchange={() => {
					wert = o.wert;
					onchange?.(o.wert);
				}}
			/>
			{#if symbol}{@render symbol(o.wert)}{/if}
			<span>{o.text}</span>
		</label>
	{/each}
</div>

<style>
	/* Aussehen: globaler Umschalter-Stil (.seg in stil/komponenten.css) – hier nur das unsichtbare Radio-Feld */
	.seg-teil {
		position: relative;
	}
	.seg-teil input {
		position: absolute;
		inset: 0;
		width: 100% !important;
		height: 100% !important;
		min-width: 0 !important;
		min-height: 0 !important;
		margin: 0 !important;
		opacity: 0;
		cursor: pointer;
	}
	.seg-teil:has(input:focus-visible) {
		box-shadow: var(--ui-fokus-ring);
	}
</style>
