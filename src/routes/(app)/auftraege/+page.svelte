<script lang="ts">
	import AuftragBoard from '$lib/components/AuftragBoard.svelte';
	import { STATUS, STATUS_NAMEN } from '$lib/auftrag-status';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/** Link mit Ansicht, Status (nur Liste), „Meine“ und Suche (leere Werte entfallen). */
	const link = (o: { ansicht?: 'board' | 'liste'; status?: string | null; meine?: boolean } = {}) => {
		const ansicht = o.ansicht ?? data.ansicht;
		const status = o.status === undefined ? data.status : o.status;
		const meine = o.meine ?? data.meine;
		const p = new URLSearchParams();
		if (ansicht === 'liste') p.set('ansicht', 'liste');
		if (ansicht === 'liste' && status) p.set('status', status);
		if (data.suche) p.set('suche', data.suche);
		if (meine) p.set('meine', '1');
		const q = p.toString();
		return q ? `/auftraege?${q}` : '/auftraege';
	};
	const BEZUG = { zustaendig: 'zuständig', todo: 'eigenes To-do', termin: 'eigener Termin' } as const;
</script>

<svelte:head>
	<title>Aufträge</title>
</svelte:head>

<main class="kd-seite breit">
	<header class="seiten-kopf">
		<h1>{data.alle && !data.meine ? 'Aufträge' : 'Meine Aufträge'}</h1>
		<div class="af-werkzeuge">
			<nav class="af-ansicht" aria-label="Ansicht">
				<a href={link({ ansicht: 'board' })} aria-current={data.ansicht === 'board' ? 'page' : undefined}>Board</a>
				<a href={link({ ansicht: 'liste' })} aria-current={data.ansicht === 'liste' ? 'page' : undefined}>Liste</a>
			</nav>
			{#if data.darfBearbeiten}
				<a href="/auftraege/neu" class="knopf-gefuellt">+ Auftrag</a>
			{/if}
		</div>
	</header>

	{#if data.alle}
		<nav aria-label="Meine oder alle Aufträge" class="af-meine">
			<a href={link({ meine: false })} class="pill" aria-current={!data.meine ? 'page' : undefined}>Alle</a>
			<a href={link({ meine: true })} class="pill" aria-current={data.meine ? 'page' : undefined}>Meine</a>
		</nav>
	{/if}

	{#if data.ansicht === 'liste'}
		<nav aria-label="Status">
			<ul class="af-reiter">
				<li><a href={link({ status: null })} aria-current={data.status === null ? 'page' : undefined}>Alle</a></li>
				{#each STATUS as s (s)}
					<li>
						<a href={link({ status: s })} aria-current={data.status === s ? 'page' : undefined}>{STATUS_NAMEN[s]}</a>
					</li>
				{/each}
			</ul>
		</nav>
	{/if}

	<form method="GET" role="search" class="kd-suche">
		{#if data.ansicht === 'liste'}<input type="hidden" name="ansicht" value="liste" />{/if}
		{#if data.ansicht === 'liste' && data.status}<input type="hidden" name="status" value={data.status} />{/if}
		{#if data.meine}<input type="hidden" name="meine" value="1" />{/if}
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

	{#if data.ansicht === 'board' && data.board}
		{#if !data.darfBearbeiten}
			<p class="kd-info">Zum Verschieben der Kacheln fehlt das Recht „Aufträge bearbeiten“.</p>
		{/if}
		<AuftragBoard spalten={data.board.spalten} darfBearbeiten={data.darfBearbeiten} mitPreisen={data.mitPreisen} />
		{#if data.board.spalten.every((s) => s.anzahl === 0)}
			<p class="kd-leer">
				{data.suche ? 'Keine Aufträge gefunden.' : data.alle && !data.meine ? 'Noch keine Aufträge angelegt.' : 'Ihnen sind noch keine Aufträge zugeordnet.'}
			</p>
		{/if}
	{:else}
		<ul class="kd-liste">
			{#each data.auftraege as a (a.id)}
				<li>
					<a href={`/auftraege/${a.id}`}>
						<span class="af-kopfzeile">
							<strong>{a.titel}</strong>
							<span class={`af-status s-${a.status}`}>{STATUS_NAMEN[a.status]}</span>
						</span>
						<span class="kd-info">{a.nummer} · {a.kundeName}</span>
						{#if a.zustaendige.length > 0}
							<span class="kd-info">Zuständig: {a.zustaendige.map((z) => z.name).join(', ')}</span>
						{/if}
						{#if a.meinBezug && a.meinBezug.length > 0}
							<span class="af-bezug">{#each a.meinBezug as b (b)}<span class="af-bezug-chip">{BEZUG[b]}</span>{/each}</span>
						{/if}
						{#if a.objektBezeichnung || a.adresse}
							<span class="kd-info">{a.objektBezeichnung ? `Objekt: ${a.objektBezeichnung}` : 'Kundenadresse'}{a.adresse ? ` · ${a.adresse}` : ''}</span>
						{/if}
					</a>
				</li>
			{:else}
				<li class="kd-leer">
					{data.suche || data.status ? 'Keine Aufträge gefunden.' : data.alle && !data.meine ? 'Noch keine Aufträge angelegt.' : 'Ihnen sind noch keine Aufträge zugeordnet.'}
				</li>
			{/each}
		</ul>

		{#if data.auftraege.length >= data.maxTreffer}
			<p class="kd-info">Es werden höchstens {data.maxTreffer} Aufträge angezeigt. Bitte die Suche eingrenzen.</p>
		{/if}
	{/if}
</main>

<style>
	.af-meine {
		display: flex;
		gap: 0.4rem;
		margin: 0 0 0.5rem;
	}
	.af-meine .pill {
		display: inline-flex;
		align-items: center;
		min-height: var(--tippziel, 44px);
		padding: 0 1rem;
		border: 1px solid var(--m365-rand);
		border-radius: 999px;
		text-decoration: none;
		color: inherit;
	}
	.af-meine .pill[aria-current='page'] {
		background: var(--m365-primaer);
		border-color: var(--m365-primaer);
		color: #fff;
	}
	.af-bezug {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.af-bezug-chip {
		padding: 0.05rem 0.5rem;
		border-radius: 999px;
		font-size: 0.75rem;
		background: var(--m365-primaer-hell);
		color: var(--m365-primaer-dunkel);
	}
</style>
