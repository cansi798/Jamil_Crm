/**
 * Leitfaden beim Termin – Fachlogik (Wunsch Jamil, Talk msgs 4302/4304; Entscheidungen 4340: 1c / 2b / 3a / 4b).
 * Regeln und Prüfungen der Schritte: `src/lib/leitfaden.ts`; Tabellen: Migration 116.
 *
 * Wer darf ausfüllen? Die für den Termin eingeteilte Person – oder wer die Plantafel bearbeiten darf (Büro/Chef).
 * Kundendaten-Schritte schreiben direkt in die Kundenakte (nur E-Mail, Telefon, bevorzugter Kontaktweg, Adresse – auch
 * ohne das Recht „Kunden bearbeiten“, weil genau das der Auftrag des Leitfadens ist); Fotos landen in den Dokumenten
 * des Auftrags; beim Abschluss entstehen die gewählten Aufgaben und eine Zusammenfassung als Notiz am Auftrag. Alles in
 * EINER Transaktion mit der Quelle „leitfaden“ im Änderungsprotokoll.
 *
 * Offline (4b): Jede Eingabe hat eine Kennung (`opId`). Kommt dieselbe Eingabe zweimal an, wirkt sie nur einmal; je
 * Schritt gewinnt die spätere Eingabe (Zeitpunkt vom Gerät). Fremde/unbekannte Termine sind immer 404.
 */
import { inEinerTransaktion, mitBetrieb, systemAbfrage, type Kontext, type TransactionSql } from './db';
import { ApiFehler } from './fehler';
import { hatRecht } from './rechte';
import { hatModul } from './tarif';
import { anzeigeName, pruefeKundeEingabe, UUID } from './kunden';
import { pruefeDateiInhalt } from './kundenakte';
import {
	fehlendePflicht,
	fortschritt,
	giltFuer,
	MAX_BEGRUENDUNG,
	pruefeSchritte,
	pruefeWert,
	STARTVORLAGE,
	text,
	uebernimm,
	zusammenfassung,
	type Adresse,
	type Antworten,
	type AufgabeWert,
	type LeitfadenKunde,
	type LeitfadenProtokoll,
	type LeitfadenProtokolle,
	type LeitfadenStatus,
	type ProtokollEingabe,
	type Schritt
} from '../leitfaden';
import {
	schliesseAb as schliesseProtokollAb,
	speichereAntworten as speichereProtokollAntworten,
	speichereFoto as speichereProtokollFoto,
	speichereUnterschrift as speichereProtokollUnterschrift,
	starteProtokoll
} from './protokoll-formulare';
import { fehlendeFelder } from '../protokoll-formular';

export type LeitfadenEinstellung = {
	aktiv: boolean;
	name: string;
	arten: string[];
	terminarten: string[];
	schritte: Schritt[];
	version: number;
	/** false = noch nie gespeichert (Startvorlage) */
	gespeichert: boolean;
};

export type LeitfadenStand = {
	id: string;
	einsatzId: string | null;
	auftragId: string;
	auftragNummer: string;
	auftragTitel: string;
	kundeId: string | null;
	kundeName: string;
	terminBeginn: string | null;
	benutzerId: string | null;
	benutzerName: string | null;
	name: string;
	schritte: Schritt[];
	antworten: Antworten;
	kunde: LeitfadenKunde | null;
	/** Protokolle der Schritte „Protokoll ausfüllen“ (Jamil msg 4353) */
	protokolle: LeitfadenProtokolle;
	status: LeitfadenStatus;
	begruendung: string | null;
	abgeschlossenAm: string | null;
	abgeschlossenVon: string | null;
	fortschritt: { erledigt: number; gesamt: number };
	fehlend: string[];
};

export type Eingabe = { opId: string; schrittId: string; wert: unknown; zeit: string };

const ARTEN = ['besichtigung', 'montage', 'wartung'];
/** Die Leitfaden-Prüfung (eingeteilte Person bzw. Plantafel) ersetzt beim Protokoll die Auftragssicht. */
const ALLE = (k: Kontext) => ({ alle: true, benutzerId: k.benutzerId });
const nichtGefunden = () => new ApiFehler(404, 'Termin nicht gefunden.');
const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);

// ——— Einstellungen (3a: einer je Firma, 1c: Arten/Terminarten) ———

export async function ladeEinstellung(k: Kontext): Promise<LeitfadenEinstellung> {
	return mitBetrieb(k, async (tx) => {
		const [z] = await tx`select aktiv, name, arten, terminarten, schritte, version from app.leitfaden_vorlagen where betrieb_id = ${k.betriebId}`;
		if (!z) return { aktiv: false, name: 'Leitfaden Besichtigung', arten: ['besichtigung'], terminarten: [], schritte: STARTVORLAGE, version: 0, gespeichert: false };
		return { aktiv: z.aktiv, name: z.name, arten: z.arten, terminarten: z.terminarten.map(String), schritte: z.schritte, version: z.version, gespeichert: true };
	});
}

