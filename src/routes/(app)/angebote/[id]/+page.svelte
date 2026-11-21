<script lang="ts">
	import Plus from '$lib/components/ui/Plus.svelte';
	import { page } from '$app/state';
	import MailAnKunde from '$lib/components/MailAnKunde.svelte';
	import Segmente from '$lib/components/ui/Segmente.svelte';
	import Auswahl from '$lib/components/ui/Auswahl.svelte';
	import { untrack } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import KatalogSuche, { type KatalogTreffer } from '$lib/components/KatalogSuche.svelte';
	import PositionenEditor, { neuerSchluessel, type EditorZeile } from '$lib/components/PositionenEditor.svelte';
	import Summenblock from '$lib/components/Summenblock.svelte';
	import { ANGEBOT_STATUS_NAMEN } from '$lib/angebot-status';
	import { centAlsEingabe, euro, leseEuroInCent, leseMenge, mengeText, summen, type MwstSatz } from '$lib/geld';
	import { bewerteAngebot } from '$lib/kalkulation';
	import { enhance } from '$app/forms';
	import { mailtoLink } from '$lib/nachfassen';
	import LoeschenKnopf from '$lib/components/ui/LoeschenKnopf.svelte';
	import LoeschenPanel from '$lib/components/ui/LoeschenPanel.svelte';
	import { frage } from '$lib/rueckfrage';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let kopiert = $state<string | null>(null);
	async function kopiere(laufId: string, text: string) {
		try {
			await navigator.clipboard.writeText(text);
			kopiert = laufId;
			setTimeout(() => (kopiert = null), 2500);
		} catch {
			kopiert = null;
		}
	}

	type Angebot = PageData['angebot'];

	type Kopf = { datum: string; gueltigBis: string; mwstSatz: MwstSatz; einleitung: string; schluss: string };

	const zeilenAus = (a: Angebot): EditorZeile[] =>
		a.positionen.map((p) => ({
			schluessel: neuerSchluessel(),
			katalogPositionId: p.katalogPositionId,
			bezeichnung: p.bezeichnung,
			beschreibung: p.beschreibung ?? '',
			menge: mengeText(p.menge).replaceAll('.', ''),
			einheit: p.einheit,
			einzelpreis: centAlsEingabe(p.einzelpreisCent),
			arbeitMinuten: p.arbeitMinuten === null ? '' : String(p.arbeitMinuten).replace('.', ','),
			materialCent: p.materialCent
		}));
	const kopfAus = (a: Angebot): Kopf => ({
		datum: a.datum,
		gueltigBis: a.gueltigBis,
		mwstSatz: a.mwstSatz,
		einleitung: a.einleitung ?? '',
		schluss: a.schluss ?? ''
	});
	const standVon = (z: EditorZeile[], k: Kopf) => JSON.stringify({ zeilen: z.map(({ schluessel: _s, ...rest }) => rest), kopf: k });

	// Anfangszustand synchron aus den Seitendaten (auch beim Rendern auf dem Server)
	const anfang = untrack(() => data.angebot);
	let geladen = anfang;
	let angebot = $state<Angebot>(anfang);
	let zeilen = $state<EditorZeile[]>(zeilenAus(anfang));
	let kopf = $state<Kopf>(kopfAus(anfang));
	let gespeichertStand = $state(standVon(zeilenAus(anfang), kopfAus(anfang)));
	let fehler = $state<string | null>(null);
	let meldung = $state<string | null>(null);
	let arbeitet = $state(false);
	let katalogOffen = $state(false);
	let vorlageOffen = $state(false);
	let vorlageWahl = $state('');
	let zuletztHinzu = $state<string | null>(null);

	// Ampel und erwarteter Gewinn (Wunsch Jamil, msg 2476): Arbeitszeit × Kosten-Stundensatz + Material gegen den Erlös
	const zahlOderNull = (t: string | undefined) => {
		const x = (t ?? '').trim().replace(',', '.');
		return x === '' || Number.isNaN(Number(x)) ? null : Number(x);
	};
	const bewertung = $derived(
		bewerteAngebot(
			zeilen.map((z) => {
				let menge = 0;
				let preis = 0;
				try {
					menge = leseMenge(z.menge);
					preis = z.einzelpreis.trim() === '' ? 0 : leseEuroInCent(z.einzelpreis);
				} catch {
					/* ungültige Zeile zählt nicht */
				}
				return { menge, einzelpreisCent: preis, einheit: z.einheit, arbeitMinuten: zahlOderNull(z.arbeitMinuten), materialCent: z.materialCent ?? null };
			}),
			data.satz
		)
	);

	// Drei Terminvorschläge für den Baubeginn (Jamil #6093): bis zu drei Tage, im Entwurf änderbar
	type TerminZeile = { beginn: string; hinweis: string };
	const termineAus = (a: Angebot): TerminZeile[] => {
		const t = a.terminvorschlaege.map((x) => ({ beginn: x.beginn, hinweis: x.hinweis ?? '' }));
		while (t.length < 3) t.push({ beginn: '', hinweis: '' });
		return t;
	};
	let termine = $state<TerminZeile[]>(termineAus(anfang));
	let terminWahl = $state('');

	function uebernehme(a: Angebot) {
		angebot = a;
		zeilen = zeilenAus(a);
		kopf = kopfAus(a);
		gespeichertStand = standVon(zeilen, kopf);
		termine = termineAus(a);
	}

	// Neue Daten vom Server (neue Version, Statuswechsel mit invalidateAll) übernehmen
	$effect(() => {
		const a = data.angebot;
		if (a !== geladen) {
			geladen = a;
			uebernehme(a);
		}
	});

	// Altbelege (CRM-Nummer in einem Lexware-Betrieb) sind nur lesbar
	const entwurf = $derived(angebot.status === 'entwurf' && !angebot.altbeleg);
	const geaendert = $derived(entwurf && standVon(zeilen, kopf) !== gespeichertStand);
	const live = $derived(
		summen(
			zeilen.map((z) => {
				let menge = 0;
				let einzelpreisCent = 0;
				try {
					menge = leseMenge(z.menge);
				} catch {
					/* ungültig: zählt 0 */
				}
				try {
					einzelpreisCent = z.einzelpreis.trim() === '' ? 0 : leseEuroInCent(z.einzelpreis);
				} catch {
					/* ungültig: zählt 0 */
				}
				return { menge, einzelpreisCent };
			}),
			kopf.mwstSatz
		)
	);
	const ohnePreis = $derived(
		zeilen.filter((z) => {
			try {
				return z.einzelpreis.trim() === '' || leseEuroInCent(z.einzelpreis) === 0;
			} catch {
				return false;
			}
		}).length
	);

	async function api(methode: string, url: string, koerper?: unknown) {
		const r = await fetch(url, {
			method: methode,
			headers: koerper === undefined ? undefined : { 'content-type': 'application/json' },
			body: koerper === undefined ? undefined : JSON.stringify(koerper)
		});
		const text = await r.text();
		const json = text ? JSON.parse(text) : null;
		if (!r.ok) throw new Error(json?.fehler ?? 'Das hat nicht geklappt. Bitte erneut versuchen.');
		return json;
	}

	async function aktion(fn: () => Promise<void>) {
		if (arbeitet) return;
		arbeitet = true;
		fehler = null;
		meldung = null;
		try {
			await fn();
		} catch (e) {
			fehler = (e as Error).message;
		} finally {
			arbeitet = false;
		}
	}

	/** Kopf und Positionen in EINER Anfrage (eine Transaktion auf dem Server). */
	async function speichernIntern() {
		const a = await api('PUT', `/api/angebote/${angebot.id}`, {
			datum: kopf.datum,
			gueltigBis: kopf.gueltigBis,
			mwstSatz: kopf.mwstSatz,
			einleitung: kopf.einleitung,
			schluss: kopf.schluss,
			positionen: zeilen.map((z) => ({
				katalogPositionId: z.katalogPositionId,
				bezeichnung: z.bezeichnung,
				beschreibung: z.beschreibung,
				menge: z.menge,
				einheit: z.einheit,
				einzelpreis: z.einzelpreis,
				arbeitMinuten: z.arbeitMinuten ?? '',
				materialCent: z.materialCent ?? null
			}))
		});
		uebernehme(a);
	}

	const speichern = () =>
		aktion(async () => {
			await speichernIntern();
			meldung = 'Gespeichert.';
		});

	const pdf = (ev: MouseEvent) => {
		const knopf = ev.currentTarget as HTMLElement;
		return aktion(async () => {
			if (geaendert) await speichernIntern();
			const n = angebot.positionen.filter((p) => p.einzelpreisCent === 0).length;
			// Rückfrage-Blase am Knopf statt confirm() (gemeinsamer Baustein, Regel Jamil msg 3091)
			if (n > 0 && !(await frage(knopf, { frage: `${n === 1 ? '1 Position' : `${n} Positionen`} ohne Preis – trotzdem erstellen?`, ja: 'Trotzdem erstellen' }))) return;
			const a = document.createElement('a');
			a.href = `/api/angebote/${angebot.id}/pdf`;
			a.download = `Angebot_${angebot.nummer}.pdf`;
			document.body.appendChild(a);
			a.click();
			a.remove();
		});
	};

	const status = (nach: string, text: string, extra: Record<string, unknown> = {}) =>
		aktion(async () => {
			if (geaendert) await speichernIntern();
			const a = await api('POST', `/api/angebote/${angebot.id}/status`, { status: nach, ...extra });
			uebernehme(a);
			meldung = a.hinweis ? `${text} ${a.hinweis}` : text;
			await invalidateAll();
		});

	// Lexware (Plan Phase 2): Versenden schreibt das Angebot in Lexware fest – vorher nachfragen
	const lexware = $derived(angebot.belegQuelle === 'lexware');
	const PHASE_TEXT: Record<string, string> = {
		wartet: 'wird in Lexware festgeschrieben …',
		festgeschrieben: 'in Lexware festgeschrieben – PDF wird geholt …',
		pdf: 'bereit zum Versand (PDF aus Lexware)',
		gesendet: 'an den Kunden gesendet',
		fehler: 'Fehler bei Lexware'
	};
	async function versenden(ev: MouseEvent) {
		const knopf = ev.currentTarget as HTMLElement;
		if (lexware) {
			const ok = await frage(knopf, { frage: 'Danach ist das Angebot nicht mehr änderbar: Lexware schreibt es fest und vergibt die Nummer. Jetzt versenden?', ja: 'Versenden' });
			if (!ok) return;
			return status('versendet', 'Versendet.');
		}
		return status('versendet', 'Als versendet markiert.');
	}
	const termineSpeichern = () =>
		aktion(async () => {
			const a = await api('PUT', `/api/angebote/${angebot.id}/termine`, {
				termine: termine.filter((t) => t.beginn).map((t) => ({ beginn: t.beginn, hinweis: t.hinweis.trim() || null }))
			});
			uebernehme(a);
			meldung = 'Terminvorschläge gespeichert.';
		});
	const alsGesendet = () =>
		aktion(async () => {
			await api('POST', `/api/angebote/${angebot.id}/gesendet`, {});
			meldung = 'Als gesendet markiert – das Nachfassen zählt ab heute.';
			await invalidateAll();
		});
	const tagText = (t: string) => new Date(`${t}T12:00:00Z`).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });

	const neueVersion = () =>
		aktion(async () => {
			const neu = await api('POST', `/api/angebote/${angebot.id}/neue-version`);
			await goto(`/angebote/${neu.id}`);
			meldung = `Neue Version ${neu.nummer} angelegt.`;
		});

	/** Jamil msg 3043: „Angebot löschen“ (nur Entwürfe) oben rechts, Rückfrage unter dem Kopf; Fehler bleiben dort. */
	let loeschenOffen = $state(false);
	let loeschFehler = $state<string | null>(null);
	async function loeschen() {
		if (arbeitet) return;
		arbeitet = true;
		loeschFehler = null;
		try {
			await api('DELETE', `/api/angebote/${angebot.id}`);
			await goto(angebot.auftragId ? `/auftraege/${angebot.auftragId}` : '/ausgangsbelege/angebote');
		} catch (e) {
			loeschFehler = (e as Error).message;
		} finally {
			arbeitet = false;
		}
	}

	function ausKatalog(t: KatalogTreffer) {
		zeilen = [
			...zeilen,
			{
				schluessel: neuerSchluessel(),
				katalogPositionId: t.id,
				bezeichnung: t.bezeichnung,
				beschreibung: t.beschreibung ?? '',
				menge: '1',
				einheit: t.einheit,
				einzelpreis: centAlsEingabe(t.einzelpreisCent ?? 0),
				arbeitMinuten: t.arbeitMinuten === null || t.arbeitMinuten === undefined ? '' : String(t.arbeitMinuten).replace('.', ','),
				materialCent: t.materialCent ?? null
			}
		];
		zuletztHinzu = t.bezeichnung;
	}

	/** Angebots-Vorlage einfügen: erst ungespeicherte Änderungen sichern, dann hängt der Server die Positionen an
	 * (Katalogpreise von heute) und übernimmt Einleitung/Schluss der Vorlage, falls sie welche hat. */
	const ausVorlage = () =>
		aktion(async () => {
			const v = data.vorlagen.find((x) => x.id === vorlageWahl);
			if (!v) return;
			if (geaendert) await speichernIntern();
			const vorher = angebot.positionen.length;
			const a = await api('POST', `/api/angebote/${angebot.id}/vorlage`, { vorlageId: v.id });
			uebernehme(a);
			const neu = a.positionen.length - vorher;
			meldung = `Vorlage „${v.name}“ eingefügt (${neu === 1 ? '1 Position' : `${neu} Positionen`}). Alles bleibt änderbar.`;
			vorlageOffen = false;
			vorlageWahl = '';
		});

	// ── Zuordnen (nur Angebote ohne Auftrag): Kunde oder Auftrag suchen und wählen ──
	let zuordnenArt = $state<'auftrag' | 'kunde'>('auftrag');
	let zuordnenSuche = $state('');
	let zuordnenTreffer = $state<{ id: string; text: string }[]>([]);
	let zuordnenMeldung = $state<string | null>(null);

	let zuordnenUhr: ReturnType<typeof setTimeout> | undefined;
	async function zuordnenSuchen() {
		zuordnenMeldung = null;
		try {
			const q = encodeURIComponent(zuordnenSuche);
			if (zuordnenArt === 'kunde') {
				const liste: { id: string; name: string; ort: string | null }[] = await api('GET', `/api/kunden?suche=${q}`);
				zuordnenTreffer = liste.map((k) => ({ id: k.id, text: [k.name, k.ort].filter(Boolean).join(' · ') }));
			} else {
				const liste: { id: string; nummer: string; titel: string; kundeName: string }[] = await api('GET', `/api/auftraege?suche=${q}&offen=1`);
				zuordnenTreffer = liste.map((a) => ({ id: a.id, text: `${a.nummer} · ${a.titel} · ${a.kundeName}` }));
			}
			if (zuordnenTreffer.length === 0) zuordnenMeldung = 'Nichts gefunden.';
		} catch (e) {
			zuordnenMeldung = (e as Error).message;
		}
	}

	const zuordnen = (id: string, text: string) =>
		aktion(async () => {
			if (geaendert) await speichernIntern();
			const a = await api('POST', `/api/angebote/${angebot.id}/zuordnen`, zuordnenArt === 'kunde' ? { kundeId: id } : { auftragId: id });
			uebernehme(a);
			zuordnenTreffer = [];
			zuordnenSuche = '';
			meldung = a.hinweis ? `Zugeordnet: ${text}. ${a.hinweis}` : `Zugeordnet: ${text}.`;
			await invalidateAll();
		});

	function freiePosition() {
		zeilen = [
			...zeilen,
			{ schluessel: neuerSchluessel(), katalogPositionId: null, bezeichnung: '', beschreibung: '', menge: '1', einheit: 'Stk', einzelpreis: '' }
		];
	}
