<script lang="ts">
	import FilterLeiste from '$lib/components/ui/FilterLeiste.svelte';
	import SuchFeld from '$lib/components/ui/SuchFeld.svelte';
	import type { PageData } from './$types';
	import Avatar from '$lib/components/ui/Avatar.svelte';

	let { data }: { data: PageData } = $props();

	const zeile = (k: PageData['kunden'][number]) =>
		[k.art === 'firma' ? [k.vorname, k.nachname].filter(Boolean).join(' ') : '', k.ort, k.telefon]
			.filter(Boolean)
			.join(' · ');
</script>

<svelte:head>
	<title>Kunden</title>
</svelte:head>

<main class="kd-seite breit">
	<header class="seiten-kopf">
		<h1>Kunden</h1>
		{#if data.darfBearbeiten}
			<div class="seiten-aktionen"><a href="/kunden/neu" class="kd-knopf">+ Kunde</a></div>
		{/if}
	</header>

	<FilterLeiste label="Kunden filtern">
		{#snippet suche()}
			<SuchFeld wert={data.suche} label="Kunden suchen" placeholder="Name, Firma, Ort, Telefon oder E-Mail" />
		{/snippet}
		{#snippet rechts()}
			<span class="kd-info">{data.kunden.length} {data.kunden.length === 1 ? 'Kunde' : 'Kunden'}</span>
		{/snippet}
	</FilterLeiste>

	<ul class="kd-liste">
		{#each data.kunden as kunde (kunde.id)}
			<li>
				<a href={`/kunden/${kunde.id}`} class="zeile-mit-avatar">
					<Avatar name={kunde.name} groesse={34} />
					<strong>{kunde.name}</strong>
					{#if zeile(kunde)}<span class="kd-info">{zeile(kunde)}</span>{/if}
				</a>
			</li>
		{:else}
			<li class="kd-leer">
				<span>{data.suche ? 'Keine Kunden gefunden. Anders schreiben oder nur einen Teil des Namens suchen.' : 'Noch keine Kunden angelegt.'}</span>
				{#if data.darfBearbeiten}<a href="/kunden/neu" class="kd-knopf hell">+ Kunde anlegen</a>{/if}
			</li>
		{/each}
	</ul>

	{#if data.kunden.length >= data.maxTreffer}
		<p class="kd-info">Es werden höchstens {data.maxTreffer} Kunden angezeigt. Bitte die Suche eingrenzen.</p>
	{/if}
</main>