/** Speichert den Leitfaden der Firma. Schritte werden geprüft; Version +1, wenn sich die Schritte ändern. */
export async function speichereEinstellung(k: Kontext, e: Record<string, unknown>): Promise<LeitfadenEinstellung> {
	const name = text(e.name, 100);
	if (!name) throw new ApiFehler(400, 'Bitte einen Namen für den Leitfaden eingeben.');
	let schritte: Schritt[];
	try {
		schritte = pruefeSchritte(e.schritte);
	} catch (f) {
		throw new ApiFehler(400, (f as Error).message);
	}
	const arten = Array.isArray(e.arten) ? [...new Set(e.arten.filter((a): a is string => typeof a === 'string' && ARTEN.includes(a)))] : [];
	const roh = Array.isArray(e.terminarten) ? e.terminarten.filter((t): t is string => typeof t === 'string' && UUID.test(t)) : [];
	const aktiv = e.aktiv === true;
	return mitBetrieb(k, async (tx) => {
		// nur Terminarten des eigenen Betriebs
		const terminarten = roh.length
			? (await tx`select id from app.buchung_dienste where betrieb_id = ${k.betriebId} and id = any(${roh}::uuid[])`).map((z) => String(z.id))
			: [];
		if (aktiv && arten.length === 0 && terminarten.length === 0) {
			throw new ApiFehler(400, 'Bitte mindestens eine Termin-Art anhaken, bei der der Leitfaden erscheinen soll.');
		}
		const [z] = await tx`
			insert into app.leitfaden_vorlagen (betrieb_id, aktiv, name, arten, terminarten, schritte)
			values (${k.betriebId}, ${aktiv}, ${name}, ${arten}, ${terminarten}::uuid[], ${tx.json(schritte)})
			on conflict (betrieb_id) do update set aktiv = excluded.aktiv, name = excluded.name, arten = excluded.arten,
				terminarten = excluded.terminarten, schritte = excluded.schritte,
				version = app.leitfaden_vorlagen.version + case when app.leitfaden_vorlagen.schritte = excluded.schritte then 0 else 1 end
			returning aktiv, name, arten, terminarten, schritte, version`;
		return { aktiv: z.aktiv, name: z.name, arten: z.arten, terminarten: z.terminarten.map(String), schritte: z.schritte, version: z.version, gespeichert: true };
	});
}

// ——— Termin, Zugriff, Durchlauf ———

type Termin = {
	id: string;
	auftragId: string | null;
	benutzerId: string;
	art: string;
	terminartId: string | null;
	kundeId: string | null;
};

async function ladeTermin(tx: TransactionSql, k: Kontext, einsatzId: string): Promise<Termin> {
	if (!UUID.test(einsatzId)) throw nichtGefunden();
	const [z] = await tx`
		select e.id, e.auftrag_id, e.benutzer_id, e.art, e.terminart_id, a.kunde_id
		from app.einsaetze e left join app.auftraege a on a.id = e.auftrag_id and a.betrieb_id = e.betrieb_id
		where e.id = ${einsatzId} and e.betrieb_id = ${k.betriebId}`;
	if (!z) throw nichtGefunden();
	return { id: z.id, auftragId: z.auftrag_id, benutzerId: z.benutzer_id, art: z.art, terminartId: z.terminart_id, kundeId: z.kunde_id };
}

/** Eingeteilte Person oder Plantafel-Bearbeiter (Büro/Chef). Andere sehen den Termin gar nicht (404). */
function pruefeAusfuellen(nutzer: Nutzer, t: Termin): void {
	if (t.benutzerId !== nutzer.id && !hatRecht(nutzer, 'plantafel.bearbeiten')) throw nichtGefunden();
}

async function pruefeModulPlantafel(k: Kontext): Promise<void> {
	if (!(await hatModul(k.betriebId, 'plantafel'))) throw new ApiFehler(402, 'Im aktuellen Tarif nicht enthalten');
}

const STAND_SQL = `d.id, d.einsatz_id, d.auftrag_id, d.benutzer_id, d.name, d.schritte, d.antworten, d.status, d.begruendung,
	d.abgeschlossen_am, d.ergebnis, a.nummer, a.titel, a.kunde_id, e.beginn as termin_beginn, b.name as benutzer_name,
	ab.name as abgeschlossen_von_name,
	k.art as kunde_art, k.firma as kunde_firma, k.vorname as kunde_vorname, k.nachname as kunde_nachname,
	k.email::text as kunde_email, k.telefon as kunde_telefon, k.bevorzugter_kontakt as kunde_kontaktweg,
	k.strasse as kunde_strasse, k.plz as kunde_plz, k.ort as kunde_ort, a.einmal_name`;
