<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Fuß jedes Formulars (docs/design-regeln.md): Aktionen IMMER unten rechts, „Abbrechen“ links von „Speichern“.
	 * `links` für seltene Zusatzaktionen ganz links (z. B. „Löschen“).
	 */
	let { children, links }: { children: Snippet; links?: Snippet } = $props();
</script>

<div class="form-fuss">
	{#if links}<div class="form-fuss-links">{@render links()}</div>{/if}
	<div class="form-fuss-rechts">{@render children()}</div>
</div>
