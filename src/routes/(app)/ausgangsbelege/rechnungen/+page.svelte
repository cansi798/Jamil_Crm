<script lang="ts">
	import FilterLeiste from '$lib/components/ui/FilterLeiste.svelte';
	import BelegReiter from '$lib/components/ausgangsbelege/BelegReiter.svelte';
</script>

<svelte:head>
	<title>Rechnungen · Ausgangsbelege</title>
</svelte:head>

<main class="kd-seite breit">
	<header class="seiten-kopf">
		<div>
			<h1>Ausgangsbelege</h1>
			<p class="seiten-meta">Rechnungen werden in Lexware geschrieben und erscheinen hier nach der Anbindung.</p>
		</div>
	</header>

	<!-- gleiche Listenstruktur wie Angebote/ABs; Status-Filter und Kacheln kommen mit den Rechnungen (Lexware) -->
	<FilterLeiste form={false} label="Rechnungen filtern">
		{#snippet filter()}
			<BelegReiter aktiv="rechnungen" />
		{/snippet}
	</FilterLeiste>

	<ul class="kd-liste">
		<li class="kd-leer re-leer">
			<strong>Rechnungen kommen mit der Lexware-Anbindung</strong>
			<span class="kd-info">Bis dahin Rechnungen wie gewohnt in Lexware schreiben. Danach stehen sie hier mit Nummer, Kunde, Auftrag, Datum und Zahlstatus.</span>
		</li>
	</ul>
</main>

<style>
	.re-leer {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
</style>