function zuStand(z: Record<string, any>, protokolle: LeitfadenProtokolle = {}): LeitfadenStand {
	const kunde: LeitfadenKunde | null = z.kunde_id
		? { email: z.kunde_email, telefon: z.kunde_telefon, bevorzugter_kontakt: z.kunde_kontaktweg, strasse: z.kunde_strasse, plz: z.kunde_plz, ort: z.kunde_ort }
		: null;
	const schritte = z.schritte as Schritt[];
	const antworten = (z.antworten ?? {}) as Antworten;
	return {
		id: z.id,
		einsatzId: z.einsatz_id,
		auftragId: z.auftrag_id,
		auftragNummer: z.nummer,
		auftragTitel: z.titel,
		kundeId: z.kunde_id,
		kundeName: z.kunde_art ? anzeigeName({ art: z.kunde_art, firma: z.kunde_firma, vorname: z.kunde_vorname, nachname: z.kunde_nachname }) : (z.einmal_name ?? ''),
		terminBeginn: iso(z.termin_beginn),
		benutzerId: z.benutzer_id,
		benutzerName: z.benutzer_name ?? null,
		name: z.name,
		schritte,
		antworten,
		kunde,
		protokolle,
		status: z.status,
		begruendung: z.begruendung,
		abgeschlossenAm: iso(z.abgeschlossen_am),
		abgeschlossenVon: z.abgeschlossen_von_name ?? null,
		fortschritt: fortschritt(schritte, antworten, kunde, protokolle),
		fehlend: fehlendePflicht(schritte, antworten, kunde, protokolle).map((s) => s.id)
	};
}

async function ladeStand(tx: TransactionSql, k: Kontext, wo: { durchlaufId?: string; einsatzId?: string }): Promise<LeitfadenStand | null> {
	const [z] = await tx`
		select ${tx.unsafe(STAND_SQL)}
		from app.leitfaden_durchlaeufe d
		join app.auftraege a on a.id = d.auftrag_id and a.betrieb_id = d.betrieb_id
		left join app.kunden k on k.id = a.kunde_id and k.betrieb_id = a.betrieb_id
		left join app.einsaetze e on e.id = d.einsatz_id and e.betrieb_id = d.betrieb_id
		left join app.benutzer b on b.id = d.benutzer_id and b.betrieb_id = d.betrieb_id
		left join app.benutzer ab on ab.id = d.abgeschlossen_von and ab.betrieb_id = d.betrieb_id
		where d.betrieb_id = ${k.betriebId}
			and ${wo.durchlaufId ? tx`d.id = ${wo.durchlaufId}` : tx`d.einsatz_id = ${wo.einsatzId!}`}`;
	if (!z) return null;
	return zuStand(z, await ladeProtokolle(tx, k, z.schritte as Schritt[], z.ergebnis));
}

/** Protokolle der Protokoll-Schritte (Kennungen in `ergebnis.protokolle`) mit Schema der Vorlage und Antworten. */
async function ladeProtokolle(tx: TransactionSql, k: Kontext, schritte: Schritt[], ergebnis: unknown): Promise<LeitfadenProtokolle> {
	const ids = ((ergebnis as { protokolle?: Record<string, string | null> } | null)?.protokolle ?? {}) as Record<string, string | null>;
	const liste = Object.values(ids).filter((x): x is string => !!x);
	const gefunden = liste.length
		? await tx`
			select p.id, p.titel, p.antworten, p.status, p.pdf_datei_id, v.schema from app.protokolle p
			join app.protokoll_vorlagen v on v.id = p.vorlage_id and v.betrieb_id = p.betrieb_id
			where p.betrieb_id = ${k.betriebId} and p.id = any(${liste}::uuid[])`
		: [];
	const ergebnisse: LeitfadenProtokolle = {};
	for (const s of schritte) {
		if (s.typ !== 'protokoll') continue;
		const p = gefunden.find((x) => x.id === ids[s.id]);
		ergebnisse[s.id] = p
			? ({ id: p.id, titel: p.titel, schema: p.schema, antworten: p.antworten ?? {}, status: p.status, pdfDateiId: p.pdf_datei_id } satisfies LeitfadenProtokoll)
			: null;
	}
	return ergebnisse;
}

