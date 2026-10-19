<script lang="ts">
	/**
	 * Datum als Chip mit Kalender-Symbol („Fällig“ bzw. „Fällig: Fr 24.10.“). Klick öffnet den Kalender des
	 * Geräts (natives Datumsfeld, unsichtbar im Chip – so bleibt die Eingabe barrierefrei und mobil vertraut).
	 */
	let {
		name,
		wert = $bindable(''),
		label = 'Fällig'
	}: { name: string; wert?: string; label?: string } = $props();

	let feld = $state<HTMLInputElement>();
	const TAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
	const anzeige = $derived.by(() => {
		const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(wert);
		if (!m) return null;
		const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
		const jahr = d.getFullYear() !== new Date().getFullYear() ? m[1] : '';
		return `${TAGE[d.getDay()]} ${m[3]}.${m[2]}.${jahr}`;
	});
	function oeffnen() {
		if (!feld) return;
		try {
			feld.showPicker();
		} catch {
			feld.focus();
		}
	}
</script>

<span class="dw">
	<button type="button" class="ui-chip" class:gesetzt={!!anzeige} onclick={oeffnen} aria-hidden="true" tabindex="-1">
		<svg viewBox="0 0 16 16" class="dw-symbol"><rect x="2.5" y="3.5" width="11" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.4" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" /></svg>
		<span class:leise={!anzeige}>{anzeige ? `${label}: ${anzeige}` : label}</span>
	</button>
	<input bind:this={feld} class="dw-feld" type="date" {name} bind:value={wert} aria-label={label} onclick={oeffnen} />
	{#if anzeige}
		<button type="button" class="dw-weg" aria-label={`${label} entfernen`} onclick={() => (wert = '')}>
			<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 5l6 6M11 5l-6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
		</button>
	{/if}
</span>

<style>
	.dw {
		position: relative;
		display: inline-flex;
		align-items: center;
	}
	.dw-symbol {
		width: 16px;
		height: 16px;
		flex: none;
		color: var(--ui-text-leise);
	}
	.gesetzt .dw-symbol {
		color: var(--ui-akzent);
	}
	.leise {
		color: var(--ui-text-leise);
	}
	/* Natives Feld liegt unsichtbar über dem Chip: Fokus per Tastatur landet hier, Tippen öffnet den Kalender */
	.dw-feld {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		min-height: 0;
		padding: 0;
		border: 0;
		opacity: 0;
		cursor: pointer;
	}
	.dw-feld:focus-visible + .dw-weg,
	.dw:focus-within .ui-chip {
		box-shadow: var(--ui-fokus-ring);
		border-color: var(--ui-akzent);
	}
	.dw-weg {
		position: relative;
		z-index: 1;
		display: inline-grid;
		place-items: center;
		width: 1.75rem;
		height: 1.75rem;
		margin-left: -2.1rem;
		border: 0;
		border-radius: 999px;
		background: transparent;
		color: var(--ui-text-leise);
		cursor: pointer;
	}
	.dw-weg:hover {
		background: var(--m365-flaeche-hover);
	}
	.dw-weg svg {
		width: 14px;
		height: 14px;
	}
	.gesetzt {
		padding-right: 2.25rem;
	}
</style>
