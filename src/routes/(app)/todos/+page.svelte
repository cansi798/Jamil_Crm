<script lang="ts">
	import TodoKanban from '$lib/components/TodoKanban.svelte';
	import TodoListe from '$lib/components/TodoListe.svelte';
	import TodoNeu from '$lib/components/TodoNeu.svelte';
	import AddPanel from '$lib/components/AddPanel.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const NAMEN = { meine: 'Meine', offen: 'Offen', alle: 'Alle' } as const;
	const LEER = {
		meine: 'Keine To-dos – weder direkt zugewiesen noch in Aufträgen, für die Sie zuständig sind.',
		offen: 'Keine offenen To-dos.',
		alle: 'Noch keine To-dos angelegt.'
	} as const;

	/** Link mit Ansicht, Reiter und Filtern (leere Werte entfallen) – wie auf der Auftragsseite. */
	const link = (o: { ansicht?: 'board' | 'liste'; nur?: string } = {}) => {
		const ansicht = o.ansicht ?? data.ansicht;
		const nur = o.nur ?? data.nur;
		const p = new URLSearchParams();
		if (ansicht === 'liste') p.set('ansicht', 'liste');
		if (nur !== 'meine') p.set('nur', nur);
		if (data.filter.person) p.set('person', data.filter.person);
		if (data.filter.status) p.set('status', data.filter.status);
		const q = p.toString();
		return q ? `/todos?${q}` : '/todos';
	};
	const aktionen = { umschalten: '?/umschalten', aendern: '?/aendern', loeschen: '?/loeschen', serieBeenden: '?/serieBeenden' };
</script>

<svelte:head>
	<title>To-dos</title>
</svelte:head>

<main class="kd-seite breit">
	<header class="seiten-kopf">
		<h1>{data.nur === 'meine' ? 'Meine To-dos' : 'To-dos'}</h1>
		<div class="af-werkzeuge">
			<nav class="af-ansicht" aria-label="Ansicht">
				<a href={link({ ansicht: 'board' })} aria-current={data.ansicht === 'board' ? 'page' : undefined}>Board</a>
				<a href={link({ ansicht: 'liste' })} aria-current={data.ansicht === 'liste' ? 'page' : undefined}>Liste</a>
			</nav>
		</div>
	</header>

	{#if data.reiter.length > 1}
		<nav aria-label="Meine oder alle To-dos" class="af-meine">
			{#each data.reiter as r (r)}
				<a href={link({ nur: r })} class="pill" class:aktiv={data.nur === r} aria-current={data.nur === r ? 'page' : undefined}>{NAMEN[r]}</a>
			{/each}
		</nav>
	{/if}

	<form method="GET" class="td-filter" aria-label="To-dos filtern">
		{#if data.ansicht === 'liste'}<input type="hidden" name="ansicht" value="liste" />{/if}
		{#if data.nur !== 'meine'}<input type="hidden" name="nur" value={data.nur} />{/if}
		{#if data.mitarbeiter.length > 0}
			<label>
				Zugewiesen an
				<select name="person" onchange={(ev) => ev.currentTarget.form?.requestSubmit()}>
					<option value="">alle Personen</option>
					{#each data.mitarbeiter as m (m.id)}<option value={m.id} selected={data.filter.person === m.id}>{m.name}</option>{/each}
				</select>
			</label>
		{/if}
		<label>
			Status
			<select name="status" onchange={(ev) => ev.currentTarget.form?.requestSubmit()}>
				<option value="" selected={data.filter.status === ''}>alle</option>
				<option value="offen" selected={data.filter.status === 'offen'}>offen</option>
				<option value="erledigt" selected={data.filter.status === 'erledigt'}>erledigt</option>
			</select>
		</label>
		<noscript><button type="submit" class="kd-knopf hell">Filtern</button></noscript>
	</form>

	{#if form?.fehler && !form?.todoWerte}
		<p role="alert" class="kd-fehler">{form.fehler}</p>
	{/if}

	{#if data.darfBearbeiten}
		<AddPanel label="To-do hinzufügen" art="primaer" offen={!!form?.todoWerte || Object.values(data.vorbelegt ?? {}).some(Boolean)}>
			{#snippet children(schliessen)}
				<TodoNeu
					aktion="?/anlegen"
					mitarbeiter={data.mitarbeiter}
					fehler={form?.todoWerte ? form.fehler : null}
					werte={form?.todoWerte ?? data.vorbelegt}
					onfertig={schliessen}
					onabbrechen={schliessen}
				/>
			{/snippet}
		</AddPanel>
	{/if}

	{#if data.ansicht === 'liste'}
		<TodoListe
			todos={data.todos}
			heute={data.heute}
			benutzerId={data.benutzerId}
			darfBearbeiten={data.darfBearbeiten}
			mitarbeiter={data.mitarbeiter}
			{aktionen}
			leer={LEER[data.nur]}
		/>
	{:else}
		<TodoKanban
			zeigeQuelle={data.nur === 'meine'}
			todos={data.todos}
			heute={data.heute}
			benutzerId={data.benutzerId}
			darfBearbeiten={data.darfBearbeiten}
			mitarbeiter={data.mitarbeiter}
			{aktionen}
			leer={LEER[data.nur]}
		/>
	{/if}
</main>

<style>
	.td-filter {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin: 0.5rem 0 1rem;
	}
	.td-filter label {
		display: grid;
		gap: 0.2rem;
		font-size: 0.875rem;
		min-width: 12rem;
	}
	.td-filter select {
		min-height: var(--tippziel, 44px);
	}
</style>
