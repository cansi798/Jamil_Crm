<script lang="ts">
	import { niedrigsterTarif, type TarifInfo } from '$lib/tarife';

	/** Kleines Schild an gesperrten Funktionen: nennt den günstigsten Tarif, der das Modul enthält. */
	let { modul, tarife }: { modul: string; tarife: readonly TarifInfo[] } = $props();

	const tarif = $derived(niedrigsterTarif(tarife, modul));
</script>

{#if tarif}
	<span class="tarif-hinweis">Im Tarif {tarif.name} enthalten</span>
{/if}

<style>
	.tarif-hinweis {
		display: inline-block;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		background: #eef2ff;
		color: #3730a3;
		font-size: 0.75rem;
		font-weight: 600;
		white-space: nowrap;
	}
</style>
