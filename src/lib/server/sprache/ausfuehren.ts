import { inEinerTransaktion } from '../db';
import { ApiFehler } from '../fehler';
import { betriebKontext } from '../rechte';
import { legeAuftragAn } from '../auftraege';
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
		if (m) w.einsaetze[Number(m[1])].benutzerId = id;
		else if (a.feld === 'kunde') w.kundeId = id;
		else if (a.feld === 'zustaendig') w.zustaendigId = id;
		else if (a.feld === 'auftrag') w.auftragId = id;
		else if (a.feld === 'einsatz') w.einsatzId = id;
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
	await pruefeAktionsRechte(locals, inhalt.aktion, { mitEinsaetzen: mitEinsaetze });
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
				geplantAb: w.geplantAb ?? null
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
				{ titel: w.titel, zustaendigId: w.zustaendigId ?? null, faellig: w.faellig ?? null, auftragId: w.auftragId ?? null },
				todoSichtVon(nutzer)
			);
			return { status: 201, meldung: `To-do „${t.titel}“ angelegt`, link: t.auftragId ? `/auftraege/${t.auftragId}` : '/todos', warnungen: [] };
		}
		case 'einsatz_anlegen': {
			const einsaetze: Einsatz[] = [];
			for (const e of (w.einsaetze ?? []) as { benutzerId: string; beginn: string; ende: string }[]) {
				einsaetze.push(await legeEinsatzAn(k, { auftragId: w.auftragId, benutzerId: e.benutzerId, beginn: e.beginn, ende: e.ende, notiz: w.notiz ?? null }));
			}
			const tag = einsaetze[0] ? new Date(einsaetze[0].beginn) : null;
			return {
				status: 201,
				meldung: einsaetze.length === 1 ? 'Termin eingeplant' : `${einsaetze.length} Termine eingeplant`,
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
		case 'protokoll_ausfuellen': {
			const { legeProtokollAn } = await import('../baustellen-protokolle');
			const prot = await legeProtokollAn(k, w.auftragId, w.typ, w.inhalt, nutzer.id);
			return { status: 201, meldung: `Protokoll ${PROTOKOLL_TYP_TITEL[prot.typ] ?? prot.typ} gespeichert`, link: `/auftraege/${prot.auftragId}/dokumentation`, warnungen: [] };
		}
	}
}

const PROTOKOLL_TYP_TITEL: Record<string, string> = {
	abnahme: 'Abnahme',
	regiebericht: 'Regiebericht',
	aufmass: 'Aufmaß',
	maengelliste: 'Mängelliste'
};

const tagVon = (d: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(d);

