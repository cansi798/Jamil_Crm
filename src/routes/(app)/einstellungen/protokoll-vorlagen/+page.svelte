<script lang="ts">
	import { enhance } from '$app/forms';
	import '$lib/stil/kunden.css';
	import Abschnitt from '$lib/components/Abschnitt.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const aktive = $derived(data.vorlagen.filter((v) => !v.archiviert));
	const archivierte = $derived(data.vorlagen.filter((v) => v.archiviert));
	const datum = (iso: string) => new Date(iso).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' });
	const aufmass = $derived(data.art === 'aufmass');
	// Formular-Aktion mit der Art in der Adresse (SvelteKit: „?art=aufmass&/neu“)
	const ziel = (name: string) => (aufmass ? `?art=aufmass&/${name}` : `?/${name}`);
</script>

<svelte:head>
	<title>{aufmass ? 'Aufmaß-Vorlagen' : 'Protokoll-Vorlagen'} – CRM</title>
</svelte:head>

<main class="kd-seite breit pv-seite">
	<header class="seiten-kopf">
		<div>
			<h1>{aufmass ? 'Aufmaß-Vorlagen' : 'Protokoll-Vorlagen'}</h1>
			<p class="seiten-meta">
				{#if aufmass}
					Aufmaß vor Ort: Räume, Maße, berechnete Flächen und Mengen; verknüpft mit dem Katalog wird daraus mit einem Klick ein
					Angebot. Jede Änderung wird eine neue Version – begonnene Aufmaße behalten ihre.
				{:else}
					Formulare für Monteure: Schritte, Pflichtfelder, Fotos, Bedingungen und Unterschrift. Jede Änderung wird eine neue
					Version – ausgefüllte Protokolle behalten ihre.
				{/if}
			</p>
		</div>
		<form method="POST" action={ziel('neu')} use:enhance>
			<button type="submit" class="kd-knopf" data-testid="vorlage-neu">+ Neue Vorlage</button>
		</form>
	</header>

	{#if form?.fehler}<p role="alert" class="kd-fehler">{form.fehler}</p>{/if}
	{#if form && 'uebernommen' in form}<p role="status" class="kd-info">{form.uebernommen} Beispielvorlage(n) übernommen.</p>{/if}

	<Abschnitt titel="Vorlagen" anzahl={aktive.length}>
		<ul class="kd-liste pv-liste">
			{#each aktive as v (v.id)}
				<li>
					<a href={`/einstellungen/protokoll-vorlagen/${v.id}`} class="pv-link">
						<strong>{v.name}</strong>
						<span class="kd-info">
							Version {v.version} · {v.seiten} Schritt{v.seiten === 1 ? '' : 'e'} · {v.felder} Felder · geändert {datum(v.geaendert)}
							{#if v.protokolle > 0}· {v.protokolle} Protokoll{v.protokolle === 1 ? '' : 'e'}{/if}
						</span>
						{#if v.beschreibung}<span class="kd-info">{v.beschreibung}</span>{/if}
					</a>
					<div class="pv-aktionen">
						<form method="POST" action="?/duplizieren" use:enhance>
							<input type="hidden" name="id" value={v.id} />
							<button type="submit" class="knopf-subtil klein">Duplizieren</button>
						</form>
						<form method="POST" action="?/archivieren" use:enhance>
							<input type="hidden" name="id" value={v.id} />
							<button type="submit" class="knopf-subtil klein">Archivieren</button>
						</form>
					</div>
				</li>
			{:else}
				<li class="kd-leer">Noch keine Vorlage. Legen Sie eine an oder übernehmen Sie ein Beispiel.</li>
			{/each}
		</ul>
	</Abschnitt>

	{#if data.beispiele.length > 0}
		<Abschnitt titel="Beispiele">
			<p class="kd-info">Fertige Vorlagen zum Übernehmen – danach frei änderbar.</p>
			<ul class="kd-liste">
				{#each data.beispiele as b (b.schluessel)}
					<li><span><strong>{b.name}</strong><span class="kd-info">{b.beschreibung}</span></span></li>
				{/each}
			</ul>
			<form method="POST" action={ziel('beispiele')} use:enhance>
				<button type="submit" class="kd-knopf hell" data-testid="beispiele-uebernehmen">Beispiele übernehmen</button>
			</form>
		</Abschnitt>
	{/if}

	{#if archivierte.length > 0}
		<Abschnitt titel="Archiviert" anzahl={archivierte.length}>
			<ul class="kd-liste pv-liste">
				{#each archivierte as v (v.id)}
					<li>
						<span class="pv-link"><strong>{v.name}</strong><span class="kd-info">Version {v.version} · archiviert</span></span>
						<form method="POST" action="?/wiederherstellen" use:enhance>
							<input type="hidden" name="id" value={v.id} />
							<button type="submit" class="knopf-subtil klein">Wiederherstellen</button>
						</form>
					</li>
				{/each}
			</ul>
		</Abschnitt>
	{/if}
</main>

<style>
	.pv-liste li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--ui-a3);
		flex-wrap: wrap;
	}
	.pv-link {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		flex: 1 1 18rem;
		min-width: 0;
	}
	.pv-aktionen {
		display: flex;
		gap: var(--ui-a2);
	}
	.pv-seite :global(.abschnitt) {
		margin-bottom: var(--ui-a4);
	}
</style>
