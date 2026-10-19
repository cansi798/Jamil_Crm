<script lang="ts">
	import { enhance } from '$app/forms';
	import { STATUS_NAMEN } from '$lib/auftrag-status';
	import { terminKurz } from '$lib/einsatz-art';
	import { berlinTag, berlinUhrzeit, tagDeutsch } from '$lib/zeit';
	import Abschnitt from '$lib/components/Abschnitt.svelte';
	import AddPanel from '$lib/components/AddPanel.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const k = $derived(data.kunde);
	const adresse = $derived([k.strasse, [k.plz, k.ort].filter(Boolean).join(' ')].filter(Boolean).join(', '));
	const ansprechpartner = $derived([k.anrede, k.vorname, k.nachname].filter(Boolean).join(' '));

	const wann = (iso: string) => {
		const d = new Date(iso);
		return `${tagDeutsch(berlinTag(d))}, ${berlinUhrzeit(d)}`;
	};
	const groesse = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
	let notizText = $state('');

	const TYP_NAMEN = { auftrag: 'Auftrag', angebot: 'Angebot', termin: 'Termin', notiz: 'Notiz', dokument: 'Dokument' } as const;
	const FILTER = [
		['alle', 'Alle'],
		['auftrag', 'Aufträge'],
		['angebot', 'Angebote'],
		['termin', 'Termine'],
		['notiz', 'Notizen'],
		['dokument', 'Dokumente']
	] as const;
	let filter = $state<(typeof FILTER)[number][0]>('alle');
	const gefiltert = $derived(filter === 'alle' ? data.zeitleiste : data.zeitleiste.filter((e) => e.typ === filter));
</script>

<svelte:head>
	<title>{k.name}</title>
</svelte:head>

