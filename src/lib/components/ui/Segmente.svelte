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
		name: string;
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
	.seg {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 2px;
		max-width: 100%;
		padding: 3px;
		border-radius: 999px;
		background: var(--ui-grau-hell);
		border: 1px solid var(--ui-rand);
	}
	.seg.voll {
		display: flex;
	}
	.seg.voll .seg-teil {
		flex: 1 1 0;
	}
	.seg-teil {
		position: relative;
		display: inline-flex !important;
		align-items: center;
		justify-content: center;
		min-height: calc(var(--ui-feld-hoehe) - 6px) !important;
		padding: 0 1rem;
		border-radius: 999px;
		color: var(--ui-text-leise) !important;
		font-family: var(--ui-schrift-titel);
		font-size: 0.8125rem !important;
		font-weight: 600 !important;
		text-align: center;
		cursor: pointer;
		transition: background 150ms, color 150ms, box-shadow 150ms;
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
	.seg-teil:hover:not(.an) {
		color: var(--ui-text) !important;
	}
	.seg-teil.an {
		background: var(--ui-flaeche);
		color: var(--ui-text) !important;
		box-shadow: 0 1px 3px rgba(45, 44, 46, 0.14), inset 0 -2px 0 var(--ui-akzent);
	}
	.seg-teil:has(input:focus-visible) {
		box-shadow: var(--ui-fokus-ring);
	}
</style>
