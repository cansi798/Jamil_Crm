import { mitBetriebOeffentlich, systemAbfrage, type TransactionSql } from './db';
import { ApiFehler } from './fehler';
import { pruefeBild } from './bildpruefung';
import { sendePush, type PushNachricht } from './erinnerungen';
import { mailVersand } from './nachfassen';
import { ONLINE_QUELLE, startlisteFallsLeer } from './quellen';
import {
	globaleEinbettenDomains,
	ladeDienste,
	ladeEinstellungen,
	ladeVerfuegbarkeit,
	ladeVerteilung,
	regelnVon,
	type Dienst
} from './buchung';
import { neuesVerwaltungsToken, verwaltungsHash } from './buchung-schutz';
import {
	BUCHUNG_GRENZEN,
	ORT_NAMEN,
	dauerText,
	freieZeiten,
	nurVorname,
	pruefeKontakt,
	telefonSchluessel,
	waehleMitarbeiter,
	type Kontakt,
	type OrtArt
} from '../buchung';
import { auswerten, alleFelder, bereinigeAntworten, fehlendeFelder, type Antworten, type Schema } from '../protokoll-formular';
import { berlinTag, berlinUhrzeit, istTag, tagDeutsch, tagKurz, tagPlus } from '../zeit';
import { standardFarbe } from '../farben';

/**
 * Öffentliche Online-Buchung (ohne Anmeldung, Wunsch Jamil msgs 2684/2686).
 *
 * Ablauf: Token → (SECURITY DEFINER, crm_auth) Link und Betrieb → alles Weitere als crm_app im Betriebskontext ohne
 * Benutzer (`mitBetriebOeffentlich`, RLS). Nach außen gehen nur: Name/Kontakt/Logo/Farbe des Betriebs, Dienst (Name,
 * Beschreibung, Dauer, Ort), freie Anfangszeiten (ohne Mitarbeiter) und – nur bei einem Link für genau einen
 * Mitarbeiter – dessen Vorname. Nie Kunden, Aufträge oder andere Buchungen.
 *
 * Buchen: unter einer Sperre je Betrieb (pg_advisory_xact_lock) wird die Zeit neu gerechnet; nur wenn sie noch frei
 * ist, entstehen Kunde (oder vorhandener per E-Mail/Telefon), Objekt, Auftrag „Anfrage“ mit Auftragsquelle, Einsatz in
 * der Plantafel und die Buchung. Die Datenbank schließt Doppelbuchungen zusätzlich aus (Ausschluss-Bedingung).
 */

export type Betriebsanzeige = {
	name: string;
	telefon: string | null;
	email: string | null;
	web: string | null;
	farbe: string;
	hatLogo: boolean;
	logoStand: string;
};

export type OeffentlicherDienst = {
	name: string;
	beschreibung: string | null;
	dauerMin: number;
	dauerText: string;
	ortArt: OrtArt;
	ortName: string;
	adresse: Dienst['adresse'];
	fragen: Schema;
	farbe: string;
};

export type Seite = {
	betrieb: Betriebsanzeige;
	dienst: OeffentlicherDienst;
	/** nur bei einem Link für genau einen Mitarbeiter */
	mitarbeiterVorname: string | null;
	datenschutzUrl: string | null;
	/** Ursprünge, die die Seite einbetten dürfen (CSP frame-ancestors) */
	einbetten: string[];
};

type Kontext = { betriebId: string; linkId: string };

const nichtGefunden = () => new ApiFehler(404, 'Dieser Buchungslink ist nicht (mehr) gültig.');

/** Token → Link und Betrieb (oder null). Nur das Format wird vorab geprüft; den Rest macht die Datenbankfunktion. */
export async function loeseLinkAuf(token: unknown): Promise<Kontext | null> {
	if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,64}$/.test(token)) return null;
	const [z] = await systemAbfrage((sql) => sql`select * from app.buchung_link_aufloesen(${token})`);
	return z ? { betriebId: z.betrieb_id, linkId: z.link_id } : null;
}

type LinkDaten = { dienst: Dienst; linkBenutzer: string | null; linkQuelle: string | null; kandidaten: { id: string; name: string }[] };

async function ladeLink(tx: TransactionSql, k: Kontext): Promise<LinkDaten> {
	const [l] = await tx`select dienst_id, benutzer_id, quelle_id from app.buchung_links where id = ${k.linkId} and betrieb_id = ${k.betriebId} and aktiv`;
	if (!l) throw nichtGefunden();
	const [dienst] = await ladeDienste(tx, k.betriebId, l.dienst_id);
	if (!dienst || !dienst.aktiv) throw nichtGefunden();
	// Nur aktive Mitarbeiter des Dienstes; ein Link für einen Mitarbeiter liefert nur diesen
	const aktiv = await tx`select id from app.benutzer where betrieb_id = ${k.betriebId} and aktiv and id = any(${dienst.mitarbeiter.map((m) => m.id)}::uuid[])`;
	const aktiveIds = new Set(aktiv.map((r) => r.id as string));
	let kandidaten = dienst.mitarbeiter.filter((m) => aktiveIds.has(m.id));
	if (l.benutzer_id) kandidaten = kandidaten.filter((m) => m.id === l.benutzer_id);
	else if (dienst.modus === 'fest') kandidaten = kandidaten.slice(0, 1);
	return { dienst, linkBenutzer: l.benutzer_id, linkQuelle: l.quelle_id, kandidaten };
}

