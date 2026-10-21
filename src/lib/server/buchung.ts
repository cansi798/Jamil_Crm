import { randomBytes } from 'node:crypto';
import { mitBetrieb, type Kontext, type TransactionSql } from './db';
import { ApiFehler } from './fehler';
import { textFeld, UUID } from './kunden';
import { darf, pruefeModul } from './tarif';
import { istFarbe } from '../farben';
import { istEinsatzArt, type EinsatzArt } from '../einsatz-art';
import { alleFelder, dateiIds, pruefeSchema, SchemaFehler, wertText, type Schema } from '../protokoll-formular';
import {
	ADRESSE_ARTEN,
	FRAGE_TYPEN,
	MODI,
	ORT_ARTEN,
	istUhrzeit,
	type AdresseArt,
	type ArbeitsZeit,
	type Ausnahme,
	type DienstRegeln,
	type Modus,
	type OrtArt,
	type Verfuegbarkeit
} from '../buchung';
import { berlinTag, berlinZeitpunkt, istTag, tagesGrenzen, tagPlus } from '../zeit';

/**
 * Online-Buchung – Einstellungen im Betrieb (Recht „buchung.verwalten“, Module Aufträge + Plantafel): Dienste mit
 * Mitarbeitern und Buchungslinks, Arbeitszeiten/Ausnahmen je Mitarbeiter, Datenschutz-Link und Domains zum Einbetten.
 * Die öffentliche Seite (ohne Anmeldung) steht in `buchung-oeffentlich.ts` und benutzt `ladeVerfuegbarkeit` von hier.
 */

export const RECHT = 'buchung.verwalten';

/** Recht + Module (Aufträge und Plantafel) – 401/403/402 wie überall. */
export async function buchungZugriff(locals: { nutzer: Nutzer | null }): Promise<void> {
	await darf(locals, 'auftraege', RECHT);
	await pruefeModul(locals, 'plantafel');
}

export type BuchungsLink = {
	id: string;
	benutzerId: string | null;
	benutzerName: string | null;
	token: string;
	quelleId: string | null;
	aktiv: boolean;
};

export type Dienst = {
	id: string;
	name: string;
	beschreibung: string | null;
	dauerMin: number;
	pufferVorMin: number;
	pufferNachMin: number;
	vorlaufMin: number;
	horizontTage: number;
	maxProTag: number | null;
	ortArt: OrtArt;
	farbe: string;
	aktiv: boolean;
	/** erscheint in der Online-Buchung (Jamil msg 3074); sonst nur in der Plantafel wählbar */
	onlineBuchbar: boolean;
	modus: Modus;
	einsatzArt: EinsatzArt;
	adresse: AdresseArt;
	fragen: Schema;
	quelleId: string | null;
	mitarbeiter: { id: string; name: string }[];
	links: BuchungsLink[];
	/** kommende, aktive Buchungen */
	kommend: number;
};

export const regelnVon = (d: Pick<Dienst, 'dauerMin' | 'pufferVorMin' | 'pufferNachMin' | 'vorlaufMin' | 'horizontTage' | 'maxProTag'>): DienstRegeln => ({
	dauerMin: d.dauerMin,
	pufferVorMin: d.pufferVorMin,
	pufferNachMin: d.pufferNachMin,
	vorlaufMin: d.vorlaufMin,
	horizontTage: d.horizontTage,
	maxProTag: d.maxProTag
});

const nichtGefunden = () => new ApiFehler(404, 'Terminart nicht gefunden.');
export function pruefeId(id: unknown, fehler: () => ApiFehler = nichtGefunden): string {
	if (typeof id !== 'string' || !UUID.test(id.trim())) throw fehler();
	return id.trim().toLowerCase();
}

/** Nicht erratbares Token für /buchen/<Token> (24 Zufallsbytes, base64url = 32 Zeichen). */
export const neuesToken = () => randomBytes(24).toString('base64url');

export const LEERE_FRAGEN: Schema = { seiten: [] };

/** Fragen eines Dienstes prüfen: höchstens ein Schritt, nur erlaubte Feldtypen; ohne Felder → keine Fragen. */
export function pruefeFragen(roh: unknown): Schema {
	if (roh === undefined || roh === null || roh === '') return LEERE_FRAGEN;
	let wert = roh;
	if (typeof roh === 'string') {
		try {
			wert = JSON.parse(roh);
		} catch {
			throw new ApiFehler(400, 'Fragen: ungültig.');
		}
	}
	try {
		const s = pruefeSchema(wert, { typen: FRAGE_TYPEN, maxSeiten: 1, leerErlaubt: true });
		const felder = s.seiten.flatMap((x) => x.abschnitte.flatMap((a) => a.felder));
		return felder.length === 0 ? LEERE_FRAGEN : s;
	} catch (e) {
		if (e instanceof SchemaFehler) throw new ApiFehler(400, `Fragen: ${e.message}`);
		throw e;
	}
}

function ganzzahl(w: unknown, was: string, min: number, max: number, standard: number | null): number | null {
	if (w === undefined || w === null || w === '') {
		if (standard === null) return null;
		return standard;
	}
	const n = typeof w === 'number' ? w : Number(String(w).trim().replace(',', '.'));
	if (!Number.isInteger(n) || n < min || n > max) throw new ApiFehler(400, `${was}: bitte eine ganze Zahl von ${min} bis ${max}.`);
	return n;
}

function auswahl<T extends string>(w: unknown, erlaubt: readonly T[], standard: T, was: string): T {
	if (w === undefined || w === null || w === '') return standard;
	if (typeof w !== 'string' || !(erlaubt as readonly string[]).includes(w)) throw new ApiFehler(400, `${was}: ungültige Auswahl.`);
	return w as T;
}

const janein = (w: unknown, standard: boolean) =>
	w === undefined || w === null || w === '' ? standard : w === true || w === 'true' || w === 'on' || w === '1';

export type DienstWerte = Omit<Dienst, 'id' | 'mitarbeiter' | 'links' | 'kommend'>;

