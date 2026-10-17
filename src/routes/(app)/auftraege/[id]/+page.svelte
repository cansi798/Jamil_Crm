<script lang="ts">
	import { enhance } from '$app/forms';
	import StatusKette from '$lib/components/StatusKette.svelte';
	import TodoListe from '$lib/components/TodoListe.svelte';
	import TodoNeu from '$lib/components/TodoNeu.svelte';
	import { STATUS_NAMEN } from '$lib/auftrag-status';
	import { ANGEBOT_STATUS_NAMEN } from '$lib/angebot-status';
	import { euro } from '$lib/geld';
	import { berlinTag, berlinUhrzeit, tagDeutsch, tagKurz } from '$lib/zeit';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const a = $derived(data.auftrag);
	let kiLaeuft = $state(false);
</script>

<svelte:head>
	<title>{a.nummer} {a.titel}</title>
</svelte:head>

<main class="kd-seite">
	<a href="/auftraege" class="kd-zurueck">← Aufträge</a>
	<h1>{a.titel}</h1>
	<p class="kd-info">{a.nummer} · {STATUS_NAMEN[a.status]}</p>

	{#if form?.fehler && !form?.todoFehler}
		<p role="alert" class="kd-fehler">{form.fehler}</p>
	{/if}

	<StatusKette status={a.status} darfBearbeiten={data.darfBearbeiten} />

	<dl class="kd-daten">
		<dt>Kunde</dt>
		<dd>
			{#if data.kundeLesbar}<a href={`/kunden/${a.kundeId}`}>{a.kundeName}</a>{:else}{a.kundeName}{/if}
		</dd>
		{#if a.objektId}
			<dt>Objekt</dt>
			<dd>
				{#if data.kundeLesbar}
					<a href={`/kunden/${a.kundeId}/objekte/${a.objektId}`}>{a.objektBezeichnung}</a>
				{:else}{a.objektBezeichnung}{/if}
			</dd>
		{/if}
		{#if a.geplantAb}
			<dt>Geplant ab</dt>
			<dd>{tagDeutsch(a.geplantAb)}</dd>
		{/if}
		{#if a.beschreibung}
			<dt>Beschreibung</dt>
			<dd>{a.beschreibung}</dd>
		{/if}
	</dl>

	{#if data.darfBearbeiten}
		<a href={`/auftraege/${a.id}/bearbeiten`} class="kd-knopf hell">Auftrag bearbeiten</a>
	{/if}
	<a href={`/auftraege/${a.id}/dokumentation`} class="kd-knopf hell">Dokumentation</a>

	{#if data.angebote}
		<h2>Angebote</h2>
		<ul class="kd-liste">
			{#each data.angebote as an (an.id)}
				<li>
					{#if data.darfAngebote}
						<a href={`/angebote/${an.id}`}>
							<span class="af-kopfzeile">
								<strong>{an.nummer}</strong>
								<span class={`an-status s-${an.status}`}>{ANGEBOT_STATUS_NAMEN[an.status]}</span>
							</span>
							<span class="kd-info">{tagDeutsch(an.datum)}{an.bruttoCent !== undefined ? ` · ${euro(an.bruttoCent)}` : ''}</span>
						</a>
					{:else}
						<span class="af-kopfzeile kd-kein-link">
							<strong>{an.nummer}</strong>
							<span class={`an-status s-${an.status}`}>{ANGEBOT_STATUS_NAMEN[an.status]}</span>
						</span>
					{/if}
				</li>
			{:else}
				<li class="kd-leer">Noch kein Angebot.</li>
			{/each}
		</ul>
		{#if data.darfAngebote}
			<form method="POST" action="?/angebotErstellen" use:enhance>
				<button type="submit" class="kd-knopf">Angebot erstellen</button>
			</form>
		{/if}
		{#if data.darfKiEntwurf}
			<details class="ki-entwurf" open={!!form?.kiStichworte}>
				<summary class="kd-knopf hell">KI-Entwurf</summary>
				<form
					method="POST"
					action="?/kiEntwurf"
					enctype="multipart/form-data"
					class="kd-formular"
					use:enhance={() => {
						kiLaeuft = true;
						return async ({ update }) => {
							await update();
							kiLaeuft = false;
						};
					}}
				>
					<p class="kd-info">
						Die KI wählt nur Positionen aus Ihrem Leistungskatalog und schlägt Mengen vor. Preise kommen immer aus dem Katalog;
						unklare Positionen sind gelb als „bitte prüfen“ markiert.
					</p>
					<label>
						Leistungen (Stichworte)
						<textarea name="stichworte" rows="3" maxlength="2000" placeholder="z. B. 12 m² Wandfliesen, Silikonfugen erneuern">{form?.kiStichworte ?? ''}</textarea>
					</label>
					<label>
						Foto (optional, JPEG/PNG bis 5 MB)
						<input type="file" name="foto" accept="image/jpeg,image/png" />
					</label>
					<label class="ki-zustimmung">
						<input type="checkbox" name="zustimmung" value="ja" />
						Das Foto darf zur Auswertung an die KI (Mistral, Verarbeitung in der EU) gesendet werden.
					</label>
					<button type="submit" class="kd-knopf" disabled={kiLaeuft}>{kiLaeuft ? 'KI arbeitet …' : 'Entwurf erstellen'}</button>
				</form>
			</details>
		{/if}
	{/if}

	<h2>Einsätze</h2>
	<ul class="kd-liste af-einsaetze">
		{#each data.einsaetze as e (e.id)}
			<li>
				<span>
					<strong>{tagKurz(berlinTag(new Date(e.beginn)))} {berlinUhrzeit(new Date(e.beginn))}–{berlinUhrzeit(new Date(e.ende))}</strong>
					· {e.benutzerName}
				</span>
				{#if e.notiz}<span class="kd-info">{e.notiz}</span>{/if}
			</li>
		{:else}
			<li class="kd-leer">Noch keine Einsätze geplant.</li>
		{/each}
	</ul>

	<h2>To-dos</h2>
	{#if form?.todoFehler && !form?.todoWerte}
		<p role="alert" class="kd-fehler">{form.fehler}</p>
	{/if}
	<TodoListe
		todos={data.todos}
		heute={data.heute}
		benutzerId={data.benutzerId}
		darfBearbeiten={data.darfBearbeiten}
		mitarbeiter={data.mitarbeiter}
		zeigeAuftrag={false}
		aktionen={{ umschalten: '?/todoUmschalten', aendern: '?/todoAendern', loeschen: '?/todoLoeschen' }}
		leer="Noch keine To-dos zu diesem Auftrag."
	/>
	{#if data.darfBearbeiten}
		<TodoNeu
			aktion="?/todoAnlegen"
			mitarbeiter={data.mitarbeiter}
			fehler={form?.todoWerte ? form.fehler : null}
			werte={form?.todoWerte ?? {}}
		/>
	{/if}

	<h2>Verlauf</h2>
	<ol class="kd-verlauf">
		{#each data.verlauf as eintrag (eintrag.id)}
			<li>
				<strong>{eintrag.titel}</strong> · {eintrag.zeit} · {eintrag.wer}
				{#if eintrag.aenderungen.length > 0}
					<ul>
						{#each eintrag.aenderungen as aenderung (aenderung.feld)}
							<li class="kd-info">{aenderung.feld}: {aenderung.alt} → {aenderung.neu}</li>
						{/each}
					</ul>
				{/if}
			</li>
		{:else}
			<li class="kd-leer">Noch keine Einträge.</li>
		{/each}
	</ol>
	{#if data.verlaufGekuerzt}
		<p class="kd-info">Ältere Einträge werden hier nicht angezeigt.</p>
	{/if}

	{#if data.darfBearbeiten && a.status === 'anfrage'}
		<details class="kd-loeschen">
			<summary>Auftrag löschen …</summary>
			<form method="POST" action="?/loeschen" use:enhance class="kd-formular">
				<p>Die Anfrage und ihre To-dos werden endgültig gelöscht. Das lässt sich nicht rückgängig machen.</p>
				<button type="submit" class="kd-knopf gefahr">Endgültig löschen</button>
			</form>
		</details>
	{/if}
</main>

<style>
	.ki-entwurf {
		margin-top: 0.75rem;
	}
	.ki-entwurf summary {
		list-style: none;
		display: inline-flex;
		cursor: pointer;
	}
	.ki-entwurf form {
		margin-top: 0.75rem;
	}
	.ki-zustimmung {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
		font-weight: 400;
	}
	.ki-zustimmung input {
		min-width: 1.25rem;
		min-height: 1.25rem;
	}
</style>