async function betriebsanzeige(tx: TransactionSql, betriebId: string, dienstFarbe: string): Promise<Betriebsanzeige> {
	const [b] = await tx`
		select coalesce(nullif(btrim(p.firmenname), ''), be.name) as name, p.telefon, p.email, p.web, p.farbe,
			p.logo is not null as hat_logo, p.logo_geaendert
		from app.betriebe be left join app.betrieb_profil p on p.betrieb_id = be.id where be.id = ${betriebId}`;
	return {
		name: b?.name ?? '',
		telefon: b?.telefon ?? null,
		email: b?.email ?? null,
		web: b?.web ?? null,
		farbe: b?.farbe ?? dienstFarbe,
		hatLogo: b?.hat_logo === true,
		logoStand: b?.logo_geaendert ? String(new Date(b.logo_geaendert).getTime()) : '0'
	};
}

const oeffentlicherDienst = (d: Dienst): OeffentlicherDienst => ({
	name: d.name,
	beschreibung: d.beschreibung,
	dauerMin: d.dauerMin,
	dauerText: dauerText(d.dauerMin),
	ortArt: d.ortArt,
	ortName: ORT_NAMEN[d.ortArt],
	adresse: d.adresse,
	fragen: d.fragen,
	farbe: d.farbe
});

/** Daten der Buchungsseite – oder null (unbekannter/ausgeschalteter Link). */
export async function ladeSeite(token: unknown): Promise<Seite | null> {
	const k = await loeseLinkAuf(token);
	if (!k) return null;
	return mitBetriebOeffentlich(k.betriebId, async (tx) => {
		const l = await ladeLink(tx, k);
		const e = await ladeEinstellungen(tx, k.betriebId);
		const einzeln = l.linkBenutzer && l.kandidaten.length === 1 ? l.kandidaten[0] : l.dienst.modus === 'fest' && l.kandidaten.length === 1 ? l.kandidaten[0] : null;
		return {
			betrieb: await betriebsanzeige(tx, k.betriebId, l.dienst.farbe),
			dienst: oeffentlicherDienst(l.dienst),
			mitarbeiterVorname: einzeln ? nurVorname(einzeln.name) : null,
			datenschutzUrl: e.datenschutzUrl,
			einbetten: [...e.einbettenDomains, ...globaleEinbettenDomains()]
		};
	});
}

/** Logo des Betriebs zum Link (oder null). */
export async function logoZumLink(token: unknown): Promise<{ bytes: Uint8Array; typ: string } | null> {
	const k = await loeseLinkAuf(token);
	if (!k) return null;
	return mitBetriebOeffentlich(k.betriebId, async (tx) => {
		const [z] = await tx`select logo, logo_typ from app.betrieb_profil where betrieb_id = ${k.betriebId} and logo is not null`;
		if (!z) return null;
		const buf = z.logo as Buffer;
		return { bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), typ: z.logo_typ };
	});
}

export type Termine = { tage: { tag: string; zeiten: { beginn: string; ende: string }[] }[]; naechsterVon: string | null; bisTag: string };

/** Freie Zeiten (ohne Mitarbeiter) für bis zu 14 Tage ab `vonTag`; `naechsterVon` für „Weitere Termine“. */
async function termineFuer(
	tx: TransactionSql,
	betriebId: string,
	dienst: Dienst,
	kandidaten: string[],
	vonRoh: unknown,
	jetzt: Date,
	ohneBuchung: string | null = null
): Promise<Termine> {
	const heute = berlinTag(jetzt);
	const letzter = tagPlus(heute, dienst.horizontTage);
	let von = istTag(vonRoh) && vonRoh >= heute ? vonRoh : heute;
	if (von > letzter) von = letzter;
	const bis = [tagPlus(von, BUCHUNG_GRENZEN.tageJeAbfrage - 1), letzter].sort()[0];
	const verf = await ladeVerfuegbarkeit(tx, betriebId, dienst.id, kandidaten, von, bis, ohneBuchung);
	const tage = freieZeiten(regelnVon(dienst), verf, { vonTag: von, bisTag: bis, jetzt }).map((t) => ({
		tag: t.tag,
		zeiten: t.zeiten.map((z) => ({ beginn: z.beginn, ende: z.ende }))
	}));
	return { tage, naechsterVon: bis < letzter ? tagPlus(bis, 1) : null, bisTag: bis };
}