<main class="kd-seite">
	<a href="/kunden" class="kd-zurueck">← Kunden</a>
	<header class="seiten-kopf">
		<div>
			<h1>{k.name}</h1>
			<p class="seiten-meta">{k.art === 'firma' ? 'Firmenkunde' : 'Privatkunde'}{adresse ? ` · ${adresse}` : ''}</p>
		</div>
		<div class="seiten-aktionen">
			{#if data.darfBearbeiten}
				<a href={`/kunden/${k.id}/bearbeiten`} class="kd-knopf hell">Kunde bearbeiten</a>
			{/if}
			{#if data.auftraege && data.darfAuftragAnlegen}
				<a href={`/auftraege/neu?kunde=${k.id}`} class="kd-knopf">+ Auftrag</a>
			{/if}
		</div>
	</header>

	<Abschnitt titel="Kontakt">
		<dl class="kd-daten ka-kontakt">
			{#if k.art === 'firma' && ansprechpartner}
				<div><dt>Ansprechpartner</dt><dd>{ansprechpartner}</dd></div>
			{:else if k.art === 'privat' && k.anrede}
				<div><dt>Anrede</dt><dd>{k.anrede}</dd></div>
			{/if}
			{#if k.telefon}
				<div><dt>Telefon</dt><dd><a href={`tel:${k.telefon.replace(/[^0-9+]/g, '')}`}>{k.telefon}</a></dd></div>
			{/if}
			{#if k.email}
				<div><dt>E-Mail</dt><dd><a href={`mailto:${k.email}`}>{k.email}</a></dd></div>
			{/if}
			{#if adresse}
				<div><dt>Adresse</dt><dd>{adresse}</dd></div>
			{/if}
			{#if k.notiz}
				<div class="ka-breit"><dt>Notiz</dt><dd>{k.notiz}</dd></div>
			{/if}
		</dl>
	</Abschnitt>

	<Abschnitt titel="Objekte" anzahl={data.objekte.length}>
		{#snippet aktionen()}
			{#if data.darfBearbeiten}
				<a href={`/kunden/${k.id}/objekte/neu`} class="kd-knopf hell">+ Objekt</a>
			{/if}
		{/snippet}
		<ul class="kd-liste">
			{#each data.objekte as objekt (objekt.id)}
				<li>
					<a href={`/kunden/${k.id}/objekte/${objekt.id}`}>
						<strong>{objekt.bezeichnung}</strong>
						{#if objekt.strasse || objekt.ort}
							<span class="kd-info">
								{[objekt.strasse, [objekt.plz, objekt.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')}
							</span>
						{/if}
					</a>
				</li>
			{:else}
				<li class="kd-leer">Noch keine Objekte (Baustellen) angelegt.</li>
			{/each}
		</ul>
	</Abschnitt>

	{#if data.auftraege}
		<Abschnitt titel="Aufträge" anzahl={data.auftraege.length}>
			<ul class="kd-liste">
				{#each data.auftraege as auftrag (auftrag.id)}
					<li>
						<a href={`/auftraege/${auftrag.id}`}>
							<strong>{auftrag.titel}</strong>
							<span class="kd-info">
								{auftrag.nummer} · {STATUS_NAMEN[auftrag.status]}{auftrag.kommenderTermin ? ` · Nächster Termin: ${terminKurz(auftrag.kommenderTermin)}` : ''}
							</span>
							<span class="kd-info">
								{auftrag.objektBezeichnung ? `Objekt: ${auftrag.objektBezeichnung}` : 'Kundenadresse'}{auftrag.adresse ? ` · ${auftrag.adresse}` : ''}
							</span>
						</a>
					</li>
				{:else}
					<li class="kd-leer">Noch keine Aufträge.</li>
				{/each}
			</ul>
		</Abschnitt>
	{/if}

	<Abschnitt titel="Notizen" anzahl={data.notizen.length}>
		{#if data.darfBearbeiten}
			<AddPanel label="Notiz hinzufügen" offen={!!form?.notizFehler}>
				{#snippet children(schliessen)}
					<form
						method="POST"
						action="?/notizAnlegen"
						class="kd-formular"
						use:enhance={() =>
							async ({ result, update }) => {
								await update({ reset: false });
								if (result.type === 'success') notizText = '';
							}}
					>
						{#if form?.notizFehler}<p role="alert" class="kd-fehler">{form.notizFehler}</p>{/if}
						<label>
							Neue Notiz
							<textarea name="text" bind:value={notizText} maxlength="10000" rows="3" required placeholder="z. B. Hund im Garten – bitte klingeln"></textarea>
						</label>
						<div class="knopf-reihe">
							<button type="submit" class="kd-knopf">Notiz speichern</button>
							<button type="button" class="kd-knopf hell" onclick={schliessen}>Abbrechen</button>
						</div>
					</form>
				{/snippet}
			</AddPanel>
		{/if}
		<ul class="kd-liste ka-notizen" aria-label="Notizen">
			{#each data.notizen as n (n.id)}
				<li>
					<p class="ka-text">{n.text}</p>
					<span class="kd-info">{wann(n.angelegt)}{n.vonName ? ` · ${n.vonName}` : ''}</span>
					{#if data.darfBearbeiten}
						<form method="POST" action="?/notizLoeschen" use:enhance class="ka-loeschen">
							<input type="hidden" name="id" value={n.id} />
							<button type="submit" class="kd-knopf gefahr klein" aria-label="Notiz vom {wann(n.angelegt)} löschen">Löschen</button>
						</form>
					{/if}
				</li>
			{:else}
				<li class="kd-leer">Noch keine Notizen.</li>
			{/each}
		</ul>
	</Abschnitt>

	<Abschnitt titel="Dokumente" anzahl={data.dokumente.length}>
		{#if data.darfBearbeiten}
			<AddPanel label="Dokument hochladen" offen={!!form?.dokumentFehler}>
				{#snippet children(schliessen)}
					<form method="POST" action="?/dokumentHochladen" enctype="multipart/form-data" use:enhance class="kd-formular">
						{#if form?.dokumentFehler}<p role="alert" class="kd-fehler">{form.dokumentFehler}</p>{/if}
						<label>
							Datei (PDF, Bild, Word, Excel – höchstens 5 MB)
							<input
								type="file"
								name="datei"
								required
								accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.docx,.xlsx,application/pdf,image/jpeg,image/png,image/webp,image/heic"
							/>
						</label>
						<label>Beschreibung (optional) <input type="text" name="beschreibung" maxlength="500" /></label>
						<div class="knopf-reihe">
							<button type="submit" class="kd-knopf">Hochladen</button>
							<button type="button" class="kd-knopf hell" onclick={schliessen}>Abbrechen</button>
						</div>
					</form>
				{/snippet}
			</AddPanel>
		{/if}
		<ul class="kd-liste ka-dokumente" aria-label="Dokumente">
			{#each data.dokumente as d (d.id)}
				<li>
					<a href={`/kunden/${k.id}/dokumente/${d.id}`} download={d.name}>
						<strong>{d.name}</strong>
						<span class="kd-info">
							{groesse(d.groesse)} · {wann(d.angelegt)}{d.vonName ? ` · ${d.vonName}` : ''}{d.beschreibung ? ` · ${d.beschreibung}` : ''}
						</span>
					</a>
					{#if data.darfBearbeiten}
						<form method="POST" action="?/dokumentLoeschen" use:enhance class="ka-loeschen">
							<input type="hidden" name="id" value={d.id} />
							<button type="submit" class="kd-knopf gefahr klein" aria-label="Dokument {d.name} löschen">Löschen</button>
						</form>
					{/if}
				</li>
			{:else}
				<li class="kd-leer">Noch keine Dokumente.</li>
			{/each}
		</ul>
	</Abschnitt>

	<Abschnitt titel="Kundenportal">
		<div class="ka-portal">
			<p class="kd-info">
				Bald: Hier richten Sie das Kundenportal für diesen Kunden ein (Zugang, freigegebene Angebote und Dokumente) und können es
				direkt öffnen.
			</p>
			<button type="button" class="kd-knopf hell" disabled>Kundenportal öffnen (in Vorbereitung)</button>
		</div>
	</Abschnitt>

	<Abschnitt titel="Verlauf">
		{#snippet aktionen()}
			{#if data.darfAngebotAnlegen}
				<form method="POST" action="?/angebotErstellen" use:enhance>
					<button type="submit" class="kd-knopf hell">+ Angebot ohne Auftrag</button>
				</form>
			{/if}
		{/snippet}
	<div class="ka-verlauf-kopf">
		<div class="pills" role="group" aria-label="Verlauf filtern">
			{#each FILTER as [wert, text] (wert)}
				<button type="button" class="pill" class:aktiv={filter === wert} aria-pressed={filter === wert} onclick={() => (filter = wert)}>
					{text}
				</button>
			{/each}
		</div>
	</div>
	<ol class="ka-zeitleiste" aria-label="Verlauf des Kunden">
		{#each gefiltert as e (e.id)}
			<li class={`ka-eintrag typ-${e.typ}`}>
				<span class="ka-typ">{TYP_NAMEN[e.typ]}</span>
				<div class="ka-eintrag-inhalt">
					{#if e.link}<a href={e.link}><strong>{e.titel}</strong></a>{:else}<strong>{e.titel}</strong>{/if}
					{#if e.text}<p class="ka-text">{e.text}</p>{/if}
					<span class="kd-info">{wann(e.zeit)}{new Date(e.zeit).getTime() > Date.now() ? ' · geplant' : ''}</span>
				</div>
			</li>
		{:else}
			<li class="kd-leer">Noch keine Einträge.</li>
		{/each}
	</ol>
	<p class="kd-info">Termine legen Sie im Auftrag an. Rechnungen und E-Mails erscheinen hier, sobald sie angebunden sind.</p>
	</Abschnitt>

	<details class="ka-protokoll">
		<summary>Änderungsprotokoll der Kundendaten</summary>
	<ol class="kd-verlauf">
		{#each data.verlauf as eintrag (eintrag.id)}
			<li>
				<strong>{eintrag.titel}</strong> · {eintrag.zeit} · {eintrag.wer}
				{#if eintrag.aenderungen.length > 0}
					<ul>
						{#each eintrag.aenderungen as a (a.feld)}
							<li class="kd-info">{a.feld}: {a.alt} → {a.neu}</li>
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

	</details>

	{#if data.darfBearbeiten}
		<details class="kd-loeschen">
			<summary>Kunde löschen …</summary>
			<form method="POST" action="?/loeschen" use:enhance class="kd-formular">
				{#if form?.fehler && !form?.notizFehler && !form?.dokumentFehler}
					<p role="alert" class="kd-fehler">{form.fehler}</p>
				{/if}
				<p>
					Der Kunde und alle seine Objekte werden endgültig gelöscht. Das lässt sich nicht rückgängig machen.
				</p>
				<button type="submit" class="kd-knopf gefahr">Endgültig löschen</button>
			</form>
		</details>
	{/if}
</main>

<style>
	.ka-notizen li,
	.ka-dokumente li {
		display: grid;
		gap: 0.25rem;
	}
	.ka-text {
		margin: 0;
		white-space: pre-line;
		overflow-wrap: anywhere;
	}
	.ka-loeschen {
		justify-self: start;
	}
	.ka-kontakt {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
		gap: 0.75rem 1.5rem;
		margin: 0;
	}
	.ka-kontakt :global(dt) {
		margin-top: 0;
	}
	.ka-breit {
		grid-column: 1 / -1;
	}
	.ka-notizen li,
	.ka-dokumente li {
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--ui-rand);
	}
	.ka-notizen li:last-child,
	.ka-dokumente li:last-child {
		border-bottom: 0;
	}
	.ka-dokumente li > a {
		padding: 0;
		border: 0;
		min-height: 0;
	}
	.ka-protokoll,
	.kd-loeschen {
		margin-top: 1rem;
	}
	.ka-verlauf-kopf {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
	}
	.pills {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.pill {
		min-height: var(--tippziel, 44px);
		padding: 0 0.9rem;
		border: 1px solid var(--m365-rand);
		border-radius: 999px;
		background: var(--m365-flaeche);
		font: inherit;
		cursor: pointer;
	}
	.pill.aktiv {
		background: var(--m365-primaer);
		border-color: var(--m365-primaer);
		color: #fff;
	}
	.ka-zeitleiste {
		list-style: none;
		margin: 0;
		padding: 0;
		border-left: 2px solid var(--m365-rand);
	}
	.ka-eintrag {
		position: relative;
		display: grid;
		grid-template-columns: 5.5rem minmax(0, 1fr);
		gap: 0.5rem;
		padding: 0.6rem 0 0.6rem 0.9rem;
	}
	.ka-eintrag::before {
		content: '';
		position: absolute;
		left: -0.4rem;
		top: 1rem;
		width: 0.7rem;
		height: 0.7rem;
		border-radius: 50%;
		background: var(--m365-rand-stark);
	}
	.typ-auftrag::before { background: var(--m365-primaer); }
	.typ-angebot::before { background: var(--m365-erfolg); }
	.typ-termin::before { background: var(--m365-warnung); }
	.ka-typ {
		font-size: 0.75rem;
		color: var(--m365-text-leise);
		padding-top: 0.15rem;
	}
	.ka-eintrag-inhalt {
		display: grid;
		gap: 0.15rem;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.ka-portal {
		display: grid;
		gap: 0.5rem;
		justify-items: start;
	}
	.ka-portal :disabled {
		opacity: 0.6;
		cursor: default;
	}
</style>
