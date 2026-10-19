<script lang="ts">
	import { STUFEN, STUFE_NAMEN } from '$lib/stufen';

	/**
	 * Stufe gering/mittel/hoch als farbige Segmente (statt <select>), z. B. „Lautstärke“ oder „Schmutz“.
	 * Nochmals auf das gewählte Segment tippen hebt die Auswahl auf. Wert über Radio-Felder `name`.
	 */
	let {
		name,
		label,
		wert = $bindable('')
	}: { name: string; label: string; wert?: string } = $props();
	const FARBE: Record<number, string> = { 1: 'gruen', 2: 'orange', 3: 'rot' };
</script>

<div class="sw" role="radiogroup" aria-label={label}>
	<span class="sw-label" aria-hidden="true">{label}</span>
	<span class="sw-segmente">
		<input type="radio" {name} value="" checked={wert === ''} hidden />
		{#each STUFEN as n (n)}
			<label class={`sw-seg ${FARBE[n]}`} class:an={wert === String(n)}>
				<input
					type="radio"
					{name}
					value={String(n)}
					checked={wert === String(n)}
					onclick={() => (wert = wert === String(n) ? '' : String(n))}
				/>
				{STUFE_NAMEN[n]}
			</label>
		{/each}
	</span>
</div>

<style>
	.sw {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		min-height: var(--ui-feld-hoehe);
	}
	.sw-label {
		color: var(--ui-text-leise);
		font-size: var(--ui-schrift-s);
		font-weight: 500;
	}
	.sw-segmente {
		display: inline-flex;
		padding: 2px;
		border: 1px solid var(--ui-rand-stark);
		border-radius: 999px;
		background: var(--ui-flaeche);
	}
	.sw-seg {
		position: relative;
		display: inline-flex !important;
		align-items: center;
		min-height: calc(var(--ui-feld-hoehe) - 6px) !important;
		padding: 0 0.75rem;
		border-radius: 999px;
		color: var(--ui-text-leise) !important;
		font-size: var(--ui-schrift-s) !important;
		font-weight: 500 !important;
		cursor: pointer;
		transition: background 120ms, color 120ms;
	}
	.sw-seg input {
		position: absolute;
		inset: 0;
		width: 100% !important;
		height: 100% !important;
		min-height: 0 !important;
		margin: 0 !important;
		opacity: 0;
		cursor: pointer;
	}
	.sw-seg:hover {
		background: var(--m365-flaeche-hover);
	}
	.sw-seg:has(input:focus-visible) {
		box-shadow: var(--ui-fokus-ring);
	}
	.sw-seg.an.gruen {
		background: var(--ui-gruen);
		color: #fff !important;
	}
	.sw-seg.an.orange {
		background: var(--ui-orange);
		color: #fff !important;
	}
	.sw-seg.an.rot {
		background: var(--ui-rot);
		color: #fff !important;
	}
</style>
