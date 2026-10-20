import { inEinerTransaktion } from '../db';
import { ApiFehler } from '../fehler';
import { betriebKontext } from '../rechte';
import { legeAuftragAn, sichtVon } from '../auftraege';
import { legeKundeAn, UUID } from '../kunden';
import { aendereEinsatz, holeEinsatz, legeEinsatzAn, ABWESENHEIT_NAMEN, type Einsatz } from '../plantafel';
import { legeTodoAn, todoSichtVon } from '../todos';
import { entwirfAngebot, entwurfHinweise } from '../ki/angebot-entwurf';
import { AKTIONEN, type AktionsName } from './aktionen';
import { neueZeiten, type Auswahl } from './aufloesen';
import { pruefeSprachZugang } from './befehl';
import { pruefeAktionsRechte } from './rechte';
import { gibFrei, markiereBenutzt, pruefeVorschlag } from './vorschlag';

/**
 * Führt einen bestätigten Sprach-Vorschlag aus: Vorschlag prüfen (Signatur, Ablauf, Benutzer/Betrieb, nur einmal),
 * Rechte wie in der Oberfläche **vor** dem Schreiben, Auswahl bei Mehrdeutigkeit nur aus den signierten Optionen –
 * dann über dieselben Dienste wie die Oberfläche (`legeKundeAn`, `legeAuftragAn`, `legeEinsatzAn`, …) in EINER
 * Transaktion mit `app.quelle = 'sprache'` (Änderungsprotokoll).
 */

export type Ausfuehrung = { meldung: string; link: string | null; warnungen: string[]; status: 200 | 201 };

/** Ergänzt die Werte um die Auswahl des Nutzers; nur signierte Optionen, jede offene Auswahl ist Pflicht. */
export function wendeAuswahlAn(werte: Record<string, any>, offen: Auswahl[], auswahl: unknown): Record<string, any> {
	const gewaehlt = (auswahl ?? {}) as Record<string, unknown>;
	if (auswahl !== undefined && auswahl !== null && (typeof auswahl !== 'object' || Array.isArray(auswahl))) {
		throw new ApiFehler(400, 'Ungültige Auswahl.');
	}
	const felder = new Set(offen.map((a) => a.feld));
	for (const f of Object.keys(gewaehlt)) if (!felder.has(f)) throw new ApiFehler(400, 'Ungültige Auswahl.');
	const w = structuredClone(werte);
	for (const a of offen) {
		const id = gewaehlt[a.feld];
		if (id === undefined || id === null || id === '') throw new ApiFehler(400, `Bitte wählen: ${a.frage}`);
		if (typeof id !== 'string' || !a.optionen.some((o) => o.id === id)) throw new ApiFehler(400, 'Ungültige Auswahl.');
		const m = /^mitarbeiter\.(\d+)$/.exec(a.feld);
		if (m && Array.isArray(w.mitarbeiterIds)) w.mitarbeiterIds[Number(m[1])] = id;
		else if (m) w.einsaetze[Number(m[1])].benutzerId = id;
		else if (a.feld === 'kunde') w.kundeId = id;
		else if (a.feld === 'zustaendig') w.zustaendigId = id;
		else if (a.feld === 'auftrag') w.auftragId = id;
		else if (a.feld === 'einsatz') w.einsatzId = id;
		else if (a.feld === 'vorlage') w.vorlageId = id;
		else if (a.feld === 'todo') w.todoId = id;
		else if (a.feld === 'objekt') w.objektId = id;
		else if (a.feld === 'angebot') w.angebotId = id;
		else if (a.feld === 'quelle') w.quelleId = id;
		else throw new ApiFehler(400, 'Ungültige Auswahl.');
	}
	return w;
}

/** Plantafel-Warnungen als Text: „Ali Monteur: Doppelbelegung“, „Ali Monteur: Urlaub“. */
function warnTexte(einsaetze: Einsatz[]): string[] {
	const texte = new Set<string>();
	for (const e of einsaetze) {
		for (const w of e.warnungen) {
			texte.add(`${e.benutzerName}: ${w.art === 'doppelt' ? 'Doppelbelegung' : ABWESENHEIT_NAMEN[w.art]}`);
		}
	}
	return [...texte];
}

type Inhalt = { aktion: AktionsName; werte: Record<string, any>; auswahl: Auswahl[] };

function pruefeInhalt(x: any): Inhalt {
	if (!x || typeof x !== 'object' || !(AKTIONEN as readonly string[]).includes(x.aktion) || !x.werte || !Array.isArray(x.auswahl)) {
		throw new ApiFehler(400, 'Der Vorschlag ist ungültig – bitte noch einmal sprechen.');
	}
	return x as Inhalt;
}

