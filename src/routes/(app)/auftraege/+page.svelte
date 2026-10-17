<script lang="ts">
	import { STATUS, STATUS_NAMEN } from '$lib/auftrag-status';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/** Link eines Reiters: Status wechseln, Suche behalten. */
	const reiterLink = (status: string | null) => {
		const p = new URLSearchParams();
		if (status) p.set('status', status);
		if (data.suche) p.set('suche', data.suche);
		const q = p.toString();
		return q ? `/auftraege?${q}` : '/auftraege';
	};
</script>

<svelte:head>
	<title>Aufträge</title>
</svelte:head>

<main class="kd-seite">
	<header class="seiten-kopf">
		<h1>{data.alle ? 'Aufträge' : 'Meine Aufträge'}</h1>
		{#if data.darfBearbeiten}
			<a href="/auftraege/neu" class="knopf-gefuellt">+ Auftrag</a>
		{/if}
	</header>

	<nav aria-label="Status">
		<ul class="af-reiter">
			<li><a href={reiterLink(null)} aria-current={data.status === null ? 'page' : undefined}>Alle</a></li>
			{#each STATUS as s (s)}
				<li>
					<a href={reiterLink(s)} aria-current={data.status === s ? 'page' : undefined}>{STATUS_NAMEN[s]}</a>
				</li>
			{/each}
		</ul>
	</nav>

	<form method="GET" role="search" class="kd-suche">
		{#if data.status}<input type="hidden" name="status" value={data.status} />{/if}
		<input
			type="search"
			name="suche"
			value={data.suche}
			placeholder="Nummer, Titel oder Kunde"
			aria-label="Aufträge suchen"
			autocomplete="off"
			enterkeyhint="search"
		/>
		<button type="submit" class="knopf-subtil">Suchen</button>
	</form>

	<ul class="kd-liste">
		{#each data.auftraege as a (a.id)}
			<li>
				<a href={`/auftraege/${a.id}`}>
					<span class="af-kopfzeile">
						<strong>{a.titel}</strong>
						<span class={`af-status s-${a.status}`}>{STATUS_NAMEN[a.status]}</span>
					</span>
					<span class="kd-info">{a.nummer} · {a.kundeName}{a.objektBezeichnung ? ` · ${a.objektBezeichnung}` : ''}</span>
				</a>
			</li>
		{:else}
			<li class="kd-leer">
				{data.suche || data.status ? 'Keine Aufträge gefunden.' : data.alle ? 'Noch keine Aufträge angelegt.' : 'Ihnen sind noch keine Aufträge zugeordnet.'}
			</li>
		{/each}
	</ul>

	{#if data.auftraege.length >= data.maxTreffer}
		<p class="kd-info">Es werden höchstens {data.maxTreffer} Aufträge angezeigt. Bitte die Suche eingrenzen.</p>
	{/if}
</main>