</script>

<svelte:head>
	<title>Angebot {angebot.nummer}</title>
</svelte:head>

<main class="kd-seite an-seite">
	{#if page.url.searchParams.get('hinweis')}<p class="kt-hinweis warnung" role="status">{page.url.searchParams.get('hinweis')}</p>{/if}
	{#if angebot.auftragId}
		<a href={`/auftraege/${angebot.auftragId}`} class="kd-zurueck">← Auftrag {angebot.auftragNummer}</a>
	{:else}
		<a href="/ausgangsbelege/angebote" class="kd-zurueck">← Ausgangsbelege</a>
	{/if}
	<header class="seiten-kopf">
		<div class="an-kopf-titel">
			<div class="an-titelzeile">
				<h1>Angebot {angebot.nummer}</h1>
				<span class={`an-status s-${angebot.status}`} data-testid="angebot-status">{ANGEBOT_STATUS_NAMEN[angebot.status]}</span>
			</div>
			<p class="seiten-meta">{angebot.kundeName} · {angebot.auftragTitel ?? 'ohne Auftrag'}{angebot.vorgaengerId ? ' · neue Version' : ''}</p>
		</div>
		{#if entwurf}
			<div class="seiten-aktionen">
				<LoeschenKnopf ding="Angebot" bind:offen={loeschenOffen} />
			</div>
		{/if}
	</header>
	{#if entwurf}
		<LoeschenPanel ding="Angebot" bind:offen={loeschenOffen} fehler={loeschFehler} onbestaetigen={loeschen} {arbeitet}>
			Das Angebot {angebot.nummer} wird endgültig gelöscht. Das lässt sich nicht rückgängig machen.
		</LoeschenPanel>
	{/if}

	{#if !angebot.auftragId}
		<section class="an-katalog an-zuordnen" aria-label="Angebot zuordnen">
			<h3>Zuordnen</h3>
			<p class="kd-info">
				{angebot.kundeId ? `Kunde: ${angebot.kundeName}. ` : 'Noch keinem Kunden zugeordnet. '}Einem Auftrag zuordnen – dann gilt dessen
				Kunde – oder nur einem Kunden.
			</p>
			<Segmente
				label="Zuordnen zu"
				bind:wert={zuordnenArt}
				optionen={[
					{ wert: 'auftrag', text: 'Auftrag' },
					{ wert: 'kunde', text: 'Kunde' }
				]}
				onchange={() => (zuordnenTreffer = [])}
			/>
			<div class="kd-suche">
				<input
					type="search"
					bind:value={zuordnenSuche}
					placeholder={zuordnenArt === 'kunde' ? 'Name, Ort oder Telefon' : 'Nummer, Titel oder Kunde'}
					aria-label="Zum Zuordnen suchen"
					oninput={() => {
						clearTimeout(zuordnenUhr);
						zuordnenUhr = setTimeout(() => void zuordnenSuchen(), 250);
					}}
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							clearTimeout(zuordnenUhr);
							void zuordnenSuchen();
						}
					}}
				/>
			</div>
			{#if zuordnenMeldung}<p class="kd-info" role="status">{zuordnenMeldung}</p>{/if}
			{#if zuordnenTreffer.length > 0}
				<ul class="kd-liste" aria-label="Treffer zum Zuordnen">
					{#each zuordnenTreffer as t (t.id)}
						<li><button type="button" class="an-treffer" onclick={() => zuordnen(t.id, t.text)} disabled={arbeitet}>{t.text}</button></li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}

	{#if angebot.altbeleg}
		<p class="kt-hinweis warnung" data-testid="altbeleg">
			Altbeleg (CRM-Nummer): Seit Lexware die Belege führt, ist dieses Angebot nur lesbar. Für Änderungen „Als neue Version
			bearbeiten“ – daraus wird ein Lexware-Angebot.
		</p>
	{:else if !entwurf}
		<p class="kt-hinweis">
			Dieses Angebot ist {ANGEBOT_STATUS_NAMEN[angebot.status].toLowerCase()} und kann nicht mehr geändert werden. Für Änderungen
			„Als neue Version bearbeiten“.
		</p>
	{/if}

	{#if lexware && data.lexware}
		<section class="an-nachfassen an-lexware" aria-labelledby="lexware-titel" data-testid="angebot-lexware">
			<h2 id="lexware-titel">Lexware</h2>
			{#if entwurf}
				<p class="kd-info">
					Entwurf im CRM – noch ohne Nummer. Beim Versenden legt das CRM das Angebot in Lexware an und schreibt es fest; Nummer und PDF
					kommen aus Lexware. Das PDF hier ist nur eine Vorschau (Wasserzeichen „Vorschau – kein Beleg“).
				</p>
				{#each data.lexware.hinweise as h (h)}<p class="kt-hinweis warnung">{h}</p>{/each}
			{:else}
				<p class="kd-info">
					Stand: <strong>{PHASE_TEXT[angebot.lexware?.phase ?? ''] ?? '–'}</strong>{#if angebot.lexware?.nummer} · Nummer {angebot.lexware.nummer}{/if}{#if angebot.lexware?.status}
						· in Lexware: {angebot.lexware.status === 'accepted' ? 'angenommen' : angebot.lexware.status === 'rejected' ? 'abgelehnt' : angebot.lexware.status === 'open' ? 'offen' : angebot.lexware.status}{/if}
				</p>
				{#if angebot.lexware?.fehler}<p class="kd-fehler" role="alert">{angebot.lexware.fehler}</p>{/if}
				{#each data.lexware.schritte as s (s.art + s.seit)}
					<p class="kd-info">
						Wartet auf Lexware (seit {new Date(s.seit).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}){s.fehler ? `: ${s.fehler}` : ''}
					</p>
				{/each}
				<div class="an-nf-mail">
					{#if data.lexware.link}<a class="kd-knopf hell" href={data.lexware.link} target="_blank" rel="noopener noreferrer">In Lexware öffnen</a>{/if}
					{#if angebot.lexware?.phase === 'pdf'}
						{#if data.mail}
							<a class="kd-knopf hell" href={mailtoLink(data.mail.an, `Ihr Angebot ${angebot.nummer}`, 'Anbei erhalten Sie unser Angebot als PDF (bitte das heruntergeladene PDF anhängen).')}>In Mailprogramm öffnen</a>
						{/if}
						<button type="button" class="kd-knopf hell" onclick={alsGesendet} disabled={arbeitet}>Als gesendet markieren</button>
					{/if}
				</div>
			{/if}
		</section>
	{/if}

	<section class="an-nachfassen an-termine" aria-labelledby="termine-titel" data-testid="angebot-termine">
		<h2 id="termine-titel">Terminvorschläge für den Baubeginn</h2>
		{#if entwurf && !angebot.altbeleg}
			<p class="kd-info">Bis zu drei Tage – der Kunde wählt bei der Annahme im Portal einen davon (oder „keiner passt“).</p>
			{#each termine as t, i (i)}
				<div class="kd-zwei">
					<label>Termin {i + 1} <input type="date" bind:value={t.beginn} /></label>
					<label>Hinweis <input type="text" bind:value={t.hinweis} maxlength="200" placeholder="z. B. vormittags" /></label>
				</div>
			{/each}
			<div><button type="button" class="kd-knopf hell" onclick={termineSpeichern} disabled={arbeitet}>Termine speichern</button></div>
		{:else if angebot.terminvorschlaege.length > 0}
			<ul class="kd-liste">
				{#each angebot.terminvorschlaege as t (t.id)}<li>{t.pos}) {tagText(t.beginn)}{t.hinweis ? ` – ${t.hinweis}` : ''}</li>{/each}
			</ul>
		{:else}
			<p class="kd-info">Keine Terminvorschläge.</p>
		{/if}
	</section>

	<section aria-label="Angaben" class="an-kopf kd-formular">
		<div class="kd-zwei">
			<label>Datum <input type="date" bind:value={kopf.datum} disabled={!entwurf} /></label>
			<label>Gültig bis <input type="date" bind:value={kopf.gueltigBis} disabled={!entwurf} /></label>
		</div>
		<label>
			MwSt-Satz
			<Auswahl bind:value={kopf.mwstSatz} disabled={!entwurf}>
				<option value={19}>19 %</option>
				<option value={7}>7 %</option>
				<option value={0}>0 %</option>
			</Auswahl>
		</label>
		<label>Einleitung <textarea bind:value={kopf.einleitung} maxlength="2000" rows="2" disabled={!entwurf}></textarea></label>
	</section>

	<h2>Positionen</h2>
	<PositionenEditor bind:zeilen nurLesen={!entwurf} mitArbeitszeit />

	{#if entwurf}
		<div class="an-hinzu">
			<button type="button" class="kd-knopf hell" onclick={() => (katalogOffen = !katalogOffen)} aria-expanded={katalogOffen}><Plus />Aus Katalog</button>
			<button type="button" class="kd-knopf hell" onclick={freiePosition}><Plus />Freie Position</button>
			{#if data.vorlagen.length > 0}
				<button type="button" class="kd-knopf hell" onclick={() => (vorlageOffen = !vorlageOffen)} aria-expanded={vorlageOffen}>
					+ Aus Vorlage
				</button>
			{/if}
		</div>
		{#if vorlageOffen}
			<section class="an-katalog an-vorlage" aria-label="Aus Vorlage einfügen">
				<h3>Aus Vorlage einfügen</h3>
				<p class="kd-info">Die Positionen kommen ans Ende; Katalogpositionen mit dem heutigen Katalogpreis.</p>
				<div class="an-vorlage-wahl">
					<Auswahl bind:value={vorlageWahl} aria-label="Angebots-Vorlage">
						<option value="">– Vorlage wählen –</option>
						{#each data.vorlagen as v (v.id)}
							<option value={v.id}>{v.name} ({v.anzahlPositionen === 1 ? '1 Position' : `${v.anzahlPositionen} Positionen`})</option>
						{/each}
					</Auswahl>
					<button type="button" class="kd-knopf" onclick={ausVorlage} disabled={arbeitet || !vorlageWahl}>Einfügen</button>
				</div>
			</section>
		{/if}
		{#if katalogOffen}
			<section class="an-katalog" aria-label="Aus Katalog wählen">
				<h3>Aus Katalog wählen</h3>
				{#if zuletztHinzu}<p role="status" class="kd-info">Hinzugefügt: {zuletztHinzu}</p>{/if}
				<KatalogSuche onwaehle={ausKatalog} onschliessen={() => (katalogOffen = false)} />
			</section>
		{/if}
	{/if}

	<Summenblock nettoCent={live.nettoCent} mwstCent={live.mwstCent} bruttoCent={live.bruttoCent} mwstSatz={kopf.mwstSatz} />

	{#if data.satz}
		<section class={`an-ampel ampel-${bewertung.ampel ?? 'leer'}`} aria-label="Wirtschaftlichkeit">
			<div class="an-ampel-kopf">
				<span class="an-ampel-punkt" aria-hidden="true"></span>
				<strong>
					{#if bewertung.ampel === 'gruen'}Mit Gewinn
					{:else if bewertung.ampel === 'gelb'}Deckt die Kosten, aber wenig Gewinn
					{:else if bewertung.ampel === 'rot'}Verlust – unter kostendeckend
					{:else}Noch keine Bewertung – Arbeitszeit je Position fehlt{/if}
				</strong>
			</div>
			<dl>
				<div><dt>Arbeitszeit</dt><dd>{bewertung.arbeitsstunden.toLocaleString('de-DE')} h</dd></div>
				<div><dt>Erlös je Arbeitsstunde</dt><dd>{bewertung.effektiverSatzCent === null ? '–' : `${euro(bewertung.effektiverSatzCent)}/h`}</dd></div>
				<div><dt>Kosten (Arbeit × {euro(data.satz.kostendeckendCent)}/h + Material)</dt><dd>{bewertung.kostenCent === null ? '–' : euro(bewertung.kostenCent)}</dd></div>
				<div>
					<dt>Erwarteter Gewinn</dt>
					<dd class:minus={(bewertung.gewinnCent ?? 0) < 0}>{bewertung.gewinnCent === null ? '–' : euro(bewertung.gewinnCent)}</dd>
				</div>
			</dl>
			<p class="kd-info">
				Grün ab Verrechnungssatz {euro(data.satz.empfohlenCent)}/h, rot unter dem Kosten-Stundensatz {euro(data.satz.kostendeckendCent)}/h (aus der
				Kalkulation).{#if bewertung.ohneArbeitszeit > 0} {bewertung.ohneArbeitszeit} Position{bewertung.ohneArbeitszeit === 1 ? '' : 'en'} ohne Arbeitszeit
					zählen nur mit Erlös und Material.{/if}
			</p>
		</section>
	{/if}

	{#if data.nachweise.length > 0}
		<section class="an-nachfassen an-nachweis" aria-labelledby="nachweis-titel">
			<h2 id="nachweis-titel">Nachweis (Kundenportal)</h2>
			<ul class="kd-liste">
				{#each data.nachweise as n (n.zeit + n.name)}
					<li class="kd-info">
						<strong>{n.entscheidung === 'angenommen' ? 'Angenommen' : 'Abgelehnt'}</strong> von {n.name} am {n.zeit}{n.grund ? ` – ${n.grund}` : ''}
						{#if n.agb}<br />{n.agb}{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}
	<section class="an-nachfassen" id="nachfassen" aria-labelledby="nachfassen-titel">
		<h2 id="nachfassen-titel">Nachfassen</h2>
		{#if data.nachfassen.kundeAus}
			<p class="kd-info">Beim Kunden ist „kein automatisches Nachfassen“ eingestellt.</p>
		{:else if angebot.status === 'versendet'}
			<form method="POST" action="?/nachfassenPause" use:enhance class="an-nf-pause">
				<input type="hidden" name="pausiert" value={data.nachfassen.pausiert ? 'nein' : 'ja'} />
				<span class="kd-info">{data.nachfassen.pausiert ? 'Nachfassen ist pausiert.' : 'Nachfassen läuft automatisch nach den Stufen in den Einstellungen.'}</span>
				<button type="submit" class="kd-knopf hell klein">{data.nachfassen.pausiert ? 'Fortsetzen' : 'Pausieren'}</button>
			</form>
		{:else}
			<p class="kd-info">
				{angebot.status === 'entwurf' ? 'Startet, sobald das Angebot versendet ist.' : 'Beendet – das Angebot ist angenommen bzw. abgelehnt.'}
			</p>
		{/if}
		{#if data.mail}<div class="an-nf-mail"><MailAnKunde vorbereitung={data.mail} /></div>{/if}
		{#each data.nachfassen.laeufe as l (l.id)}
			<article class="an-nf-lauf">
				<header>
					<strong>Stufe {l.stufeNr} · nach {l.tage} Tagen</strong>
					<span class="kd-info">
						{new Date(l.angelegt).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' })}{#if l.todoId} · Aufgabe {l.todoErledigt ? 'erledigt' : 'offen'}{l.zustaendigName ? ` (${l.zustaendigName})` : ''}{/if}{#if l.gesendetAm} · Mail gesendet {new Date(l.gesendetAm).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' })}{/if}
					</span>
				</header>
				{#if l.mailText && l.mailBetreff}
					<p class="an-nf-betreff"><span class="kd-info">An:</span> {l.mailAn ?? 'keine E-Mail beim Kunden'} · <span class="kd-info">Betreff:</span> {l.mailBetreff}</p>
					<details>
						<summary class="kd-info">Mailtext ansehen</summary>
						<pre class="an-nf-text">{l.mailText}</pre>
					</details>
					<div class="an-nf-knoepfe">
						<button type="button" class="kd-knopf hell" onclick={() => kopiere(l.id, `${l.mailBetreff}\n\n${l.mailText}`)}>
							{kopiert === l.id ? 'Kopiert ✓' : 'Text kopieren'}
						</button>
						<a class="kd-knopf hell" href={mailtoLink(l.mailAn, l.mailBetreff, l.mailText)}>In Mailprogramm öffnen</a>
						{#if !l.gesendetAm}
							<form method="POST" action="?/nachfassenGesendet" use:enhance>
								<input type="hidden" name="id" value={l.id} />
								<button type="submit" class="kd-knopf">Als gesendet markieren</button>
							</form>
						{/if}
					</div>
				{/if}
			</article>
		{/each}
	</section>
	{#if ohnePreis > 0}
		<p class="kt-hinweis warnung">{ohnePreis === 1 ? '1 Position' : `${ohnePreis} Positionen`} ohne Preis.</p>
	{/if}

	<label class="an-schluss">Schlusstext <textarea bind:value={kopf.schluss} maxlength="2000" rows="2" disabled={!entwurf}></textarea></label>

	{#if fehler}<p role="alert" class="kd-fehler">{fehler}</p>{/if}
	{#if meldung}<p role="status" class="kt-hinweis ok">{meldung}</p>{/if}
	{#if geaendert}<p class="kd-info">Ungespeicherte Änderungen.</p>{/if}

	<div class="an-aktionen">
		{#if entwurf}
			<button type="button" class="kd-knopf" onclick={speichern} disabled={arbeitet || !geaendert}>Speichern</button>
		{/if}
		<button type="button" class="kd-knopf hell" onclick={pdf} disabled={arbeitet}>
			{lexware ? (angebot.lexware?.id ? 'PDF (Lexware) herunterladen' : 'Vorschau-PDF') : 'PDF herunterladen'}
		</button>
		<a class="kd-knopf hell" href={`/api/angebote/${angebot.id}/lexware-json`} download title="Angebot im Format der Lexware-Schnittstelle (nur zum Prüfen, ohne Verbindung)" data-testid="angebot-lexware-json">Lexware-JSON herunterladen</a>
		{#if angebot.status === 'entwurf' && !angebot.altbeleg}
			<button type="button" class="kd-knopf hell" onclick={versenden} disabled={arbeitet || zeilen.length === 0}>
				{lexware ? 'Versenden (in Lexware festschreiben)' : 'Als versendet markieren'}
			</button>
		{:else if angebot.status === 'versendet'}
			{#if angebot.terminvorschlaege.length > 0}
				<label class="an-terminwahl">
					Baubeginn
					<Auswahl bind:value={terminWahl}>
						<option value="">– nicht gewählt –</option>
						{#each angebot.terminvorschlaege as t (t.id)}<option value={t.id}>{tagText(t.beginn)}</option>{/each}
						<option value="keiner">Keiner passt (Kunden anrufen)</option>
					</Auswahl>
				</label>
			{/if}
			<button type="button" class="kd-knopf hell" onclick={() => status('angenommen', 'Angebot angenommen.', terminWahl ? { termin: terminWahl } : {})} disabled={arbeitet}>Angenommen</button>
			<button type="button" class="kd-knopf hell" onclick={() => status('abgelehnt', 'Angebot abgelehnt.')} disabled={arbeitet}>Abgelehnt</button>
			{#if !lexware}
				<button type="button" class="kd-knopf hell" onclick={() => status('entwurf', 'Zurück zum Entwurf.')} disabled={arbeitet}>Zurück zum Entwurf</button>
			{:else if !angebot.lexware?.id}
				<button type="button" class="kd-knopf hell" onclick={() => status('entwurf', 'Versand zurückgenommen.')} disabled={arbeitet}>Versand zurücknehmen</button>
			{/if}
		{/if}
		{#if !entwurf}
			<button type="button" class="kd-knopf hell" onclick={neueVersion} disabled={arbeitet}>Als neue Version bearbeiten</button>
		{/if}
	</div>
</main>

<style>
	.an-kopf-titel {
		min-width: 0;
	}
	.an-titelzeile {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.75rem;
	}

	.an-terminwahl {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}
	.an-nf-mail {
		margin: 0.5rem 0;
	}
	.an-nachfassen {
		margin: 1.5rem 0;
		display: grid;
		gap: 0.6rem;
	}
	.an-nachfassen h2 {
		margin: 0;
		font-size: 1.125rem;
	}
	.an-nf-pause {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}
	.an-nf-lauf {
		padding: 0.75rem 1rem;
		border: 1px solid var(--m365-rand);
		border-radius: var(--m365-radius);
		background: var(--m365-flaeche);
		display: grid;
		gap: 0.4rem;
	}
	.an-nf-lauf header {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		align-items: baseline;
	}
	.an-nf-betreff {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.an-nf-text {
		white-space: pre-wrap;
		font: inherit;
		font-size: 0.875rem;
		margin: 0.4rem 0 0;
	}
	.an-nf-knoepfe {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.an-ampel {
		margin: 1rem 0;
		padding: 0.75rem 1rem;
		border: 1px solid color-mix(in srgb, var(--ampel, var(--ui-grau)) 30%, transparent);
		border-radius: var(--ui-radius-karte);
		background: color-mix(in srgb, var(--ampel, var(--ui-grau)) 6%, var(--ui-flaeche));
		background: var(--m365-flaeche);
	}
	.ampel-gruen {
		--ampel: var(--m365-erfolg);
	}
	.ampel-gelb {
		--ampel: #e0a800;
	}
	.ampel-rot {
		--ampel: var(--m365-fehler);
	}
	.an-ampel-kopf {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.an-ampel-punkt {
		width: 0.9rem;
		height: 0.9rem;
		border-radius: 50%;
		background: var(--ampel, var(--m365-rand-stark));
	}
	.an-ampel dl {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
		gap: 0.5rem 1rem;
		margin: 0.6rem 0;
	}
	.an-ampel dt {
		font-size: 0.8125rem;
		color: var(--m365-text-leise);
	}
	.an-ampel dd {
		margin: 0;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.an-ampel dd.minus {
		color: var(--m365-fehler);
	}
	.an-seite {
		max-width: none; /* ganze Arbeitsfläche (Jamil msg 2838) */
	}
	.an-kopf {
		margin-bottom: 0.5rem;
	}
	.an-hinzu {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.5rem;
		margin: 0.75rem 0;
	}
	@media (min-width: 700px) {
		.an-hinzu {
			display: flex;
		}
	}
	.an-katalog {
		padding: 0.75rem;
		border: 1px solid var(--primaer);
		border-radius: 0.5rem;
		background: var(--primaer-hell);
	}
	.an-zuordnen {
		margin: 0.75rem 0;
	}
	.an-zuordnen-art {
		display: flex;
		gap: 1.25rem;
		margin-bottom: 0.5rem;
	}
	.an-zuordnen-art label {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-height: var(--tippziel, 44px);
	}
	.an-treffer {
		width: 100%;
		min-height: var(--tippziel, 44px);
		text-align: left;
		background: none;
		border: none;
		padding: 0.5rem 0.75rem;
		cursor: pointer;
		font: inherit;
	}
	.an-vorlage-wahl {
		display: grid;
		gap: 0.5rem;
	}
	.an-vorlage-wahl select {
		min-height: var(--tippziel, 44px);
	}
	@media (min-width: 700px) {
		.an-vorlage-wahl {
			grid-template-columns: minmax(0, 1fr) auto;
		}
	}
	.an-katalog h3 {
		margin: 0 0 0.5rem;
		font-size: 1rem;
	}
	.an-schluss {
		display: grid;
		gap: 0.25rem;
		margin: 0.75rem 0;
	}
	.an-aktionen {
		display: grid;
		gap: 0.5rem;
		margin: 1rem 0 2rem;
	}
	@media (min-width: 700px) {
		.an-aktionen {
			display: flex;
			flex-wrap: wrap;
		}
	}
	.an-aktionen :disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