/**
 * Durchlauf zum Termin holen – gibt es keinen und passt der Termin zu den Einstellungen (1c), wird er mit einer Kopie
 * der aktuellen Vorlage angelegt. Ohne passenden Leitfaden: `null`.
 */
async function holeOderStarte(tx: TransactionSql, k: Kontext, t: Termin): Promise<LeitfadenStand | null> {
	const da = await ladeStand(tx, k, { einsatzId: t.id });
	if (da) return da;
	if (!t.auftragId) return null;
	const [v] = await tx`select aktiv, name, arten, terminarten, schritte, version from app.leitfaden_vorlagen where betrieb_id = ${k.betriebId}`;
	if (!v || !giltFuer({ aktiv: v.aktiv, arten: v.arten, terminarten: v.terminarten.map(String) }, { art: t.art, terminartId: t.terminartId, mitAuftrag: true })) return null;
	const [neu] = await tx`
		insert into app.leitfaden_durchlaeufe (betrieb_id, einsatz_id, auftrag_id, benutzer_id, name, version, schritte)
		values (${k.betriebId}, ${t.id}, ${t.auftragId}, ${t.benutzerId}, ${v.name}, ${v.version}, ${tx.json(v.schritte)})
		on conflict (einsatz_id) do nothing
		returning id`;
	// Schritte „Protokoll ausfüllen“ (Jamil msg 4353): je Schritt ein Protokoll aus der aktuellen Version der Vorlage
	if (neu) {
		const protokolle: Record<string, string | null> = {};
		for (const s of v.schritte as Schritt[]) {
			if (s.typ !== 'protokoll' || !s.vorlageGruppe) continue;
			const [pv] = await tx`
				select id from app.protokoll_vorlagen
				where betrieb_id = ${k.betriebId} and gruppe_id = ${s.vorlageGruppe} and aktuell and not archiviert and art = 'protokoll'`;
			protokolle[s.id] = pv ? (await starteProtokoll(k, ALLE(k), { vorlageId: pv.id, auftragId: t.auftragId })).id : null;
		}
		if (Object.keys(protokolle).length > 0) {
			await tx`update app.leitfaden_durchlaeufe set ergebnis = ${tx.json({ protokolle })} where id = ${neu.id} and betrieb_id = ${k.betriebId}`;
		}
	}
	return ladeStand(tx, k, { einsatzId: t.id });
}

/** Leitfaden eines Termins für die ausfüllende Person (404 ohne Zugriff, `null` = für diesen Termin kein Leitfaden). */
export async function leitfadenZumTermin(k: Kontext, nutzer: Nutzer, einsatzId: string): Promise<LeitfadenStand | null> {
	await pruefeModulPlantafel(k);
	return inEinerTransaktion(k, 'leitfaden', () =>
		mitBetrieb(k, async (tx) => {
			const t = await ladeTermin(tx, k, einsatzId);
			pruefeAusfuellen(nutzer, t);
			return holeOderStarte(tx, k, t);
		})
	);
}

/** Leitfäden zu „Meine Einsätze heute“ (für die Startseite und die Offline-Kopie): Termin-ID → Stand. */
export async function leitfaedenFuerTermine(k: Kontext, nutzer: Nutzer, einsatzIds: string[]): Promise<Map<string, LeitfadenStand>> {
	const ergebnis = new Map<string, LeitfadenStand>();
	if (einsatzIds.length === 0 || !(await hatModul(k.betriebId, 'plantafel'))) return ergebnis;
	await inEinerTransaktion(k, 'leitfaden', () =>
		mitBetrieb(k, async (tx) => {
			for (const id of einsatzIds) {
				const t = await ladeTermin(tx, k, id).catch(() => null);
				if (!t || (t.benutzerId !== nutzer.id && !hatRecht(nutzer, 'plantafel.bearbeiten'))) continue;
				const s = await holeOderStarte(tx, k, t);
				if (s) ergebnis.set(id, s);
			}
		})
	);
	return ergebnis;
}

/** Alle Leitfäden eines Auftrags (Karte „Leitfaden“ im Auftrag – die Sichtbarkeit des Auftrags prüft der Aufrufer). */
export async function leitfaedenZumAuftrag(k: Kontext, auftragId: string): Promise<LeitfadenStand[]> {
	if (!UUID.test(auftragId)) return [];
	return mitBetrieb(k, async (tx) => {
		const ids = await tx`select id from app.leitfaden_durchlaeufe where betrieb_id = ${k.betriebId} and auftrag_id = ${auftragId} order by angelegt desc`;
		const liste: LeitfadenStand[] = [];
		for (const { id } of ids) {
			const s = await ladeStand(tx, k, { durchlaufId: id });
			if (s) liste.push(s);
		}
		return liste;
	});
}