export async function fuehreAus(locals: { nutzer: Nutzer | null }, token: unknown, auswahl?: unknown): Promise<Ausfuehrung> {
	await pruefeSprachZugang(locals);
	const k = betriebKontext(locals);
	const nutzer = locals.nutzer!;
	if (typeof token !== 'string' || token === '') throw new ApiFehler(400, 'Der Vorschlag fehlt.');
	const geprueft = pruefeVorschlag(token, nutzer.id, k.betriebId);
	const inhalt = pruefeInhalt(geprueft.vorschau);
	const mitEinsaetze = inhalt.aktion === 'auftrag_anlegen' && Array.isArray(inhalt.werte.einsaetze) && inhalt.werte.einsaetze.length > 0;
	// Eigener Termin nur für sich selbst: reicht das Recht „Erinnerungen nutzen“ (msg 2682)
	const eigenerTermin =
		inhalt.aktion === 'einsatz_anlegen' && inhalt.werte.eigen === true && Array.isArray(inhalt.werte.einsaetze) &&
		inhalt.werte.einsaetze.length > 0 && inhalt.werte.einsaetze.every((e: { benutzerId: string | null }) => e.benutzerId === nutzer.id);
	await pruefeAktionsRechte(locals, inhalt.aktion, { mitEinsaetzen: mitEinsaetze, eigenerTermin, formular: inhalt.aktion === 'protokoll_ausfuellen' ? !!inhalt.werte.formular : undefined });
	const w = wendeAuswahlAn(inhalt.werte, inhalt.auswahl, auswahl);
	markiereBenutzt(geprueft);
	try {
		if (inhalt.aktion === 'angebot_entwurf') {
			// Eigene Transaktion erst nach der KI-Antwort (keine offene DB-Transaktion während der KI-Anfrage)
			const e = await entwirfAngebot(locals, w.auftragId, { stichworte: w.stichworte }, 'sprache');
			return { status: 201, meldung: `Angebotsentwurf ${e.nummer} angelegt – bitte prüfen`, link: `/angebote/${e.angebotId}`, warnungen: entwurfHinweise(e) };
		}
		return await inEinerTransaktion(k, 'sprache', () => ausfuehrenJe(k, nutzer, inhalt.aktion, w));
	} catch (e) {
		gibFrei(geprueft);
		throw e;
	}
}

