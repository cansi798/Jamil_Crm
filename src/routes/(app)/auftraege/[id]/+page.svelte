<script lang="ts">
	import { enhance } from '$app/forms';
	import Karte from '$lib/components/Karte.svelte';
	import StatusKette from '$lib/components/StatusKette.svelte';
	import TodoKanban from '$lib/components/TodoKanban.svelte';
	import TodoNeu from '$lib/components/TodoNeu.svelte';
	import { STATUS_NAMEN } from '$lib/auftrag-status';
	import { ANGEBOT_STATUS_NAMEN } from '$lib/angebot-status';
	import { euro } from '$lib/geld';
	import { berlinTag, berlinUhrzeit, tagDeutsch, tagKurz } from '$lib/zeit';
	import { EINSATZ_ARTEN, EINSATZ_ART_NAMEN } from '$lib/einsatz-art';
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
	<header class="seiten-kopf">
		<div>
			<h1>{a.titel}</h1>
			<p class="kd-info">{a.nummer} · {STATUS_NAMEN[a.status]}</p>
		</div>
		<div class="karte-aktionen">
			{#if data.darfBearbeiten}
				<a href={`/auftraege/${a.id}/bearbeiten`} class="knopf-subtil">Auftrag bearbeiten</a>
			{/if}
			<a href={`/auftraege/${a.id}/dokumentation`} class="knopf-gefuellt">Dokumentation</a>
		</div>
	</header>

	{#if data.kundenHinweise && (data.kundenHinweise.notiz || data.kundenHinweise.notizen.length > 0)}
		<aside class="af-hinweise" aria-label="Hinweise zum Kunden">
			<strong>Hinweise zum Kunden</strong>
			<ul>
				{#if data.kundenHinweise.notiz}<li>{data.kundenHinweise.notiz}</li>{/if}
				{#each data.kundenHinweise.notizen as n (n.id)}
					<li>{n.text} <span class="kd-info">· {tagDeutsch(berlinTag(new Date(n.angelegt)))}{n.vonName ? ` · ${n.vonName}` : ''}</span></li>
				{/each}
			</ul>
			{#if data.kundenHinweise.weitere > 0}
				<a href={`/kunden/${a.kundeId}`}>{data.kundenHinweise.weitere} weitere Notizen beim Kunden</a>
			{/if}
		</aside>
	{/if}

	{#if form?.fehler && !form?.todoFehler && !form?.terminFehler}
		<p role="alert" class="kd-fehler">{form.fehler}</p>
	{/if}

	<StatusKette status={a.status} darfBearbeiten={data.darfBearbeiten} />

	<Karte>
		{#snippet titel()}Stammdaten{/snippet}
		<dl class="kd-daten">
			<dt>Kunde</dt>
			<dd>
				{#if a.kundeArt === 'kunde'}
					{#if data.kundeLesbar}<a href={`/kunden/${a.kundeId}`}>{a.kundeName}</a>{:else}{a.kundeName}{/if}
				{:else if a.kundeArt === 'einmal' && a.einmalKunde}
					{a.einmalKunde.name} <span class="kd-info">(Einmal-Kunde)</span>
					{#if a.einmalKunde.telefon}<br /><a href={`tel:${a.einmalKunde.telefon.replace(/[^0-9+]/g, '')}`}>{a.einmalKunde.telefon}</a>{/if}
					{#if a.einmalKunde.email}<br /><a href={`mailto:${a.einmalKunde.email}`}>{a.einmalKunde.email}</a>{/if}
					{#if data.darfKundeUebernehmen}
						<form method="POST" action="?/kundeUebernehmen" use:enhance class="af-uebernehmen">
							<button type="submit" class="knopf-subtil">In Kundendatenbank übernehmen</button>
						</form>
					{/if}
				{:else}
					<span class="kd-info">Ohne Kunde</span>
				{/if}
			</dd>
			<dt>Einsatzort</dt>
			<dd>
				{a.adresse ?? 'Keine Adresse hinterlegt'}
				{#if a.adresse}
					<span class="kd-info">{a.adresseVonObjekt ? `(Objekt ${a.objektBezeichnung})` : a.kundeArt === 'einmal' ? '(Einmal-Kunde)' : '(Kundenadresse)'}</span>
				{/if}
			</dd>
			{#if a.zustaendige.length > 0}
				<dt>Zuständig</dt>
				<dd>{a.zustaendige.map((z) => z.name).join(', ')}</dd>
			{/if}
			{#if a.objektId && a.kundeId}
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
	</Karte>

	{#if data.angebote}
		<Karte>
			{#snippet titel()}Angebote{/snippet}
			{#snippet aktionen()}
				{#if data.darfAngebote}
					<form method="POST" action="?/angebotErstellen" use:enhance class="an-erstellen">
						{#if data.angebotVorlagen.length > 0}
							<select name="vorlageId" aria-label="Angebots-Vorlage">
								<option value="">ohne Vorlage</option>
								{#each data.angebotVorlagen as v (v.id)}
									<option value={v.id}>Vorlage: {v.name}</option>
								{/each}
							</select>
						{/if}
						<button type="submit" class="knopf-subtil">Angebot erstellen</button>
					</form>
				{/if}
			{/snippet}
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
			{#if data.darfKiEntwurf}
				<details class="ki-entwurf" open={!!form?.kiStichworte}>
					<summary class="knopf-subtil">KI-Entwurf</summary>
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
						<button type="submit" class="knopf-gefuellt" disabled={kiLaeuft}>{kiLaeuft ? 'KI arbeitet …' : 'Entwurf erstellen'}</button>
					</form>
				</details>
			{/if}
		</Karte>
	{/if}

	<Karte>
		{#snippet titel()}Termine{/snippet}
		<ul class="kd-liste af-einsaetze">
			{#each data.einsaetze as e (e.id)}
				<li>
					<span>
						<span class={`af-art art-${e.art}`}>{EINSATZ_ART_NAMEN[e.art]}</span>
						<strong>{tagKurz(berlinTag(new Date(e.beginn)))} {berlinUhrzeit(new Date(e.beginn))}–{berlinUhrzeit(new Date(e.ende))}</strong>
						· {e.benutzerName}
					</span>
					{#if e.notiz}<span class="kd-info">{e.notiz}</span>{/if}
				</li>
			{:else}
				<li class="kd-leer">Noch keine Termine geplant.</li>
			{/each}
		</ul>
		{#if data.darfTermine}
			<details class="af-termin-neu" open={!!form?.terminFehler}>
				<summary>+ Termin</summary>
				<form method="POST" action="?/terminAnlegen" use:enhance class="kd-formular">
					{#if form?.terminFehler}<p role="alert" class="kd-fehler">{form.terminFehler}</p>{/if}
					<label>
						Art
						<select name="art" required>
							{#each EINSATZ_ARTEN as art (art)}<option value={art} selected={art === 'montage'}>{EINSATZ_ART_NAMEN[art]}</option>{/each}
						</select>
					</label>
					<label>
						Mitarbeiter
						<select name="benutzerId" required>
							<option value="">– bitte wählen –</option>
							{#each data.mitarbeiter as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
						</select>
					</label>
					<label>Tag <input type="date" name="tag" required value={data.heute} /></label>
					<div class="kd-zwei">
						<label>von <input type="time" name="von" required value="08:00" /></label>
						<label>bis <input type="time" name="bis" required value="12:00" /></label>
					</div>
					<label>Notiz (optional) <input type="text" name="notiz" maxlength="500" /></label>
					<button type="submit" class="kd-knopf">Termin speichern</button>
				</form>
			</details>
		{/if}
	</Karte>

	<Karte>
		{#snippet titel()}To-dos{/snippet}
		{#if form?.todoFehler && !form?.todoWerte}
			<p role="alert" class="kd-fehler">{form.fehler}</p>
		{/if}
		<TodoKanban
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
				mitBelastung
				aktion="?/todoAnlegen"
				mitarbeiter={data.mitarbeiter}
				fehler={form?.todoWerte ? form.fehler : null}
				werte={form?.todoWerte ?? {}}
			/>
		{/if}
	</Karte>

	<Karte>
		{#snippet titel()}Verlauf{/snippet}
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
	</Karte>

	{#if data.darfBearbeiten && a.status === 'anfrage'}
		<details class="kd-loeschen">
			<summary>Auftrag löschen …</summary>
			<form method="POST" action="?/loeschen" use:enhance class="kd-formular">
				<p>Die Anfrage und ihre To-dos werden endgültig gelöscht. Das lässt sich nicht rückgängig machen.</p>
				<button type="submit" class="knopf-gefahr">Endgültig löschen</button>
			</form>
		</details>
	{/if}
</main>

<style>
	.af-hinweise {
		margin: 0 0 1rem;
		padding: 0.75rem 1rem;
		border-left: 4px solid var(--m365-warnung);
		border-radius: var(--m365-radius);
		background: var(--m365-warnung-hell);
	}
	.af-hinweise ul {
		margin: 0.25rem 0 0;
		padding-left: 1.1rem;
	}
	.af-art {
		display: inline-block;
		margin-right: 0.35rem;
		padding: 0.05rem 0.45rem;
		border-radius: 999px;
		font-size: 0.75rem;
		background: var(--m365-flaeche-hover);
	}
	.art-besichtigung {
		background: var(--m365-primaer-hell);
		color: var(--m365-primaer-dunkel);
	}
	.art-wartung {
		background: var(--m365-erfolg-hell);
		color: var(--m365-erfolg);
	}
	.af-termin-neu summary {
		display: inline-flex;
		align-items: center;
		min-height: var(--tippziel, 44px);
		color: var(--m365-primaer);
		cursor: pointer;
	}
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