// ——— Eingaben (idempotent, spätere gewinnt) ———

const OP = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function pruefeOp(opId: unknown): string {
	if (typeof opId !== 'string' || !OP.test(opId)) throw new ApiFehler(400, 'Ungültige Kennung der Eingabe.');
	return opId.toLowerCase();
}
function pruefeZeit(zeit: unknown): string {
	const d = typeof zeit === 'string' ? new Date(zeit) : null;
	if (!d || Number.isNaN(d.getTime())) throw new ApiFehler(400, 'Ungültiger Zeitpunkt der Eingabe.');
	// Uhren von Geräten gehen falsch: höchstens 5 Minuten in die Zukunft
	return new Date(Math.min(d.getTime(), Date.now() + 5 * 60_000)).toISOString();
}

/** Schreibt einen Kundendaten-Wert in die Kundenakte (geprüft wie im Kundenformular). */
async function schreibeKundendaten(tx: TransactionSql, k: Kontext, kundeId: string, feld: string, wert: unknown): Promise<void> {
	const [alt] = await tx`
		select art, firma, anrede, vorname, nachname, email::text as email, telefon, strasse, plz, ort, notiz, bevorzugter_kontakt
		from app.kunden where id = ${kundeId} and betrieb_id = ${k.betriebId} for update`;
	if (!alt) throw new ApiFehler(404, 'Kunde nicht gefunden.');
	const neu: Record<string, unknown> = { ...alt };
	if (feld === 'adresse') Object.assign(neu, wert as Adresse);
	else neu[feld] = wert;
	let w;
	try {
		w = pruefeKundeEingabe(neu);
	} catch (e) {
		throw e instanceof ApiFehler ? e : new ApiFehler(400, 'Die Angabe ist ungültig.');
	}
	await tx`
		update app.kunden set email = ${w.email}, telefon = ${w.telefon}, bevorzugter_kontakt = ${w.bevorzugter_kontakt},
			strasse = ${w.strasse}, plz = ${w.plz}, ort = ${w.ort}
		where id = ${kundeId} and betrieb_id = ${k.betriebId}`;
}

async function sperreOffen(
	tx: TransactionSql,
	k: Kontext,
	einsatzId: string
): Promise<{ id: string; antworten: Antworten; status: string; schritte: Schritt[]; ergebnis: { protokolle?: Record<string, string | null>; aufgaben?: string[]; notiz?: string | null } }> {
	const [d] = await tx`
		select id, antworten, status, schritte, ergebnis from app.leitfaden_durchlaeufe
		where einsatz_id = ${einsatzId} and betrieb_id = ${k.betriebId} for update`;
	if (!d) throw new ApiFehler(404, 'Für diesen Termin gibt es keinen Leitfaden.');
	return d as never;
}

/**
 * Eingaben übernehmen (auch nachgeschickte von offline). Je Eingabe: schon bekannt → überspringen; ältere als die
 * gespeicherte Antwort → nur vermerken. Ein abgeschlossener Leitfaden nimmt keine Eingaben mehr an (409).
 */
