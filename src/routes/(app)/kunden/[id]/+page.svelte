<script lang="ts">
	import { rueckfrage } from '$lib/rueckfrage';
	import { enhance } from '$app/forms';
	import { STATUS_NAMEN } from '$lib/auftrag-status';
	import { terminKurz } from '$lib/einsatz-art';
	import { berlinTag, berlinUhrzeit, tagDeutsch } from '$lib/zeit';
	import Abschnitt from '$lib/components/Abschnitt.svelte';
	import AddPanel from '$lib/components/AddPanel.svelte';
	import MailAnKunde from '$lib/components/MailAnKunde.svelte';
	import Auswahl from '$lib/components/ui/Auswahl.svelte';
	import InfoFeld from '$lib/components/ui/InfoFeld.svelte';
	import InfoFenster from '$lib/components/ui/InfoFenster.svelte';
	import FormFuss from '$lib/components/ui/FormFuss.svelte';
	import LoeschenKnopf from '$lib/components/ui/LoeschenKnopf.svelte';
	import LoeschenPanel from '$lib/components/ui/LoeschenPanel.svelte';
	import { navigationsLink, telefonLink } from '$lib/kontakt-links';
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
	// Portal-Einstellungen des Kunden (msg 3439): Auswahl „wie Firma / ja / nein“
	const dreiWahl = (w: boolean | null) => (w === null ? '' : w ? 'an' : 'aus');
	const firmaText = (w: boolean) => `Firmen-Standard (${w ? 'ja' : 'nein'})`;
	const PORTAL_FELDER = [
		{ name: 'sichtbar', label: 'Aufträge im Portal zeigen', info: 'kunde.sichtbar' },
		{ name: 'status', label: 'Auftragsstatus zeigen', info: 'kunde.status' },
		{ name: 'termine', label: 'Nächste Termine zeigen', info: 'kunde.termine' },
		{ name: 'mitarbeiter', label: 'Namen der Mitarbeiter zeigen', info: 'kunde.mitarbeiter' },
		{ name: 'annahme', label: 'Angebot online annehmen lassen', info: 'kunde.annahme' },
		{ name: 'abAutomatisch', label: 'Auftragsbestätigung automatisch erstellen', info: 'kunde.ab_automatisch' }
	] as const;
	/** Jamil msg 3034: „Kunde löschen“ oben rechts; die Rückfrage klappt unter dem Kopf auf (bleibt bei Fehler offen). */
	let loeschenOffen = $state(false);
	// Kundenportal: Rückfrage vor dem Widerrufen; „Link kopieren“ mit kurzer Rückmeldung
	let widerrufFrage = $state<string | null>(null);
	let kopiert = $state<string | null>(null);
	async function kopiere(adresse: string) {
		try {
			await navigator.clipboard.writeText(adresse);
			const id = data.portal?.links.find((l) => l.url === adresse)?.id ?? null;
			kopiert = id;
			setTimeout(() => (kopiert = null), 2500);
		} catch {
			window.prompt('Link kopieren:', adresse);
		}
	}

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
			{#if data.darfBearbeiten}
				<LoeschenKnopf ding="Kunde" bind:offen={loeschenOffen} />
			{/if}
			{#if data.auftraege && data.darfAuftragAnlegen}
				<a href={`/auftraege/neu?kunde=${k.id}`} class="kd-knopf">+ Auftrag</a>
			{/if}
		</div>
	</header>

	{#if form?.fehler && !form?.loeschFehler && !form?.notizFehler && !form?.dokumentFehler && !form?.portalFehler}
		<p role="alert" class="kd-fehler">{form.fehler}</p>
	{/if}
	{#if data.darfBearbeiten}
		<LoeschenPanel ding="Kunde" bind:offen={loeschenOffen} fehler={form?.loeschFehler ? (form.fehler ?? null) : null}>
			Der Kunde und alle seine Objekte werden endgültig gelöscht. Das lässt sich nicht rückgängig machen.
		</LoeschenPanel>
	{/if}

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
		<!-- Gleiche Knopfreihe wie im Auftrag (msg 3072): Navigieren, Mail an Kunden, Anrufen -->
		{#if navigationsLink(adresse) || data.mail || telefonLink(k.telefon)}
			<div class="ka-mail" data-testid="kunde-aktionen">
				{#if navigationsLink(adresse)}<a class="kd-knopf hell" href={navigationsLink(adresse)} target="_blank" rel="noopener">Navigieren</a>{/if}
				{#if data.mail}<MailAnKunde vorbereitung={data.mail} />{/if}
				{#if telefonLink(k.telefon)}<a class="kd-knopf hell" href={telefonLink(k.telefon)}>Anrufen</a>{/if}
			</div>
		{/if}
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

	{#if data.portal}
		<Abschnitt titel="Kundenportal" id="kundenportal">
			{#if form?.portalFehler}<p role="alert" class="kd-fehler">{form.portalFehler}</p>{/if}
			{#if form?.portalMeldung}<p role="status" class="kd-info">{form.portalMeldung}</p>{/if}
			{#if form?.portalUrl}
				<div class="kp-neu" data-testid="portal-url">
					<p><strong>Neuer Link</strong> – nur jetzt sichtbar, bitte gleich kopieren und dem Kunden schicken:</p>
					<input readonly value={form.portalUrl} aria-label="Portal-Link" onfocus={(ev) => ev.currentTarget.select()} />
					<button type="button" class="kd-knopf" onclick={() => navigator.clipboard?.writeText(form?.portalUrl ?? '')}>Kopieren</button>
					{#if data.portalMail}<MailAnKunde vorbereitung={data.portalMail} extra={{ 'portal.link': form.portalUrl }} knopf="Per E-Mail senden" titel="Portal-Link per E-Mail" />{/if}
				</div>
			{/if}
			{#each data.portal.links.filter((l) => l.gueltig) as l (l.id)}
				<div class="kp-link" data-testid="portal-aktiv">
					<span>Gültiger Link vom {tagDeutsch(berlinTag(new Date(l.angelegt)))}{l.laeuftAb ? ` · bis ${tagDeutsch(berlinTag(new Date(new Date(l.laeuftAb).getTime() - 1)))}` : ''} · {l.zugriffe}× geöffnet</span>
					<div class="kp-knoepfe">
						{#if l.url}
							<!-- Aktiven Link wieder öffnen/kopieren (msg 3036) -->
							<a class="kd-knopf hell" href={l.url} target="_blank" rel="noopener noreferrer">Kundenportal öffnen</a>
							<button type="button" class="kd-knopf hell" onclick={() => kopiere(l.url!)}>{kopiert === l.id ? 'Kopiert ✓' : 'Link kopieren'}</button>
						{/if}
						{#if widerrufFrage === l.id}
							<form method="POST" action="?/portalWiderrufen" use:enhance={() => async ({ update }) => { widerrufFrage = null; await update(); }} class="kp-frage" role="group" aria-label="Link widerrufen?">
								<input type="hidden" name="linkId" value={l.id} />
								<span>Wirklich widerrufen? Der Link funktioniert dann sofort nicht mehr.</span>
								<button type="button" class="kd-knopf hell" onclick={() => (widerrufFrage = null)}>Abbrechen</button>
								<button type="submit" class="kd-knopf gefahr">Ja, widerrufen</button>
							</form>
						{:else}
							<button type="button" class="kd-knopf gefahr" onclick={() => (widerrufFrage = l.id)}>Widerrufen</button>
						{/if}
					</div>
					{#if l.ohneKopie}
						<p class="kd-info kp-alt">Dieser Link wurde vor dem Update erzeugt und lässt sich hier nicht öffnen – zum Öffnen bitte einmal einen neuen Link erzeugen (der alte wird dann ungültig).</p>
					{/if}
				</div>
			{/each}
			<!-- Portal-Passwort (msg 3037): Standard PLZ, eigenes Passwort möglich -->
			<div class="kp-passwort" role="group" aria-label="Portal-Passwort">
				<p class="kp-titel">Passwort für das Portal</p>
				{#if data.portal.passwort.eigenes}
					<p class="kd-info">Eigenes Passwort gesetzt{data.portal.passwort.geaendert ? ` (am ${tagDeutsch(berlinTag(new Date(data.portal.passwort.geaendert)))})` : ''}.</p>
				{:else if data.portal.passwort.plz}
					<p class="kd-info">Der Kunde öffnet das Portal mit seiner Postleitzahl ({data.portal.passwort.plz}). Für sensible Kunden besser ein eigenes Passwort setzen.</p>
				{:else}
					<p class="kd-fehler" role="status" data-testid="portal-ohne-passwort">Der Kunde hat keine Postleitzahl – bitte ein eigenes Passwort setzen, sonst kann er das Portal nicht öffnen.</p>
				{/if}
				{#if data.portal.passwort.fehlversuche > 0}
					<p class="kd-info">{data.portal.passwort.fehlversuche}× falsches Passwort in den letzten 7 Tagen.</p>
				{/if}
				<form method="POST" action="?/portalPasswort" use:enhance class="kp-form">
					<label>Eigenes Passwort (mind. 6 Zeichen) <input type="text" name="passwort" minlength="6" maxlength="100" autocomplete="off" required /></label>
					<button type="submit" class="kd-knopf hell">Passwort speichern</button>
				</form>
				{#if data.portal.passwort.eigenes}
					<form method="POST" action="?/portalPasswort" use:enhance>
						<input type="hidden" name="aktion" value="plz" />
						<button type="submit" class="kd-knopf hell" disabled={!data.portal.passwort.plz}>Auf Postleitzahl zurücksetzen</button>
					</form>
				{/if}
			</div>
			<form method="POST" action="?/portalLink" use:enhance class="kp-form">
				<label>Gültig bis (optional) <input type="date" name="laeuftAb" /></label>
				<button type="submit" class="kd-knopf">{data.portal.links.some((l) => l.gueltig) ? 'Neuen Link erzeugen (alter wird ungültig)' : 'Link für den Kunden erzeugen'}</button>
			</form>
			<!-- Einstellungen gehören zum Kunden, nicht zum Auftrag (Jamil msgs 3423, 3439); leer = Standard der Firma -->
			<div class="kp-einstellung" id="portal-einstellung" role="group" aria-label="Portal-Einstellungen dieses Kunden" data-testid="portal-einstellung">
				<p class="kp-titel">Einstellungen für diesen Kunden <InfoFenster id="kunde.portal_seite" /></p>
				<p class="kd-info">
					Gilt für alle Aufträge dieses Kunden. „Firmen-Standard“ übernimmt die Einstellung unter
					{#if data.darfFirmenEinstellungen}<a href="/einstellungen/kundenportal">Auftrag → Kundenportal & Auftragsbestätigung</a>{:else}Auftrag → Kundenportal & Auftragsbestätigung (Einstellungen der Firma){/if}.
				</p>
				<form method="POST" action="?/portalEinstellung" use:enhance={() => async ({ update }) => update({ reset: false })} class="kp-form kp-einst-form">
					{#each PORTAL_FELDER as fd (fd.name)}
						<InfoFeld id={fd.info}>
							<label>{fd.label}
								<Auswahl name={fd.name}>
									<option value="" selected={data.portal.einstellung.kunde[fd.name] === null}>{firmaText(data.portal.einstellung.firma[fd.name])}</option>
									<option value="an" selected={data.portal.einstellung.kunde[fd.name] === true}>ja</option>
									<option value="aus" selected={data.portal.einstellung.kunde[fd.name] === false}>nein</option>
								</Auswahl>
							</label>
						</InfoFeld>
					{/each}
					<!-- Rückmeldung direkt am Knopf (am Handy liegt der Abschnittskopf weit oben) -->
					{#if form?.einstellungFehler}<p role="alert" class="kd-fehler kp-voll">{form.einstellungFehler}</p>{/if}
					{#if form?.einstellungMeldung}<p role="status" class="kd-info kp-voll">{form.einstellungMeldung}</p>{/if}
					<FormFuss><button type="submit" class="kd-knopf">Einstellungen speichern</button></FormFuss>
				</form>
			</div>
			<p class="kp-titel">Im Portal: {data.portal.auftraege.filter((a) => a.imPortal).length} von {data.portal.auftraege.length} Aufträgen</p>
			<ul class="kd-liste kp-auftraege">
				{#each data.portal.auftraege as a (a.id)}
					<li><a href={`/auftraege/${a.id}#kundenportal`}><strong>{a.nummer} {a.titel}</strong><span class="kd-info">{a.imPortal ? 'im Portal' : 'nicht im Portal'}</span></a></li>
				{/each}
			</ul>
		</Abschnitt>
	{/if}

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
							<button type="button" class="kd-knopf hell" onclick={schliessen}>Abbrechen</button>
							<button type="submit" class="kd-knopf">Notiz speichern</button>
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
							<button type="submit" class="kd-knopf gefahr klein" aria-label="Notiz vom {wann(n.angelegt)} löschen" use:rueckfrage={'Notiz wirklich löschen?'}>Löschen</button>
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
							<button type="button" class="kd-knopf hell" onclick={schliessen}>Abbrechen</button>
							<button type="submit" class="kd-knopf">Hochladen</button>
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
							<button type="submit" class="kd-knopf gefahr klein" aria-label="Dokument {d.name} löschen" use:rueckfrage={`Dokument „${d.name}“ wirklich löschen?`}>Löschen</button>
						</form>
					{/if}
				</li>
			{:else}
				<li class="kd-leer">Noch keine Dokumente.</li>
			{/each}
		</ul>
	</Abschnitt>

	{#if !data.portal}
	<Abschnitt titel="Kundenportal">
		<div class="ka-portal">
			<p class="kd-info">
				Bald: Hier richten Sie das Kundenportal für diesen Kunden ein (Zugang, freigegebene Angebote und Dokumente) und können es
				direkt öffnen.
			</p>
			<button type="button" class="kd-knopf hell" disabled>Kundenportal öffnen (in Vorbereitung)</button>
		</div>
	</Abschnitt>
	{/if}

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

	{#if data.darfBearbeiten && data.nachfassen}
		<form method="POST" action="?/nachfassen" use:enhance class="kd-nachfassen">
			<input type="hidden" name="aus" value={data.nachfassen.aus ? 'nein' : 'ja'} />
			<label class="kd-haken">
				<input type="checkbox" checked={data.nachfassen.aus} onchange={(ev) => ev.currentTarget.form?.requestSubmit()} />
				<span>Kein automatisches Nachfassen (Angebote, Rechnungen)</span>
			</label>
		</form>
	{/if}

</main>

<style>
	.ka-mail {
		display: flex;
		flex-wrap: wrap;
		gap: var(--ui-a2);
		margin-top: var(--ui-a3);
	}
	.ka-mail > :global(*) {
		flex: 0 1 auto;
	}
	.ka-mail :global(.mk) {
		flex-basis: 100%;
	}
	.kp-neu :global(.mk) {
		flex: 1 1 100%;
	}
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
	.ka-protokoll {
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
		color: var(--ui-akzent-auf);
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
	.kp-neu { display: flex; flex-wrap: wrap; gap: var(--ui-a2); padding: var(--ui-a3); border-radius: var(--ui-radius); background: var(--ui-gruen-hell); margin-bottom: var(--ui-a3); }
	.kp-neu p { margin: 0; flex-basis: 100%; }
	.kp-neu input { flex: 1 1 14rem; min-height: var(--ui-feld-hoehe); min-width: 0; }
	.kp-knoepfe { display: flex; flex-wrap: wrap; gap: var(--ui-a2); align-items: center; }
	.kp-frage { display: flex; flex-wrap: wrap; gap: var(--ui-a2); align-items: center; padding: var(--ui-a2) var(--ui-a3); border-radius: var(--ui-radius); background: var(--ui-rot-hell); }
	.kp-alt { flex-basis: 100%; margin: 0; }
	.kp-einstellung { display: grid; gap: var(--ui-a2); margin: var(--ui-a3) 0; }
	.kp-einstellung p { margin: 0; }
	/* doppelte Klasse: sonst gewinnt das spätere `.kp-form { display: flex }` und die Felder stehen ungleich breit */
	.kp-form.kp-einst-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(17rem, 100%), 1fr)); align-items: end; gap: var(--ui-a2) var(--ui-a3); }
	.kp-einst-form :global(.form-fuss), .kp-voll { grid-column: 1 / -1; margin: 0; }
	.kp-einstellung { scroll-margin-top: 5rem; }
	.kp-passwort { display: grid; gap: var(--ui-a2); margin: var(--ui-a3) 0; }
	.kp-passwort p { margin: 0; }
	.kp-link { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--ui-a2); align-items: center; margin-bottom: var(--ui-a2); font-size: var(--ui-schrift-s); }
	.kp-form { display: flex; flex-wrap: wrap; gap: var(--ui-a2); align-items: flex-end; }
	.kp-form label { display: grid; gap: var(--ui-a1); font-size: var(--ui-schrift-s); }
	.kp-titel { margin: var(--ui-a3) 0 var(--ui-a1); font-weight: 600; font-size: var(--ui-schrift-s); }
</style>
