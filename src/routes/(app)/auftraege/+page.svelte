<script lang="ts">
	import { terminKurz } from '$lib/einsatz-art';
	import { navigationsLink, telefonLink } from '$lib/kontakt-links';
	import AuftragBoard from '$lib/components/AuftragBoard.svelte';
	import AuftragHinweise from '$lib/components/AuftragHinweise.svelte';
	import { STATUS, STATUS_NAMEN } from '$lib/auftrag-status';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/** Link mit Ansicht, Status (nur Liste), „Meine“ und Suche (leere Werte entfallen). */
	const link = (o: { ansicht?: 'board' | 'liste'; status?: string | null; meine?: boolean; nachfassen?: boolean } = {}) => {
		const ansicht = o.ansicht ?? data.ansicht;
		const status = o.status === undefined ? data.status : o.status;
		const meine = o.meine ?? data.meine;
		const p = new URLSearchParams();
		if (ansicht === 'liste') p.set('ansicht', 'liste');
		if (ansicht === 'liste' && status) p.set('status', status);
		if (data.suche) p.set('suche', data.suche);
		if (meine) p.set('meine', '1');
		if (data.quelle) p.set('quelle', data.quelle);
		if (o.nachfassen ?? data.nachfassenFaellig) p.set('nachfassen', 'faellig');
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
			<a href={link({ meine: false })} class="pill" class:aktiv={!data.meine} aria-current={!data.meine ? 'page' : undefined}>Alle</a>
			<a href={link({ meine: true })} class="pill" class:aktiv={data.meine} aria-current={data.meine ? 'page' : undefined}>Meine</a>
					</nav>
				{/if}
				<nav aria-label="Weitere Filter" class="af-meine">
					<a href={link({ nachfassen: !data.nachfassenFaellig })} class="pill" class:aktiv={data.nachfassenFaellig} aria-current={data.nachfassenFaellig ? 'page' : undefined}>↻ Nachfassen fällig</a>
				</nav>

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

	<form method="GET" role="search" class="kd-suche af-suche">
		{#if data.ansicht === 'liste'}<input type="hidden" name="ansicht" value="liste" />{/if}
		{#if data.ansicht === 'liste' && data.status}<input type="hidden" name="status" value={data.status} />{/if}
		{#if data.meine}<input type="hidden" name="meine" value="1" />{/if}
		{#if data.nachfassenFaellig}<input type="hidden" name="nachfassen" value="faellig" />{/if}
		<select name="quelle" aria-label="Auftragsquelle" class="af-quelle-filter" onchange={(ev) => ev.currentTarget.form?.requestSubmit()}>
			<option value="" selected={!data.quelle}>Alle Auftragsquellen</option>
			{#each data.quellen as q (q.id)}<option value={q.id} selected={data.quelle === q.id}>{q.name}{q.aktiv ? '' : ' (aus)'}</option>{/each}
			<option value="ohne" selected={data.quelle === 'ohne'}>Ohne Auftragsquelle</option>
		</select>
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
				{data.nachfassenFaellig ? 'Kein Nachfassen fällig.' : data.suche || data.quelle ? 'Keine Aufträge gefunden.' : data.alle && !data.meine ? 'Noch keine Aufträge angelegt.' : 'Ihnen sind noch keine Aufträge zugeordnet.'}
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
						<AuftragHinweise quelleName={a.quelleName} quelleFarbe={a.quelleFarbe} angebotInfo={a.angebotInfo} nachfassenInfo={a.nachfassenInfo} />
						{#if a.kommenderTermin}
							<span class="kd-info">Nächster Termin: {terminKurz(a.kommenderTermin)}</span>
						{/if}
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
					{#if navigationsLink(a.adresse) || telefonLink(a.telefon)}
						<span class="af-liste-vorort">
							{#if navigationsLink(a.adresse)}<a href={navigationsLink(a.adresse)} target="_blank" rel="noopener">Navigieren</a>{/if}
							{#if telefonLink(a.telefon)}<a href={telefonLink(a.telefon)}>Anrufen</a>{/if}
						</span>
					{/if}
				</li>
			{:else}
				<li class="kd-leer">
					{data.nachfassenFaellig ? 'Kein Nachfassen fällig.' : data.suche || data.status || data.quelle ? 'Keine Aufträge gefunden.' : data.alle && !data.meine ? 'Noch keine Aufträge angelegt.' : 'Ihnen sind noch keine Aufträge zugeordnet.'}
				</li>
			{/each}
		</ul>

		{#if data.auftraege.length >= data.maxTreffer}
			<p class="kd-info">Es werden höchstens {data.maxTreffer} Aufträge angezeigt. Bitte die Suche eingrenzen.</p>
		{/if}
	{/if}
</main>

<style>
	.af-suche {
		grid-template-columns: auto minmax(0, 1fr) auto;
	}
	@media (max-width: 30rem) {
		.af-suche {
			grid-template-columns: minmax(0, 1fr) auto;
		}
		.af-suche .af-quelle-filter {
			grid-column: 1 / -1;
			max-width: none;
		}
	}
	.af-quelle-filter {
		width: auto !important;
		max-width: 12rem;
	}
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
	.af-liste-vorort {
		display: flex;
		gap: 1rem;
		padding: 0 1rem 0.75rem;
	}
	.af-liste-vorort a {
		display: inline-flex;
		align-items: center;
		min-height: var(--tippziel, 44px);
		font-weight: 600;
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
