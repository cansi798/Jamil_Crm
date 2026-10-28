<script lang="ts">
	/**
	 * Abzeichen in der Zeile der Kundenliste (Jamil, Talk msg 3522): letztes Angebot, Kundenportal (aktiv, wie oft geöffnet),
	 * offene Aufträge, nächster Termin, Bestandskunde. Gleiche Optik wie die Abzeichen der Auftragskarten (`ah-chip`);
	 * Einzelheiten stehen im Tooltip und – für Screenreader – im versteckten Text.
	 */
	import { kundenAbzeichen, type KundenZeilenInfo } from '$lib/kunden-zeilen';

	let { info }: { info: KundenZeilenInfo | null } = $props();
	const liste = $derived(kundenAbzeichen(info));
</script>

{#if liste.length > 0}
	<span class="ah kh" data-testid="kunden-hinweise">
		{#each liste as a (a.art)}
			<span class={`ah-chip ${a.ton}`} title={a.titel} data-art={a.art}>
				<span aria-hidden="true">{a.zeichen}</span>
				{a.text}<span class="kh-unsichtbar"> – {a.titel}</span>
			</span>
		{/each}
	</span>
{/if}

<style>
	/* in der Zeile mit Avatar immer in der Textspalte */
	.kh {
		grid-column: 2;
		margin-top: 0.15rem;
	}
	/* Handy: kompakter, damit fünf Abzeichen nicht die halbe Zeile füllen */
	@media (max-width: 640px) {
		.kh {
			gap: 0.2rem 0.25rem;
		}
		.kh :global(.ah-chip) {
			font-size: 0.6875rem;
			line-height: 1.05rem;
		}
	}
	.kh-unsichtbar {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
</style>
