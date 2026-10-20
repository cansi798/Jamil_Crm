<script lang="ts">
	import '$lib/stil/kunden.css';
	import type { PageData } from './$types';
	export let data: PageData;
</script>

<svelte:head>
	<title>Vorlagen – CRM</title>
</svelte:head>

<main class="kd-seite breit">
	<header class="seiten-kopf">
		<div>
			<h1>Auftrags-Vorlagen</h1>
			<p class="seiten-meta">Aufgabenlisten für wiederkehrende Aufträge – beim Anlegen eines Auftrags wählbar.</p>
		</div>
		{#if data.darfBearbeiten}
			<a href="/auftrag-vorlagen/neu" class="kd-knopf">+ Neue Vorlage</a>
		{/if}
	</header>

	<ul class="kd-liste">
		{#each data.vorlagen as vorlage (vorlage.id)}
			<li>
				<a href="/auftrag-vorlagen/{vorlage.id}">
					<strong>{vorlage.name}</strong>
					{#if vorlage.beschreibung}
						<span class="kd-info">{vorlage.beschreibung}</span>
					{/if}
				</a>
			</li>
		{:else}
			<li class="kd-leer">
				<span>Noch keine Vorlagen. Eine Vorlage spart Tipparbeit: Ihre Aufgaben stehen beim nächsten Auftrag sofort bereit.</span>
				{#if data.darfBearbeiten}<a href="/auftrag-vorlagen/neu" class="kd-knopf hell">+ Erste Vorlage anlegen</a>{/if}
			</li>
		{/each}
	</ul>
</main>
