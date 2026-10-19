<script lang="ts">
	import type { PageData } from './$types';
	export let data: PageData;
</script>

<svelte:head>
	<title>Vorlagen – CRM</title>
</svelte:head>

<div class="seite">
	<header class="kopf">
		<h1>Auftrags-Vorlagen</h1>
		{#if data.darfBearbeiten}
			<a href="/auftrag-vorlagen/neu" class="knopf prima">+ Neue Vorlage</a>
		{/if}
	</header>

	{#if data.vorlagen.length === 0}
		<p class="leer">Noch keine Vorlagen vorhanden.</p>
	{:else}
		<ul class="liste">
			{#each data.vorlagen as vorlage (vorlage.id)}
				<li class="karte">
					<a href="/auftrag-vorlagen/{vorlage.id}" class="karte-inhalt">
						<strong>{vorlage.name}</strong>
						{#if vorlage.beschreibung}
							<p class="beschreibung">{vorlage.beschreibung}</p>
						{/if}
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.seite {
		/* ganze Breite des Arbeitsbereichs wie die anderen Listen */
		margin: 0 auto;
		padding: 1rem;
	}
	.kopf {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1.5rem;
	}
	h1 {
		margin: 0;
		font-size: 1.5rem;
		color: var(--text, #323130);
	}
	.knopf {
		display: inline-block;
		padding: 0.5rem 1rem;
		background: var(--primar, #0078d4);
		color: white;
		text-decoration: none;
		border-radius: 4px;
		font-size: 0.875rem;
	}
	.knopf:hover {
		background: var(--primar-dunkel, #106ebe);
	}
	.leer {
		color: var(--text-leise, #605e5c);
		text-align: center;
		padding: 2rem;
	}
	.liste {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.karte {
		background: var(--karte-hintergrund, white);
		border-radius: 8px;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
		transition: box-shadow 0.2s;
	}
	.karte:hover {
		box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
	}
	.karte-inhalt {
		display: block;
		padding: 1rem;
		text-decoration: none;
		color: var(--text, #323130);
	}
	.beschreibung {
		margin: 0.5rem 0 0;
		color: var(--text-leise, #605e5c);
		font-size: 0.875rem;
	}
</style>
