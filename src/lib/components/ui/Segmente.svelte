<script lang="ts">
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
		onchange
	}: {
		/** Feldname im Formular; ohne Namen nur Anzeige-Umschalter (Wert über bind:wert) */
		name?: string;
		optionen: readonly { wert: string; text: string }[];
		wert?: string;
		/** Beschriftung der Gruppe (für Screenreader; sichtbar macht sie die Seite selbst) */
		label: string;
		/** über die ganze Breite (Segmente teilen sich den Platz) */
		voll?: boolean;
		onchange?: (wert: string) => void;
	} = $props();
</script>

<div class="seg" class:voll role="radiogroup" aria-label={label}>
	{#each optionen as o (o.wert)}
		<label class="seg-teil" class:an={wert === o.wert}>
			<input
				type="radio"
				{name}
				value={o.wert}
				checked={wert === o.wert}
				onchange={() => {
					wert = o.wert;
					onchange?.(o.wert);
				}}
			/>
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
