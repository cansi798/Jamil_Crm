<script lang="ts">
	import TodoKanban from '$lib/components/TodoKanban.svelte';
	import TodoNeu from '$lib/components/TodoNeu.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const NAMEN = { meine: 'Meine', offen: 'Offen', alle: 'Alle' } as const;
	const LEER = {
		meine: 'Keine To-dos – weder direkt zugewiesen noch in Aufträgen, für die Sie zuständig sind.',
		offen: 'Keine offenen To-dos.',
		alle: 'Noch keine To-dos angelegt.'
	} as const;
</script>

<svelte:head>
	<title>To-dos</title>
</svelte:head>

<main class="kd-seite">
	<h1>To-dos</h1>

	{#if data.reiter.length > 1}
		<nav aria-label="Auswahl">
			<ul class="pills">
				{#each data.reiter as r (r)}
					<li>
						<a href={r === 'meine' ? '/todos' : `/todos?nur=${r}`} class="pill" class:aktiv={data.nur === r} aria-current={data.nur === r ? 'page' : undefined}>
							{NAMEN[r]}
						</a>
					</li>
				{/each}
			</ul>
		</nav>
	{/if}

	<form method="GET" class="td-filter" aria-label="To-dos filtern">
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
		<TodoNeu
			aktion="?/anlegen"
			mitarbeiter={data.mitarbeiter}
			fehler={form?.todoWerte ? form.fehler : null}
			werte={form?.todoWerte ?? data.vorbelegt}
		/>
	{/if}

	<TodoKanban
		zeigeQuelle={data.nur === 'meine'}
		todos={data.todos}
		heute={data.heute}
		benutzerId={data.benutzerId}
		darfBearbeiten={data.darfBearbeiten}
		mitarbeiter={data.mitarbeiter}
		aktionen={{ umschalten: '?/umschalten', aendern: '?/aendern', loeschen: '?/loeschen' }}
		leer={LEER[data.nur]}
	/>
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
	.pills {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		list-style: none;
		margin: 0;
		padding: 0;
	}
</style>