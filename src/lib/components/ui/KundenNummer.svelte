<script lang="ts">
	import { KUNDENNUMMER_FOLGT } from '$lib/kundennummer';

	/**
	 * Gemeinsamer Baustein für DIE Kundennummer (Can #6748): die Nummer aus Lexware, sonst „Kundennummer folgt von
	 * Lexware“ (leise). Überall gleich: Kundenliste, Kundenakte, Auftrag, Angebot, Rechnung.
	 */
	/** `kurz` (Standard): „Kd.-Nr. 10001“; `kurz={false}`: nur die Zahl (z. B. neben einer Beschriftung „Kundennummer“) */
	let { nummer, kurz = true }: { nummer: number | null | undefined; kurz?: boolean } = $props();
	const hat = $derived(typeof nummer === 'number' && nummer > 0);
</script>

<span class="kn" class:kn-folgt={!hat} data-testid="kundennummer">{#if hat}{#if kurz}Kd.-Nr. {/if}<strong>{nummer}</strong>{:else}{KUNDENNUMMER_FOLGT}{/if}</span>

<style>
	.kn {
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.kn strong {
		font-weight: 600;
	}
	.kn-folgt {
		color: var(--ui-text-leise, #6b6a6d);
		font-style: italic;
	}
</style>