async function ausfuehrenJe(
	k: { betriebId: string; benutzerId: string },
	nutzer: Nutzer,
	aktion: AktionsName,
	w: Record<string, any>
): Promise<Ausfuehrung> {
	switch (aktion) {
		case 'kunde_anlegen': {
			const kd = await legeKundeAn(k, w.kunde ?? {});
			return { status: 201, meldung: `Kunde „${kd.name}“ angelegt`, link: `/kunden/${kd.id}`, warnungen: [] };
		}
		case 'auftrag_anlegen': {
			const a = await legeAuftragAn(k, {
				titel: w.titel,
				kundeId: w.kundeId,
				objektId: w.objektId ?? null,
				beschreibung: w.beschreibung ?? null,
				geplantAb: w.geplantAb ?? null,
				quelleId: w.quelleId ?? null
			});
			const einsaetze: Einsatz[] = [];
			for (const e of (w.einsaetze ?? []) as { benutzerId: string; beginn: string; ende: string }[]) {
				einsaetze.push(await legeEinsatzAn(k, { auftragId: a.id, benutzerId: e.benutzerId, beginn: e.beginn, ende: e.ende }));
			}
			return { status: 201, meldung: `Auftrag ${a.nummer} „${a.titel}“ angelegt`, link: `/auftraege/${a.id}`, warnungen: warnTexte(einsaetze) };
		}
		case 'todo_anlegen': {
			const t = await legeTodoAn(
				k,
				{
					titel: w.titel,
					zustaendigId: w.zustaendigId ?? null,
					faellig: w.faellig ?? null,
					faelligZeit: w.faelligZeit ?? null,
					auftragId: w.auftragId ?? null,
					...(Array.isArray(w.erinnerungen) && w.erinnerungen.length > 0 ? { erinnerungen: w.erinnerungen } : {}),
					...(w.wiederholung ? { wiederholung: w.wiederholung, intervall: w.intervall ?? '1' } : {})
				},
				todoSichtVon(nutzer)
			);
			return {
				status: 201,
				meldung: t.serie ? `Wiederkehrendes To-do „${t.titel}“ angelegt (${t.serie.text})` : `To-do „${t.titel}“ angelegt`,
				link: t.auftragId ? `/auftraege/${t.auftragId}` : '/todos',
				warnungen: []
			};
		}
		case 'einsatz_anlegen': {
			if (w.gruppe) {
				// Mehrtägig und/oder Kolonne (msgs 2510, 2513)
				const { legeGruppeAn } = await import('../plantafel');
				const g = await legeGruppeAn(k, {
					...w.gruppe,
					auftragId: w.auftragId,
					benutzerIds: ((w.mitarbeiterIds ?? []) as (string | null)[]).filter(Boolean)
				});
				const tage = new Set(g.einsaetze.map((e) => tagVon(new Date(e.beginn)))).size;
				return {
					status: 201,
					meldung: `Termin an ${tage} Tag${tage === 1 ? '' : 'en'} eingeplant (${g.einsaetze.length} Einsätze)`,
					link: `/plantafel?tag=${encodeURIComponent(w.gruppe.vonTag)}`,
					warnungen: warnTexte(g.einsaetze)
				};
			}
			const einsaetze: Einsatz[] = [];
			const liste = (w.einsaetze ?? []) as { benutzerId: string; beginn: string; ende: string }[];
			// Erinnerungen (msgs 2679/2682) an den Termin des Sprechenden, sonst an den ersten
			const mitErinnerung = Math.max(0, liste.findIndex((e) => e.benutzerId === nutzer.id));
			for (const [i, e] of liste.entries()) {
				einsaetze.push(
					await legeEinsatzAn(k, {
						auftragId: w.eigen ? null : w.auftragId,
						...(w.eigen ? { titel: w.titel } : {}),
						benutzerId: e.benutzerId,
						beginn: e.beginn,
						ende: e.ende,
						notiz: w.notiz ?? null,
						...(i === mitErinnerung && Array.isArray(w.erinnerungen) && w.erinnerungen.length > 0 ? { erinnerungen: w.erinnerungen } : {})
					})
				);
			}
			const tag = einsaetze[0] ? new Date(einsaetze[0].beginn) : null;
			return {
				status: 201,
				meldung: w.eigen ? `Eigener Termin „${w.titel}“ eingetragen` : einsaetze.length === 1 ? 'Termin eingeplant' : `${einsaetze.length} Termine eingeplant`,
				link: tag ? `/plantafel?tag=${encodeURIComponent(tagVon(tag))}` : '/plantafel',
				warnungen: warnTexte(einsaetze)
			};
		}
		case 'einsatz_verschieben': {
			if (typeof w.einsatzId !== 'string' || !UUID.test(w.einsatzId)) throw new ApiFehler(400, 'Ungültiger Termin.');
			const alt = await holeEinsatz(k, w.einsatzId);
			const neu = neueZeiten(new Date(alt.beginn), new Date(alt.ende), w.nachTag, w.nachUhrzeit ?? null);
			const e = await aendereEinsatz(k, alt.id, { beginn: neu.beginn.toISOString(), ende: neu.ende.toISOString() });
			return { status: 200, meldung: 'Termin verschoben', link: `/plantafel?tag=${tagVon(neu.beginn)}`, warnungen: warnTexte([e]) };
		}
		case 'angebot_entwurf':
			throw new Error('angebot_entwurf läuft nicht über ausfuehrenJe');
		case 'mitarbeiter_zuweisen':
		case 'status_aendern':
		case 'todo_abhaken':
		case 'anlage_anlegen':
		case 'nachfassen_pausieren':
		case 'angebot_entscheidung':
		case 'quelle_setzen':
			return neueAktionen(k, nutzer, aktion, w);
		case 'abfrage_tagesplan':
		case 'route_heute':
		case 'abfrage_auslastung':
		case 'abfrage_monatsgewinn':
		case 'abfrage_nachfassen':
		case 'kalender_zeigen':
		case 'buchungslink_zeigen':
		case 'abfrage_nachkalkulation':
		case 'abfrage_verlust':
		case 'portallink_zeigen':
		case 'foto_aufmass':
			throw new ApiFehler(400, 'Fragen werden ohne Bestätigung beantwortet.');
		case 'dienst_anlegen': {
			const { legeDienstAn } = await import('../buchung');
			const ids = (w.mitarbeiterIds as (string | null)[]).filter((x): x is string => !!x);
			const d = await legeDienstAn(k, { name: w.dienst?.name, dauerMin: w.dienst?.dauerMin, modus: ids.length === 1 ? 'fest' : 'beliebig' }, ids);
			return { status: 201, meldung: `Dienst „${d.name}“ angelegt`, link: `/einstellungen/online-buchung/${d.id}`, warnungen: [] };
		}
		case 'protokoll_ausfuellen': {
			if (w.formular) {
				// Frei gestaltete Vorlage: Protokoll starten und den Assistenten öffnen
				const { starteProtokoll } = await import('../protokoll-formulare');
				const p = await starteProtokoll(k, sichtVon(nutzer), { vorlageId: w.vorlageId, auftragId: w.auftragId });
				return { status: 201, meldung: `Protokoll „${p.titel}“ gestartet`, link: `/protokolle/${p.id}`, warnungen: [] };
			}
			const { legeProtokollAn } = await import('../baustellen-protokolle');
			const prot = await legeProtokollAn(k, w.auftragId, w.typ, w.inhalt, nutzer.id);
			return { status: 201, meldung: `Protokoll ${PROTOKOLL_TYP_TITEL[prot.typ] ?? prot.typ} gespeichert`, link: `/auftraege/${prot.auftragId}/dokumentation`, warnungen: [] };
		}
	}
}

