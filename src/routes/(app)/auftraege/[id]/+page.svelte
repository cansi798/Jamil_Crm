<script lang="ts">
	import { rueckfrage } from '$lib/rueckfrage';
	import PersonWahl from '$lib/components/ui/PersonWahl.svelte';
	import Auswahl from '$lib/components/ui/Auswahl.svelte';
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import Karte from '$lib/components/Karte.svelte';
	import ScrollBereich from '$lib/components/ui/ScrollBereich.svelte';
	import InfoFenster from '$lib/components/ui/InfoFenster.svelte';
	import BelegListe, { type BelegZeile } from '$lib/components/ausgangsbelege/BelegListe.svelte';
	import StatusKette from '$lib/components/StatusKette.svelte';
	import { untergruppe } from '$lib/auftrag-board';
	import AuftragHinweise from '$lib/components/AuftragHinweise.svelte';
	import TodoListe from '$lib/components/TodoListe.svelte';
	import TodoNeu from '$lib/components/TodoNeu.svelte';
	import AddPanel from '$lib/components/AddPanel.svelte';
	import VorlageAnwenden from '$lib/components/VorlageAnwenden.svelte';
	import AuftragLinks from '$lib/components/AuftragLinks.svelte';
	import AuftragUnterlagen from '$lib/components/AuftragUnterlagen.svelte';
	import { anzeigeDateiname } from '$lib/dateiname';
	import MailAnKunde from '$lib/components/MailAnKunde.svelte';
	import AuftragPartner from '$lib/components/AuftragPartner.svelte';
	import QuelleChip from '$lib/components/ui/QuelleChip.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import LoeschenKnopf from '$lib/components/ui/LoeschenKnopf.svelte';
	import LoeschenPanel from '$lib/components/ui/LoeschenPanel.svelte';
	import { ANGEBOT_STATUS_NAMEN } from '$lib/angebot-status';
	import { euro } from '$lib/geld';
	import { berlinTag, berlinUhrzeit, tagDeutsch, tagKurz } from '$lib/zeit';
	import { EINSATZ_ARTEN, EINSATZ_ART_NAMEN } from '$lib/einsatz-art';
	import { navigationsLink, telefonLink } from '$lib/kontakt-links';
	import ZeitKnoepfe from '$lib/components/zeit/ZeitKnoepfe.svelte';
	import NachkalkulationKarte from '$lib/components/zeit/Nachkalkulation.svelte';
	import { stundenText } from '$lib/zeiterfassung';
	import { mengeText } from '$lib/geld';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const a = $derived(data.auftrag);
	let kiLaeuft = $state(false);

	// Eingeklappt bis gebraucht (Wunsch Jamil, msg 2579): „Mitarbeiter zuweisen“ bleibt offen, solange man Häkchen
	// setzt, und schließt mit „Fertig“; Aufgabe, Termin und Angebot über das gemeinsame AddPanel (zu nach Speichern).
	let zuweisenOffen = $state(false);

	// Portal-Link des Kunden kopieren (msg 3050)
	let portalKopiert = $state(false);
	async function kopierePortal(adresse: string) {
		try {
			await navigator.clipboard.writeText(adresse);
			portalKopiert = true;
			setTimeout(() => (portalKopiert = false), 2500);
		} catch {
			window.prompt('Link kopieren:', adresse);
		}
	}

	// „Angebot hinzufügen“: ein Feld mit vier Wegen statt verstreuter Auswahlen und Knöpfe
	type Weg = 'neu' | 'vorlage' | 'ki' | 'zuordnen';
	// Ausgangsbelege des Auftrags (Jamil msg 3525): Angebote und Auftragsbestätigungen in EINER Liste, neueste zuerst
	const belege = $derived.by((): BelegZeile[] => {
		const l: (BelegZeile & { sort: string })[] = [];
		for (const an of data.angebote ?? []) {
			l.push({
				id: `an-${an.id}`,
				typ: 'angebot',
				href: data.darfAngebote ? `/angebote/${an.id}` : null,
				nummer: an.nummer,
				datum: tagDeutsch(an.datum),
				status: { text: ANGEBOT_STATUS_NAMEN[an.status], klasse: `s-${an.status}` },
				betrag: an.bruttoCent !== undefined ? euro(an.bruttoCent) : null,
				sort: an.datum
			});
		}
		for (const ab of data.auftragsbestaetigungen) {
			l.push({
				id: `ab-${ab.id}`,
				typ: 'ab',
				href: `/api/auftragsbestaetigungen/${ab.id}/pdf`,
				neuerTab: true,
				nummer: ab.nummer,
				datum: tagDeutsch(berlinTag(new Date(ab.angelegt))),
				zusatz: ab.versendetAm ? `versendet ${tagDeutsch(berlinTag(new Date(ab.versendetAm)))}` : null,
				status: { text: ab.versandStatus === 'gesendet' ? 'Versendet' : 'Bereit zum Versand', klasse: `s-${ab.versandStatus === 'gesendet' ? 'angenommen' : 'versendet'}` },
				sort: berlinTag(new Date(ab.angelegt))
			});
		}
		return l.sort((x, y) => (x.sort < y.sort ? 1 : x.sort > y.sort ? -1 : 0)).map(({ sort: _s, ...z }) => z);
	});
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
	// Beschreibung kompakt (msg 2846): zwei Zeilen, „Mehr anzeigen“, Klick auf „Bearbeiten“ öffnet das Feld
	let beschreibungBearbeiten = $state(false);
	let beschreibungGanz = $state(false);
	const sofort = () => async ({ result, update }: { result: { type: string }; update: (o?: { reset?: boolean; invalidateAll?: boolean }) => Promise<void> }) => {
		await update({ reset: false });
		if (result.type === 'success') {
			gespeichert = true;
			clearTimeout(gespeichertZeit);
			gespeichertZeit = setTimeout(() => (gespeichert = false), 2500);
		}
	};
	/** Jamil msg 3043: „Auftrag löschen“ (nur Anfragen) oben rechts, Rückfrage unter dem Kopf. */
	let loeschenOffen = $state(false);
	const darfLoeschen = $derived(data.darfBearbeiten && a.status === 'anfrage');
	// robust gegen den Rückgabetyp der Aktionen (nicht jede Aktion liefert loeschFehler)
	const loeschFehler = $derived(form && 'loeschFehler' in form && form.loeschFehler ? ((form as { fehler?: string }).fehler ?? null) : null);
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
			<div class="af-kopf-chips">
				<!-- Auftragsquelle als Chip, Klick ändert sie sofort (Jamil msg 2844) -->
				<QuelleChip quellen={data.quellen} wert={a.quelleId} name={a.quelleName} farbe={a.quelleFarbe} darf={data.darfBearbeiten && data.quellen.length > 0} absenden={sofort} />
				<AuftragHinweise angebotInfo={a.angebotInfo} nachfassenInfo={a.nachfassenInfo} />
				<!-- Kundenportal dezent im Kopf (Jamil msg 3561): nur wenn der Auftrag dort sichtbar ist; Erklärung im Tooltip/ⓘ -->
				{#if data.portal?.imPortal}
					<span class="af-portal-chip" data-testid="portal-status-auftrag">
						{#if data.kundeEinstellbar && data.portal.kundeId}
							<a class="ah-chip gut" href={`/kunden/${data.portal.kundeId}#portal-einstellung`} title={`Im Kundenportal des Kunden sichtbar${data.portal.kundeHatLink ? '' : ' – der Kunde hat noch keinen Link'}. Einstellungen beim Kunden.`}><span aria-hidden="true">✓</span> Im Portal sichtbar{#if !data.portal.kundeHatLink}<span class="af-portal-ohne"> · noch kein Link</span>{/if}</a>
						{:else}
							<span class="ah-chip gut" title="Im Kundenportal des Kunden sichtbar"><span aria-hidden="true">✓</span> Im Portal sichtbar</span>
						{/if}
						<InfoFenster id="auftrag.portal" />
					</span>
				{/if}
			</div>
		</div>
		<div class="seiten-aktionen">
			{#if data.darfBearbeiten}
				<a href={`/auftraege/${a.id}/bearbeiten`} class="kd-knopf hell">Auftrag bearbeiten</a>
			{/if}
			{#if darfLoeschen}
				<LoeschenKnopf ding="Auftrag" bind:offen={loeschenOffen} />
			{/if}
			<!-- „Dokumentation“ oben entfernt (Jamil msg 3566): erreichbar über „Dokumente & Notizen“ → „Dokumentation öffnen“ -->
		</div>
	</header>
	{#if darfLoeschen}
		<LoeschenPanel ding="Auftrag" bind:offen={loeschenOffen} fehler={loeschFehler}>
			Die Anfrage und ihre Aufgaben werden endgültig gelöscht. Das lässt sich nicht rückgängig machen.
		</LoeschenPanel>
	{/if}
	<StatusKette status={a.status} darfBearbeiten={data.darfBearbeiten} untergruppe={untergruppe(a)} uebersprungen={a.quelleUebersprungen} />

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

	{#if form?.fehler && !loeschFehler && !form?.todoFehler && !form?.terminFehler && !form?.aendernFehler && !form?.protokollFehler && !form?.materialFehler}
		<p role="alert" class="kd-fehler">{form.fehler}</p>
	{/if}

	<!-- Ab 1200 px zwei Spalten (Wunsch Jamil msg 2495: ganze Arbeitsfläche): links Arbeit, rechts Kontext.
	     Schmal eine Spalte; die Reihenfolge der Karten steuert dann `order` (Ort und Mitarbeiter früh). -->
	<div class="af-raster">
		<div class="af-haupt">
			<!-- Beschreibung kompakt oben links (Jamil msg 2846): zwei Zeilen, Klick zum Bearbeiten -->
			<div class="af-k k-beschreibung">
				<div class="af-beschreibung" class:leer={!a.beschreibung}>
					{#if data.darfBearbeiten && beschreibungBearbeiten}
						<form method="POST" action="?/aendern" use:enhance={sofort} class="af-inline">
							<!-- svelte-ignore a11y_autofocus -->
							<textarea
								name="beschreibung"
								aria-label="Beschreibung"
								maxlength="4000"
								rows="4"
								autofocus
								placeholder="Infos zum Auftrag …"
								onkeydown={(ev) => {
									if (ev.key === 'Escape') beschreibungBearbeiten = false;
								}}
								onblur={(ev) => {
									beschreibungBearbeiten = false;
									if (ev.currentTarget.value !== (a.beschreibung ?? '')) ev.currentTarget.form?.requestSubmit();
								}}>{a.beschreibung ?? ''}</textarea
							>
						</form>
					{:else if a.beschreibung}
						<p class="af-beschreibung-text" class:offen={beschreibungGanz}>{a.beschreibung}</p>
						<div class="af-beschreibung-knoepfe">
							{#if a.beschreibung.length > 140 || a.beschreibung.includes('\n')}
								<button type="button" class="knopf-ghost klein" onclick={() => (beschreibungGanz = !beschreibungGanz)}>{beschreibungGanz ? 'Weniger' : 'Mehr anzeigen'}</button>
							{/if}
							{#if data.darfBearbeiten}<button type="button" class="knopf-ghost klein" aria-label="Beschreibung bearbeiten" onclick={() => (beschreibungBearbeiten = true)}>Bearbeiten</button>{/if}
						</div>
					{:else if data.darfBearbeiten}
						<button type="button" class="knopf-ghost" onclick={() => (beschreibungBearbeiten = true)}>+ Beschreibung</button>
					{:else}
						<p class="kd-info af-beschreibung-text">Keine Beschreibung.</p>
					{/if}
					{#if form?.aendernFehler}<p role="alert" class="kd-fehler">{form.aendernFehler}</p>{/if}
				</div>
			</div>
			{#if data.zeit}
				<div class="af-k k-zeit" id="zeiterfassung">
					<Karte>
						{#snippet titel()}Zeiterfassung{/snippet}
						<ZeitKnoepfe auftragId={a.id} titel={`${a.nummer} ${a.titel}`} laufend={data.zeit.laufend} />
						<p class="af-zeit-summe">
							Heute ich: <strong>{stundenText(data.zeit.summe.heuteIch.arbeitMin)}</strong>
							{#if data.zeit.verwalten}
								· Auftrag gesamt: <strong>{stundenText(data.zeit.summe.gesamt.arbeitMin)}</strong> Arbeit, {stundenText(data.zeit.summe.gesamt.fahrtMin)} Fahrt, {String(data.zeit.summe.gesamt.km).replace('.', ',')} km
							{/if}
							· <a href={`/zeiten?auftrag=${a.id}`}>Zeiten ansehen</a>
						</p>
						{#if data.zeit.verwalten && data.zeit.summe.personen.length > 1}
							<ul class="af-zeit-personen">
								{#each data.zeit.summe.personen as p (p.benutzerId)}<li>{p.name}: {stundenText(p.arbeitMin)}</li>{/each}
							</ul>
						{/if}
					</Karte>
				</div>
			{/if}
			{#each data.buchungen as bu (bu.id)}
				<div class="af-k k-buchung">
					<Karte>
						{#snippet titel()}Online-Buchung{/snippet}
						<div class="af-buchung" data-testid="online-buchung">
							<p>
								<strong>{bu.dienstName}</strong> · {tagKurz(berlinTag(new Date(bu.beginn)))} {berlinUhrzeit(new Date(bu.beginn))}–{berlinUhrzeit(new Date(bu.ende))}
								· {bu.mitarbeiterName}
								{#if bu.status === 'storniert'}<span class="badge badge-rot">vom Kunden abgesagt</span>{/if}
							</p>
							<dl class="kd-daten">
								<div><dt>Gebucht von</dt><dd>{bu.kontakt.name}</dd></div>
								{#if bu.kontakt.telefon}<div><dt>Telefon</dt><dd><a href={`tel:${bu.kontakt.telefon.replace(/[^0-9+]/g, '')}`}>{bu.kontakt.telefon}</a></dd></div>{/if}
								{#if bu.kontakt.email}<div><dt>E-Mail</dt><dd><a href={`mailto:${bu.kontakt.email}`}>{bu.kontakt.email}</a></dd></div>{/if}
								{#if bu.kontakt.adresse}<div><dt>Adresse</dt><dd>{bu.kontakt.adresse}</dd></div>{/if}
								{#each bu.antworten as an (an.id)}
									<div>
										<dt>{an.label}</dt>
										<dd class="af-antwort">
											{#if an.fotos.length > 0}
												<span class="af-buchung-fotos">
													{#each an.fotos as f, i (f)}<a href={`/api/dateien/${f}`} target="_blank" rel="noopener"><img src={`/api/dateien/${f}`} alt={`${an.label} – Foto ${i + 1}`} loading="lazy" /></a>{/each}
												</span>
											{:else}{an.text}{/if}
										</dd>
									</div>
								{/each}
							</dl>
						</div>
					</Karte>
				</div>
			{/each}
			<div class="af-k k-todos">
				<Karte>
					{#snippet titel()}Aufgaben{/snippet}
					{#if form?.todoFehler && !form?.todoWerte}
						<p role="alert" class="kd-fehler">{form.fehler}</p>
					{/if}
					{#if form?.vorlageErgebnis}
						<p class="kd-info" role="status">
							Vorlage „{form.vorlageErgebnis.name}“ übernommen: {form.vorlageErgebnis.angelegt}
							{form.vorlageErgebnis.angelegt === 1 ? 'Aufgabe' : 'Aufgaben'} hinzugefügt{form.vorlageErgebnis.uebersprungen.length > 0
								? `, ${form.vorlageErgebnis.uebersprungen.length} schon vorhanden (übersprungen)`
								: ''}.
						</p>
					{/if}
					{#if data.darfBearbeiten}
						<div class="todo-hinzu">
							<AddPanel label="Aufgabe hinzufügen" offen={!!form?.todoWerte}>
								{#snippet children(schliessen)}
									<TodoNeu
										mitBelastung
										aktion="?/todoAnlegen"
										mitarbeiter={data.mitarbeiter}
										amAuftrag={a.zustaendige}
										standardZustaendig={data.benutzerId}
										fehler={form?.todoWerte ? form.fehler : null}
										werte={form?.todoWerte ?? {}}
										onfertig={schliessen}
										onabbrechen={schliessen}
									/>
								{/snippet}
							</AddPanel>
							{#if data.aufgabenVorlagen.length > 0}
								<AddPanel label="Aufgaben aus Vorlage" offen={!!form?.vorlageFehler}>
									{#snippet children(schliessen)}
										<VorlageAnwenden
											vorlagen={data.aufgabenVorlagen}
											vorhandeneTitel={data.todos.map((t) => t.titel)}
											mitarbeiter={data.mitarbeiter}
											amAuftrag={a.zustaendige}
											fehler={form?.vorlageFehler ? form.fehler : null}
											onfertig={schliessen}
											onabbrechen={schliessen}
										/>
									{/snippet}
								</AddPanel>
							{/if}
						</div>
					{/if}
					<TodoListe
						todos={data.todos}
						heute={data.heute}
						benutzerId={data.benutzerId}
						darfBearbeiten={data.darfBearbeiten}
						mitarbeiter={data.mitarbeiter}
						amAuftrag={a.zustaendige}
						aktionen={{ umschalten: '?/todoUmschalten', aendern: '?/todoAendern', loeschen: '?/todoLoeschen', serieBeenden: '?/todoSerieBeenden', unterNeu: '?/todoUnterNeu', unterUmschalten: '?/todoUnterUmschalten', unterLoeschen: '?/todoUnterLoeschen' }}
						leer="Noch keine Aufgaben zu diesem Auftrag."
					/>
				</Karte>
			</div>

			<div class="af-k k-termine">
				<Karte>
					{#snippet titel()}Termine{/snippet}
					<!-- „geplant ab“ stand in der entfernten Karte „Nächster Termin“ (Jamil msg 3564) -->
					{#if !a.kommenderTermin && a.geplantAb}<p class="kd-info">Geplant ab {tagDeutsch(a.geplantAb)} – noch kein Termin.</p>{/if}
					{#if data.darfTermine}
						<AddPanel label="Termin hinzufügen" offen={!!form?.terminFehler}>
							{#snippet children(schliessen)}
								<form method="POST" action="?/terminAnlegen" use:enhance class="kd-formular af-termin-form">
									{#if form?.terminFehler}<p role="alert" class="kd-fehler">{form.terminFehler}</p>{/if}
									<div class="kd-zwei">
										<label>
											Art
											<Auswahl name="art" required>
												{#each EINSATZ_ARTEN as art (art)}<option value={art} selected={art === 'montage'}>{EINSATZ_ART_NAMEN[art]}</option>{/each}
											</Auswahl>
										</label>
										<div class="ui-feld">
											Mitarbeiter
											<PersonWahl name="benutzerId" label="Mitarbeiter" leerText="Mitarbeiter wählen" required personen={data.mitarbeiter} />
										</div>
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

			{#if data.material}
				<div class="af-k k-material" id="material">
					<Karte>
						{#snippet titel()}Material{/snippet}
						{#snippet aktionen()}
							{#if data.material && data.material.offenePlan > 0}
								<form method="POST" action="?/materialWieGeplant" use:enhance>
									<button type="submit" class="kd-knopf">✓ Wie geplant</button>
								</form>
							{/if}
						{/snippet}
						{#if form?.materialFehler}<p role="alert" class="kd-fehler">{form.materialFehler}</p>{/if}
						{#if form?.materialMeldung}<p role="status" class="kd-info">{form.materialMeldung}</p>{/if}
						{#if data.material.ohneAngebot}
							<p class="kd-info">Geplantes Material kommt aus dem angenommenen Angebot – hier gibt es noch keins. Verbrauchtes Material kann trotzdem eingetragen werden.</p>
						{/if}
						{#if data.material.zeilen.length > 0}
							<ul class="af-material">
								{#each data.material.zeilen as m (m.id ?? m.positionId)}
									<li class:offen={m.positionId && m.id === null}>
										<span class="af-mat-name">{m.bezeichnung}{#if m.quelle === 'lieferschein'} <small>(Lieferschein)</small>{/if}
											{#if m.mengePlan !== null}<small>geplant {mengeText(m.mengePlan)} {m.einheit}</small>{/if}
										</span>
										<form method="POST" action="?/materialMenge" use:enhance={() => async ({ update }) => update({ reset: false })} class="af-mat-form">
											{#if m.id}<input type="hidden" name="id" value={m.id} />{:else}<input type="hidden" name="positionId" value={m.positionId} />{/if}
											<label class="af-mat-menge">
												<span class="unsichtbar">Verbraucht ({m.einheit})</span>
												<input name="menge" inputmode="decimal" value={m.menge === null ? '' : mengeText(m.menge)} placeholder={m.mengePlan === null ? '' : mengeText(m.mengePlan)} aria-label={`Verbraucht: ${m.bezeichnung} in ${m.einheit}`} />
												<span>{m.einheit}</span>
											</label>
											<button type="submit" class="kd-knopf hell">{m.id ? 'Ändern' : 'Bestätigen'}</button>
										</form>
										{#if m.id && !m.positionId}
											<form method="POST" action="?/materialLoeschen" use:enhance>
												<input type="hidden" name="id" value={m.id} />
												<button type="submit" class="knopf-subtil" aria-label={`${m.bezeichnung} entfernen`} use:rueckfrage={{ frage: `„${m.bezeichnung}“ wirklich entfernen?`, ja: 'Entfernen' }}>✕</button>
											</form>
										{/if}
									</li>
								{/each}
							</ul>
						{/if}
						<AddPanel label="Material hinzufügen">
							{#snippet children(schliessen)}
								<form method="POST" action="?/materialNeu" use:enhance class="af-mat-neu">
									<label>Bezeichnung <input name="bezeichnung" required maxlength="200" /></label>
									<label>Menge <input name="menge" inputmode="decimal" required /></label>
									<label>Einheit <input name="einheit" value="Stk" maxlength="20" /></label>
									{#if data.preiseSehen}<label>Einkauf je Einheit (€) <input name="preis" inputmode="decimal" /></label>{/if}
									<div class="af-mat-knoepfe">
										<button type="button" class="kd-knopf hell" onclick={schliessen}>Abbrechen</button>
										<button type="submit" class="kd-knopf">Speichern</button>
									</div>
								</form>
							{/snippet}
						</AddPanel>
						<AddPanel label="Lieferschein fotografieren">
							{#snippet children(schliessen)}
								<form method="POST" action="?/lieferschein" enctype="multipart/form-data" use:enhance={() => { kiLaeuft = true; return async ({ update }) => { await update(); kiLaeuft = false; }; }} class="af-mat-neu">
									<label>Foto des Lieferscheins <input type="file" name="foto" accept="image/jpeg,image/png" capture="environment" required /></label>
									<label class="af-zustimmung"><input type="checkbox" name="zustimmung" value="ja" required /> Das Foto darf zur Auswertung an die KI gesendet werden (nur das Foto, keine Kundendaten).</label>
									<div class="af-mat-knoepfe">
										<button type="button" class="kd-knopf hell" onclick={schliessen}>Abbrechen</button>
										<button type="submit" class="kd-knopf" disabled={kiLaeuft}>{kiLaeuft ? 'KI liest …' : 'Auslesen'}</button>
									</div>
								</form>
							{/snippet}
						</AddPanel>
						{#if form?.lieferschein}
							<form method="POST" action="?/lieferscheinUebernehmen" use:enhance class="af-lieferschein">
								<p class="kd-info">Bitte prüfen – nur angehakte Zeilen werden übernommen. Gelb = schlecht lesbar.</p>
								{#each form.lieferschein as p, i (i)}
									<fieldset class:unsicher={p.unsicher}>
										<legend class="unsichtbar">Position {i + 1}</legend>
										<label class="af-nehmen"><input type="checkbox" name={`nehmen_${i}`} value="ja" checked /> <span class="unsichtbar">übernehmen</span></label>
										<input name={`bezeichnung_${i}`} value={p.bezeichnung} aria-label="Bezeichnung" />
										<input name={`menge_${i}`} value={mengeText(p.menge)} inputmode="decimal" aria-label="Menge" class="kurz" />
										<input name={`einheit_${i}`} value={p.einheit} aria-label="Einheit" class="kurz" />
										{#if data.preiseSehen}<input name={`preis_${i}`} value={p.einzelpreisCent === null ? '' : euro(p.einzelpreisCent).replace(/\s*€/, '')} aria-label="Einkauf je Einheit (€)" class="kurz" />{/if}
									</fieldset>
								{/each}
								<button type="submit" class="kd-knopf">Übernehmen</button>
							</form>
						{/if}
					</Karte>
				</div>
			{/if}
			{#if data.nachkalkulation}
				<div class="af-k k-nachkalk" id="nachkalkulation">
					<Karte>
						{#snippet titel()}Nachkalkulation{/snippet}
						<NachkalkulationKarte nk={data.nachkalkulation} />
					</Karte>
				</div>
			{/if}

			{#if data.protokolle}
				<div class="af-k k-protokolle">
					<Karte>
						{#snippet titel()}Protokolle{/snippet}
						{#snippet aktionen()}
							{#if data.darfProtokollStarten && data.protokollVorlagen.length > 0}
								<form method="POST" action="?/protokollStarten" use:enhance class="af-protokoll-start">
									<Auswahl name="vorlageId" aria-label="Protokoll-Vorlage" required data-testid="protokoll-vorlage">
										{#each data.protokollVorlagen as v (v.id)}<option value={v.id}>{v.name}</option>{/each}
									</Auswahl>
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
					<ScrollBereich label="Verlauf des Auftrags">
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
					</ScrollBereich>
					{#if data.verlaufGekuerzt}
						<p class="kd-info">Ältere Einträge werden hier nicht angezeigt.</p>
					{/if}
				</Karte>
			</div>
		</div>

		<aside class="af-seitenleiste" aria-label="Auftrag im Überblick">
			<div class="af-k k-ort">
				<Karte>
					{#snippet titel()}Kunde &amp; Einsatzort{/snippet}
					<dl class="af-kunde-kurz">
						<dt class="kd-unsichtbar">Kunde</dt>
						<dd>
								{#if a.kundeArt === 'kunde'}
									{#if data.kundeLesbar}<a href={`/kunden/${a.kundeId}`}>{a.kundeName}</a>{:else}{a.kundeName}{/if}
									{#if data.portal && a.kundeId && !data.portal.kundeLinkUrl}
										<!-- Kein (öffnebarer) Portal-Link (msg 3050): zur Verwaltung beim Kunden – hier wird nichts erzeugt -->
										<span class="af-portal-kurz" data-testid="kunde-portal">
											<a href={`/kunden/${a.kundeId}#kundenportal`}>Portal-Link beim Kunden verwalten</a>
										</span>
									{/if}
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
					</dl>
					<div class="af-objekt">
						{#if data.darfBearbeiten && a.kundeArt === 'kunde'}
							<form method="POST" action="?/aendern" use:enhance={sofort} class="af-inline">
								<label class="af-feld">
									Objekt
									<Auswahl name="objektId" aria-label="Objekt" onchange={(ev) => ev.currentTarget.form?.requestSubmit()}>
										<option value="" selected={!a.objektId}>Kundenadresse (Standard)</option>
										{#each data.objekte as o (o.id)}
											<option value={o.id} selected={o.id === a.objektId}>{o.bezeichnung}{o.adresse ? ` – ${o.adresse}` : ''}</option>
										{/each}
									</Auswahl>
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
						{#if navigationsLink(a.adresse) || telefonLink(a.telefon) || data.mail || data.portal?.kundeLinkUrl}
							<!-- Eine Knopfreihe (msgs 3050/3072): Navigieren, Mail an Kunden, Anrufen, Kundenportal -->
							<div class="af-vorort" data-testid="kunde-aktionen">
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
								{#if data.mail}<MailAnKunde vorbereitung={data.mail} />{/if}
								{#if data.portal?.kundeLinkUrl}
									<a class="kd-knopf hell" href={data.portal.kundeLinkUrl} target="_blank" rel="noopener noreferrer">Kundenportal öffnen</a>
									<button type="button" class="kd-knopf hell" onclick={() => kopierePortal(data.portal!.kundeLinkUrl!)}>{portalKopiert ? 'Kopiert ✓' : 'Portal-Link kopieren'}</button>
								{/if}
							</div>
						{/if}
						{#if a.anlageId || (data.darfBearbeiten && data.anlagen.length > 0)}
							<div class="af-anlage">
								{#if data.darfBearbeiten && data.anlagen.length > 0}
									<form method="POST" action="?/aendern" use:enhance={sofort} class="af-inline">
										<label class="af-feld">
											Anlage
											<Auswahl name="anlageId" aria-label="Anlage" onchange={(ev) => ev.currentTarget.form?.requestSubmit()}>
												<option value="" selected={!a.anlageId}>– keine Anlage –</option>
												{#each data.anlagen as an (an.id)}
													<option value={an.id} selected={an.id === a.anlageId}>{an.bezeichnung} ({an.typName})</option>
												{/each}
											</Auswahl>
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
								<p class="kd-info">Mehrere möglich – jede Auswahl wird sofort gespeichert.</p>
								<PersonWahl
									name="zustaendige"
									mehrfach
									absenden
									label="Mitarbeiter zuweisen"
									leerText="Mitarbeiter wählen"
									personen={data.mitarbeiter}
									werte={a.zustaendige.map((z) => z.id)}
								/>
								<button type="button" class="kd-knopf hell af-fertig" onclick={() => (zuweisenOffen = false)}>Fertig</button>
							</form>
							{#if data.kolonnen.length > 0}
								<form method="POST" action="?/kolonneZuweisen" use:enhance={sofort} class="af-kolonne">
									<label>
										Kolonne zuweisen
										<Auswahl name="kolonneId" required>
											{#each data.kolonnen as ko (ko.id)}<option value={ko.id}>{ko.name} ({ko.mitglieder.map((m) => m.name.split(' ')[0]).join(', ')})</option>{/each}
										</Auswahl>
									</label>
									<button type="submit" class="kd-knopf hell">Zuweisen</button>
								</form>
							{/if}
						</details>
					{/if}
				</Karte>
			</div>

			{#if data.angebote || data.auftragsbestaetigungen.length > 0 || data.abHinweis}
				<!-- Ausgangsbelege des Auftrags (Jamil msg 3525): Angebote, Auftragsbestätigungen und (mit Lexware) Rechnungen in EINER
				     Liste, neueste zuerst, Belegart als Abzeichen – gleiche Zeile wie unter „Ausgangsbelege“ (BelegListe) -->
				<div class="af-k k-angebote" id="ausgangsbelege">
					<Karte>
						{#snippet titel()}Ausgangsbelege{/snippet}
						<BelegListe zeilen={belege} leerText="Noch kein Angebot und keine Auftragsbestätigung." kompakt label="Ausgangsbelege des Auftrags" />
						<div id="auftragsbestaetigung">
							{#each data.auftragsbestaetigungen.filter((x) => x.versandStatus === 'bereit') as ab (ab.id)}
								<div class="af-ab" data-testid="ab-bereit">
									<p><strong>{ab.nummer}</strong> · bereit zum Versand</p>
									<div class="af-ab-knoepfe">
										<a class="kd-knopf hell klein" href={`/api/auftragsbestaetigungen/${ab.id}/pdf?download=1`} download>PDF herunterladen</a>
										<a class="kd-knopf hell klein" href={`mailto:${ab.mailAn ?? ''}?subject=${encodeURIComponent(ab.mailBetreff ?? '')}&body=${encodeURIComponent(ab.mailText ?? '')}`}>In Mailprogramm öffnen</a>
										<form method="POST" action="?/abGesendet" use:enhance><input type="hidden" name="id" value={ab.id} /><button type="submit" class="kd-knopf klein">Als gesendet markieren</button></form>
									</div>
									{#if data.abVorlagen.length > 1}
										<form method="POST" action="?/abVorlage" use:enhance={sofort} class="af-inline">
											<input type="hidden" name="id" value={ab.id} />
											<label>Mail-Vorlage
												<Auswahl name="vorlageId" onchange={(ev) => ev.currentTarget.form?.requestSubmit()}>
													<option value="">Standard „Auftragsbestätigung“</option>
													{#each data.abVorlagen as v (v.id)}<option value={v.id}>{v.name}</option>{/each}
												</Auswahl>
											</label>
										</form>
									{/if}
									<p class="kd-info">Der Mailversand ist noch nicht angebunden: PDF herunterladen, im Mailprogramm anhängen und senden.{#if !ab.mailAn} Beim Kunden ist keine E-Mail hinterlegt.{/if}</p>
								</div>
							{/each}
							{#if data.abHinweis}
								<!-- Einstellung gehört zum Kunden (Jamil msgs 3439, 3521 E): hier nur der wirksame Wert -->
								<p class="kd-info" data-testid="ab-hinweis">
									Auftragsbestätigung automatisch: <strong>{data.abHinweis.an ? 'an' : 'aus'}</strong>
									{#if !data.abHinweis.kundeId}
										– Auftrag ohne Kunden: Einstellung der Firma.
									{:else}
										– <a href={`/kunden/${data.abHinweis.kundeId}#automatik`}>beim Kunden einstellen</a>
									{/if}
								</p>
							{/if}
						</div>
						<!-- Freigaben fürs Kundenportal (früher eigene Karte „Kundenportal“, Jamil msg 3561 aufgelöst) -->
						{#if data.portal}
							{#if form?.portalFehler}<p role="alert" class="kd-fehler">{form.portalFehler}</p>{/if}
							{#if data.portal.angebote.length + data.portal.dateien.length > 0}
								<p class="af-portal-titel">Im Kundenportal freigeben <span class="kd-info">(Haken = der Kunde sieht es)</span></p>
								<ul class="af-portal-docs">
									{#each [...data.portal.angebote.map((x) => ({ art: 'angebot', id: x.id, name: `Angebot ${x.nummer}`, geteilt: x.geteilt })), ...data.portal.dateien.map((x) => ({ art: 'datei', id: x.id, name: anzeigeDateiname(x.name, x.typ, x.angelegt), geteilt: x.geteilt }))] as d (d.id)}
										<li>
											<form method="POST" action="?/portalDokument" use:enhance={sofort}>
												<input type="hidden" name="art" value={d.art} /><input type="hidden" name="refId" value={d.id} />
												<label><input type="checkbox" name="geteilt" value="ja" checked={d.geteilt} onchange={(ev) => ev.currentTarget.form?.requestSubmit()} /> {d.name}</label>
											</form>
										</li>
									{/each}
								</ul>
							{/if}
						{/if}
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
													<Auswahl name="vorlageId" required>
														<option value="">– bitte wählen –</option>
														{#each data.angebotVorlagen as v (v.id)}
															<option value={v.id}>Vorlage: {v.name}</option>
														{/each}
													</Auswahl>
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
												<Auswahl name="angebotId" required>
													<option value="">– bitte wählen –</option>
													{#each data.zuordenbareAngebote as z (z.id)}
														<option value={z.id}>{z.nummer} · {z.kundeName} · {tagDeutsch(z.datum)} · {euro(z.bruttoCent)}</option>
													{/each}
												</Auswahl>
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

			{#if data.partner.auftraggeber || data.partner.subunternehmer.length || data.partnerAuswahl.length || data.partner.fremdleistungen?.length}
				<div class="af-k k-partner" id="partner">
					<Karte>
						{#snippet titel()}Partner{/snippet}
						<AuftragPartner partner={data.partner} auswahl={data.partnerAuswahl} darfBearbeiten={data.darfBearbeiten} {form} />
					</Karte>
				</div>
			{/if}

			<div class="af-k k-links" id="links">
				<Karte>
					{#snippet titel()}Links{/snippet}
					<AuftragLinks links={data.links} darfBearbeiten={data.darfBearbeiten} darfPortal={data.darfLinkPortal} {form} />
				</Karte>
			</div>

			<div class="af-k k-doku">
				<Karte>
					{#snippet titel()}Dokumente &amp; Notizen{/snippet}
					<!-- Wie die Links (Jamil msg 3070): direkt hier hinzufügen, je Eintrag „Im Kundenportal“ -->
					<AuftragUnterlagen
						dokumente={data.unterlagen.dokumente}
						notizen={data.unterlagen.notizen}
						auftragId={a.id}
						benutzerId={data.benutzerId}
						darfBearbeiten={data.darfBearbeiten}
						darfPortal={data.darfUnterlagenPortal}
						darfAlleLoeschen={data.darfAlleUnterlagenLoeschen}
						{form}
					/>
				</Karte>
			</div>
		</aside>
	</div>
	{#if gespeichert}<p class="af-gespeichert" role="status">Gespeichert</p>{/if}
</main>

<style>
	.af-portal-kurz {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.75rem;
		margin-top: 0.25rem;
		font-size: var(--ui-schrift-s);
	}
	.af-portal-kurz a {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
	}
	/* „Aufgabe hinzufügen“ und „Aufgaben aus Vorlage“ nebeneinander; ein geöffnetes Feld nimmt die ganze Breite */
	.todo-hinzu {
		display: flex;
		flex-wrap: wrap;
		gap: 0 0.5rem;
	}
	.todo-hinzu :global(.add-panel.offen) {
		flex: 1 1 100%;
	}
	.af-buchung p {
		margin: 0 0 0.5rem;
		line-height: 1.6;
	}
	.af-antwort {
		white-space: pre-line;
	}
	.af-buchung-fotos {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}
	.af-buchung-fotos img {
		width: 5rem;
		height: 5rem;
		object-fit: cover;
		border-radius: var(--ui-radius);
	}
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
		max-width: none; /* ganze Arbeitsfläche (Jamil msg 2838) */
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
	/* Reihenfolge Aufgaben → Termine → Material → Nachkalkulation (Jamil msg 3563), am Handy genauso */
	.k-zeit { order: 0; }
	.k-beschreibung { order: 1; }
	.k-buchung { order: 1; }
	.k-ort { order: 2; }
	.k-mitarbeiter { order: 3; }
	.k-todos { order: 4; }
	.k-termine { order: 5; }
	.k-material { order: 6; }
	.k-nachkalk { order: 7; }
	.k-protokolle { order: 8; }
	.k-angebote { order: 9; }
	.k-partner { order: 10; }
	.k-links { order: 10; }
	.k-doku { order: 10; }
	.k-verlauf { order: 11; }
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
	.af-kopf-chips {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		margin-top: 0.35rem;
	}
	.af-beschreibung {
		margin-bottom: 1rem;
		padding: 0.75rem 1rem;
		border: 1px solid var(--ui-rand);
		border-left: 4px solid var(--ui-akzent);
		border-radius: var(--ui-radius-karte);
		background: var(--ui-flaeche);
	}
	.af-beschreibung.leer {
		border-left-color: var(--ui-rand-stark);
		padding: 0.4rem 0.6rem;
	}
	.af-beschreibung-text {
		margin: 0;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		white-space: pre-line;
		line-height: 1.5;
	}
	.af-beschreibung-text.offen {
		display: block;
	}
	.af-beschreibung-knoepfe {
		display: flex;
		gap: 0.4rem;
		margin-top: 0.4rem;
	}
	.af-kunde-kurz {
		margin: 0 0 0.75rem;
		font-weight: 600;
	}
	.af-kunde-kurz dd {
		margin: 0;
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
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.af-vorort > :global(*) {
		flex: 1 1 9rem;
		min-width: 0;
	}
	/* Geöffnete Mail (Vorschau mit Text) nimmt die ganze Breite der Karte */
	.af-vorort :global(.mk) {
		flex-basis: 100%;
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
	.ki-zustimmung {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
		font-weight: 400;
	}
	.af-zeit-summe {
		margin: var(--ui-a2) 0 0;
		font-size: var(--ui-schrift-s);
		color: var(--ui-text-leise);
	}
	.af-zeit-personen {
		margin: var(--ui-a1) 0 0;
		padding-left: 1.1rem;
		font-size: var(--ui-schrift-s);
	}
	.af-material {
		list-style: none;
		margin: 0 0 var(--ui-a3);
		padding: 0;
		display: grid;
		gap: var(--ui-a2);
	}
	.af-material li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--ui-a2);
		padding: var(--ui-a2) 0;
		border-bottom: 1px solid var(--ui-rand);
	}
	.af-material li.offen .af-mat-name {
		color: var(--ui-text-leise);
	}
	.af-mat-name {
		flex: 1 1 12rem;
		display: grid;
	}
	.af-mat-name small {
		color: var(--ui-text-leise);
		font-size: var(--ui-schrift-xs);
	}
	.af-mat-form {
		display: flex;
		gap: var(--ui-a2);
		align-items: center;
	}
	.af-mat-menge {
		display: flex;
		align-items: center;
		gap: var(--ui-a1);
	}
	.af-mat-menge input {
		width: 5.5rem;
		min-height: var(--ui-feld-hoehe);
		text-align: right;
	}
	.af-mat-neu {
		display: grid;
		gap: var(--ui-a2);
	}
	.af-mat-neu label {
		display: grid;
		gap: var(--ui-a1);
	}
	.af-mat-knoepfe {
		display: flex;
		gap: var(--ui-a2);
		flex-wrap: wrap;
	}
	.af-zustimmung {
		display: flex !important;
		gap: var(--ui-a2);
		align-items: flex-start;
		font-size: var(--ui-schrift-s);
	}
	.af-lieferschein {
		display: grid;
		gap: var(--ui-a2);
		margin-top: var(--ui-a3);
	}
	.af-lieferschein fieldset {
		display: flex;
		flex-wrap: wrap;
		gap: var(--ui-a2);
		align-items: center;
		margin: 0;
		padding: var(--ui-a2);
		border: 1px solid var(--ui-rand);
		border-radius: var(--ui-radius);
	}
	.af-lieferschein fieldset.unsicher {
		background: var(--m365-warnung-hell);
	}
	.af-lieferschein input {
		min-height: var(--ui-feld-hoehe);
		flex: 1 1 10rem;
	}
	.af-lieferschein input.kurz {
		flex: 0 1 5.5rem;
		width: 5.5rem;
	}
	.af-nehmen input {
		width: 1.4rem;
		height: 1.4rem;
	}
	.af-ab { display: grid; gap: var(--ui-a2); padding-bottom: var(--ui-a2); border-bottom: 1px solid var(--ui-rand); margin-bottom: var(--ui-a2); }
	.af-ab p { margin: 0; }
	.af-ab-knoepfe { display: flex; flex-wrap: wrap; gap: var(--ui-a2); align-items: flex-end; }
	.af-portal-docs { list-style: none; margin: var(--ui-a2) 0; padding: 0; display: grid; gap: var(--ui-a1); font-size: var(--ui-schrift-s); }
	.af-portal-docs label { display: flex; gap: var(--ui-a2); align-items: center; min-height: 2.25rem; }
	.af-portal-titel { margin: var(--ui-a2) 0 0; font-weight: 600; font-size: var(--ui-schrift-s); }
	/* Kundenportal dezent (msg 3526): Haken + kurzer Zustand, ⓘ für die Erklärung */
	.af-portal-chip { display: inline-flex; align-items: center; }
	.af-portal-chip a.ah-chip { text-decoration: none; }
	.af-portal-ohne { font-weight: 400; }
	#auftragsbestaetigung { display: grid; gap: var(--ui-a2); margin-top: var(--ui-a2); }
	#auftragsbestaetigung > p { margin: 0; }
</style>
