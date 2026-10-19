<script lang="ts">
	import { ANGEBOT_STATUS, ANGEBOT_STATUS_NAMEN } from '$lib/angebot-status';
	import { euro } from '$lib/geld';
	import { tagDeutsch } from '$lib/zeit';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Angebote</title>
</svelte:head>

<main class="kd-seite">
	<h1>Angebote</h1>
	<p class="kd-info">Neue Angebote legen Sie im Auftrag an („Angebot erstellen“).</p>

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
						<span class="kd-info">{a.auftragTitel} · {tagDeutsch(a.datum)}</span>
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
