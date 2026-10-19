<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Angebots-Vorlagen</title>
</svelte:head>

<main class="kd-seite breit">
	<div class="af-kopfzeile">
		<h1>Angebots-Vorlagen</h1>
		<a href="/angebot-vorlagen/neu" class="kd-knopf">+ Neue Vorlage</a>
	</div>
	<p class="kd-info">
		Wiederkehrende Angebote als Vorlage: Im Angebot über „+ Aus Vorlage“ einfügen oder schon beim „Angebot erstellen“ im Auftrag
		wählen.
	</p>
	<ul class="kd-liste">
		{#each data.vorlagen as v (v.id)}
			<li>
				<a href={`/angebot-vorlagen/${v.id}`}>
					<strong>{v.name}</strong>
					<span class="kd-info">{v.anzahlPositionen === 1 ? '1 Position' : `${v.anzahlPositionen} Positionen`}</span>
				</a>
			</li>
		{:else}
			<li class="kd-leer">Noch keine Angebots-Vorlagen.</li>
		{/each}
	</ul>
</main>
