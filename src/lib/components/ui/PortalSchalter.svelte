<script lang="ts">
	import { enhance } from '$app/forms';

	/**
	 * „Im Kundenportal“ je Eintrag (Links, Dokumente, Notizen am Auftrag – Jamil msgs 2850, 3070): kleiner Umschalter,
	 * speichert sofort. EIN Baustein für alle Listen (Einheitlichkeit).
	 */
	let {
		aktion,
		felder,
		an,
		label
	}: {
		/** Formular-Aktion, z. B. „?/linkPortal“ */
		aktion: string;
		/** versteckte Felder (z. B. { linkId }) */
		felder: Record<string, string>;
		an: boolean;
		/** Vorlesename, z. B. „„Abnahme“ im Kundenportal anzeigen“ */
		label: string;
	} = $props();
</script>

<form method="POST" action={aktion} use:enhance={() => async ({ update }) => update({ reset: false })} class="ps">
	{#each Object.entries(felder) as [name, wert] (name)}<input type="hidden" {name} value={wert} />{/each}
	<input type="hidden" name="imPortal" value={an ? 'nein' : 'ja'} />
	<button type="submit" class="ps-knopf" role="switch" aria-checked={an} aria-label={label}>
		<span class="ps-bahn" aria-hidden="true"></span> Im Kundenportal
	</button>
</form>

<style>
	.ps {
		margin: 0;
	}
	.ps-knopf {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 44px;
		background: none;
		border: none;
		padding: 0;
		color: var(--ui-text);
		font: inherit;
		cursor: pointer;
	}
	.ps-bahn {
		position: relative;
		width: 1.75rem;
		height: 1rem;
		border-radius: 1rem;
		background: var(--ui-rand);
		transition: background 0.15s;
	}
	.ps-bahn::after {
		content: '';
		position: absolute;
		top: 0.125rem;
		left: 0.125rem;
		width: 0.75rem;
		height: 0.75rem;
		border-radius: 50%;
		background: var(--ui-flaeche, #fff);
		transition: transform 0.15s;
	}
	.ps-knopf[aria-checked='true'] .ps-bahn {
		background: var(--ui-akzent);
	}
	.ps-knopf[aria-checked='true'] .ps-bahn::after {
		transform: translateX(0.75rem);
	}
	@media (prefers-reduced-motion: reduce) {
		.ps-bahn,
		.ps-bahn::after {
			transition: none;
		}
	}
</style>