/** Prüft einen vollständigen Dienst (Formular oder Sprache); 400 mit klarer Meldung. */
export function pruefeDienstEingabe(e: Record<string, unknown>): DienstWerte {
	const name = textFeld(e.name, 'Name', 100);
	if (!name) throw new ApiFehler(400, 'Name: Bitte einen Namen eingeben (z. B. „Besichtigung“).');
	const farbe = e.farbe === undefined || e.farbe === null || e.farbe === '' ? '#0f6cbd' : e.farbe;
	if (!istFarbe(farbe)) throw new ApiFehler(400, 'Farbe: bitte eine Farbe wählen.');
	const einsatzArt = e.einsatzArt === undefined || e.einsatzArt === '' ? 'besichtigung' : e.einsatzArt;
	if (!istEinsatzArt(einsatzArt)) throw new ApiFehler(400, 'Art des Termins: ungültige Auswahl.');
	const quelleId = e.quelleId === undefined || e.quelleId === null || e.quelleId === '' ? null : pruefeId(e.quelleId, () => new ApiFehler(400, 'Auftragsquelle: ungültige Auswahl.'));
	return {
		name,
		beschreibung: textFeld(e.beschreibung, 'Beschreibung', 2000),
		dauerMin: ganzzahl(e.dauerMin, 'Dauer (Minuten)', 5, 720, 60)!,
		pufferVorMin: ganzzahl(e.pufferVorMin, 'Puffer davor (Minuten)', 0, 240, 0)!,
		pufferNachMin: ganzzahl(e.pufferNachMin, 'Puffer danach (Minuten)', 0, 240, 0)!,
		vorlaufMin: ganzzahl(e.vorlaufMin, 'Mindestvorlauf (Minuten)', 0, 43200, 1440)!,
		horizontTage: ganzzahl(e.horizontTage, 'Buchbar bis (Tage im Voraus)', 1, 365, 60)!,
		maxProTag: ganzzahl(e.maxProTag, 'Höchstens je Tag', 1, 50, null),
		ortArt: auswahl(e.ortArt, ORT_ARTEN, 'kunde', 'Ort'),
		farbe: (farbe as string).toLowerCase(),
		aktiv: janein(e.aktiv, true),
		onlineBuchbar: janein(e.onlineBuchbar, true),
		modus: auswahl(e.modus, MODI, 'beliebig', 'Mitarbeiter'),
		einsatzArt,
		adresse: auswahl(e.adresse, ADRESSE_ARTEN, 'pflicht', 'Adresse'),
		fragen: pruefeFragen(e.fragen),
		quelleId
	};
}

const AUSWAHL = `d.id, d.name, d.beschreibung, d.dauer_min, d.puffer_vor_min, d.puffer_nach_min, d.vorlauf_min, d.horizont_tage,
	d.max_pro_tag, d.ort_art, d.farbe, d.aktiv, d.online_buchbar, d.modus, d.einsatz_art, d.adresse, d.fragen, d.quelle_id`;

export function zuDienst(z: Record<string, any>): Omit<Dienst, 'mitarbeiter' | 'links' | 'kommend'> {
	return {
		id: z.id,
		name: z.name,
		beschreibung: z.beschreibung,
		dauerMin: z.dauer_min,
		pufferVorMin: z.puffer_vor_min,
		pufferNachMin: z.puffer_nach_min,
		vorlaufMin: z.vorlauf_min,
		horizontTage: z.horizont_tage,
		maxProTag: z.max_pro_tag,
		ortArt: z.ort_art,
		farbe: z.farbe,
		aktiv: z.aktiv,
		onlineBuchbar: z.online_buchbar ?? true,
		modus: z.modus,
		einsatzArt: z.einsatz_art,
		adresse: z.adresse,
		fragen: (z.fragen as Schema) ?? LEERE_FRAGEN,
		quelleId: z.quelle_id
	};
}

export async function ladeDienste(tx: TransactionSql, betriebId: string, id?: string): Promise<Dienst[]> {
	const z = await tx.unsafe(
		`select ${AUSWAHL},
			(select count(*)::int from app.buchungen b where b.dienst_id = d.id and b.betrieb_id = d.betrieb_id and b.status = 'aktiv' and b.ende > now()) as kommend
		from app.buchung_dienste d where d.betrieb_id = $1 ${id ? 'and d.id = $2' : ''}
		order by d.sortierung, public.unaccent(lower(d.name)), d.id`,
		id ? [betriebId, id] : [betriebId]
	);
	if (z.length === 0) return [];
	const ids = z.map((r) => r.id as string);
	const ma = await tx`
		select m.dienst_id, b.id, b.name from app.buchung_dienst_mitarbeiter m
		join app.benutzer b on b.id = m.benutzer_id and b.betrieb_id = m.betrieb_id
		where m.betrieb_id = ${betriebId} and m.dienst_id = any(${ids}::uuid[])
		order by public.unaccent(lower(b.name)), b.id`;
	const links = await tx`
		select l.id, l.dienst_id, l.benutzer_id, b.name as benutzer_name, l.token, l.quelle_id, l.aktiv
		from app.buchung_links l left join app.benutzer b on b.id = l.benutzer_id and b.betrieb_id = l.betrieb_id
		where l.betrieb_id = ${betriebId} and l.dienst_id = any(${ids}::uuid[])
		order by (l.benutzer_id is not null), public.unaccent(lower(coalesce(b.name, ''))), l.id`;
	return z.map((r) => ({
		...zuDienst(r),
		kommend: r.kommend,
		mitarbeiter: ma.filter((m) => m.dienst_id === r.id).map((m) => ({ id: m.id, name: m.name })),
		links: links
			.filter((l) => l.dienst_id === r.id)
			.map((l) => ({ id: l.id, benutzerId: l.benutzer_id, benutzerName: l.benutzer_name, token: l.token, quelleId: l.quelle_id, aktiv: l.aktiv }))
	}));
}

export async function listeDienste(k: Kontext): Promise<Dienst[]> {
	return mitBetrieb(k, (tx) => ladeDienste(tx, k.betriebId));
}

export async function holeDienst(k: Kontext, id: unknown): Promise<Dienst> {
	const did = pruefeId(id);
	const [d] = await mitBetrieb(k, (tx) => ladeDienste(tx, k.betriebId, did));
	if (!d) throw nichtGefunden();
	return d;
}

