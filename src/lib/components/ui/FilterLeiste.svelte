<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Filterleiste – auf jeder Listenseite gleich aufgebaut (docs/design-regeln.md):
	 *   links Suche, daneben Filter-Chips (Person, Status …), rechts Ansicht/Zusatz.
	 * Als GET-Formular (`form`, Standard) oder nur als Rahmen (`form={false}`), wenn die Seite selbst filtert.
	 */
	let {
		suche,
		filter,
		rechts,
		form = true,
		label = 'Liste filtern'
	}: { suche?: Snippet; filter?: Snippet; rechts?: Snippet; form?: boolean; label?: string } = $props();
</script>

{#snippet inhalt()}
	{#if suche}{@render suche()}{/if}
	{#if filter}<div class="fl-filter">{@render filter()}</div>{/if}
	{#if rechts}<div class="fl-rechts">{@render rechts()}</div>{/if}
{/snippet}

{#if form}
	<form method="GET" class="filter-leiste" role="search" aria-label={label} data-sveltekit-keepfocus data-sveltekit-replacestate>
		{@render inhalt()}
	</form>
{:else}
	<div class="filter-leiste" role="group" aria-label={label}>{@render inhalt()}</div>
{/if}
