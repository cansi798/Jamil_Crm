<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import Karte from '$lib/components/Karte.svelte';
	import StatusKette from '$lib/components/StatusKette.svelte';
	import TodoListe from '$lib/components/TodoListe.svelte';
	import TodoNeu from '$lib/components/TodoNeu.svelte';
	import AddPanel from '$lib/components/AddPanel.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
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
	// setzt, und schließt mit „Fertig“; To-do, Termin und Angebot über das gemeinsame AddPanel (zu nach Speichern).
	let zuweisenOffen = $state(false);

	// „Angebot hinzufügen“: ein Feld mit vier Wegen statt verstreuter Auswahlen und Knöpfe
	type Weg = 'neu' | 'vorlage' | 'ki' | 'zuordnen';
	const wegeAngebot = $derived.by(() => {
		const wege: [Weg, string][] = [];
		if (data.darfAngebote) wege.push(['neu', 'Neu']);
		if (data.darfAngebote && data.angebotVorlagen.length > 0) wege.push(['vorlage', 'Aus Vorlage']);
		if (data.darfKiEntwurf) wege.push(['ki', 'KI-Entwurf']);
		if (data.zuordenbareAngebote.length > 0) wege.push(['zuordnen', 'Bestehendes zuordnen']);
		return wege;
	});
	let angebotWeg = $state<Weg>(untrack(() => (form?.kiStichworte ? 'ki' : 'neu')));
	$effect(() => {
		if (wegeAngebot.length > 0 && !wegeAngebot.some(([w]) => w === angebotWeg)) angebotWeg = wegeAngebot[0][0];
	});

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