export async function speichereEingaben(k: Kontext, nutzer: Nutzer, einsatzId: string, eingaben: unknown): Promise<LeitfadenStand> {
	await pruefeModulPlantafel(k);
	if (!Array.isArray(eingaben) || eingaben.length === 0) throw new ApiFehler(400, 'Keine Eingaben.');
	if (eingaben.length > 100) throw new ApiFehler(400, 'Zu viele Eingaben auf einmal.');
	return inEinerTransaktion(k, 'leitfaden', () =>
		mitBetrieb(k, async (tx) => {
			const t = await ladeTermin(tx, k, einsatzId);
			pruefeAusfuellen(nutzer, t);
			if (!(await holeOderStarte(tx, k, t))) throw new ApiFehler(404, 'Für diesen Termin gibt es keinen Leitfaden.');
			const d = await sperreOffen(tx, k, einsatzId);
			let antworten = d.antworten;
			let neu = false;
			for (const roh of eingaben as Record<string, unknown>[]) {
				const opId = pruefeOp(roh?.opId);
				const zeit = pruefeZeit(roh?.zeit);
				const [schon] = await tx`select 1 from app.leitfaden_eingaben where op_id = ${opId}`;
				if (schon) continue;
				if (d.status !== 'offen') throw new ApiFehler(409, 'Der Leitfaden ist schon abgeschlossen.');
				const s = d.schritte.find((x) => x.id === roh.schrittId);
				if (!s) throw new ApiFehler(400, 'Diesen Schritt gibt es im Leitfaden nicht.');
				let wert: unknown;
				try {
					wert = pruefeWert(s, roh.wert);
				} catch (e) {
					throw new ApiFehler(400, `${s.titel}: ${(e as Error).message}`);
				}
				if (s.typ === 'protokoll') {
					// Protokoll im Leitfaden (Jamil msg 4353): je Feld gewinnt die spätere Eingabe
					const pid = d.ergebnis?.protokolle?.[s.id];
					if (!pid) throw new ApiFehler(400, `${s.titel}: Die Protokoll-Vorlage ist nicht mehr verfügbar.`);
					const pe = wert as ProtokollEingabe;
					const zeiten = ((antworten[s.id]?.wert as { zeiten?: Record<string, string> } | undefined)?.zeiten ?? {}) as Record<string, string>;
					if (!zeiten[pe.feld] || zeiten[pe.feld] <= zeit) {
						const [p] = await tx`select antworten from app.protokolle where id = ${pid} and betrieb_id = ${k.betriebId}`;
						await speichereProtokollAntworten(k, ALLE(k), pid, { ...(p?.antworten ?? {}), [pe.feld]: pe.wert });
						antworten = { ...antworten, [s.id]: { wert: { zeiten: { ...zeiten, [pe.feld]: zeit } }, zeit, von: nutzer.id } };
						neu = true;
					}
				} else {
					const r = uebernimm(antworten, s.id, wert, zeit, nutzer.id);
					if (r.geaendert) {
						antworten = r.antworten;
						neu = true;
						if (s.typ === 'kundendaten' && t.kundeId) await schreibeKundendaten(tx, k, t.kundeId, s.feld!, wert);
					}
				}
				await tx`insert into app.leitfaden_eingaben (op_id, betrieb_id, durchlauf_id, art) values (${opId}, ${k.betriebId}, ${d.id}, 'eingabe')`;
			}
			if (neu) await tx`update app.leitfaden_durchlaeufe set antworten = ${tx.json(antworten as never)} where id = ${d.id} and betrieb_id = ${k.betriebId}`;
			return (await ladeStand(tx, k, { einsatzId }))!;
		})
	);
}

export const FOTO_MAX_BYTES = 10 * 1024 * 1024;

/** Foto zu einem Foto-Schritt: landet in den Dokumenten des Auftrags; idempotent über `opId`. */
export async function speichereFoto(
	k: Kontext,
	nutzer: Nutzer,
	einsatzId: string,
	f: { opId: unknown; schrittId: unknown; zeit: unknown; datei: unknown; feld?: unknown }
): Promise<LeitfadenStand> {
	await pruefeModulPlantafel(k);
	const opId = pruefeOp(f.opId);
	const zeit = pruefeZeit(f.zeit);
	if (!(f.datei instanceof File) || f.datei.size === 0) throw new ApiFehler(400, 'Bitte ein Foto auswählen.');
	if (f.datei.size > FOTO_MAX_BYTES) throw new ApiFehler(413, 'Das Foto ist zu groß (höchstens 10 MB).');
	if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.datei.type)) throw new ApiFehler(400, 'Bitte ein Foto als JPEG oder PNG.');
	const inhalt = new Uint8Array(await f.datei.arrayBuffer());
	pruefeDateiInhalt(f.datei.type, inhalt);
	const datei = f.datei;
	return inEinerTransaktion(k, 'leitfaden', () =>
		mitBetrieb(k, async (tx) => {
			const t = await ladeTermin(tx, k, einsatzId);
			pruefeAusfuellen(nutzer, t);
			if (!(await holeOderStarte(tx, k, t))) throw new ApiFehler(404, 'Für diesen Termin gibt es keinen Leitfaden.');
			const d = await sperreOffen(tx, k, einsatzId);
			const [schon] = await tx`select 1 from app.leitfaden_eingaben where op_id = ${opId}`;
			if (schon) return (await ladeStand(tx, k, { einsatzId }))!;
			if (d.status !== 'offen') throw new ApiFehler(409, 'Der Leitfaden ist schon abgeschlossen.');
			// Foto für ein Feld des Protokolls (Jamil msg 4353): landet im Protokoll (und damit im PDF)
			const ps = d.schritte.find((x) => x.id === f.schrittId && x.typ === 'protokoll');
			if (ps) {
				const pid = d.ergebnis?.protokolle?.[ps.id];
				if (!pid) throw new ApiFehler(400, `${ps.titel}: Die Protokoll-Vorlage ist nicht mehr verfügbar.`);
				await speichereProtokollFoto(k, ALLE(k), pid, f.feld, { name: `foto.${datei.type === 'image/png' ? 'png' : 'jpg'}`, inhalt });
				await tx`insert into app.leitfaden_eingaben (op_id, betrieb_id, durchlauf_id, art) values (${opId}, ${k.betriebId}, ${d.id}, 'foto')`;
				return (await ladeStand(tx, k, { einsatzId }))!;
			}
			const s = d.schritte.find((x) => x.id === f.schrittId && x.typ === 'foto');
			if (!s) throw new ApiFehler(400, 'Diesen Foto-Schritt gibt es im Leitfaden nicht.');
			const endung = datei.type === 'image/png' ? 'png' : datei.type === 'image/webp' ? 'webp' : 'jpg';
			const name = `Leitfaden_${s.id}_${zeit.slice(0, 19).replace(/[-:T]/g, '')}.${endung}`;
			const [neu] = await tx`
				insert into app.dateien (betrieb_id, auftrag_id, name, typ, groesse, inhalt, beschreibung, von_benutzer_id)
				values (${k.betriebId}, ${t.auftragId}, ${name}, ${datei.type}, ${datei.size}, ${Buffer.from(inhalt)}, ${`Leitfaden: ${s.titel}`.slice(0, 500)}, ${nutzer.id})
				returning id`;
			const bisher = Array.isArray(d.antworten[s.id]?.wert) ? (d.antworten[s.id].wert as string[]) : [];
			// Fotos sammeln sich (kein „spätere gewinnt“): jedes Foto zählt
			const antworten: Antworten = { ...d.antworten, [s.id]: { wert: [...bisher, neu.id], zeit, von: nutzer.id } };
			await tx`update app.leitfaden_durchlaeufe set antworten = ${tx.json(antworten as never)} where id = ${d.id} and betrieb_id = ${k.betriebId}`;
			await tx`insert into app.leitfaden_eingaben (op_id, betrieb_id, durchlauf_id, art, ergebnis) values (${opId}, ${k.betriebId}, ${d.id}, 'foto', ${tx.json({ dateiId: neu.id })})`;
			return (await ladeStand(tx, k, { einsatzId }))!;
		})
	);
}