async function neueAktionen(k: { betriebId: string; benutzerId: string }, nutzer: Nutzer, aktion: AktionsName, w: Record<string, any>): Promise<Ausfuehrung> {
	switch (aktion) {
		case 'mitarbeiter_zuweisen': {
			const { aendereAuftrag, holeAuftrag } = await import('../auftraege');
			const a = await holeAuftrag(k, sichtVon(nutzer), w.auftragId);
			const ids = [...new Set([...a.zustaendige.map((z) => z.id), ...(w.mitarbeiterIds as string[])])];
			const neu = await aendereAuftrag(k, a.id, { zustaendige: ids }, sichtVon(nutzer));
			return { status: 200, meldung: `Zuständig für ${neu.nummer}: ${neu.zustaendige.map((z) => z.name).join(', ')}`, link: `/auftraege/${neu.id}`, warnungen: [] };
		}
		case 'status_aendern': {
			const { setzeStatus } = await import('../auftraege');
			const { STATUS_NAMEN, istStatus } = await import('../../auftrag-status');
			if (!istStatus(w.status)) throw new ApiFehler(400, 'Bitte den neuen Status nennen.');
			const a = await setzeStatus(k, w.auftragId, w.status, sichtVon(nutzer), { sprung: true });
			return { status: 200, meldung: `Auftrag ${a.nummer} ist jetzt „${STATUS_NAMEN[a.status]}“`, link: `/auftraege/${a.id}`, warnungen: [] };
		}
		case 'todo_abhaken': {
			const { aendereTodo, setzeErledigt, todoSichtVon: tsv } = await import('../todos');
			const { hatRecht } = await import('../rechte');
			const t = hatRecht(nutzer, 'auftraege.bearbeiten')
				? await aendereTodo(k, w.todoId, { erledigt: true }, tsv(nutzer))
				: await setzeErledigt(k, tsv(nutzer), w.todoId, true);
			return { status: 200, meldung: `To-do „${t.titel}“ erledigt`, link: t.auftragId ? `/auftraege/${t.auftragId}` : '/todos', warnungen: [] };
		}
		case 'anlage_anlegen': {
			const { legeAnlageAn } = await import('../anlagen');
			const an = await legeAnlageAn(k, w.kundeId, w.objektId, w.anlage);
			return { status: 201, meldung: `Anlage „${an.bezeichnung}“ angelegt`, link: `/anlagen/${an.id}`, warnungen: [] };
		}
		case 'quelle_setzen': {
			const { aendereAuftrag } = await import('../auftraege');
			const a = await aendereAuftrag(k, w.auftragId, { quelleId: w.quelleId }, sichtVon(nutzer));
			return { status: 200, meldung: `Auftragsquelle von ${a.nummer}: ${a.quelleName}`, link: `/auftraege/${a.id}`, warnungen: [] };
		}
		case 'angebot_entscheidung': {
			const { setzeAngebotStatus } = await import('../angebote');
			const zg = { sicht: sichtVon(nutzer), auftragAendern: (await import('../rechte')).hatRecht(nutzer, 'auftraege.bearbeiten') };
			const a = await setzeAngebotStatus(k, w.angebotId, w.status, zg, 'sprache');
			return { status: 200, meldung: `Angebot ${a.nummer} ist ${w.status}`, link: `/angebote/${a.id}`, warnungen: a.hinweis ? [a.hinweis] : [] };
		}
		case 'nachfassen_pausieren': {
			const { setzeNachfassenPausiert } = await import('../nachfassen');
			await setzeNachfassenPausiert(k, w.angebotId, !!w.pausiert);
			return { status: 200, meldung: w.pausiert ? 'Nachfassen pausiert' : 'Nachfassen läuft wieder', link: `/angebote/${w.angebotId}#nachfassen`, warnungen: [] };
		}
		default:
			throw new Error(`Aktion ${aktion} nicht ausführbar`);
	}
}

const PROTOKOLL_TYP_TITEL: Record<string, string> = {
	abnahme: 'Abnahme',
	regiebericht: 'Regiebericht',
	aufmass: 'Aufmaß',
	maengelliste: 'Mängelliste'
};

const tagVon = (d: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(d);