<main class="kd-seite breit af-seite">
	<a href="/auftraege" class="kd-zurueck">← Aufträge</a>
	<header class="seiten-kopf af-kopf">
		<div>
			<h1>{a.titel}</h1>
			<p class="seiten-meta">{a.nummer}{a.kundeName ? ` · ${a.kundeName}` : ''}</p>
		</div>
		<div class="seiten-aktionen">
			{#if data.darfBearbeiten}
				<a href={`/auftraege/${a.id}/bearbeiten`} class="kd-knopf hell">Auftrag bearbeiten</a>
			{/if}
			<a href={`/auftraege/${a.id}/dokumentation`} class="kd-knopf">Dokumentation</a>
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

	{#if form?.fehler && !form?.todoFehler && !form?.terminFehler && !form?.aendernFehler && !form?.protokollFehler}
		<p role="alert" class="kd-fehler">{form.fehler}</p>
	{/if}

	<!-- Ab 1200 px zwei Spalten (Wunsch Jamil msg 2495: ganze Arbeitsfläche): links Arbeit, rechts Kontext.
	     Schmal eine Spalte; die Reihenfolge der Karten steuert dann `order` (Ort und Mitarbeiter früh). -->
	<div class="af-raster">
		<div class="af-haupt">
			<div class="af-k k-stamm">
				<Karte>
					{#snippet titel()}Stammdaten{/snippet}
					<dl class="kd-daten af-stamm">
						<div>
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
						</div>
						<div>
							<dt>Nächster Termin</dt>
							<dd>
								{#if a.kommenderTermin}
									{terminKurz(a.kommenderTermin)}
								{:else if a.geplantAb}
									geplant ab {tagDeutsch(a.geplantAb)} <span class="kd-info">(noch kein Termin)</span>
								{:else}
									<span class="kd-info">Noch kein Termin – bei „Termine“ anlegen.</span>
								{/if}
							</dd>
						</div>
						<div class="af-breit">
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
						</div>
					</dl>
					{#if form?.aendernFehler}<p role="alert" class="kd-fehler">{form.aendernFehler}</p>{/if}
				</Karte>
			</div>

			<div class="af-k k-todos">
				<Karte>
					{#snippet titel()}To-dos{/snippet}
					{#if form?.todoFehler && !form?.todoWerte}
						<p role="alert" class="kd-fehler">{form.fehler}</p>
					{/if}
					{#if data.darfBearbeiten}
						<AddPanel label="To-do hinzufügen" offen={!!form?.todoWerte}>
							{#snippet children(schliessen)}
								<TodoNeu
									mitBelastung
									aktion="?/todoAnlegen"
									mitarbeiter={data.mitarbeiter}
									fehler={form?.todoWerte ? form.fehler : null}
									werte={form?.todoWerte ?? {}}
									onfertig={schliessen}
									onabbrechen={schliessen}
								/>
							{/snippet}
						</AddPanel>
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
			</div>

			<div class="af-k k-termine">
				<Karte>
					{#snippet titel()}Termine{/snippet}
					{#if data.darfTermine}
						<AddPanel label="Termin hinzufügen" offen={!!form?.terminFehler}>
							{#snippet children(schliessen)}
								<form method="POST" action="?/terminAnlegen" use:enhance class="kd-formular af-termin-form">
									{#if form?.terminFehler}<p role="alert" class="kd-fehler">{form.terminFehler}</p>{/if}
									<div class="kd-zwei">
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
									</div>
									<div class="af-drei">
										<label>Tag <input type="date" name="tag" required value={data.heute} /></label>
										<label>von <input type="time" name="von" required value="08:00" /></label>
										<label>bis <input type="time" name="bis" required value="12:00" /></label>
									</div>
									<label>Notiz (optional) <input type="text" name="notiz" maxlength="500" /></label>
									<div class="af-fuss">
										<button type="button" class="knopf-ghost" onclick={schliessen}>Abbrechen</button>
										<button type="submit" class="kd-knopf">Termin speichern</button>
									</div>
								</form>
							{/snippet}
						</AddPanel>
					{/if}
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
				</Karte>
			</div>

			{#if data.protokolle}
				<div class="af-k k-protokolle">
					<Karte>
						{#snippet titel()}Protokolle{/snippet}
						{#snippet aktionen()}
							{#if data.darfProtokollStarten && data.protokollVorlagen.length > 0}
								<form method="POST" action="?/protokollStarten" use:enhance class="af-protokoll-start">
									<select name="vorlageId" aria-label="Protokoll-Vorlage" required data-testid="protokoll-vorlage">
										{#each data.protokollVorlagen as v (v.id)}<option value={v.id}>{v.name}</option>{/each}
									</select>
									<button type="submit" class="kd-knopf" data-testid="protokoll-starten">Protokoll starten</button>
								</form>
							{/if}
						{/snippet}
						{#if form?.protokollFehler}<p role="alert" class="kd-fehler">{form.protokollFehler}</p>{/if}
						<ul class="kd-liste">
							{#each data.protokolle as pr (pr.id)}
								<li>
									<a href={`/protokolle/${pr.id}`}>
										<span class="af-kopfzeile">
											<strong>{pr.titel}</strong>
											<span class={`badge ${pr.status === 'abgeschlossen' ? 'badge-gruen' : 'badge-gelb'}`}>{pr.status === 'abgeschlossen' ? 'Abgeschlossen' : 'Entwurf'}</span>
										</span>
										<span class="kd-info">
											{pr.status === 'abgeschlossen' && pr.abgeschlossen
												? `${tagDeutsch(berlinTag(new Date(pr.abgeschlossen)))} · ${pr.abgeschlossenVonName ?? ''}${pr.unterschriebenVon ? ` · unterschrieben von ${pr.unterschriebenVon}` : ''}`
												: `begonnen ${tagDeutsch(berlinTag(new Date(pr.angelegt)))}${pr.vonName ? ` von ${pr.vonName}` : ''}`}
										</span>
									</a>
								</li>
							{:else}
								<li class="kd-leer">
									{data.darfProtokollStarten && data.protokollVorlagen.length === 0
										? 'Noch keine Protokoll-Vorlage – unter Einstellungen → Protokoll-Vorlagen anlegen.'
										: 'Noch kein Protokoll.'}
								</li>
							{/each}
						</ul>
					</Karte>
				</div>
			{/if}

			<div class="af-k k-verlauf">
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
			</div>

			{#if data.darfBearbeiten && a.status === 'anfrage'}
				<div class="af-k k-loeschen">
					<details class="kd-loeschen">
						<summary>Auftrag löschen …</summary>
						<form method="POST" action="?/loeschen" use:enhance class="kd-formular">
							<p>Die Anfrage und ihre To-dos werden endgültig gelöscht. Das lässt sich nicht rückgängig machen.</p>
							<button type="submit" class="knopf-gefahr">Endgültig löschen</button>
						</form>
					</details>
				</div>
			{/if}
		</div>

		<aside class="af-seitenleiste" aria-label="Auftrag im Überblick">
			<div class="af-k k-ort">
				<Karte>
					{#snippet titel()}Einsatzort{/snippet}
					<div class="af-objekt">
						{#if data.darfBearbeiten && a.kundeArt === 'kunde'}
							<form method="POST" action="?/aendern" use:enhance={sofort} class="af-inline">
								<label class="af-feld">
									Objekt
									<select name="objektId" aria-label="Objekt" onchange={(ev) => ev.currentTarget.form?.requestSubmit()}>
										<option value="" selected={!a.objektId}>Kundenadresse (Standard)</option>
										{#each data.objekte as o (o.id)}
											<option value={o.id} selected={o.id === a.objektId}>{o.bezeichnung}{o.adresse ? ` – ${o.adresse}` : ''}</option>
										{/each}
									</select>
								</label>
							</form>
							<span class="af-adresse">{a.adresse ?? 'Keine Adresse hinterlegt'}</span>
							{#if a.objektId && data.kundeLesbar}
								<a href={`/kunden/${a.kundeId}/objekte/${a.objektId}`}>Objekt öffnen</a>
							{/if}
						{:else if a.objektId && a.kundeId}
							{#if data.kundeLesbar}
								<a href={`/kunden/${a.kundeId}/objekte/${a.objektId}`}><strong>{a.objektBezeichnung}</strong></a>
							{:else}<strong>{a.objektBezeichnung}</strong>{/if}
							<span class="af-adresse">{a.adresse ?? 'Keine Adresse hinterlegt'}</span>
						{:else}
							<span class="af-adresse">
								{a.adresse ?? 'Keine Adresse hinterlegt'}
								<span class="kd-info">{a.kundeArt === 'einmal' ? '(Einmal-Kunde)' : a.kundeArt === 'kunde' ? '(Kundenadresse)' : ''}</span>
							</span>
						{/if}
						{#if navigationsLink(a.adresse) || telefonLink(a.telefon)}
							<div class="af-vorort">
								{#if navigationsLink(a.adresse)}
									<a class="kd-knopf" href={navigationsLink(a.adresse)} target="_blank" rel="noopener">
										<svg class="af-symbol" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z" /></svg>
										Navigieren
									</a>
								{/if}
								{#if telefonLink(a.telefon)}
									<a class="kd-knopf hell" href={telefonLink(a.telefon)}>
										<svg class="af-symbol" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1Z" /></svg>
										Anrufen
									</a>
								{/if}
							</div>
						{/if}
						{#if a.anlageId || (data.darfBearbeiten && data.anlagen.length > 0)}
							<div class="af-anlage">
								{#if data.darfBearbeiten && data.anlagen.length > 0}
									<form method="POST" action="?/aendern" use:enhance={sofort} class="af-inline">
										<label class="af-feld">
											Anlage
											<select name="anlageId" aria-label="Anlage" onchange={(ev) => ev.currentTarget.form?.requestSubmit()}>
												<option value="" selected={!a.anlageId}>– keine Anlage –</option>
												{#each data.anlagen as an (an.id)}
													<option value={an.id} selected={an.id === a.anlageId}>{an.bezeichnung} ({an.typName})</option>
												{/each}
											</select>
										</label>
									</form>
								{:else}
									<span class="af-feld">Anlage <strong>{a.anlageBezeichnung}</strong></span>
								{/if}
								{#if a.anlageId && data.kundeLesbar}
									<a href={`/anlagen/${a.anlageId}`}>Anlage öffnen (Verlauf, QR)</a>
								{/if}
							</div>
						{/if}
					</div>
				</Karte>
			</div>

			<div class="af-k k-mitarbeiter">
				<Karte>
					{#snippet titel()}Mitarbeiter{/snippet}
					<ul class="af-chips" aria-label="Zuständige Mitarbeiter">
						{#each a.zustaendige as z (z.id)}
							<li class="af-chip"><Avatar name={z.name} groesse={26} />{z.name}</li>
						{:else}
							<li class="kd-info">Noch keine Mitarbeiter zugewiesen.</li>
						{/each}
					</ul>
					{#if data.darfBearbeiten}
						<details class="af-zuweisen" bind:open={zuweisenOffen}>
							<summary class="kd-knopf hell">Mitarbeiter zuweisen</summary>
							<form method="POST" action="?/aendern" use:enhance={sofort} class="af-zuweisen-liste">
								<input type="hidden" name="zustaendigeGesendet" value="1" />
								<p class="kd-info">Mehrere möglich – jedes Häkchen wird sofort gespeichert.</p>
								{#each data.mitarbeiter as m (m.id)}
									<label class="af-haken-zeile">
										<input
											type="checkbox"
											name="zustaendige"
											value={m.id}
											checked={a.zustaendige.some((z) => z.id === m.id)}
											onchange={(ev) => ev.currentTarget.form?.requestSubmit()}
										/>
										<Avatar name={m.name} groesse={24} />
										{m.name}
									</label>
								{/each}
								<button type="button" class="kd-knopf hell af-fertig" onclick={() => (zuweisenOffen = false)}>Fertig</button>
							</form>
							{#if data.kolonnen.length > 0}
								<form method="POST" action="?/kolonneZuweisen" use:enhance={sofort} class="af-kolonne">
									<label>
										Kolonne zuweisen
										<select name="kolonneId" required>
											{#each data.kolonnen as ko (ko.id)}<option value={ko.id}>{ko.name} ({ko.mitglieder.map((m) => m.name.split(' ')[0]).join(', ')})</option>{/each}
										</select>
									</label>
									<button type="submit" class="kd-knopf hell">Zuweisen</button>
								</form>
							{/if}
						</details>
					{/if}
				</Karte>
			</div>

			{#if data.angebote}
				<div class="af-k k-angebote">
					<Karte>
						{#snippet titel()}Angebote{/snippet}
						<ul class="kd-liste af-angebote">
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
						{#if wegeAngebot.length > 0}
							<AddPanel label="Angebot hinzufügen" offen={!!form?.kiStichworte}>
								{#snippet children()}
									<div class="af-wege" role="group" aria-label="Wie anlegen?">
										{#each wegeAngebot as [wert, text] (wert)}
											<button type="button" class="pill" class:aktiv={angebotWeg === wert} aria-pressed={angebotWeg === wert} onclick={() => (angebotWeg = wert)}>{text}</button>
										{/each}
									</div>
									{#if angebotWeg === 'neu' || angebotWeg === 'vorlage'}
										<form method="POST" action="?/angebotErstellen" use:enhance class="kd-formular">
											{#if angebotWeg === 'vorlage'}
												<label>
													Angebots-Vorlage
													<select name="vorlageId" required>
														<option value="">– bitte wählen –</option>
														{#each data.angebotVorlagen as v (v.id)}
															<option value={v.id}>Vorlage: {v.name}</option>
														{/each}
													</select>
												</label>
											{:else}
												<p class="kd-info">Leeres Angebot zu diesem Auftrag; Positionen fügen Sie im Angebot hinzu.</p>
											{/if}
											<div class="af-fuss"><button type="submit" class="kd-knopf">Angebot erstellen</button></div>
										</form>
									{:else if angebotWeg === 'zuordnen'}
										<form method="POST" action="?/angebotZuordnen" use:enhance class="kd-formular">
											<label>
												Bestehendes Angebot zuordnen
												<select name="angebotId" required>
													<option value="">– bitte wählen –</option>
													{#each data.zuordenbareAngebote as z (z.id)}
														<option value={z.id}>{z.nummer} · {z.kundeName} · {tagDeutsch(z.datum)} · {euro(z.bruttoCent)}</option>
													{/each}
												</select>
											</label>
											<div class="af-fuss"><button type="submit" class="kd-knopf">Zuordnen</button></div>
										</form>
									{:else if angebotWeg === 'ki'}
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
											<div class="af-fuss">
												<button type="submit" class="kd-knopf" disabled={kiLaeuft}>{kiLaeuft ? 'KI arbeitet …' : 'Entwurf erstellen'}</button>
											</div>
										</form>
									{/if}
								{/snippet}
							</AddPanel>
						{/if}
					</Karte>
				</div>
			{/if}

			<div class="af-k k-doku">
				<Karte>
					{#snippet titel()}Dokumente &amp; Protokolle{/snippet}
					<p class="kd-info af-doku-text">Fotos, Notizen und Baustellen-Protokolle (mit Unterschrift) zu diesem Auftrag.</p>
					<a href={`/auftraege/${a.id}/dokumentation`} class="kd-knopf hell">Dokumentation öffnen</a>
				</Karte>
			</div>
		</aside>
	</div>
	{#if gespeichert}<p class="af-gespeichert" role="status">Gespeichert</p>{/if}
</main>

<style>
	.af-protokoll-start {
		display: flex;
		flex-wrap: wrap;
		gap: var(--ui-a2);
	}
	.af-protokoll-start select {
		width: auto;
		max-width: 16rem;
	}
	/* Kopf über die ganze Breite, darunter ab 1200 px zwei Spalten */
	.af-seite {
		max-width: 96rem;
	}
	.af-raster {
		display: flex;
		flex-direction: column;
		gap: 0;
		margin-top: 1rem;
	}
	.af-haupt,
	.af-seitenleiste {
		display: contents;
	}
	/* Schmal: Ort und Mitarbeiter früh (Monteur unterwegs), dann Arbeit */
	.k-stamm { order: 1; }
	.k-ort { order: 2; }
	.k-mitarbeiter { order: 3; }
	.k-todos { order: 4; }
	.k-termine { order: 5; }
	.k-protokolle { order: 5; }
	.k-angebote { order: 6; }
	.k-doku { order: 7; }
	.k-verlauf { order: 8; }
	.k-loeschen { order: 9; }
	@media (min-width: 1200px) {
		.af-raster {
			display: grid;
			grid-template-columns: minmax(0, 1fr) minmax(20rem, 24rem);
			align-items: start;
			gap: 1rem;
		}
		.af-haupt,
		.af-seitenleiste {
			display: block;
			min-width: 0;
		}
	}
	.af-stamm {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		gap: 0.75rem 1.5rem;
		margin: 0;
	}
	.af-stamm :global(dt) {
		margin-top: 0;
	}
	.af-breit {
		grid-column: 1 / -1;
	}
	.af-inline select,
	.af-inline textarea {
		width: 100%;
	}
	.af-feld {
		display: grid;
		gap: 0.3rem;
		color: var(--ui-text-leise);
		font-size: var(--ui-schrift-s);
		font-weight: 500;
	}
	.af-objekt {
		display: grid;
		gap: 0.6rem;
		justify-items: stretch;
	}
	.af-objekt > a,
	.af-anlage > a {
		justify-self: start;
		font-size: var(--ui-schrift-m);
	}
	.af-adresse {
		font-weight: 500;
	}
	.af-anlage {
		display: grid;
		gap: 0.4rem;
		padding-top: 0.6rem;
		border-top: 1px solid var(--ui-rand);
	}
	.af-vorort {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
	}
	.af-symbol {
		width: 1.1rem;
		height: 1.1rem;
		fill: currentColor;
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
		background: var(--ui-gruen);
		color: #fff;
		box-shadow: var(--ui-schatten-hoch);
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
		padding: 0.2rem 0.75rem 0.2rem 0.2rem;
		border: 1px solid var(--ui-rand);
		border-radius: 999px;
		background: var(--ui-flaeche);
		font-size: var(--ui-schrift-m);
		font-weight: 500;
	}
	.af-zuweisen > summary {
		list-style: none;
		display: inline-flex;
		align-items: center;
		cursor: pointer;
	}
	.af-zuweisen > summary::-webkit-details-marker {
		display: none;
	}
	.af-kolonne {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}
	.af-kolonne label {
		display: grid;
		gap: 0.25rem;
		font-size: 0.875rem;
		font-weight: 600;
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
		font-size: var(--ui-schrift-m);
	}
	.af-fertig {
		justify-self: start;
		margin-top: 0.5rem;
	}
	:global(.kd-unsichtbar) {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}
	.af-hinweise {
		margin: 1rem 0 0;
		padding: 0.75rem 1rem;
		border-left: 4px solid var(--ui-orange);
		border-radius: var(--ui-radius);
		background: var(--ui-orange-hell);
	}
	.af-hinweise ul {
		margin: 0.25rem 0 0;
		padding-left: 1.1rem;
	}
	.af-art {
		display: inline-block;
		margin-right: 0.35rem;
		padding: 0.05rem 0.5rem;
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 600;
		background: var(--ui-grau-hell);
	}
	.art-besichtigung {
		background: var(--ui-blau-hell);
		color: #1e4fb3;
	}
	.art-wartung {
		background: var(--ui-gruen-hell);
		color: #166b45;
	}
	.af-drei {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
		gap: 0.75rem;
	}
	.af-fuss {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}
	.af-wege {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-bottom: 0.75rem;
	}
	.af-angebote {
		margin-top: 0;
	}
	.af-doku-text {
		margin: 0 0 0.75rem;
	}
	.ki-zustimmung {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
		font-weight: 400;
	}
</style>