/** Unterschrift in einem Protokoll-Feld des Leitfadens (PNG vom Unterschriftsfeld + Name); idempotent über `opId`. */
export async function speichereUnterschrift(
	k: Kontext,
	nutzer: Nutzer,
	einsatzId: string,
	f: { opId: unknown; schrittId: unknown; feld: unknown; name: unknown; datei: unknown }
): Promise<LeitfadenStand> {
	await pruefeModulPlantafel(k);
	const opId = pruefeOp(f.opId);
	if (!(f.datei instanceof Blob) || f.datei.size === 0) throw new ApiFehler(400, 'Die Unterschrift fehlt.');
	const png = new Uint8Array(await f.datei.arrayBuffer());
	return inEinerTransaktion(k, 'leitfaden', () =>
		mitBetrieb(k, async (tx) => {
			const t = await ladeTermin(tx, k, einsatzId);
			pruefeAusfuellen(nutzer, t);
			if (!(await holeOderStarte(tx, k, t))) throw new ApiFehler(404, 'Für diesen Termin gibt es keinen Leitfaden.');
			const d = await sperreOffen(tx, k, einsatzId);
			const [schon] = await tx`select 1 from app.leitfaden_eingaben where op_id = ${opId}`;
			if (schon) return (await ladeStand(tx, k, { einsatzId }))!;
			if (d.status !== 'offen') throw new ApiFehler(409, 'Der Leitfaden ist schon abgeschlossen.');
			const ps = d.schritte.find((x) => x.id === f.schrittId && x.typ === 'protokoll');
			const pid = ps ? d.ergebnis?.protokolle?.[ps.id] : null;
			if (!ps || !pid) throw new ApiFehler(400, 'Diesen Protokoll-Schritt gibt es im Leitfaden nicht.');
			await speichereProtokollUnterschrift(k, ALLE(k), pid, f.feld, png, f.name);
			await tx`insert into app.leitfaden_eingaben (op_id, betrieb_id, durchlauf_id, art) values (${opId}, ${k.betriebId}, ${d.id}, 'unterschrift')`;
			return (await ladeStand(tx, k, { einsatzId }))!;
		})
	);
}

/**
 * Abschließen (2b): Alle Pflichtschritte erledigt → „abgeschlossen“; sonst nur mit Begründung → „mit_begruendung“ (das
 * Büro bekommt über den Trigger einen Hinweis). Legt die gewählten Aufgaben und eine Zusammenfassung als Notiz am
 * Auftrag an. Ein zweiter Abschluss (z. B. nachgeschickt) ändert nichts mehr.
 */