async function pruefeQuelle(tx: TransactionSql, k: Kontext, quelleId: string | null): Promise<void> {
	if (!quelleId) return;
	const [q] = await tx`select 1 from app.auftrag_quellen where id = ${quelleId} and betrieb_id = ${k.betriebId}`;
	if (!q) throw new ApiFehler(400, 'Auftragsquelle: ungültige Auswahl.');
}

/** Prüft Mitarbeiter-IDs (aktiv, im Betrieb) und die Regel „fester Mitarbeiter = genau einer“. */
async function pruefeMitarbeiter(tx: TransactionSql, k: Kontext, ids: string[], modus: Modus): Promise<string[]> {
	const eindeutig = [...new Set(ids.map((i) => pruefeId(i, () => new ApiFehler(400, 'Mitarbeiter: ungültige Auswahl.'))))];
	if (eindeutig.length > 50) throw new ApiFehler(400, 'Höchstens 50 Mitarbeiter je Terminart.');
	if (eindeutig.length > 0) {
		const z = await tx`select id from app.benutzer where betrieb_id = ${k.betriebId} and aktiv and id = any(${eindeutig}::uuid[])`;
		if (z.length !== eindeutig.length) throw new ApiFehler(400, 'Mitarbeiter: ungültige Auswahl.');
	}
	if (modus === 'fest' && eindeutig.length > 1) throw new ApiFehler(400, 'Bei „Fester Mitarbeiter“ bitte genau einen Mitarbeiter wählen.');
	return eindeutig;
}

/** Mitarbeiter-Liste aus Formular (`mitarbeiter` mehrfach) oder JSON (Array). `undefined` = nicht ändern. */
export function mitarbeiterAus(e: Record<string, unknown> | FormData): string[] | undefined {
	if (e instanceof FormData) {
		if (!e.has('mitarbeiterGesendet') && !e.has('mitarbeiter')) return undefined;
		return e.getAll('mitarbeiter').map(String).filter(Boolean);
	}
	if (e.mitarbeiter === undefined) return undefined;
	if (!Array.isArray(e.mitarbeiter)) throw new ApiFehler(400, 'Mitarbeiter: Liste erwartet.');
	return e.mitarbeiter.map(String);
}

async function setzeMitarbeiter(tx: TransactionSql, k: Kontext, dienstId: string, ids: string[]): Promise<void> {
	await tx`delete from app.buchung_dienst_mitarbeiter where dienst_id = ${dienstId} and betrieb_id = ${k.betriebId} and not (benutzer_id = any(${ids}::uuid[]))`;
	for (const id of ids) {
		await tx`insert into app.buchung_dienst_mitarbeiter (betrieb_id, dienst_id, benutzer_id) values (${k.betriebId}, ${dienstId}, ${id}) on conflict do nothing`;
	}
	// Links einzelner Mitarbeiter, die nicht mehr zugeordnet sind, gehen weg (sonst könnte man sie noch buchen)
	await tx`delete from app.buchung_links where dienst_id = ${dienstId} and betrieb_id = ${k.betriebId} and benutzer_id is not null and not (benutzer_id = any(${ids}::uuid[]))`;
	// Standard-Link (alle Mitarbeiter des Dienstes) gibt es immer
	await tx`insert into app.buchung_links (betrieb_id, dienst_id, token) values (${k.betriebId}, ${dienstId}, ${neuesToken()}) on conflict do nothing`;
}

/** Neuer Dienst (mit Standard-Link); optional Mitarbeiter. */
export async function legeDienstAn(k: Kontext, e: Record<string, unknown>, mitarbeiter: string[] = []): Promise<Dienst> {
	const w = pruefeDienstEingabe(e);
	return mitBetrieb(k, async (tx) => {
		await pruefeQuelle(tx, k, w.quelleId);
		const ids = await pruefeMitarbeiter(tx, k, mitarbeiter, w.modus);
		const [gleich] = await tx`select 1 from app.buchung_dienste where betrieb_id = ${k.betriebId} and lower(btrim(name)) = lower(${w.name})`;
		if (gleich) throw new ApiFehler(409, `Es gibt schon eine Terminart „${w.name}“.`);
		const [{ n }] = await tx`select coalesce(max(sortierung), 0)::int + 1 as n from app.buchung_dienste where betrieb_id = ${k.betriebId}`;
		const [z] = await tx`
			insert into app.buchung_dienste (betrieb_id, name, beschreibung, dauer_min, puffer_vor_min, puffer_nach_min, vorlauf_min,
				horizont_tage, max_pro_tag, ort_art, farbe, aktiv, online_buchbar, modus, einsatz_art, adresse, fragen, quelle_id, sortierung)
			values (${k.betriebId}, ${w.name}, ${w.beschreibung}, ${w.dauerMin}, ${w.pufferVorMin}, ${w.pufferNachMin}, ${w.vorlaufMin},
				${w.horizontTage}, ${w.maxProTag}, ${w.ortArt}, ${w.farbe}, ${w.aktiv}, ${w.onlineBuchbar}, ${w.modus}, ${w.einsatzArt}, ${w.adresse},
				${tx.json(w.fragen as never)}, ${w.quelleId}, ${n})
			returning id`;
		await setzeMitarbeiter(tx, k, z.id, ids);
		return (await ladeDienste(tx, k.betriebId, z.id))[0];
	});
}

