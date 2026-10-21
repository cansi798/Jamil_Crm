<script lang="ts">
	import type { Snippet } from 'svelte';
	import GespeicherteAnsichten from './GespeicherteAnsichten.svelte';

	/**
	 * Filterleiste – auf jeder Listenseite gleich aufgebaut (docs/design-regeln.md):
	 *   links Suche, daneben Filter-Chips (Person, Status …), rechts Ansicht/Zusatz.
	 * Als GET-Formular (`form`, Standard) oder nur als Rahmen (`form={false}`), wenn die Seite selbst filtert.
	 * `ansichten="<seite>"` zeigt rechts den Knopf „Gespeicherte Ansichten“ (Jamil msgs 2830, 2921).
	 */
	let {
		suche,
		filter,
		rechts,
		form = true,
		label = 'Liste filtern',
		ansichten
	}: { suche?: Snippet; filter?: Snippet; rechts?: Snippet; form?: boolean; label?: string; ansichten?: string } = $props();
</script>

{#snippet inhalt()}
	{#if suche}{@render suche()}{/if}
	{#if filter}<div class="fl-filter">{@render filter()}</div>{/if}
	{#if rechts || ansichten}
		<div class="fl-rechts">
			{#if ansichten}<GespeicherteAnsichten seite={ansichten} />{/if}
			{#if rechts}{@render rechts()}{/if}
		</div>
	{/if}
{/snippet}

{#if form}
	<form method="GET" class="filter-leiste" role="search" aria-label={label} data-sveltekit-keepfocus data-sveltekit-replacestate>
		{@render inhalt()}
	</form>
{:else}
	<div class="filter-leiste" role="group" aria-label={label}>{@render inhalt()}</div>
{/if}
