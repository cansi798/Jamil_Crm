<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Universelle Karte im Fluent-Look: optionale Kopfzeile (Titel + Aktionen) und freier Inhalt.
	 * Nutzt die `.karte`-Klassen aus `komponenten.css`.
	 */
	let {
		titel,
		aktionen,
		children
	}: {
		titel?: Snippet;
		aktionen?: Snippet;
		children?: Snippet;
	} = $props();
</script>

<section class="karte">
	{#if titel || aktionen}
		<header class="karte-kopf">
			{#if titel}
				<h2 class="karte-titel">{@render titel()}</h2>
			{/if}
			{#if aktionen}
				<div class="karte-aktionen">{@render aktionen()}</div>
			{/if}
		</header>
	{/if}
	{#if children}
		<div class="karte-inhalt">{@render children()}</div>
	{/if}
</section>
