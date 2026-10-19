<script lang="ts">
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
	<div class="af-kopfzeile">
		<h1>Angebote</h1>
		{#if data.darfOhneAuftrag}
			<form method="POST" action="?/neu" use:enhance>
				<button type="submit" class="kd-knopf">+ Angebot ohne Auftrag</button>
			</form>
		{/if}
	</div>
	<p class="kd-info">
		Angebote entstehen meist im Auftrag („Angebot erstellen“). Ein Angebot ohne Auftrag lässt sich später einem Kunden oder
		Auftrag zuordnen.
	</p>
	{#if form?.fehler}<p role="alert" class="kd-fehler">{form.fehler}</p>{/if}

	<nav aria-label="Status">
		<ul class="af-reiter">
			<li><a href="/angebote" aria-current={data.status === null ? 'page' : undefined}>Alle</a></li>
			{#each ANGEBOT_STATUS as s (s)}
				<li><a href={`/angebote?status=${s}`} aria-current={data.status === s ? 'page' : undefined}>{ANGEBOT_STATUS_NAMEN[s]}</a></li>
			{/each}
		</ul>
	</nav>

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