/** Ändert einen Dienst (angegebene Felder ersetzen die bisherigen; das Ergebnis wird als Ganzes geprüft). */
export async function aendereDienst(k: Kontext, id: unknown, e: Record<string, unknown>, mitarbeiter?: string[]): Promise<Dienst> {
	const did = pruefeId(id);
	return mitBetrieb(k, async (tx) => {
		const [alt] = await ladeDienste(tx, k.betriebId, did);
		if (!alt) throw nichtGefunden();
		const w = pruefeDienstEingabe({ ...alt, ...e });
		await pruefeQuelle(tx, k, w.quelleId);
		const ids = await pruefeMitarbeiter(tx, k, mitarbeiter ?? alt.mitarbeiter.map((m) => m.id), w.modus);
		const [gleich] = await tx`select 1 from app.buchung_dienste where betrieb_id = ${k.betriebId} and lower(btrim(name)) = lower(${w.name}) and id <> ${did}`;
		if (gleich) throw new ApiFehler(409, `Es gibt schon eine Terminart „${w.name}“.`);
		await tx`
			update app.buchung_dienste set name = ${w.name}, beschreibung = ${w.beschreibung}, dauer_min = ${w.dauerMin},
				puffer_vor_min = ${w.pufferVorMin}, puffer_nach_min = ${w.pufferNachMin}, vorlauf_min = ${w.vorlaufMin},
				horizont_tage = ${w.horizontTage}, max_pro_tag = ${w.maxProTag}, ort_art = ${w.ortArt}, farbe = ${w.farbe},
				aktiv = ${w.aktiv}, online_buchbar = ${w.onlineBuchbar}, modus = ${w.modus}, einsatz_art = ${w.einsatzArt}, adresse = ${w.adresse},
				fragen = ${tx.json(w.fragen as never)}, quelle_id = ${w.quelleId}
			where id = ${did} and betrieb_id = ${k.betriebId}`;
		await setzeMitarbeiter(tx, k, did, ids);
		return (await ladeDienste(tx, k.betriebId, did))[0];
	});
}

/** Mail-Vorlage der Terminbestätigung je Dienst (leer = Standard der Bibliothek, Jamil msg 2789). */
export async function holeDienstMailVorlage(k: Kontext, id: unknown): Promise<string | null> {
	const did = pruefeId(id);
	return mitBetrieb(k, async (tx) => {
		const [z] = await tx`select mail_vorlage_id from app.buchung_dienste where id = ${did} and betrieb_id = ${k.betriebId}`;
		if (!z) throw nichtGefunden();
		return (z.mail_vorlage_id as string | null) ?? null;
	});
}

export async function setzeDienstMailVorlage(k: Kontext, id: unknown, vorlageId: unknown): Promise<void> {
	const did = pruefeId(id);
	const vid = vorlageId === undefined || vorlageId === null || vorlageId === '' ? null : pruefeId(vorlageId, () => new ApiFehler(400, 'Mail-Vorlage: ungültige Auswahl.'));
	await mitBetrieb(k, async (tx) => {
		if (vid) {
			const [v] = await tx`select 1 from app.mail_vorlagen where id = ${vid} and betrieb_id = ${k.betriebId}`;
			if (!v) throw new ApiFehler(400, 'Mail-Vorlage: ungültige Auswahl.');
		}
		const z = await tx`update app.buchung_dienste set mail_vorlage_id = ${vid} where id = ${did} and betrieb_id = ${k.betriebId} returning id`;
		if (z.length === 0) throw nichtGefunden();
	});
}

/** Löschen; mit Buchungen wird der Dienst nur ausgeschaltet (die Buchungen bleiben lesbar). */
export async function loescheDienst(k: Kontext, id: unknown): Promise<'geloescht' | 'deaktiviert'> {
	const did = pruefeId(id);
	return mitBetrieb(k, async (tx) => {
		const [benutzt] = await tx`select 1 from app.buchungen where dienst_id = ${did} and betrieb_id = ${k.betriebId} limit 1`;
		if (benutzt) {
			const z = await tx`update app.buchung_dienste set aktiv = false where id = ${did} and betrieb_id = ${k.betriebId} returning id`;
			if (z.length === 0) throw nichtGefunden();
			return 'deaktiviert';
		}
		const z = await tx`delete from app.buchung_dienste where id = ${did} and betrieb_id = ${k.betriebId} returning id`;
		if (z.length === 0) throw nichtGefunden();
		return 'geloescht';
	});
}

/** Reihenfolge ändern: eine Terminart um eine Stelle nach oben (-1) oder unten (+1) – gilt für Plantafel und Buchung. */
export async function verschiebeDienst(k: Kontext, id: unknown, richtung: unknown): Promise<void> {
	const did = pruefeId(id);
	const schritt = richtung === -1 || richtung === '-1' || richtung === 'hoch' ? -1 : richtung === 1 || richtung === '1' || richtung === 'runter' ? 1 : 0;
	if (schritt === 0) throw new ApiFehler(400, 'Richtung: hoch oder runter.');
	await mitBetrieb(k, async (tx) => {
		const z = await tx`
			select id from app.buchung_dienste where betrieb_id = ${k.betriebId}
			order by sortierung, public.unaccent(lower(name)), id for update`;
		const ids = z.map((r) => r.id as string);
		const i = ids.indexOf(did);
		if (i < 0) throw nichtGefunden();
		const j = i + schritt;
		if (j < 0 || j >= ids.length) return;
		[ids[i], ids[j]] = [ids[j], ids[i]];
		// fortlaufend neu nummerieren (ältere Daten können gleiche Sortierung haben)
		for (const [n, x] of ids.entries()) await tx`update app.buchung_dienste set sortierung = ${n + 1} where id = ${x} and betrieb_id = ${k.betriebId}`;
	});
}

/** Kurzform für die Auswahl „Terminart“ im Einsatz-Dialog (Plantafel). */
export type TerminartKurz = { id: string; name: string; farbe: string; dauerMin: number; einsatzArt: EinsatzArt; aktiv: boolean };

/**
 * Terminarten zur Auswahl beim Planen (ohne Mitarbeiter, Links, Fragen) in der gepflegten Reihenfolge. Das Recht zum
 * Planen prüft der Aufrufer. Ausgeschaltete Terminarten kommen mit `aktiv: false` (an bestehenden Einsätzen bleiben
 * sie sichtbar, neu wählbar sind sie nicht).
 */
export async function listeTerminarten(k: Kontext): Promise<TerminartKurz[]> {
	return mitBetrieb(k, async (tx) => {
		const z = await tx`
			select id, name, farbe, dauer_min, einsatz_art, aktiv from app.buchung_dienste where betrieb_id = ${k.betriebId}
			order by sortierung, public.unaccent(lower(name)), id`;
		return z.map((r) => ({ id: r.id, name: r.name, farbe: r.farbe, dauerMin: r.dauer_min, einsatzArt: r.einsatz_art, aktiv: r.aktiv }));
	});
}

// ——— Links ———

const linkNichtGefunden = () => new ApiFehler(404, 'Buchungslink nicht gefunden.');

