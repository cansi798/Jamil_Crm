<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import Karte from '$lib/components/Karte.svelte';
	import StatusKette from '$lib/components/StatusKette.svelte';
	import TodoListe from '$lib/components/TodoListe.svelte';
	import TodoNeu from '$lib/components/TodoNeu.svelte';
	import { ANGEBOT_STATUS_NAMEN } from '$lib/angebot-status';
	import { euro } from '$lib/geld';
	import { berlinTag, berlinUhrzeit, tagDeutsch, tagKurz } from '$lib/zeit';
	import { EINSATZ_ARTEN, EINSATZ_ART_NAMEN, terminKurz } from '$lib/einsatz-art';
	import { navigationsLink, telefonLink } from '$lib/kontakt-links';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const a = $derived(data.auftrag);
	let kiLaeuft = $state(false);

	// Eingeklappt bis gebraucht (Wunsch Jamil, msg 2579): „Mitarbeiter zuweisen“ bleibt offen, solange man Häkchen
	// setzt, und schließt mit „Fertig“; „+ To-do“ und „+ Termin“ schließen nach dem Speichern bzw. „Abbrechen“.
	let zuweisenOffen = $state(false);
	let todoNeuOffen = $state(untrack(() => !!form?.todoWerte));
	let terminOffen = $state(untrack(() => !!form?.terminFehler));
	const terminGespeichert = () => async ({ result, update }: { result: { type: string }; update: () => Promise<void> }) => {
		await update();
		if (result.type === 'success') terminOffen = false;
	};

	// Felder direkt im Auftrag ändern (Wunsch Jamil): speichern sofort, kurze Rückmeldung „Gespeichert“
	let gespeichert = $state(false);
	let gespeichertZeit: ReturnType<typeof setTimeout> | undefined;
	const sofort = () => async ({ result, update }: { result: { type: string }; update: (o?: { reset?: boolean; invalidateAll?: boolean }) => Promise<void> }) => {
		await update({ reset: false });
		if (result.type === 'success') {
			gespeichert = true;
			clearTimeout(gespeichertZeit);
			gespeichertZeit = setTimeout(() => (gespeichert = false), 2500);
		}
	};
</script>

<svelte:head>
	<title>{a.nummer} {a.titel}</title>
</svelte:head>

