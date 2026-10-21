<script lang="ts">
	import FilterLeiste from '$lib/components/ui/FilterLeiste.svelte';
	import Umschalter from '$lib/components/ui/Umschalter.svelte';
	import { ANGEBOT_STATUS, ANGEBOT_STATUS_NAMEN } from '$lib/angebot-status';
	import { euro } from '$lib/geld';
	import { tagDeutsch } from '$lib/zeit';
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
	<title>Angebote</title>
</svelte:head>

<main class="kd-seite breit">
	<header class="seiten-kopf">
		<div>
			<h1>Angebote</h1>
			<p class="seiten-meta">Meist im Auftrag erstellt – ein Angebot ohne Auftrag lässt sich später zuordnen.</p>
		</div>
		{#if data.darfOhneAuftrag}
			<form method="POST" action="?/neu" use:enhance class="seiten-aktionen">
				<button type="submit" class="kd-knopf" aria-label="+ Angebot ohne Auftrag">+ Angebot</button>
			</form>
		{/if}
	</header>
	{#if form?.fehler}<p role="alert" class="kd-fehler">{form.fehler}</p>{/if}

	<FilterLeiste form={false} label="Angebote filtern">
		{#snippet filter()}
			<Umschalter
				label="Status"
				aktiv={data.status ?? 'alle'}
				eintraege={[{ wert: 'alle', text: 'Alle', href: '/angebote' }, ...ANGEBOT_STATUS.map((st) => ({ wert: st, text: ANGEBOT_STATUS_NAMEN[st], href: `/angebote?status=${st}` }))]}
			/>
		{/snippet}
	</FilterLeiste>

	<ul class="kd-liste">
		{#each data.angebote as a (a.id)}
			<li>
				<a href={`/angebote/${a.id}`}>
					<span class="af-kopfzeile">
						<strong>{a.nummer} · {a.kundeName}</strong>
						<span class={`an-status s-${a.status}`}>{ANGEBOT_STATUS_NAMEN[a.status]}</span>
					</span>
					<span class="af-kopfzeile">
						<span class="kd-info">{a.auftragTitel ?? 'ohne Auftrag'} · {tagDeutsch(a.datum)}</span>
						<span class="kt-preis">{euro(a.bruttoCent)}</span>
					</span>
					{#if a.warnungen.includes('preis_fehlt')}<span class="kt-preis-fehlt">Preis fehlt</span>{/if}
				</a>
			</li>
		{:else}
			<li class="kd-leer">{data.status ? 'Keine Angebote in diesem Status.' : 'Noch keine Angebote.'}</li>
		{/each}
	</ul>
	{#if data.angebote.length >= data.maxTreffer}
		<p class="kd-info">Es werden höchstens {data.maxTreffer} Angebote angezeigt.</p>
	{/if}
</main>
