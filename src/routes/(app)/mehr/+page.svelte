<script lang="ts">
	import NavSymbol from '$lib/components/NavSymbol.svelte';
	import { loesche } from '$lib/heute-kopie';
	import { MOBIL_HAUPT } from '$lib/navigation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Hauptbereiche, die unten keinen Platz haben, dann die Gruppen (msg 2826)
	const weitereHaupt = $derived((data.navigation?.haupt ?? []).slice(MOBIL_HAUPT));
	const gruppen = $derived(data.navigation?.gruppen ?? []);
</script>

<svelte:head>
	<title>Mehr</title>
</svelte:head>

<main class="mehr">
	<h1>Mehr</h1>

	{#if weitereHaupt.length > 0}
		<ul class="zeilen">
			{#each weitereHaupt as e (e.name)}
				<li><a href={e.href} class="zeile"><NavSymbol symbol={e.symbol} /><span>{e.name}</span></a></li>
			{/each}
		</ul>
	{/if}
	{#each gruppen as g (g.id)}
		<h2 class="gruppe">{g.titel}</h2>
		<ul class="zeilen">
			{#each g.eintraege as e (e.name)}
				<li><a href={e.href} class="zeile"><NavSymbol symbol={e.symbol} /><span>{e.name}</span></a></li>
			{/each}
		</ul>
	{/each}

	<form method="POST" action="/api/abmelden" onsubmit={() => loesche()}>
		<button type="submit" class="zeile abmelden">
			<NavSymbol symbol="abmelden" />
			<span>Abmelden</span>
		</button>
	</form>
</main>

<style>
	.mehr {
		max-width: 40rem;
		margin: 0 auto;
		padding: 1rem;
	}
	.gruppe {
		margin: 1rem 0 0.5rem;
		font-size: var(--ui-schrift-s);
		color: var(--ui-text-leise);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	h1 {
		font-size: 1.5rem;
		margin: 0.5rem 0 1rem;
	}
	.zeilen {
		list-style: none;
		margin: 0 0 1rem;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}
	.zeile {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		min-height: 3.25rem;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--rand);
		border-radius: 0.5rem;
		background: var(--flaeche);
		color: var(--text);
		font-size: 1rem;
		text-align: left;
		text-decoration: none;
		cursor: pointer;
	}
	.abmelden {
		color: var(--fehler);
	}
</style>
