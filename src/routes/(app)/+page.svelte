<script lang="ts">
	import NavSymbol from '$lib/components/NavSymbol.svelte';
	import HeuteListe from '$lib/components/HeuteListe.svelte';
	import { speichere } from '$lib/heute-kopie';
	import { tagKurz } from '$lib/zeit';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Kopie für schlechtes Netz (nur auf diesem Gerät, bis zum Abmelden bzw. bis morgen)
	$effect(() => {
		if (data.heute && data.benutzerId) speichere(data.benutzerId, data.heuteTag, data.heute, new Date());
	});

	const bereiche = $derived((data.navigation?.haupt ?? []).filter((e) => e.symbol !== 'start'));
</script>

<svelte:head>
	<title>Start – CRM System</title>
</svelte:head>

<main class="start">
	<h1>Start</h1>

	{#if data.heute}
		<section aria-labelledby="heute-titel" class="heute">
			<h2 id="heute-titel">Meine Einsätze heute <small>{tagKurz(data.heuteTag)}</small></h2>
			<HeuteListe einsaetze={data.heute} />
		</section>
	{/if}

	{#if data.kunden}
		<form method="GET" action="/kunden" role="search" class="suche">
			<input
				type="search"
				name="suche"
				placeholder="Kunden suchen"
				aria-label="Kunden suchen"
				autocomplete="off"
				enterkeyhint="search"
			/>
			<button type="submit" class="knopf">Suchen</button>
		</form>
	{/if}

	{#if data.darfKundeAnlegen}
		<a href="/kunden/neu" class="knopf gross">+ Kunde anlegen</a>
	{/if}

	{#if bereiche.length > 0}
		<h2>Bereiche</h2>
		<ul class="kacheln">
			{#each bereiche as e (e.name)}
				<li>
					{#if e.href}
						<a href={e.href} class="kachel">
							<NavSymbol symbol={e.symbol} />
							<span>{e.name}</span>
						</a>
					{:else}
						<span class="kachel aus" aria-disabled="true">
							<NavSymbol symbol={e.symbol} />
							<span>{e.name}</span>
							{#if e.hinweis}<small>{e.hinweis}</small>{/if}
						</span>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="leise">Für Ihr Konto sind noch keine Bereiche freigeschaltet.</p>
	{/if}
</main>

<style>
	.start {
		max-width: 40rem;
		margin: 0 auto;
		padding: 1rem;
	}
	h1 {
		font-size: 1.5rem;
		margin: 0.5rem 0 1rem;
	}
	h2 {
		font-size: 1.15rem;
		margin: 1.75rem 0 0.5rem;
	}
	.heute h2 {
		margin-top: 0;
	}
	.heute h2 small {
		color: var(--text-leise);
		font-weight: 400;
	}
	.heute {
		margin-bottom: 1.5rem;
	}
	.suche {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}
	.suche input {
		width: 100%;
		min-height: var(--tippziel);
		padding: 0.5rem;
		border: 1px solid #8a8a8a;
		border-radius: 0.4rem;
	}
	.gross {
		width: 100%;
		min-height: 3.5rem;
		font-size: 1.15rem;
	}
	.kacheln {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
		gap: 0.5rem;
	}
	.kachel {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.35rem;
		min-height: 5rem;
		padding: 0.75rem;
		border: 1px solid var(--rand);
		border-radius: 0.5rem;
		color: var(--text);
		font-weight: 600;
		text-decoration: none;
	}
	a.kachel:hover {
		border-color: var(--primaer);
	}
	.kachel :global(.nav-symbol) {
		color: var(--primaer);
	}
	.kachel.aus {
		color: #8a9098;
		font-weight: 400;
	}
	.kachel.aus :global(.nav-symbol) {
		color: inherit;
	}
	.leise {
		color: var(--text-leise);
	}
	@media (min-width: 30rem) {
		.gross {
			width: auto;
			min-width: 14rem;
		}
	}
</style>
