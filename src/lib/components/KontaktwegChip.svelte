<script lang="ts">
	import KontaktwegSymbol from '$lib/components/ui/KontaktwegSymbol.svelte';
	import { KONTAKTWEG_NAMEN, type Kontaktweg } from '$lib/kontaktweg';

	/**
	 * Abzeichen „Bevorzugt: Chat“ (Jamil msgs 4289/4291) in der Optik der übrigen kleinen Abzeichen (`.ah-chip`):
	 * Kundenakte, Auftrag, Kundenliste. Ohne Angabe: nichts – oder mit `leer` ein ruhiges „Kontaktweg: keine Angabe“.
	 */
	let { weg, kurz = false, leer = false }: { weg: Kontaktweg | null; kurz?: boolean; leer?: boolean } = $props();
</script>

{#if weg}
	<span class="ah-chip kw-chip" data-testid="kontaktweg-chip" data-weg={weg} title={`Bevorzugter Kontaktweg: ${KONTAKTWEG_NAMEN[weg]}`}>
		<KontaktwegSymbol {weg} groesse={14} />
		{kurz ? KONTAKTWEG_NAMEN[weg] : `Bevorzugt: ${KONTAKTWEG_NAMEN[weg]}`}
	</span>
{:else if leer}
	<span class="ah-chip leer" data-testid="kontaktweg-chip" data-weg="">Kontaktweg: keine Angabe</span>
{/if}

<style>
	.kw-chip {
		background: #e8f1fb;
		color: #0f4c81;
		font-weight: 600;
		gap: 0.3rem;
	}
</style>