/** Link nur für einen Mitarbeiter des Dienstes (gibt es ihn schon, bleibt er). */
export async function legeMitarbeiterLinkAn(k: Kontext, dienstId: unknown, benutzerId: unknown): Promise<BuchungsLink> {
	const did = pruefeId(dienstId);
	const bid = pruefeId(benutzerId, () => new ApiFehler(400, 'Mitarbeiter: ungültige Auswahl.'));
	return mitBetrieb(k, async (tx) => {
		const [m] = await tx`select 1 from app.buchung_dienst_mitarbeiter where dienst_id = ${did} and benutzer_id = ${bid} and betrieb_id = ${k.betriebId}`;
		if (!m) throw new ApiFehler(400, 'Der Mitarbeiter ist dieser Terminart nicht zugeordnet.');
		await tx`insert into app.buchung_links (betrieb_id, dienst_id, benutzer_id, token) values (${k.betriebId}, ${did}, ${bid}, ${neuesToken()}) on conflict do nothing`;
		const [d] = await ladeDienste(tx, k.betriebId, did);
		return d.links.find((l) => l.benutzerId === bid)!;
	});
}

/** Link ändern: Auftragsquelle, an/aus oder neues Token (der alte Link funktioniert danach nicht mehr). */
export async function aendereLink(k: Kontext, linkId: unknown, e: { quelleId?: unknown; aktiv?: unknown; neuesToken?: boolean }): Promise<void> {
	const lid = pruefeId(linkId, linkNichtGefunden);
	await mitBetrieb(k, async (tx) => {
		const [l] = await tx`select id, quelle_id, aktiv from app.buchung_links where id = ${lid} and betrieb_id = ${k.betriebId}`;
		if (!l) throw linkNichtGefunden();
		const quelleId =
			e.quelleId === undefined ? l.quelle_id : e.quelleId === null || e.quelleId === '' ? null : pruefeId(e.quelleId, () => new ApiFehler(400, 'Auftragsquelle: ungültige Auswahl.'));
		await pruefeQuelle(tx, k, quelleId);
		const aktiv = e.aktiv === undefined ? l.aktiv : janein(e.aktiv, true);
		await tx`update app.buchung_links set quelle_id = ${quelleId}, aktiv = ${aktiv} where id = ${lid} and betrieb_id = ${k.betriebId}`;
		if (e.neuesToken) await tx`update app.buchung_links set token = ${neuesToken()} where id = ${lid} and betrieb_id = ${k.betriebId}`;
	});
}

/** Mitarbeiter-Link löschen (der Standard-Link eines Dienstes bleibt immer). */
export async function loescheLink(k: Kontext, linkId: unknown): Promise<void> {
	const lid = pruefeId(linkId, linkNichtGefunden);
	await mitBetrieb(k, async (tx) => {
		const z = await tx`delete from app.buchung_links where id = ${lid} and betrieb_id = ${k.betriebId} and benutzer_id is not null returning id`;
		if (z.length === 0) throw linkNichtGefunden();
	});
}

// ——— Einstellungen (Datenschutz, Einbetten) ———

export type BuchungEinstellungen = { datenschutzUrl: string | null; einbettenDomains: string[] };

