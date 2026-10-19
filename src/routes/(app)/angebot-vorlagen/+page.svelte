<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Angebots-Vorlagen</title>
</svelte:head>

<main class="kd-seite breit">
	<header class="seiten-kopf">
		<div>
			<h1>Angebots-Vorlagen</h1>
			<p class="seiten-meta">
				Wiederkehrende Angebote als Vorlage: im Angebot über „+ Aus Vorlage“ einfügen oder schon beim „Angebot erstellen“ wählen.
			</p>
		</div>
		<a href="/angebot-vorlagen/neu" class="kd-knopf">+ Neue Vorlage</a>
	</header>
	<ul class="kd-liste">
		{#each data.vorlagen as v (v.id)}
			<li>
				<a href={`/angebot-vorlagen/${v.id}`}>
					<strong>{v.name}</strong>
					<span class="kd-info">{v.anzahlPositionen === 1 ? '1 Position' : `${v.anzahlPositionen} Positionen`}</span>
				</a>
			</li>
		{:else}
			<li class="kd-leer">
				<span>Noch keine Angebots-Vorlagen. Häufige Angebote einmal anlegen und immer wieder verwenden.</span>
				<a href="/angebot-vorlagen/neu" class="kd-knopf hell">+ Erste Vorlage anlegen</a>
			</li>
		{/each}
	</ul>
</main>