<main class="kd-seite">
	<a href="/auftraege" class="kd-zurueck">← Aufträge</a>
	<header class="seiten-kopf">
		<div>
			<h1>{a.titel}</h1>
			<p class="kd-info">{a.nummer}</p>
		</div>
		<div class="karte-aktionen">
			{#if data.darfBearbeiten}
				<a href={`/auftraege/${a.id}/bearbeiten`} class="knopf-subtil">Auftrag bearbeiten</a>
			{/if}
			<a href={`/auftraege/${a.id}/dokumentation`} class="knopf-gefuellt">Dokumentation</a>
		</div>
	</header>
	<StatusKette status={a.status} darfBearbeiten={data.darfBearbeiten} />

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

	{#if form?.fehler && !form?.todoFehler && !form?.terminFehler && !form?.aendernFehler}
		<p role="alert" class="kd-fehler">{form.fehler}</p>
	{/if}

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
			<dt>Objekt / Einsatzort</dt>
			<dd class="af-objekt">
				{#if data.darfBearbeiten && a.kundeArt === 'kunde'}
					<form method="POST" action="?/aendern" use:enhance={sofort} class="af-inline">
						<select name="objektId" aria-label="Objekt" onchange={(ev) => ev.currentTarget.form?.requestSubmit()}>
							<option value="" selected={!a.objektId}>Kundenadresse (Standard)</option>
							{#each data.objekte as o (o.id)}
								<option value={o.id} selected={o.id === a.objektId}>{o.bezeichnung}{o.adresse ? ` – ${o.adresse}` : ''}</option>
							{/each}
						</select>
					</form>
					<span>{a.adresse ?? 'Keine Adresse hinterlegt'}</span>
					{#if a.objektId && data.kundeLesbar}
						<a href={`/kunden/${a.kundeId}/objekte/${a.objektId}`}>Objekt öffnen</a>
					{/if}
				{:else if a.objektId && a.kundeId}
					{#if data.kundeLesbar}
						<a href={`/kunden/${a.kundeId}/objekte/${a.objektId}`}><strong>{a.objektBezeichnung}</strong></a>
					{:else}<strong>{a.objektBezeichnung}</strong>{/if}
					<span>{a.adresse ?? 'Keine Adresse hinterlegt'}</span>
				{:else}
					<span>
						{a.adresse ?? 'Keine Adresse hinterlegt'}
						<span class="kd-info">{a.kundeArt === 'einmal' ? '(Einmal-Kunde)' : a.kundeArt === 'kunde' ? '(Kundenadresse – kein Objekt zugewiesen)' : ''}</span>
					</span>
				{/if}
			</dd>
			{#if a.anlageId || (data.darfBearbeiten && data.anlagen.length > 0)}
				<dt>Anlage</dt>
				<dd class="af-objekt">
					{#if data.darfBearbeiten && data.anlagen.length > 0}
						<form method="POST" action="?/aendern" use:enhance={sofort} class="af-inline">
							<select name="anlageId" aria-label="Anlage" onchange={(ev) => ev.currentTarget.form?.requestSubmit()}>
								<option value="" selected={!a.anlageId}>– keine Anlage –</option>
								{#each data.anlagen as an (an.id)}
									<option value={an.id} selected={an.id === a.anlageId}>{an.bezeichnung} ({an.typName})</option>
								{/each}
							</select>
						</form>
					{:else}
						<strong>{a.anlageBezeichnung}</strong>
					{/if}
					{#if a.anlageId && data.kundeLesbar}
						<a href={`/anlagen/${a.anlageId}`}>Anlage öffnen (Verlauf, QR)</a>
					{/if}
				</dd>
			{/if}
			{#if navigationsLink(a.adresse) || telefonLink(a.telefon)}
				<dt class="kd-unsichtbar">Vor Ort</dt>
				<dd class="af-vorort">
					{#if navigationsLink(a.adresse)}
						<a class="af-vorort-knopf" href={navigationsLink(a.adresse)} target="_blank" rel="noopener">
							<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z" /></svg>
							Navigieren
						</a>
					{/if}
					{#if telefonLink(a.telefon)}
						<a class="af-vorort-knopf" href={telefonLink(a.telefon)}>
							<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1Z" /></svg>
							Anrufen
						</a>
					{/if}
				</dd>
			{/if}
			<dt>Nächster Termin</dt>
			<dd>
				{#if a.kommenderTermin}
					{terminKurz(a.kommenderTermin)}
				{:else if a.geplantAb}
					geplant ab {tagDeutsch(a.geplantAb)} <span class="kd-info">(noch kein Termin – unten „+ Termin“)</span>
				{:else}
					<span class="kd-info">Noch kein Termin – unten bei „Termine“ anlegen.</span>
				{/if}
			</dd>
			<dt>Beschreibung</dt>
			<dd>
				{#if data.darfBearbeiten}
					<form method="POST" action="?/aendern" use:enhance={sofort} class="af-inline">
						<textarea
							name="beschreibung"
							aria-label="Beschreibung"
							maxlength="4000"
							rows="3"
							placeholder="Infos zum Auftrag …"
							onblur={(ev) => {
								if (ev.currentTarget.value !== (a.beschreibung ?? '')) ev.currentTarget.form?.requestSubmit();
							}}>{a.beschreibung ?? ''}</textarea
						>
					</form>
				{:else}{a.beschreibung ?? '–'}{/if}
			</dd>
		</dl>
		{#if form?.aendernFehler}<p role="alert" class="kd-fehler">{form.aendernFehler}</p>{/if}
	</Karte>

	<Karte>
		{#snippet titel()}Mitarbeiter{/snippet}
		<ul class="af-chips" aria-label="Zuständige Mitarbeiter">
			{#each a.zustaendige as z (z.id)}
				<li class="af-chip"><span class="af-chip-avatar">{z.name.charAt(0)}</span>{z.name}</li>
			{:else}
				<li class="kd-info">Noch keine Mitarbeiter zugewiesen.</li>
			{/each}
		</ul>
		{#if data.darfBearbeiten}
			<details class="af-zuweisen" bind:open={zuweisenOffen}>
				<summary class="kd-knopf hell">Mitarbeiter zuweisen</summary>
				<form method="POST" action="?/aendern" use:enhance={sofort} class="af-zuweisen-liste">
					<input type="hidden" name="zustaendigeGesendet" value="1" />
					<p class="kd-info">Mehrere möglich – jedes Häkchen wird sofort gespeichert. Zugewiesene sehen den Auftrag unter „Aufträge“.</p>
					{#each data.mitarbeiter as m (m.id)}
						<label class="af-haken-zeile">
							<input
								type="checkbox"
								name="zustaendige"
								value={m.id}
								checked={a.zustaendige.some((z) => z.id === m.id)}
								onchange={(ev) => ev.currentTarget.form?.requestSubmit()}
							/>
							{m.name}
						</label>
					{/each}
					<button type="button" class="kd-knopf hell af-fertig" onclick={() => (zuweisenOffen = false)}>Fertig</button>
				</form>
			</details>
		{/if}
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
			{#if data.zuordenbareAngebote.length > 0}
				<form method="POST" action="?/angebotZuordnen" use:enhance class="an-erstellen af-zuordnen">
					<select name="angebotId" aria-label="Bestehendes Angebot zuordnen" required>
						<option value="">Bestehendes Angebot zuordnen …</option>
						{#each data.zuordenbareAngebote as z (z.id)}
							<option value={z.id}>{z.nummer} · {z.kundeName} · {tagDeutsch(z.datum)} · {euro(z.bruttoCent)}</option>
						{/each}
					</select>
					<button type="submit" class="knopf-subtil">Zuordnen</button>
				</form>
			{/if}
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
			<details class="af-termin-neu af-aufklapp" bind:open={terminOffen}>
				<summary class="kd-knopf hell">+ Termin hinzufügen</summary>
				<form method="POST" action="?/terminAnlegen" use:enhance={terminGespeichert} class="kd-formular">
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
					<div class="td-neu-knoepfe">
						<button type="submit" class="kd-knopf">Termin speichern</button>
						<button type="button" class="kd-knopf hell" onclick={() => (terminOffen = false)}>Abbrechen</button>
					</div>
				</form>
			</details>
		{/if}
	</Karte>

	<Karte>
		{#snippet titel()}To-dos{/snippet}
		{#if form?.todoFehler && !form?.todoWerte}
			<p role="alert" class="kd-fehler">{form.fehler}</p>
		{/if}
		{#snippet aktionen()}
			{#if data.darfBearbeiten && !todoNeuOffen}
				<button type="button" class="knopf-subtil" onclick={() => (todoNeuOffen = true)}>+ To-do hinzufügen</button>
			{/if}
		{/snippet}
		{#if data.darfBearbeiten && todoNeuOffen}
			<TodoNeu
				mitBelastung
				aktion="?/todoAnlegen"
				mitarbeiter={data.mitarbeiter}
				fehler={form?.todoWerte ? form.fehler : null}
				werte={form?.todoWerte ?? {}}
				onfertig={() => (todoNeuOffen = false)}
				onabbrechen={() => (todoNeuOffen = false)}
			/>
		{/if}
		<TodoListe
			todos={data.todos}
			heute={data.heute}
			benutzerId={data.benutzerId}
			darfBearbeiten={data.darfBearbeiten}
			mitarbeiter={data.mitarbeiter}
			aktionen={{ umschalten: '?/todoUmschalten', aendern: '?/todoAendern', loeschen: '?/todoLoeschen', serieBeenden: '?/todoSerieBeenden' }}
			leer="Noch keine To-dos zu diesem Auftrag."
		/>
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
	{#if gespeichert}<p class="af-gespeichert" role="status">Gespeichert</p>{/if}
</main>

<style>
	.af-inline select,
	.af-inline textarea {
		width: 100%;
		max-width: 32rem;
	}
	.af-gespeichert {
		position: fixed;
		left: 50%;
		bottom: 5.5rem;
		transform: translateX(-50%);
		z-index: 50;
		margin: 0;
		padding: 0.5rem 1rem;
		border-radius: 999px;
		background: var(--m365-erfolg);
		color: #fff;
		box-shadow: var(--m365-schatten-pop);
	}
	.af-chips {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin: 0 0 0.75rem;
		padding: 0;
	}
	.af-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.25rem 0.75rem 0.25rem 0.25rem;
		border-radius: 999px;
		background: var(--m365-primaer-hell);
		color: var(--m365-primaer-dunkel);
	}
	.af-chip-avatar {
		display: inline-grid;
		place-items: center;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 50%;
		background: var(--m365-primaer);
		color: #fff;
		font-size: 0.8125rem;
	}
	.af-zuweisen > summary {
		list-style: none;
		display: inline-flex;
		align-items: center;
		cursor: pointer;
	}
	.af-zuweisen-liste {
		display: grid;
		gap: 0.1rem;
		margin-top: 0.5rem;
	}
	.af-haken-zeile {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		min-height: var(--tippziel, 44px);
	}
	.af-haken-zeile input {
		width: 1.25rem;
		height: 1.25rem;
	}
	.af-vorort {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.af-vorort-knopf {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-height: var(--tippziel, 44px);
		padding: 0 1rem;
		border-radius: var(--m365-radius);
		background: var(--m365-primaer);
		color: #fff;
		font-weight: 600;
		text-decoration: none;
	}
	.af-vorort-knopf svg {
		width: 1.2rem;
		height: 1.2rem;
		fill: currentColor;
	}
	:global(.kd-unsichtbar) {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}
	.af-objekt {
		display: grid;
		gap: 0.15rem;
		justify-items: start;
	}
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
	.af-termin-neu {
		margin-top: 0.5rem;
	}
	.af-termin-neu > summary {
		list-style: none;
		display: inline-flex;
		align-items: center;
		cursor: pointer;
	}
	.af-termin-neu > summary::-webkit-details-marker,
	.af-zuweisen > summary::-webkit-details-marker {
		display: none;
	}
	.af-termin-neu[open] > summary {
		display: none;
	}
	.af-fertig {
		justify-self: start;
		margin-top: 0.5rem;
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