const DOMAIN = /^https:\/\/(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(:[0-9]{1,5})?$/;

/** „www.beispiel.de“, „https://www.beispiel.de/kontakt“ → „https://www.beispiel.de“; Unsinn → Fehler. */
export function normaleDomain(roh: string): string {
	let t = roh.trim().toLowerCase();
	if (!t) throw new ApiFehler(400, 'Domain fehlt.');
	if (t.startsWith('http://')) throw new ApiFehler(400, `„${roh}“: Einbetten nur auf https-Seiten.`);
	if (!t.startsWith('https://')) t = 'https://' + t;
	const m = /^https:\/\/([^/?#]+)/.exec(t);
	const d = m ? `https://${m[1]}` : t;
	if (!DOMAIN.test(d) || d.length > 200) throw new ApiFehler(400, `„${roh}“ ist keine gültige Domain (z. B. www.ihre-firma.de).`);
	return d;
}

/** Domains aus einem Textfeld (je Zeile oder durch Komma/Leerzeichen getrennt). */
export function pruefeDomains(roh: unknown): string[] {
	if (roh === undefined || roh === null || roh === '') return [];
	const teile = Array.isArray(roh) ? roh.map(String) : String(roh).split(/[\s,;]+/);
	const liste = [...new Set(teile.filter((t) => t.trim() !== '').map(normaleDomain))];
	if (liste.length > 20) throw new ApiFehler(400, 'Höchstens 20 Domains.');
	return liste;
}

export function pruefeDatenschutzUrl(roh: unknown): string | null {
	const t = textFeld(roh, 'Datenschutz-Link', 500);
	if (!t) return null;
	let u: URL;
	try {
		u = new URL(t);
	} catch {
		throw new ApiFehler(400, 'Datenschutz-Link: bitte eine vollständige Adresse (https://…) eingeben.');
	}
	if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new ApiFehler(400, 'Datenschutz-Link: bitte eine https-Adresse eingeben.');
	if (/[\s<>"]/.test(t)) throw new ApiFehler(400, 'Datenschutz-Link: ungültige Zeichen.');
	return u.toString();
}

export async function ladeEinstellungen(tx: TransactionSql, betriebId: string): Promise<BuchungEinstellungen> {
	const [z] = await tx`select datenschutz_url, einbetten_domains from app.buchung_einstellungen where betrieb_id = ${betriebId}`;
	return { datenschutzUrl: z?.datenschutz_url ?? null, einbettenDomains: z?.einbetten_domains ?? [] };
}

export async function holeEinstellungen(k: Kontext): Promise<BuchungEinstellungen> {
	return mitBetrieb(k, (tx) => ladeEinstellungen(tx, k.betriebId));
}

export async function speichereEinstellungen(k: Kontext, e: Record<string, unknown>): Promise<BuchungEinstellungen> {
	const datenschutzUrl = pruefeDatenschutzUrl(e.datenschutzUrl);
	const domains = pruefeDomains(e.einbettenDomains);
	return mitBetrieb(k, async (tx) => {
		await tx`
			insert into app.buchung_einstellungen (betrieb_id, datenschutz_url, einbetten_domains)
			values (${k.betriebId}, ${datenschutzUrl}, ${domains})
			on conflict (betrieb_id) do update set datenschutz_url = excluded.datenschutz_url, einbetten_domains = excluded.einbetten_domains`;
		return ladeEinstellungen(tx, k.betriebId);
	});
}

/** Global erlaubte Ursprünge zum Einbetten (z. B. die eigene Firmen-Website des Betreibers) aus der Umgebung. */
export function globaleEinbettenDomains(): string[] {
	const roh = process.env.CRM_BUCHUNG_EINBETTEN ?? '';
	const aus: string[] = [];
	for (const t of roh.split(/[\s,;]+/)) {
		if (!t.trim()) continue;
		try {
			aus.push(normaleDomain(t));
		} catch {
			console.warn(`CRM_BUCHUNG_EINBETTEN: „${t}“ ist keine gültige Domain und wird ignoriert.`);
		}
	}
	return aus;
}

// ——— Arbeitszeiten und Ausnahmen ———

export type Zeiten = {
	benutzerId: string;
	/** für alle Dienste */
	allgemein: ArbeitsZeit[];
	/** abweichend je Dienst */
	jeDienst: Record<string, ArbeitsZeit[]>;
	ausnahmen: (Ausnahme & { id: string; notiz: string | null })[];
};

export async function holeZeiten(k: Kontext, benutzerId: unknown): Promise<Zeiten> {
	const bid = pruefeId(benutzerId, () => new ApiFehler(404, 'Mitarbeiter nicht gefunden.'));
	return mitBetrieb(k, async (tx) => {
		const [b] = await tx`select 1 from app.benutzer where id = ${bid} and betrieb_id = ${k.betriebId}`;
		if (!b) throw new ApiFehler(404, 'Mitarbeiter nicht gefunden.');
		const z = await tx`
			select dienst_id, wochentag, to_char(von, 'HH24:MI') as von, to_char(bis, 'HH24:MI') as bis
			from app.buchung_zeiten where betrieb_id = ${k.betriebId} and benutzer_id = ${bid} order by wochentag, von`;
		const a = await tx`
			select id, to_char(tag, 'YYYY-MM-DD') as tag, art, to_char(von, 'HH24:MI') as von, to_char(bis, 'HH24:MI') as bis, notiz
			from app.buchung_ausnahmen where betrieb_id = ${k.betriebId} and benutzer_id = ${bid}
				and tag >= (now() at time zone 'Europe/Berlin')::date - 1
			order by tag, von nulls first`;
		const jeDienst: Record<string, ArbeitsZeit[]> = {};
		for (const r of z.filter((r) => r.dienst_id)) (jeDienst[r.dienst_id] ??= []).push({ wochentag: r.wochentag, von: r.von, bis: bisText(r.bis) });
		return {
			benutzerId: bid,
			allgemein: z.filter((r) => !r.dienst_id).map((r) => ({ wochentag: r.wochentag, von: r.von, bis: bisText(r.bis) })),
			jeDienst,
			ausnahmen: a.map((r) => ({ id: r.id, tag: r.tag, art: r.art, von: r.von, bis: r.bis ? bisText(r.bis) : null, notiz: r.notiz }))
		};
	});
}

/** time „24:00“ (Tagesende) bleibt so; PostgreSQL kennt 24:00:00. */
const bisText = (t: string) => t;

/** Zeilen „wochentag, von, bis“ prüfen (Überschneidungen am selben Tag zusammengefasst ist Sache der Rechnung). */
export function pruefeArbeitszeiten(roh: unknown): ArbeitsZeit[] {
	if (!Array.isArray(roh)) throw new ApiFehler(400, 'Arbeitszeiten: Liste erwartet.');
	if (roh.length > 70) throw new ApiFehler(400, 'Zu viele Zeilen.');
	return roh.map((r, i) => {
		const o = (r ?? {}) as Record<string, unknown>;
		const wt = Number(o.wochentag);
		if (!Number.isInteger(wt) || wt < 0 || wt > 6) throw new ApiFehler(400, `Zeile ${i + 1}: ungültiger Wochentag.`);
		if (!istUhrzeit(o.von) || !(istUhrzeit(o.bis) || o.bis === '24:00')) throw new ApiFehler(400, `Zeile ${i + 1}: bitte Uhrzeiten wie 08:00 eingeben.`);
		if ((o.bis as string) <= (o.von as string)) throw new ApiFehler(400, `Zeile ${i + 1}: „bis“ muss nach „von“ liegen.`);
		return { wochentag: wt, von: o.von as string, bis: o.bis as string };
	});
}

/** Ersetzt die Arbeitszeiten eines Mitarbeiters (für alle Dienste oder – mit `dienstId` – für einen Dienst). */
export async function speichereArbeitszeiten(k: Kontext, benutzerId: unknown, dienstId: unknown, zeiten: unknown): Promise<void> {
	const bid = pruefeId(benutzerId, () => new ApiFehler(404, 'Mitarbeiter nicht gefunden.'));
	const did = dienstId === null || dienstId === undefined || dienstId === '' ? null : pruefeId(dienstId);
	const liste = pruefeArbeitszeiten(zeiten);
	await mitBetrieb(k, async (tx) => {
		const [b] = await tx`select 1 from app.benutzer where id = ${bid} and betrieb_id = ${k.betriebId}`;
		if (!b) throw new ApiFehler(404, 'Mitarbeiter nicht gefunden.');
		if (did) {
			const [d] = await tx`select 1 from app.buchung_dienste where id = ${did} and betrieb_id = ${k.betriebId}`;
			if (!d) throw nichtGefunden();
		}
		await tx`delete from app.buchung_zeiten where betrieb_id = ${k.betriebId} and benutzer_id = ${bid} and dienst_id is not distinct from ${did}::uuid`;
		for (const z of liste) {
			await tx`insert into app.buchung_zeiten (betrieb_id, benutzer_id, dienst_id, wochentag, von, bis)
				values (${k.betriebId}, ${bid}, ${did}, ${z.wochentag}, ${z.von}, ${z.bis})`;
		}
	});
}

export async function legeAusnahmeAn(k: Kontext, benutzerId: unknown, e: Record<string, unknown>): Promise<void> {
	const bid = pruefeId(benutzerId, () => new ApiFehler(404, 'Mitarbeiter nicht gefunden.'));
	if (!istTag(e.tag)) throw new ApiFehler(400, 'Bitte einen Tag wählen.');
	const art = e.art === 'zusaetzlich' ? 'zusaetzlich' : 'frei';
	const von = e.von === undefined || e.von === '' ? null : e.von;
	const bis = e.bis === undefined || e.bis === '' ? null : e.bis;
	if ((von === null) !== (bis === null)) throw new ApiFehler(400, 'Bitte „von“ und „bis“ angeben – oder beides leer lassen (ganzer Tag).');
	if (von !== null && (!istUhrzeit(von) || !istUhrzeit(bis) || (bis as string) <= (von as string))) throw new ApiFehler(400, 'Bitte gültige Uhrzeiten eingeben („bis“ nach „von“).');
	if (art === 'zusaetzlich' && von === null) throw new ApiFehler(400, 'Für zusätzliche Zeiten bitte „von“ und „bis“ angeben.');
	const notiz = textFeld(e.notiz, 'Notiz', 200);
	await mitBetrieb(k, async (tx) => {
		const [b] = await tx`select 1 from app.benutzer where id = ${bid} and betrieb_id = ${k.betriebId}`;
		if (!b) throw new ApiFehler(404, 'Mitarbeiter nicht gefunden.');
		await tx`insert into app.buchung_ausnahmen (betrieb_id, benutzer_id, tag, art, von, bis, notiz)
			values (${k.betriebId}, ${bid}, ${e.tag as string}, ${art}, ${von as string | null}, ${bis as string | null}, ${notiz})`;
	});
}

export async function loescheAusnahme(k: Kontext, id: unknown): Promise<void> {
	const aid = pruefeId(id, () => new ApiFehler(404, 'Ausnahme nicht gefunden.'));
	await mitBetrieb(k, async (tx) => {
		const z = await tx`delete from app.buchung_ausnahmen where id = ${aid} and betrieb_id = ${k.betriebId} returning id`;
		if (z.length === 0) throw new ApiFehler(404, 'Ausnahme nicht gefunden.');
	});
}

// ——— Verfügbarkeit (für die Rechnung der freien Zeiten; auch von der öffentlichen Seite benutzt) ———

/**
 * Lädt für die Mitarbeiter alles, was `freieZeiten` braucht – im Zeitraum der Tage (plus einen Tag Rand wegen der
 * Puffer). `ohneBuchung`: diese Buchung (und ihren Einsatz) nicht als belegt zählen (Verschieben).
 */
export async function ladeVerfuegbarkeit(
	tx: TransactionSql,
	betriebId: string,
	dienstId: string,
	mitarbeiterIds: string[],
	vonTag: string,
	bisTag: string,
	ohneBuchung: string | null = null
): Promise<Verfuegbarkeit[]> {
	if (mitarbeiterIds.length === 0) return [];
	const von = tagesGrenzen(tagPlus(vonTag, -1)).beginn;
	const bis = tagesGrenzen(tagPlus(bisTag, 1)).ende;
	const [zeiten, ausnahmen, einsaetze, buchungen, abw] = await Promise.all([
		tx`select benutzer_id, dienst_id, wochentag, to_char(von, 'HH24:MI') as von, to_char(bis, 'HH24:MI') as bis
			from app.buchung_zeiten where betrieb_id = ${betriebId} and benutzer_id = any(${mitarbeiterIds}::uuid[])
				and (dienst_id is null or dienst_id = ${dienstId})`,
		tx`select benutzer_id, to_char(tag, 'YYYY-MM-DD') as tag, art, to_char(von, 'HH24:MI') as von, to_char(bis, 'HH24:MI') as bis
			from app.buchung_ausnahmen where betrieb_id = ${betriebId} and benutzer_id = any(${mitarbeiterIds}::uuid[])
				and tag between ${vonTag}::date and ${bisTag}::date`,
		tx`select e.benutzer_id, e.beginn, e.ende from app.einsaetze e
			where e.betrieb_id = ${betriebId} and e.benutzer_id = any(${mitarbeiterIds}::uuid[]) and e.beginn < ${bis} and e.ende > ${von}
				and not exists (select 1 from app.buchungen b where b.id = ${ohneBuchung}::uuid and b.betrieb_id = e.betrieb_id and b.einsatz_id = e.id)`,
		tx`select b.benutzer_id, b.dienst_id, b.beginn, b.ende, d.puffer_vor_min, d.puffer_nach_min from app.buchungen b
			join app.buchung_dienste d on d.id = b.dienst_id and d.betrieb_id = b.betrieb_id
			where b.betrieb_id = ${betriebId} and b.status = 'aktiv' and b.benutzer_id = any(${mitarbeiterIds}::uuid[])
				and b.beginn < ${bis} and b.ende > ${von} and b.id is distinct from ${ohneBuchung}::uuid`,
		tx`select benutzer_id, to_char(von, 'YYYY-MM-DD') as von, to_char(bis, 'YYYY-MM-DD') as bis from app.abwesenheiten
			where betrieb_id = ${betriebId} and benutzer_id = any(${mitarbeiterIds}::uuid[]) and von <= ${bisTag}::date and bis >= ${vonTag}::date`
	]);
	return mitarbeiterIds.map((id) => {
		const eigene = zeiten.filter((z) => z.benutzer_id === id);
		const fuerDienst = eigene.filter((z) => z.dienst_id === dienstId);
		const gelten = fuerDienst.length > 0 ? fuerDienst : eigene.filter((z) => !z.dienst_id);
		const jeTag: Record<string, number> = {};
		for (const b of buchungen.filter((b) => b.benutzer_id === id && b.dienst_id === dienstId)) {
			const t = berlinTag(new Date(b.beginn));
			jeTag[t] = (jeTag[t] ?? 0) + 1;
		}
		return {
			id,
			zeiten: gelten.map((z) => ({ wochentag: z.wochentag, von: z.von, bis: z.bis })),
			ausnahmen: ausnahmen.filter((a) => a.benutzer_id === id).map((a) => ({ tag: a.tag, art: a.art, von: a.von, bis: a.bis })),
			belegt: [
				...einsaetze.filter((x) => x.benutzer_id === id).map((x) => ({ beginn: new Date(x.beginn).getTime(), ende: new Date(x.ende).getTime() })),
				...buchungen
					.filter((x) => x.benutzer_id === id)
					.map((x) => ({
						beginn: new Date(x.beginn).getTime(),
						ende: new Date(x.ende).getTime(),
						vor: x.puffer_vor_min * 60_000,
						nach: x.puffer_nach_min * 60_000
					}))
			],
			abwesend: abw.filter((a) => a.benutzer_id === id).map((a) => ({ von: a.von, bis: a.bis })),
			buchungenJeTag: jeTag
		};
	});
}

/** Stand für „abwechselnd“: kommende aktive Buchungen des Dienstes je Mitarbeiter und letzte Vergabe. */
export async function ladeVerteilung(tx: TransactionSql, betriebId: string, dienstId: string, ids: string[]): Promise<Record<string, { anzahl: number; zuletzt: number | null }>> {
	const z = await tx`
		select benutzer_id, count(*) filter (where status = 'aktiv' and ende > now())::int as anzahl, max(angelegt) as zuletzt
		from app.buchungen where betrieb_id = ${betriebId} and dienst_id = ${dienstId} and benutzer_id = any(${ids}::uuid[])
		group by benutzer_id`;
	const aus: Record<string, { anzahl: number; zuletzt: number | null }> = {};
	for (const r of z) aus[r.benutzer_id] = { anzahl: r.anzahl, zuletzt: r.zuletzt ? new Date(r.zuletzt).getTime() : null };
	return aus;
}

// ——— Buchungen im Betrieb (Anzeige) ———

export type BuchungKurz = {
	id: string;
	dienstName: string;
	beginn: string;
	ende: string;
	status: 'aktiv' | 'storniert';
	kundeName: string;
	mitarbeiterName: string;
	auftragId: string | null;
};

export async function kommendeBuchungen(k: Kontext, dienstId?: string, limit = 50): Promise<BuchungKurz[]> {
	return mitBetrieb(k, async (tx) => {
		const z = await tx`
			select b.id, d.name as dienst, b.beginn, b.ende, b.status, concat_ws(' ', b.vorname, b.nachname) as kunde, u.name as mitarbeiter, b.auftrag_id
			from app.buchungen b join app.buchung_dienste d on d.id = b.dienst_id and d.betrieb_id = b.betrieb_id
			join app.benutzer u on u.id = b.benutzer_id and u.betrieb_id = b.betrieb_id
			where b.betrieb_id = ${k.betriebId} and b.ende > now() - interval '1 day' ${dienstId ? tx`and b.dienst_id = ${dienstId}` : tx``}
			order by b.beginn limit ${Math.min(Math.max(limit, 1), 200)}`;
		return z.map((r) => ({
			id: r.id,
			dienstName: r.dienst,
			beginn: new Date(r.beginn).toISOString(),
			ende: new Date(r.ende).toISOString(),
			status: r.status,
			kundeName: r.kunde,
			mitarbeiterName: r.mitarbeiter,
			auftragId: r.auftrag_id
		}));
	});
}

export type BuchungAmAuftrag = {
	id: string;
	dienstName: string;
	beginn: string;
	ende: string;
	status: 'aktiv' | 'storniert';
	mitarbeiterName: string;
	kontakt: { name: string; email: string | null; telefon: string | null; adresse: string | null };
	/** Antworten wie ein Protokoll: Frage → Antwort (Text), Fotos als Datei-IDs des Auftrags */
	antworten: { id: string; label: string; text: string; fotos: string[]; hinweis: boolean }[];
	angelegt: string;
};

/**
 * Online-Buchungen eines Auftrags (für die Auftragsseite; die Sichtbarkeit des Auftrags prüft der Aufrufer). Die
 * Antworten werden mit der Fragen-Kopie der Buchung lesbar gemacht – unabhängig von späteren Änderungen am Dienst.
 */
export async function buchungenZumAuftrag(k: Kontext, auftragId: string): Promise<BuchungAmAuftrag[]> {
	return mitBetrieb(k, async (tx) => {
		const z = await tx`
			select b.*, d.name as dienst, u.name as mitarbeiter from app.buchungen b
			join app.buchung_dienste d on d.id = b.dienst_id and d.betrieb_id = b.betrieb_id
			join app.benutzer u on u.id = b.benutzer_id and u.betrieb_id = b.betrieb_id
			where b.betrieb_id = ${k.betriebId} and b.auftrag_id = ${auftragId}
			order by b.angelegt desc`;
		return z.map((r) => {
			const fragen = (r.fragen as Schema) ?? LEERE_FRAGEN;
			const antworten = (r.antworten ?? {}) as Record<string, unknown>;
			return {
				id: r.id,
				dienstName: r.dienst,
				beginn: new Date(r.beginn).toISOString(),
				ende: new Date(r.ende).toISOString(),
				status: r.status,
				mitarbeiterName: r.mitarbeiter,
				kontakt: {
					name: `${r.vorname ?? ''} ${r.nachname}`.trim(),
					email: r.email,
					telefon: r.telefon,
					adresse: r.strasse ? `${r.strasse}, ${r.plz ?? ''} ${r.ort ?? ''}`.trim() : null
				},
				antworten: alleFelder(fragen)
					.map(({ feld }) => ({
						id: feld.id,
						label: feld.label,
						text: feld.typ === 'hinweis' ? '' : wertText(feld, antworten[feld.id]),
						fotos: dateiIds(feld, antworten[feld.id]),
						hinweis: feld.typ === 'hinweis'
					}))
					.filter((a) => !a.hinweis && (a.text !== '–' || a.fotos.length > 0)),
				angelegt: new Date(r.angelegt).toISOString()
			};
		});
	});
}

/** Zeitpunkt zu Tag + Uhrzeit (Berlin) – kleine Hilfe für Tests und Vorschau. */
export const zeitpunktAm = (tag: string, h: number, m = 0) => berlinZeitpunkt(tag, h, m);