export async function schliesseAb(k: Kontext, nutzer: Nutzer, einsatzId: string, e: { opId: unknown; begruendung: unknown }): Promise<LeitfadenStand> {
	await pruefeModulPlantafel(k);
	const opId = pruefeOp(e.opId);
	const begruendung = text(e.begruendung, MAX_BEGRUENDUNG);
	return inEinerTransaktion(k, 'leitfaden', () =>
		mitBetrieb(k, async (tx) => {
			const t = await ladeTermin(tx, k, einsatzId);
			pruefeAusfuellen(nutzer, t);
			if (!(await holeOderStarte(tx, k, t))) throw new ApiFehler(404, 'Für diesen Termin gibt es keinen Leitfaden.');
			const d = await sperreOffen(tx, k, einsatzId);
			const [schon] = await tx`select 1 from app.leitfaden_eingaben where op_id = ${opId}`;
			if (schon || d.status !== 'offen') return (await ladeStand(tx, k, { einsatzId }))!;
			const stand = (await ladeStand(tx, k, { einsatzId }))!;
			const fehlt = fehlendePflicht(stand.schritte, stand.antworten, stand.kunde, stand.protokolle);
			if (fehlt.length > 0 && !begruendung) {
				throw new ApiFehler(400, `Es fehlen noch Pflichtschritte (${fehlt.map((s) => s.titel).join(', ')}). Abschließen geht dann nur mit Begründung.`);
			}
			const ergebnis: { protokolle?: Record<string, string | null>; aufgaben: string[]; notiz: string | null } = { protokolle: d.ergebnis?.protokolle, aufgaben: [], notiz: null };
			// Protokolle (Jamil msg 4353): vollständige werden wie gewohnt abgeschlossen – PDF in die Dokumente des Auftrags;
			// unvollständige bleiben als Entwurf am Auftrag (der Leitfaden ging dann nur mit Begründung)
			const protokolle = { ...stand.protokolle };
			for (const s of stand.schritte) {
				const p = s.typ === 'protokoll' ? stand.protokolle[s.id] : null;
				if (!p || p.status !== 'entwurf' || fehlendeFelder(p.schema, p.antworten).length > 0) continue;
				await schliesseProtokollAb(k, ALLE(k), p.id);
				protokolle[s.id] = { ...p, status: 'abgeschlossen' };
			}
			for (const s of stand.schritte) {
				const a = stand.antworten[s.id]?.wert as AufgabeWert | undefined;
				if (s.typ !== 'aufgabe' || !a?.anlegen) continue;
				const [todo] = await tx`
					insert into app.todos (betrieb_id, auftrag_id, titel, beschreibung)
					values (${k.betriebId}, ${t.auftragId}, ${a.titel.slice(0, 200)}, ${`Aus dem ${stand.name}`.slice(0, 2000)})
					returning id`;
				ergebnis.aufgaben.push(todo.id);
			}
			const status: LeitfadenStatus = fehlt.length > 0 ? 'mit_begruendung' : 'abgeschlossen';
			const notizText = zusammenfassung(stand.name, stand.schritte, stand.antworten, stand.kunde, fehlt.length > 0 ? begruendung : null, protokolle).slice(0, 10_000);
			const [n] = await tx`
				insert into app.notizen (betrieb_id, auftrag_id, text, von_benutzer_id) values (${k.betriebId}, ${t.auftragId}, ${notizText}, ${nutzer.id}) returning id`;
			ergebnis.notiz = n.id;
			await tx`
				update app.leitfaden_durchlaeufe set status = ${status}, begruendung = ${fehlt.length > 0 ? begruendung : null},
					abgeschlossen_am = now(), abgeschlossen_von = ${nutzer.id}, ergebnis = ${tx.json(ergebnis as never)}
				where id = ${d.id} and betrieb_id = ${k.betriebId}`;
			await tx`insert into app.leitfaden_eingaben (op_id, betrieb_id, durchlauf_id, art) values (${opId}, ${k.betriebId}, ${d.id}, 'abschluss')`;
			return (await ladeStand(tx, k, { einsatzId }))!;
		})
	);
}

/**
 * Hinweis ans Büro (Jamil msg 4353): Termine mit Leitfaden, die vorbei sind und deren Leitfaden nicht abgeschlossen
 * wurde – einmal je Termin, über alle Betriebe (Hintergrund-Dienst, jede Minute). Gibt die Zahl der gemeldeten Termine.
 */
export async function meldeVerpassteLeitfaeden(limit = 200): Promise<number> {
	const [z] = await systemAbfrage((sql) => sql`select app.leitfaden_verpasst_melden(${limit}) as n`);
	return Number(z?.n ?? 0);
}