export async function freieTermine(token: unknown, vonRoh: unknown, jetzt = new Date()): Promise<Termine | null> {
	const k = await loeseLinkAuf(token);
	if (!k) return null;
	return mitBetriebOeffentlich(k.betriebId, async (tx) => {
		const l = await ladeLink(tx, k);
		return termineFuer(tx, k.betriebId, l.dienst, l.kandidaten.map((m) => m.id), vonRoh, jetzt);
	});
}

// ——— Buchen ———

export type Foto = { tempId: string; feldId: string; bytes: Uint8Array };
export type Buchungseingabe = { beginn: unknown; kontakt: unknown; antworten: unknown; datenschutz: unknown; fotos: Foto[] };
export type Buchungsergebnis = { verwaltungToken: string; beginn: string; ende: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

function zeitpunktAus(w: unknown): Date {
	if (typeof w !== 'string' || !ISO.test(w)) throw new ApiFehler(400, 'Bitte einen Termin wählen.');
	const d = new Date(w);
	if (Number.isNaN(d.getTime())) throw new ApiFehler(400, 'Bitte einen Termin wählen.');
	return d;
}

/** Antworten prüfen: nur bekannte Felder, Pflichtfelder und Bedingungen; Fotos (temporäre IDs) aus dem Upload. */
export function pruefeAntworten(schema: Schema, roh: unknown, fotos: Foto[]): Antworten {
	const bisher: Antworten = {};
	const fotoFelder = new Set(alleFelder(schema).filter((x) => x.feld.typ === 'foto').map((x) => x.feld.id));
	for (const f of fotos) {
		if (!fotoFelder.has(f.feldId)) throw new ApiFehler(400, 'Foto gehört zu keiner Frage.');
		((bisher[f.feldId] ??= []) as string[]).push(f.tempId);
	}
	const antworten = bereinigeAntworten(schema, roh, bisher);
	// Antworten verborgener Felder (Bedingung nicht erfüllt) zählen nicht
	const zustand = auswerten(schema, antworten);
	for (const id of Object.keys(antworten)) if (!zustand.get(id)?.sichtbar) delete antworten[id];
	const fehlt = fehlendeFelder(schema, antworten);
	if (fehlt.length > 0) {
		throw new ApiFehler(400, `Bitte noch ausfüllen: ${fehlt.map((f) => `„${f.label}“ (${f.grund})`).join(', ')}.`, { fehlendeFragen: fehlt.map((f) => f.feldId) });
	}
	return antworten;
}

/** Vorhandenen Kunden über E-Mail, sonst Telefon erkennen – sonst neuen Privatkunden anlegen. */
async function kundeFuer(tx: TransactionSql, betriebId: string, k: Kontakt): Promise<{ id: string; neu: boolean }> {
	const [perMail] = await tx`select id from app.kunden where betrieb_id = ${betriebId} and email = ${k.email} order by angelegt limit 1`;
	if (perMail) return { id: perMail.id, neu: false };
	const schluessel = telefonSchluessel(k.telefon);
	if (schluessel.length >= 6) {
		const kandidaten = await tx`
			select id, telefon from app.kunden where betrieb_id = ${betriebId} and telefon is not null
				and right(regexp_replace(telefon, '\\D', '', 'g'), 6) = ${schluessel.slice(-6)}
			order by angelegt limit 20`;
		const treffer = kandidaten.find((c) => telefonSchluessel(c.telefon) === schluessel);
		if (treffer) return { id: treffer.id, neu: false };
	}
	const [neu] = await tx`
		insert into app.kunden (betrieb_id, art, vorname, nachname, email, telefon, strasse, plz, ort, notiz)
		values (${betriebId}, 'privat', ${k.vorname}, ${k.nachname}, ${k.email}, ${k.telefon}, ${k.strasse}, ${k.plz}, ${k.ort},
			'Angelegt über die Online-Buchung')
		returning id`;
	return { id: neu.id, neu: true };
}

async function objektFuer(tx: TransactionSql, betriebId: string, kundeId: string, k: Kontakt): Promise<string | null> {
	if (!k.strasse) return null;
	const [da] = await tx`
		select id from app.objekte where betrieb_id = ${betriebId} and kunde_id = ${kundeId}
			and lower(btrim(coalesce(strasse, ''))) = lower(${k.strasse}) and coalesce(plz, '') = ${k.plz ?? ''}
		order by angelegt limit 1`;
	if (da) return da.id;
	const [neu] = await tx`
		insert into app.objekte (betrieb_id, kunde_id, bezeichnung, strasse, plz, ort)
		values (${betriebId}, ${kundeId}, ${k.strasse.slice(0, 200)}, ${k.strasse}, ${k.plz}, ${k.ort})
		returning id`;
	return neu.id;
}

/** Auftragsquelle: am Link, sonst am Dienst, sonst „Online-Buchung“ (wird bei Bedarf angelegt). */
async function quelleFuer(tx: TransactionSql, betriebId: string, l: LinkDaten): Promise<string> {
	const gewaehlt = l.linkQuelle ?? l.dienst.quelleId;
	if (gewaehlt) return gewaehlt;
	await startlisteFallsLeer(tx, { betriebId });
	const [q] = await tx`select id from app.auftrag_quellen where betrieb_id = ${betriebId} and lower(btrim(name)) = lower(${ONLINE_QUELLE})`;
	if (q) return q.id;
	const [{ n }] = await tx`select coalesce(max(sortierung), 0)::int + 1 as n from app.auftrag_quellen where betrieb_id = ${betriebId}`;
	const [neu] = await tx`
		insert into app.auftrag_quellen (betrieb_id, name, sortierung, farbe) values (${betriebId}, ${ONLINE_QUELLE}, ${n}, ${standardFarbe(ONLINE_QUELLE)})
		returning id`;
	return neu.id;
}

type Hinweis = { benutzerId: string; nachricht: PushNachricht };

/**
 * Glocke (und Web-Push) für den Mitarbeiter und alle mit „Online-Buchung verwalten“ – über die Erinnerungen
 * (Migration 056): eine zum Termin gehörende Benachrichtigung, sofort als gesendet markiert. Push geht erst nach dem
 * Speichern raus (`sendeHinweise`).
 */
async function benachrichtige(
	tx: TransactionSql,
	betriebId: string,
	ziel: { einsatzId: string | null } | { todoId: string },
	mitarbeiterId: string,
	n: PushNachricht
): Promise<Hinweis[]> {
	const einsatzId = 'einsatzId' in ziel ? ziel.einsatzId : null;
	const todoId = 'todoId' in ziel ? ziel.todoId : null;
	if (!einsatzId && !todoId) return [];
	const verwalter = await tx`
		select b.id from app.benutzer b join app.rollen r on r.id = b.rolle_id and r.betrieb_id = b.betrieb_id
		where b.betrieb_id = ${betriebId} and b.aktiv and 'buchung.verwalten' = any (r.rechte)`;
	const empfaenger = [...new Set([mitarbeiterId, ...verwalter.map((v) => v.id as string)])];
	for (const id of empfaenger) {
		const [z] = await tx`
			insert into app.erinnerungen (betrieb_id, benutzer_id, einsatz_id, todo_id, zeitpunkt, titel, text, link)
			values (${betriebId}, ${id}, ${einsatzId}, ${todoId}, now(), ${n.titel.slice(0, 300)}, ${n.text.slice(0, 500)}, ${n.link})
			returning id`;
		await tx`update app.erinnerungen set gesendet_am = now(), ergebnis = 'gesendet' where id = ${z.id} and betrieb_id = ${betriebId}`;
	}
	return empfaenger.map((benutzerId) => ({ benutzerId, nachricht: n }));
}

function sendeHinweise(betriebId: string, hinweise: Hinweis[]): void {
	for (const h of hinweise) {
		void sendePush({ betriebId, benutzerId: h.benutzerId }, h.nachricht).catch((e) => console.error('Web-Push (Buchung):', e));
	}
}

const terminText = (beginn: Date) => `${tagKurz(berlinTag(beginn))} ${berlinUhrzeit(beginn)} Uhr`;

/** Neue Buchung über einen Link. 404 unbekannter Link, 400 ungültige Angaben, 409 Termin inzwischen vergeben. */
export async function bucheTermin(token: unknown, e: Buchungseingabe, o: { jetzt?: Date; basisUrl?: string } = {}): Promise<Buchungsergebnis> {
	const jetzt = o.jetzt ?? new Date();
	const k = await loeseLinkAuf(token);
	if (!k) throw nichtGefunden();
	if (e.datenschutz !== true) throw new ApiFehler(400, 'Bitte stimmen Sie der Verarbeitung Ihrer Angaben zu (Datenschutz).');
	const beginn = zeitpunktAus(e.beginn);
	if (e.fotos.length > BUCHUNG_GRENZEN.fotos) throw new ApiFehler(400, `Höchstens ${BUCHUNG_GRENZEN.fotos} Fotos.`);
	const bilder = e.fotos.map((f) => {
		if (!UUID.test(f.tempId) || !/^[a-z][a-z0-9_]{0,59}$/.test(f.feldId)) throw new ApiFehler(400, 'Ungültiges Foto.');
		if (f.bytes.length === 0 || f.bytes.length > BUCHUNG_GRENZEN.fotoBytes) throw new ApiFehler(400, 'Ein Foto ist zu groß – bitte ein kleineres wählen.');
		const info = pruefeBild(f.bytes);
		if (!info) throw new ApiFehler(400, 'Bitte nur Fotos als JPEG oder PNG hochladen.');
		return { ...f, typ: info.typ };
	});
	const { verwaltungToken, ergebnis, hinweise, mail } = await (async () => {
		try {
			return await mitBetriebOeffentlich(k.betriebId, async (tx) => {
				const l = await ladeLink(tx, k);
				const { werte: kontakt, fehler } = pruefeKontakt(e.kontakt, l.dienst.adresse);
				if (!kontakt) throw new ApiFehler(400, Object.values(fehler)[0], { felder: fehler });
				const antworten = pruefeAntworten(l.dienst.fragen, e.antworten, bilder);
				// Sperre je Betrieb: zwei gleichzeitige Buchungen rechnen nacheinander
				await tx`select pg_advisory_xact_lock(hashtextextended(${'buchung:' + k.betriebId}, 0))`;
				const tag = berlinTag(beginn);
				const ids = l.kandidaten.map((m) => m.id);
				const verf = await ladeVerfuegbarkeit(tx, k.betriebId, l.dienst.id, ids, tag, tag);
				const frei = freieZeiten(regelnVon(l.dienst), verf, { vonTag: tag, bisTag: tag, jetzt })[0]?.zeiten.find((z) => new Date(z.beginn).getTime() === beginn.getTime());
				if (!frei) throw new ApiFehler(409, 'Dieser Termin ist leider nicht mehr frei. Bitte wählen Sie einen anderen.');
				const benutzerId = waehleMitarbeiter(frei.mitarbeiter, await ladeVerteilung(tx, k.betriebId, l.dienst.id, frei.mitarbeiter))!;
				const ende = new Date(frei.ende);
				const kunde = await kundeFuer(tx, k.betriebId, kontakt);
				const objektId = await objektFuer(tx, k.betriebId, kunde.id, kontakt);
				const quelleId = await quelleFuer(tx, k.betriebId, l);
				const name = `${kontakt.vorname} ${kontakt.nachname}`;
				const beschreibung = [
					`Online gebucht am ${tagDeutsch(berlinTag(jetzt))} um ${berlinUhrzeit(jetzt)} Uhr: ${l.dienst.name}, ${terminText(beginn)}.`,
					`Kontakt laut Buchung: ${name}, ${kontakt.email}, ${kontakt.telefon}${kontakt.strasse ? `, ${kontakt.strasse}, ${kontakt.plz ?? ''} ${kontakt.ort ?? ''}`.trimEnd() : ''}.`,
					kunde.neu ? 'Neuer Kunde.' : 'Vorhandener Kunde (erkannt an E-Mail bzw. Telefon) – Angaben bitte prüfen.'
				].join('\n');
				const [auftrag] = await tx`
					insert into app.auftraege (betrieb_id, titel, kunde_id, objekt_id, quelle_id, beschreibung)
					values (${k.betriebId}, ${`${l.dienst.name} – ${name}`.slice(0, 200)}, ${kunde.id}, ${objektId}, ${quelleId}, ${beschreibung})
					returning id, nummer`;
				await tx`insert into app.auftrag_zustaendige (betrieb_id, auftrag_id, benutzer_id) values (${k.betriebId}, ${auftrag.id}, ${benutzerId})`;
				const [einsatz] = await tx`
					insert into app.einsaetze (betrieb_id, auftrag_id, benutzer_id, beginn, ende, notiz, art)
					values (${k.betriebId}, ${auftrag.id}, ${benutzerId}, ${beginn}, ${ende}, ${`Online-Buchung: ${l.dienst.name} (${ORT_NAMEN[l.dienst.ortArt]})`.slice(0, 500)}, ${l.dienst.einsatzArt})
					returning id`;
				// Fotos zum Auftrag (Dokumente); in den Antworten stehen danach die echten Datei-IDs
				const zuordnung = new Map<string, string>();
				let nr = 0;
				for (const b of bilder) {
					if (!(antworten[b.feldId] as string[] | undefined)?.includes(b.tempId)) continue;
					const feld = alleFelder(l.dienst.fragen).find((x) => x.feld.id === b.feldId)?.feld;
					const endung = b.typ === 'image/png' ? 'png' : 'jpg';
					const [d] = await tx`
						insert into app.dateien (betrieb_id, auftrag_id, name, typ, groesse, inhalt, beschreibung)
						values (${k.betriebId}, ${auftrag.id}, ${`Online-Buchung-Foto-${++nr}.${endung}`}, ${b.typ}, ${b.bytes.length},
							${Buffer.from(b.bytes.buffer, b.bytes.byteOffset, b.bytes.byteLength)}, ${`Online-Buchung: ${feld?.label ?? 'Foto'}`.slice(0, 500)})
						returning id`;
					zuordnung.set(b.tempId, d.id);
				}
				for (const [fid, w] of Object.entries(antworten)) {
					if (Array.isArray(w) && alleFelder(l.dienst.fragen).some((x) => x.feld.id === fid && x.feld.typ === 'foto')) {
						antworten[fid] = (w as string[]).map((t) => zuordnung.get(t)).filter(Boolean);
					}
				}
				const v = neuesVerwaltungsToken();
				const [buchung] = await tx`
					insert into app.buchungen (betrieb_id, dienst_id, link_id, benutzer_id, kunde_id, objekt_id, auftrag_id, einsatz_id, beginn, ende,
						vorname, nachname, email, telefon, strasse, plz, ort, fragen, antworten, verwaltung_hash)
					values (${k.betriebId}, ${l.dienst.id}, ${k.linkId}, ${benutzerId}, ${kunde.id}, ${objektId}, ${auftrag.id}, ${einsatz.id}, ${beginn}, ${ende},
						${kontakt.vorname}, ${kontakt.nachname}, ${kontakt.email}, ${kontakt.telefon}, ${kontakt.strasse}, ${kontakt.plz}, ${kontakt.ort},
						${tx.json(l.dienst.fragen as never)}, ${tx.json(antworten as never)}, ${v.hash})
					returning id`;
				const hinweise = await benachrichtige(tx, k.betriebId, { einsatzId: einsatz.id }, benutzerId, {
					titel: `Neue Online-Buchung: ${l.dienst.name}`,
					text: `${terminText(beginn)} – ${name}`,
					link: `/auftraege/${auftrag.id}`
				});
				const betrieb = await betriebsanzeige(tx, k.betriebId, l.dienst.farbe);
				return {
					verwaltungToken: v.token,
					ergebnis: { verwaltungToken: v.token, beginn: beginn.toISOString(), ende: ende.toISOString() },
					hinweise,
					mail: { an: kontakt.email, name: kontakt.vorname, dienst: l.dienst.name, betrieb: betrieb.name, beginn, buchungId: buchung.id as string }
				};
			});
		} catch (err) {
			if ((err as { code?: string }).code === '23P01') throw new ApiFehler(409, 'Dieser Termin ist leider nicht mehr frei. Bitte wählen Sie einen anderen.');
			throw err;
		}
	})();
	sendeHinweise(k.betriebId, hinweise);
	// Bestätigung per E-Mail, sobald der Mailversand angebunden ist (Jamil 2589); bis dahin Bestätigung am Bildschirm + .ics
	if (mailVersand.verbunden && o.basisUrl) {
		const link = `${o.basisUrl}/buchung/${verwaltungToken}`;
		const text = `Guten Tag ${mail.name},\n\nIhr Termin „${mail.dienst}“ bei ${mail.betrieb} ist gebucht: ${terminText(mail.beginn)}.\n\nTermin absagen oder verschieben: ${link}\n`;
		void mailVersand
			.senden({ an: mail.an, betreff: `Terminbestätigung: ${mail.dienst} am ${terminText(mail.beginn)}`, text, html: `<p>${text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!).replace(/\n/g, '<br>')}</p>` })
			.catch((err) => console.error('Bestätigung per E-Mail:', err));
	}
	return ergebnis;
}

// ——— Verwalten (Link aus der Bestätigung: absagen, verschieben, Kalenderdatei) ———

export type Verwaltung = {
	id: string;
	status: 'aktiv' | 'storniert';
	beginn: string;
	ende: string;
	dienst: OeffentlicherDienst;
	betrieb: Betriebsanzeige;
	mitarbeiterVorname: string;
	ort: string | null;
	name: string;
	/** Absagen/Verschieben nur vor Beginn */
	aenderbar: boolean;
	einbetten: string[];
	datenschutzUrl: string | null;
};

type VKontext = { betriebId: string; buchungId: string };

async function loeseVerwaltungAuf(token: unknown): Promise<VKontext | null> {
	const hash = verwaltungsHash(token);
	if (!hash) return null;
	const [z] = await systemAbfrage((sql) => sql`select * from app.buchung_verwaltung_aufloesen(${hash})`);
	return z ? { betriebId: z.betrieb_id, buchungId: z.buchung_id } : null;
}

async function ladeBuchung(tx: TransactionSql, v: VKontext, sperren = false) {
	const [b] = sperren
		? await tx`select * from app.buchungen where id = ${v.buchungId} and betrieb_id = ${v.betriebId} for update`
		: await tx`select * from app.buchungen where id = ${v.buchungId} and betrieb_id = ${v.betriebId}`;
	if (!b) throw new ApiFehler(404, 'Buchung nicht gefunden.');
	const [dienst] = await ladeDienste(tx, v.betriebId, b.dienst_id);
	const [ma] = await tx`select name from app.benutzer where id = ${b.benutzer_id} and betrieb_id = ${v.betriebId}`;
	return { b, dienst, mitarbeiter: ma?.name ?? '' };
}

const ortText = (d: Dienst, b: Record<string, any>, betrieb: Betriebsanzeige) =>
	d.ortArt === 'kunde' && b.strasse ? `${b.strasse}, ${b.plz ?? ''} ${b.ort ?? ''}`.trim() : d.ortArt === 'buero' ? betrieb.name : null;

export async function ladeVerwaltung(token: unknown, jetzt = new Date()): Promise<Verwaltung | null> {
	const v = await loeseVerwaltungAuf(token);
	if (!v) return null;
	return mitBetriebOeffentlich(v.betriebId, async (tx) => {
		const { b, dienst, mitarbeiter } = await ladeBuchung(tx, v);
		const betrieb = await betriebsanzeige(tx, v.betriebId, dienst.farbe);
		const e = await ladeEinstellungen(tx, v.betriebId);
		return {
			id: b.id,
			status: b.status,
			beginn: new Date(b.beginn).toISOString(),
			ende: new Date(b.ende).toISOString(),
			dienst: oeffentlicherDienst(dienst),
			betrieb,
			mitarbeiterVorname: nurVorname(mitarbeiter),
			ort: ortText(dienst, b, betrieb),
			name: `${b.vorname ?? ''} ${b.nachname}`.trim(),
			aenderbar: b.status === 'aktiv' && new Date(b.beginn).getTime() > jetzt.getTime(),
			einbetten: [...e.einbettenDomains, ...globaleEinbettenDomains()],
			datenschutzUrl: e.datenschutzUrl
		};
	});
}

async function kandidatenFuer(tx: TransactionSql, betriebId: string, b: Record<string, any>, dienst: Dienst): Promise<string[]> {
	const [l] = b.link_id ? await tx`select benutzer_id from app.buchung_links where id = ${b.link_id} and betrieb_id = ${betriebId}` : [];
	if (l?.benutzer_id || dienst.modus === 'fest') return [b.benutzer_id];
	const aktiv = await tx`select id from app.benutzer where betrieb_id = ${betriebId} and aktiv and id = any(${dienst.mitarbeiter.map((m) => m.id)}::uuid[])`;
	const ids = aktiv.map((r) => r.id as string);
	return ids.includes(b.benutzer_id) ? ids : [b.benutzer_id, ...ids];
}

/** Freie Zeiten zum Verschieben (die eigene Buchung zählt nicht als belegt). */
export async function termineZumVerschieben(token: unknown, vonRoh: unknown, jetzt = new Date()): Promise<Termine | null> {
	const v = await loeseVerwaltungAuf(token);
	if (!v) return null;
	return mitBetriebOeffentlich(v.betriebId, async (tx) => {
		const { b, dienst } = await ladeBuchung(tx, v);
		if (b.status !== 'aktiv') return { tage: [], naechsterVon: null, bisTag: berlinTag(jetzt) };
		return termineFuer(tx, v.betriebId, dienst, await kandidatenFuer(tx, v.betriebId, b, dienst), vonRoh, jetzt, b.id);
	});
}

/**
 * Termin absagen: Buchung storniert, Termin in der Plantafel gelöscht. Der Auftrag bleibt und bekommt ein To-do
 * „Online-Buchung abgesagt“ für den Mitarbeiter – daran hängt die Benachrichtigung (Glocke + Push) für ihn und die
 * Verwalter (die Benachrichtigungen zum gelöschten Termin verschwinden mit ihm).
 */
export async function sageAb(token: unknown, jetzt = new Date()): Promise<void> {
	const v = await loeseVerwaltungAuf(token);
	if (!v) throw new ApiFehler(404, 'Buchung nicht gefunden.');
	const hinweise = await mitBetriebOeffentlich(v.betriebId, async (tx) => {
		const { b, dienst } = await ladeBuchung(tx, v, true);
		if (b.status !== 'aktiv') throw new ApiFehler(409, 'Dieser Termin ist bereits abgesagt.');
		if (new Date(b.beginn).getTime() <= jetzt.getTime()) throw new ApiFehler(409, 'Der Termin hat schon begonnen und kann nicht mehr online abgesagt werden.');
		await tx`update app.buchungen set status = 'storniert', storniert_am = now() where id = ${b.id} and betrieb_id = ${v.betriebId}`;
		if (b.einsatz_id) await tx`delete from app.einsaetze where id = ${b.einsatz_id} and betrieb_id = ${v.betriebId}`;
		const name = `${b.vorname ?? ''} ${b.nachname}`.trim();
		const titel = `Online-Buchung abgesagt: ${dienst.name} ${terminText(new Date(b.beginn))} – ${name}`.slice(0, 200);
		if (!b.auftrag_id) return [];
		const [todo] = await tx`
			insert into app.todos (betrieb_id, auftrag_id, titel, zustaendig_id, faellig)
			values (${v.betriebId}, ${b.auftrag_id}, ${titel}, ${b.benutzer_id}, ${berlinTag(jetzt)})
			returning id`;
		return benachrichtige(tx, v.betriebId, { todoId: todo.id }, b.benutzer_id, {
			titel: `Online-Buchung abgesagt: ${dienst.name}`,
			text: `${terminText(new Date(b.beginn))} – ${name}`,
			link: `/auftraege/${b.auftrag_id}`
		});
	});
	sendeHinweise(v.betriebId, hinweise);
}

/** Termin verschieben (nur auf eine freie Zeit; gleicher Mitarbeiter, wenn möglich). */
export async function verschiebe(token: unknown, beginnRoh: unknown, jetzt = new Date()): Promise<{ beginn: string; ende: string }> {
	const v = await loeseVerwaltungAuf(token);
	if (!v) throw new ApiFehler(404, 'Buchung nicht gefunden.');
	const beginn = zeitpunktAus(beginnRoh);
	try {
		const { aus, hinweise } = await mitBetriebOeffentlich(v.betriebId, async (tx) => {
			await tx`select pg_advisory_xact_lock(hashtextextended(${'buchung:' + v.betriebId}, 0))`;
			const { b, dienst } = await ladeBuchung(tx, v, true);
			if (b.status !== 'aktiv') throw new ApiFehler(409, 'Dieser Termin ist abgesagt.');
			if (new Date(b.beginn).getTime() <= jetzt.getTime()) throw new ApiFehler(409, 'Der Termin hat schon begonnen und kann nicht mehr verschoben werden.');
			const kandidaten = await kandidatenFuer(tx, v.betriebId, b, dienst);
			const tag = berlinTag(beginn);
			const verf = await ladeVerfuegbarkeit(tx, v.betriebId, dienst.id, kandidaten, tag, tag, b.id);
			const frei = freieZeiten(regelnVon(dienst), verf, { vonTag: tag, bisTag: tag, jetzt })[0]?.zeiten.find((z) => new Date(z.beginn).getTime() === beginn.getTime());
			if (!frei) throw new ApiFehler(409, 'Dieser Termin ist leider nicht frei. Bitte wählen Sie einen anderen.');
			const benutzerId = frei.mitarbeiter.includes(b.benutzer_id) ? (b.benutzer_id as string) : waehleMitarbeiter(frei.mitarbeiter, await ladeVerteilung(tx, v.betriebId, dienst.id, frei.mitarbeiter))!;
			const ende = new Date(frei.ende);
			await tx`update app.buchungen set beginn = ${beginn}, ende = ${ende}, benutzer_id = ${benutzerId} where id = ${b.id} and betrieb_id = ${v.betriebId}`;
			if (b.einsatz_id) {
				await tx`update app.einsaetze set beginn = ${beginn}, ende = ${ende}, benutzer_id = ${benutzerId} where id = ${b.einsatz_id} and betrieb_id = ${v.betriebId}`;
			}
			if (b.auftrag_id && benutzerId !== b.benutzer_id) {
				await tx`insert into app.auftrag_zustaendige (betrieb_id, auftrag_id, benutzer_id) values (${v.betriebId}, ${b.auftrag_id}, ${benutzerId}) on conflict do nothing`;
			}
			const name = `${b.vorname ?? ''} ${b.nachname}`.trim();
			const hinweise = await benachrichtige(tx, v.betriebId, { einsatzId: b.einsatz_id }, benutzerId, {
				titel: `Online-Buchung verschoben: ${dienst.name}`,
				text: `Neu: ${terminText(beginn)} (vorher ${terminText(new Date(b.beginn))}) – ${name}`,
				link: b.auftrag_id ? `/auftraege/${b.auftrag_id}` : '/plantafel'
			});
			return { aus: { beginn: beginn.toISOString(), ende: ende.toISOString() }, hinweise };
		});
		sendeHinweise(v.betriebId, hinweise);
		return aus;
	} catch (err) {
		if ((err as { code?: string }).code === '23P01') throw new ApiFehler(409, 'Dieser Termin ist leider nicht frei. Bitte wählen Sie einen anderen.');
		throw err;
	}
}

/** Kalenderdatei-Daten der Buchung. */
export async function kalenderDaten(token: unknown): Promise<{ uid: string; beginn: Date; ende: Date; titel: string; ort: string | null; beschreibung: string; abgesagt: boolean } | null> {
	const v = await ladeVerwaltung(token);
	if (!v) return null;
	return {
		uid: `${v.id}@online-buchung`,
		beginn: new Date(v.beginn),
		ende: new Date(v.ende),
		titel: `${v.dienst.name} – ${v.betrieb.name}`,
		ort: v.ort ?? (v.dienst.ortArt === 'kunde' ? null : v.dienst.ortName),
		beschreibung: [`${v.dienst.name} (${v.dienst.ortName})`, v.betrieb.telefon ? `Telefon: ${v.betrieb.telefon}` : null].filter(Boolean).join('\n'),
		abgesagt: v.status === 'storniert'
	};
}

/** Logo des Betriebs zur Buchung (Verwaltungs-Seite). */
export async function logoZurBuchung(token: unknown): Promise<{ bytes: Uint8Array; typ: string } | null> {
	const v = await loeseVerwaltungAuf(token);
	if (!v) return null;
	return mitBetriebOeffentlich(v.betriebId, async (tx) => {
		const [z] = await tx`select logo, logo_typ from app.betrieb_profil where betrieb_id = ${v.betriebId} and logo is not null`;
		if (!z) return null;
		const buf = z.logo as Buffer;
		return { bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), typ: z.logo_typ };
	});
}

/** Einbett-Erlaubnis einer Verwaltungs-Seite (für die CSP). */
export async function einbettenFuerBuchung(token: unknown): Promise<string[]> {
	const v = await loeseVerwaltungAuf(token);
	if (!v) return [];
	return mitBetriebOeffentlich(v.betriebId, async (tx) => [...(await ladeEinstellungen(tx, v.betriebId)).einbettenDomains, ...globaleEinbettenDomains()]);
}
