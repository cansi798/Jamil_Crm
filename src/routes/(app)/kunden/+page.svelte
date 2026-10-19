<script lang="ts">
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
			<a href="/kunden/neu" class="knopf-gefuellt">+ Kunde</a>
		{/if}
	</header>

	<form method="GET" role="search" class="kd-suche">
		<input
			type="search"
			name="suche"
			value={data.suche}
			placeholder="Name, Firma, Ort, Telefon oder E-Mail"
			aria-label="Kunden suchen"
			autocomplete="off"
			enterkeyhint="search"
		/>
		<button type="submit" class="knopf-subtil">Suchen</button>
	</form>

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
