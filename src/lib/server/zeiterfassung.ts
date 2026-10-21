import { mitBetrieb, type Kontext, type TransactionSql } from './db';
import { ApiFehler } from './fehler';
import { holeAuftrag, sichtVon } from './auftraege';
import { firmenStart, merkeAdressen, normalAdresse } from './karte';
import { textFeld, UUID } from './kunden';
import { hatRecht } from './rechte';
import { darfEines } from './tarif';
import { fahrKm } from './routen';
import { ausTagUndUhrzeit, berlinTag, istTag, tagesGrenzen, tagPlus, wochentag } from '../zeit';
import {
		STEMPEL_AKTIONEN,
	ZEIT_ARTEN,
	summiere,
	sollMinuten,
	tagesUebersicht,
	tageZwischen,
	type TagesZeile,
	type StempelAktion,
	type Summe,
	type ZeitArt,
	type ZeitEintrag
} from '../zeiterfassung';

/**
 * Zeiterfassung (Wunsch Jamil msgs 2770/2772/2774, 2776; Migration 080): Stempeln mit einem Tipp, Nachträge und
 * Korrekturen mit Grund, Freigabe; jede Zeit gehört zu einem Auftrag (msg 2790). Rechnen: src/lib/zeiterfassung.ts.
 *
 * Rechte (Modul `zeiterfassung`):
 * - `zeiterfassung.nutzen`: eigene Zeiten stempeln, nachtragen und ändern (bis zur Freigabe), eigenes Material erfassen.
 * - `zeiterfassung.alle_sehen` (Chef/Büro): Zeiten aller sehen, für andere nachtragen, korrigieren (auch nach der Freigabe)
 *   und freigeben.
 * Stempeln auf einen Auftrag verlangt, dass der Auftrag für den Nutzer sichtbar ist (wie überall: sonst 404).
 */

export type ZeitZugriff = { k: Kontext; nutzer: Nutzer; verwalten: boolean };

export async function zeitZugriff(locals: { nutzer: Nutzer | null }): Promise<ZeitZugriff> {
	await darfEines(locals, 'zeiterfassung', ['zeiterfassung.nutzen', 'zeiterfassung.alle_sehen']);
	const nutzer = locals.nutzer!;
	return { k: { betriebId: nutzer.betriebId!, benutzerId: nutzer.id }, nutzer, verwalten: hatRecht(nutzer, 'zeiterfassung.alle_sehen') };
}

export async function zeitVerwaltung(locals: { nutzer: Nutzer | null }): Promise<ZeitZugriff> {
	await darfEines(locals, 'zeiterfassung', ['zeiterfassung.alle_sehen']);
	return zeitZugriff(locals);
}

const nichtGefunden = () => new ApiFehler(404, 'Zeiteintrag nicht gefunden.');
const UEBERSCHNEIDUNG = 'Die Zeit überschneidet sich mit einem anderen Eintrag dieser Person.';

/** Datenbankfehler der Zeiterfassung in verständliche Meldungen übersetzen. */
function uebersetze(e: unknown): never {
	const code = (e as { code?: string })?.code;
	if (code === '23P01') throw new ApiFehler(409, UEBERSCHNEIDUNG);
	if (code === '23505') throw new ApiFehler(409, 'Es läuft schon eine Zeit – bitte zuerst beenden.');
	if (code === '23514') throw new ApiFehler(400, 'Die Angaben passen nicht zusammen (z. B. Ende vor Beginn).');
	throw e;
}

// ——— Lesen ———

const AUSWAHL = `z.id, z.benutzer_id, b.name as benutzer_name, z.auftrag_id, a.nummer as auftrag_nummer, a.titel as auftrag_titel,
	z.art, z.beginn, z.ende, z.pause_min, z.km, z.km_berechnet, z.km_quelle,
	z.start_adresse, z.ziel_adresse, z.notiz, z.manuell, z.korrektur_grund, z.freigegeben_am, z.nacharbeit`;
const VON = `app.zeit_eintraege z
	join app.benutzer b on b.id = z.benutzer_id and b.betrieb_id = z.betrieb_id
	left join app.auftraege a on a.id = z.auftrag_id and a.betrieb_id = z.betrieb_id`;

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
const zahl = (w: unknown) => (w === null || w === undefined ? null : Number(w));

export function zuEintrag(z: Record<string, any>): ZeitEintrag {
	return {
		id: z.id,
		benutzerId: z.benutzer_id,
		benutzerName: z.benutzer_name,
		auftragId: z.auftrag_id,
		auftragNummer: z.auftrag_nummer ?? null,
		auftragTitel: z.auftrag_titel ?? null,
		art: z.art,
		beginn: iso(z.beginn)!,
		ende: iso(z.ende),
		pauseMin: Number(z.pause_min),
		km: zahl(z.km),
		kmBerechnet: zahl(z.km_berechnet),
		kmQuelle: z.km_quelle,
		startAdresse: z.start_adresse,
		zielAdresse: z.ziel_adresse,
		notiz: z.notiz,
		manuell: z.manuell,
		korrekturGrund: z.korrektur_grund,
		freigegeben: z.freigegeben_am !== null,
		nacharbeit: z.nacharbeit === true
	};
}

/** Laufender Abschnitt einer Person (oder null). */
export async function laufend(k: Kontext, benutzerId: string): Promise<ZeitEintrag | null> {
	const [z] = await mitBetrieb(k, (tx) => tx`
		select ${tx.unsafe(AUSWAHL)} from ${tx.unsafe(VON)}
		where z.betrieb_id = ${k.betriebId} and z.benutzer_id = ${benutzerId} and z.ende is null`);
	return z ? zuEintrag(z) : null;
}

export type ZeitFilter = { benutzerId?: string; von?: string; bis?: string; auftragId?: string };

/**
 * Einträge im Zeitraum [von, bis] (Berliner Tage, beide eingeschlossen) bzw. zu einem Auftrag. Ohne „Zeiten aller
 * verwalten“ immer nur die eigenen. Fehlende Kilometer werden vorher nachgerechnet (Koordinaten inzwischen da).
 */
export async function listeZeiten(z: ZeitZugriff, f: ZeitFilter): Promise<ZeitEintrag[]> {
	const person = z.verwalten ? f.benutzerId : z.nutzer.id;
	if (person !== undefined && !UUID.test(person)) throw new ApiFehler(400, 'Ungültige Person.');
	if (f.auftragId !== undefined && !UUID.test(f.auftragId)) throw new ApiFehler(404, 'Auftrag nicht gefunden.');
	for (const t of [f.von, f.bis]) if (t !== undefined && !istTag(t)) throw new ApiFehler(400, 'Ungültiges Datum.');
	const ab = f.von ? tagesGrenzen(f.von).beginn : null;
	const bis = f.bis ? tagesGrenzen(f.bis).ende : null;
	await kmNachtragen(z.k);
	const zeilen = await mitBetrieb(z.k, (tx) => tx`
		select ${tx.unsafe(AUSWAHL)} from ${tx.unsafe(VON)}
		where z.betrieb_id = ${z.k.betriebId}
			${person ? tx`and z.benutzer_id = ${person}` : tx``}
			${f.auftragId ? tx`and z.auftrag_id = ${f.auftragId}` : tx``}
			${bis ? tx`and z.beginn < ${bis}` : tx``}
			${ab ? tx`and coalesce(z.ende, 'infinity') > ${ab}` : tx``}
		order by z.beginn, z.id
		limit 5000`);
	return zeilen.map(zuEintrag);
}

/** Summen je Person zu einem Auftrag (für die Auftragsseite). */
export async function zeitenZumAuftrag(
	z: ZeitZugriff,
	auftragId: string,
	jetzt = new Date()
): Promise<{ personen: ({ benutzerId: string; name: string } & Summe)[]; gesamt: Summe; heuteIch: Summe }> {
	if (!UUID.test(auftragId)) throw new ApiFehler(404, 'Auftrag nicht gefunden.');
	await holeAuftrag(z.k, sichtVon(z.nutzer), auftragId);
	const liste = await listeZeiten(z, { auftragId });
	const ids = [...new Set(liste.map((e) => e.benutzerId))];
	const personen = ids.map((id) => {
		const eigene = liste.filter((e) => e.benutzerId === id);
		return { benutzerId: id, name: eigene[0].benutzerName ?? '', ...summiere(eigene, jetzt) };
	});
	const heute = tagesGrenzen(berlinTag(jetzt));
	return {
		personen,
		gesamt: personen.reduce((s, p) => ({ arbeitMin: s.arbeitMin + p.arbeitMin, pauseMin: s.pauseMin + p.pauseMin, fahrtMin: s.fahrtMin + p.fahrtMin, km: Math.round((s.km + p.km) * 10) / 10 }), { arbeitMin: 0, pauseMin: 0, fahrtMin: 0, km: 0 }),
		heuteIch: summiere(liste.filter((e) => e.benutzerId === z.nutzer.id), jetzt, { von: heute.beginn, bis: heute.ende })
	};
}

// ——— Stempeln ———

export type Ziel = { auftragId?: string | null };

export function pruefeStempelAktion(w: unknown): StempelAktion {
	if (typeof w !== 'string' || !(STEMPEL_AKTIONEN as readonly string[]).includes(w)) throw new ApiFehler(400, 'Unbekannte Aktion.');
	return w as StempelAktion;
}

/** Auftrag (Pflicht für start/abfahrt, sonst optional) – nur sichtbare Aufträge (Monteur: eigene). */
async function pruefeZiel(z: ZeitZugriff, ziel: Ziel, pflicht: boolean): Promise<{ auftragId: string | null; adresse: string | null }> {
	const auftragId = ziel.auftragId || null;
	if (auftragId) {
		if (!UUID.test(auftragId)) throw new ApiFehler(404, 'Auftrag nicht gefunden.');
		const a = await holeAuftrag(z.k, sichtVon(z.nutzer), auftragId);
		return { auftragId: a.id, adresse: a.adresse };
	}
	if (pflicht) throw new ApiFehler(400, 'Bitte einen Auftrag wählen.');
	return { auftragId: null, adresse: null };
}

/** Schließt den laufenden Abschnitt zum Zeitpunkt `jetzt` (zu kurz = unter einer Sekunde → verworfen). */
async function schliesse(tx: TransactionSql, k: Kontext, lauf: Record<string, any>, jetzt: Date): Promise<string | null> {
	if (jetzt.getTime() - new Date(lauf.beginn).getTime() < 1000) {
		await tx`delete from app.zeit_eintraege where id = ${lauf.id} and betrieb_id = ${k.betriebId}`;
		return null;
	}
	await tx`update app.zeit_eintraege set ende = ${jetzt} where id = ${lauf.id} and betrieb_id = ${k.betriebId}`;
	return lauf.art === 'fahrt' ? (lauf.id as string) : null;
}

async function neu(tx: TransactionSql, k: Kontext, benutzerId: string, art: ZeitArt, auftragId: string, jetzt: Date, extra: { start?: string | null; ziel?: string | null } = {}) {
	await tx`
		insert into app.zeit_eintraege (betrieb_id, benutzer_id, auftrag_id, art, beginn, start_adresse, ziel_adresse)
		values (${k.betriebId}, ${benutzerId}, ${auftragId}, ${art}, ${jetzt}, ${extra.start ?? null}, ${extra.ziel ?? null})`;
}

/** Wo war die Person zuletzt (heute)? Adresse des letzten Auftrags von heute, sonst die Firmenadresse. */
async function letzterOrt(z: ZeitZugriff, jetzt: Date): Promise<string | null> {
	const { beginn } = tagesGrenzen(berlinTag(jetzt));
	const [l] = await mitBetrieb(z.k, (tx) => tx`
		select z.auftrag_id, z.art, z.ziel_adresse from app.zeit_eintraege z
		where z.betrieb_id = ${z.k.betriebId} and z.benutzer_id = ${z.nutzer.id} and z.beginn >= ${beginn}
			and z.auftrag_id is not null and z.ende is not null
		order by z.ende desc limit 1`);
	if (l) {
		if (l.art === 'fahrt' && l.ziel_adresse) return l.ziel_adresse;
		try {
			const a = await holeAuftrag(z.k, sichtVon(z.nutzer), l.auftrag_id);
			if (a.adresse) return normalAdresse(a.adresse);
		} catch {
			/* Auftrag weg – dann Firma */
		}
	}
	return (await firmenStart(z.k))?.adresse ?? null;
}

export type StempelErgebnis = { laufend: ZeitEintrag | null; meldung: string };

/**
 * Ein Tipp: start (Arbeit auf Auftrag/Tätigkeit), pause, weiter, fertig, abfahrt (Fahrt zum Auftrag),
 * angekommen (Fahrt beenden und gleich Arbeit dort starten). Wer startet, während noch etwas läuft, beendet das
 * Laufende automatisch – je Person läuft immer nur eines. Doppelte Tipps ändern nichts.
 */
export async function stempeln(z: ZeitZugriff, aktion: StempelAktion, ziel: Ziel = {}, jetzt = new Date()): Promise<StempelErgebnis> {
	const zielGeprueft = aktion === 'start' || aktion === 'abfahrt' ? await pruefeZiel(z, ziel, true) : await pruefeZiel(z, ziel, false);
	if (aktion === 'abfahrt' && !zielGeprueft.auftragId) throw new ApiFehler(400, 'Abfahrt geht nur zu einem Auftrag.');
	const start = aktion === 'abfahrt' ? await letzterOrt(z, jetzt) : null;
	const k = z.k;
	let fahrtGeschlossen: string | null = null;
	const meldung = await mitBetrieb(k, async (tx) => {
		await tx`select pg_advisory_xact_lock(hashtextextended(${'zeit:' + z.nutzer.id}, 0))`;
		const [lauf] = await tx`select * from app.zeit_eintraege where betrieb_id = ${k.betriebId} and benutzer_id = ${z.nutzer.id} and ende is null for update`;
		const gleicherOrt = (l: Record<string, any>) => l.auftrag_id === zielGeprueft.auftragId;
		try {
			switch (aktion) {
				case 'start': {
					if (lauf && lauf.art === 'arbeit' && gleicherOrt(lauf)) return 'Läuft bereits.';
					if (lauf) fahrtGeschlossen = await schliesse(tx, k, lauf, jetzt);
					await neu(tx, k, z.nutzer.id, 'arbeit', zielGeprueft.auftragId!, jetzt);
					return 'Arbeitszeit gestartet.';
				}
				case 'pause': {
					if (lauf?.art === 'pause') return 'Pause läuft bereits.';
					if (!lauf || lauf.art !== 'arbeit') throw new ApiFehler(409, 'Es läuft keine Arbeitszeit.');
					await schliesse(tx, k, lauf, jetzt);
					await neu(tx, k, z.nutzer.id, 'pause', lauf.auftrag_id, jetzt);
					return 'Pause gestartet.';
				}
				case 'weiter': {
					if (lauf?.art === 'arbeit') return 'Arbeitszeit läuft bereits.';
					if (!lauf || lauf.art !== 'pause') throw new ApiFehler(409, 'Es läuft keine Pause.');
					await schliesse(tx, k, lauf, jetzt);
					await neu(tx, k, z.nutzer.id, 'arbeit', lauf.auftrag_id, jetzt);
					return 'Weiter geht’s – Arbeitszeit läuft.';
				}
				case 'fertig': {
					if (!lauf) throw new ApiFehler(409, 'Es läuft gerade keine Zeit.');
					if (zielGeprueft.auftragId && lauf.auftrag_id !== zielGeprueft.auftragId) {
						throw new ApiFehler(409, 'Die laufende Zeit gehört zu einem anderen Auftrag.');
					}
					fahrtGeschlossen = await schliesse(tx, k, lauf, jetzt);
					return lauf.art === 'fahrt' ? 'Fahrt beendet.' : 'Feierabend für diesen Auftrag – Zeit beendet.';
				}
				case 'abfahrt': {
					if (lauf && lauf.art === 'fahrt' && gleicherOrt(lauf)) return 'Fahrt läuft bereits.';
					if (lauf) fahrtGeschlossen = await schliesse(tx, k, lauf, jetzt);
					await neu(tx, k, z.nutzer.id, 'fahrt', zielGeprueft.auftragId!, jetzt, {
						start,
						ziel: zielGeprueft.adresse ? normalAdresse(zielGeprueft.adresse) : null
					});
					return 'Gute Fahrt – Fahrzeit läuft.';
				}
				case 'angekommen': {
					if (!lauf || lauf.art !== 'fahrt') throw new ApiFehler(409, 'Es läuft keine Fahrt.');
					fahrtGeschlossen = await schliesse(tx, k, lauf, jetzt);
					await neu(tx, k, z.nutzer.id, 'arbeit', lauf.auftrag_id, jetzt);
					return 'Angekommen – Arbeitszeit läuft.';
				}
			}
		} catch (e) {
			if (e instanceof ApiFehler) throw e;
			uebersetze(e);
		}
	});
	if (start || aktion === 'abfahrt') {
		const [l] = await mitBetrieb(k, (tx) => tx`select start_adresse, ziel_adresse from app.zeit_eintraege where betrieb_id = ${k.betriebId} and benutzer_id = ${z.nutzer.id} and ende is null`);
		if (l) await merkeAdressen(k, [l.start_adresse, l.ziel_adresse]);
	}
	if (fahrtGeschlossen) await kmNachtragen(k, fahrtGeschlossen);
	return { laufend: await laufend(k, z.nutzer.id), meldung };
}

/**
 * Kilometer für beendete Fahrten ohne km nachrechnen, sobald beide Adressen Koordinaten haben (die Geokodierung läuft
 * im Hintergrund). Nur eine Fahrt (`id`) oder bis zu 20 offene des Betriebs.
 */
export async function kmNachtragen(k: Kontext, id?: string): Promise<void> {
	const offen = await mitBetrieb(k, (tx) => tx`
		select z.id, s.lat as s_lat, s.lng as s_lng, g.lat as z_lat, g.lng as z_lng
		from app.zeit_eintraege z
		join app.geo_adressen s on s.betrieb_id = z.betrieb_id and s.adresse = z.start_adresse and s.status = 'gefunden'
		join app.geo_adressen g on g.betrieb_id = z.betrieb_id and g.adresse = z.ziel_adresse and g.status = 'gefunden'
		where z.betrieb_id = ${k.betriebId} and z.art = 'fahrt' and z.ende is not null and z.km_quelle is null
			${id ? tx`and z.id = ${id}` : tx``}
		limit 20`);
	for (const o of offen) {
		const r = await fahrKm({ lat: o.s_lat, lng: o.s_lng }, { lat: o.z_lat, lng: o.z_lng });
		await mitBetrieb(k, (tx) => tx`
			update app.zeit_eintraege set km = ${r.km}, km_berechnet = ${r.km}, km_quelle = ${r.quelle}
			where id = ${o.id} and betrieb_id = ${k.betriebId} and km_quelle is null`);
	}
}

// ——— Nachtragen, Korrigieren, Löschen ———

export type ZeitWerte = {
	benutzerId: string;
	art: ZeitArt;
	beginn: Date;
	ende: Date | null;
	pauseMin: number;
	auftragId: string;
	km: number | null;
	notiz: string | null;
};

function grundAus(w: unknown): string {
	const g = textFeld(w, 'Grund', 300);
	if (!g || [...g].length < 3) throw new ApiFehler(400, 'Bitte einen Grund für die Korrektur angeben (mindestens 3 Zeichen).');
	return g;
}

function ganzzahl(w: unknown, name: string, min: number, max: number): number {
	if (w === undefined || w === null || w === '') return 0;
	const n = typeof w === 'number' ? w : Number(String(w).trim());
	if (!Number.isInteger(n) || n < min || n > max) throw new ApiFehler(400, `${name}: Bitte eine ganze Zahl von ${min} bis ${max} eingeben.`);
	return n;
}

function kmAus(w: unknown): number | null {
	if (w === undefined || w === null || w === '') return null;
	const n = typeof w === 'number' ? w : Number(String(w).trim().replace(',', '.'));
	if (!Number.isFinite(n) || n < 0 || n > 5000) throw new ApiFehler(400, 'Kilometer: Bitte eine Zahl von 0 bis 5000 eingeben.');
	return Math.round(n * 10) / 10;
}

/**
 * Formularwerte → Eintrag: Tag + von/bis (HH:MM; bis ≤ von = über Mitternacht), Pause in Minuten, Art, Auftrag oder
 * Tätigkeit, km (nur Fahrt), Notiz. `bis` leer nur beim Ändern eines laufenden Eintrags.
 */
export function pruefeZeitEingabe(e: Record<string, unknown>, laeuft = false): Omit<ZeitWerte, 'benutzerId'> {
	const art = e.art;
	if (typeof art !== 'string' || !(ZEIT_ARTEN as readonly string[]).includes(art)) throw new ApiFehler(400, 'Bitte Arbeit, Pause oder Fahrt wählen.');
	const tag = e.tag;
	if (!istTag(tag)) throw new ApiFehler(400, 'Bitte einen Tag wählen.');
	let beginn: Date;
	let ende: Date | null = null;
	try {
		beginn = ausTagUndUhrzeit(tag, String(e.von ?? ''));
	} catch {
		throw new ApiFehler(400, 'Bitte den Beginn als Uhrzeit angeben (z. B. 07:30).');
	}
	const bisText = String(e.bis ?? '').trim();
	if (bisText !== '' || !laeuft) {
		try {
			ende = ausTagUndUhrzeit(tag, bisText);
		} catch {
			throw new ApiFehler(400, 'Bitte das Ende als Uhrzeit angeben (z. B. 16:00).');
		}
		if (ende <= beginn) ende = ausTagUndUhrzeit(tagPlus(tag, 1), bisText);
	}
	const pauseMin = art === 'arbeit' ? ganzzahl(e.pauseMin, 'Pause (Minuten)', 0, 720) : 0;
	if (ende && pauseMin * 60_000 >= ende.getTime() - beginn.getTime()) throw new ApiFehler(400, 'Die Pause ist länger als die Arbeitszeit.');
	const auftragId = typeof e.auftragId === 'string' && e.auftragId !== '' ? e.auftragId : null;
	if (!auftragId) throw new ApiFehler(400, 'Bitte einen Auftrag wählen – jede Zeit gehört zu einem Auftrag.');
	return {
		art: art as ZeitArt,
		beginn,
		ende,
		pauseMin,
		auftragId,
		km: art === 'fahrt' ? kmAus(e.km) : null,
		notiz: textFeld(e.notiz, 'Notiz', 500)
	};
}

async function holeRoh(tx: TransactionSql, k: Kontext, id: unknown): Promise<Record<string, any>> {
	if (typeof id !== 'string' || !UUID.test(id)) throw nichtGefunden();
	const [r] = await tx`select * from app.zeit_eintraege where id = ${id} and betrieb_id = ${k.betriebId} for update`;
	if (!r) throw nichtGefunden();
	return r;
}

function darfAendern(z: ZeitZugriff, r: Record<string, any>): void {
	if (z.verwalten) return;
	if (r.benutzer_id !== z.nutzer.id) throw nichtGefunden();
	if (r.freigegeben_am) throw new ApiFehler(409, 'Diese Zeit ist schon freigegeben – Änderungen nur noch über Chef oder Büro.');
}

/** „Nacharbeit“ (Jamil msg 2858, für die Nacharbeitsquote) – Häkchen im Formular oder true in der API. */
const istJa = (w: unknown) => w === true || w === 'on' || w === 'true' || w === 'ja';

/** Zeit nachtragen (immer mit Grund); für andere Personen nur mit „Zeiten aller verwalten“. */
export async function trageNach(z: ZeitZugriff, e: Record<string, unknown>): Promise<ZeitEintrag> {
	const w = pruefeZeitEingabe(e);
	const grund = grundAus(e.grund);
	const fuer = typeof e.benutzerId === 'string' && e.benutzerId !== '' ? e.benutzerId : z.nutzer.id;
	if (fuer !== z.nutzer.id && !z.verwalten) throw new ApiFehler(403, 'Keine Berechtigung');
	if (!UUID.test(fuer)) throw new ApiFehler(400, 'Ungültige Person.');
	await pruefeZiel(z, w, false);
	const id = await mitBetrieb(z.k, async (tx) => {
		const [p] = await tx`select id from app.benutzer where id = ${fuer} and betrieb_id = ${z.k.betriebId}`;
		if (!p) throw new ApiFehler(400, 'Ungültige Person.');
		try {
			const [r] = await tx`
				insert into app.zeit_eintraege (betrieb_id, benutzer_id, auftrag_id, art, beginn, ende, pause_min, km, km_quelle,
					notiz, manuell, korrektur_grund, nacharbeit)
				values (${z.k.betriebId}, ${fuer}, ${w.auftragId}, ${w.art}, ${w.beginn}, ${w.ende}, ${w.pauseMin}, ${w.km},
					${w.km === null ? null : 'manuell'}, ${w.notiz}, true, ${grund}, ${w.art === 'arbeit' && istJa(e.nacharbeit)})
				returning id`;
			return r.id as string;
		} catch (err) {
			uebersetze(err);
		}
	});
	return holeEintrag(z, id);
}

export async function holeEintrag(z: ZeitZugriff, id: string): Promise<ZeitEintrag> {
	const [r] = await mitBetrieb(z.k, (tx) => tx`select ${tx.unsafe(AUSWAHL)} from ${tx.unsafe(VON)} where z.id = ${id} and z.betrieb_id = ${z.k.betriebId}`);
	if (!r || (!z.verwalten && r.benutzer_id !== z.nutzer.id)) throw nichtGefunden();
	return zuEintrag(r);
}

/** Korrektur mit Grund – alter und neuer Wert stehen im Änderungsprotokoll (Verlauf). */
export async function korrigiere(z: ZeitZugriff, id: unknown, e: Record<string, unknown>): Promise<ZeitEintrag> {
	const grund = grundAus(e.grund);
	const vorher = await mitBetrieb(z.k, async (tx) => {
		const r = await holeRoh(tx, z.k, id);
		darfAendern(z, r);
		return r;
	});
	const w = pruefeZeitEingabe(e, vorher.ende === null);
	await pruefeZiel(z, w, false);
	await mitBetrieb(z.k, async (tx) => {
		const kmNeu = w.art === 'fahrt' ? w.km : null;
		const kmGeaendert = kmNeu !== (vorher.km === null ? null : Number(vorher.km));
		try {
			await tx`
				update app.zeit_eintraege set art = ${w.art}, beginn = ${w.beginn}, ende = ${w.ende}, pause_min = ${w.pauseMin},
					auftrag_id = ${w.auftragId}, km = ${kmNeu},
					km_berechnet = ${w.art === 'fahrt' ? vorher.km_berechnet : null},
					km_quelle = ${w.art !== 'fahrt' ? null : kmGeaendert ? (kmNeu === null ? null : 'manuell') : vorher.km_quelle},
					notiz = ${w.notiz}, manuell = true, korrektur_grund = ${grund},
					nacharbeit = ${w.art === 'arbeit' && (e.nacharbeit === undefined ? vorher.nacharbeit === true : istJa(e.nacharbeit))}
				where id = ${vorher.id} and betrieb_id = ${z.k.betriebId}`;
		} catch (err) {
			uebersetze(err);
		}
	});
	return holeEintrag(z, vorher.id);
}

/** Löschen mit Grund: der Grund wird vorher gespeichert, damit er im Protokoll beim gelöschten Eintrag steht. */
export async function loescheZeit(z: ZeitZugriff, id: unknown, grundEingabe: unknown): Promise<void> {
	const grund = grundAus(grundEingabe);
	await mitBetrieb(z.k, async (tx) => {
		const r = await holeRoh(tx, z.k, id);
		darfAendern(z, r);
		await tx`update app.zeit_eintraege set korrektur_grund = ${grund} where id = ${r.id} and betrieb_id = ${z.k.betriebId}`;
		await tx`delete from app.zeit_eintraege where id = ${r.id} and betrieb_id = ${z.k.betriebId}`;
	});
}

/** Freigabe (Chef/Büro): alle beendeten, noch offenen Einträge einer Person im Zeitraum. Liefert die Anzahl. */
export async function gebeFrei(z: ZeitZugriff, benutzerId: unknown, von: unknown, bis: unknown): Promise<number> {
	if (!z.verwalten) throw new ApiFehler(403, 'Keine Berechtigung');
	if (typeof benutzerId !== 'string' || !UUID.test(benutzerId)) throw new ApiFehler(400, 'Bitte eine Person wählen.');
	if (!istTag(von) || !istTag(bis) || bis < von) throw new ApiFehler(400, 'Ungültiger Zeitraum.');
	const ab = tagesGrenzen(von).beginn;
	const ende = tagesGrenzen(bis).ende;
	const z2 = await mitBetrieb(z.k, (tx) => tx`
		update app.zeit_eintraege set freigegeben_am = now(), freigegeben_von = ${z.nutzer.id}
		where betrieb_id = ${z.k.betriebId} and benutzer_id = ${benutzerId} and ende is not null and freigegeben_am is null
			and beginn >= ${ab} and beginn < ${ende}
		returning id`);
	return z2.length;
}

// ——— Verlauf des Auftrags: Korrekturen und Nachträge ———

const zeitFormat = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const uhr = (d: unknown) => (d ? new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(d as string)) : 'läuft');

/**
 * Korrekturen, Nachträge und Löschungen von Zeiten zu einem Auftrag für den Verlauf (Stempeln selbst nicht – das wäre
 * zu viel). Wer nicht alle Zeiten verwaltet, sieht nur die eigenen.
 */
export async function zeitVerlauf(z: ZeitZugriff, auftragId: string): Promise<{ iso: string; zeile: { id: string; zeit: string; wer: string; titel: string; aenderungen: { feld: string; alt: string; neu: string }[] } }[]> {
	if (!UUID.test(auftragId)) throw new ApiFehler(404, 'Auftrag nicht gefunden.');
	await holeAuftrag(z.k, sichtVon(z.nutzer), auftragId);
	const zeilen = await mitBetrieb(z.k, (tx) => tx`
		select a.id::text as id, a.zeit, a.aktion, a.vorher, a.nachher, a.quelle, b.name as benutzer_name, p.name as person
		from app.aenderungen a
		left join app.benutzer b on b.id = a.benutzer_id
		left join app.benutzer p on p.id = coalesce(a.nachher ->> 'benutzer_id', a.vorher ->> 'benutzer_id')::uuid
		where a.betrieb_id = ${z.k.betriebId} and a.tabelle = 'zeit_eintraege'
			and (coalesce(a.nachher ->> 'auftrag_id', a.vorher ->> 'auftrag_id') = ${auftragId}
				or (a.vorher ->> 'auftrag_id') = ${auftragId})
			${z.verwalten ? tx`` : tx`and coalesce(a.nachher ->> 'benutzer_id', a.vorher ->> 'benutzer_id') = ${z.nutzer.id}`}
		order by a.id desc limit 100`);
	const aus = [];
	for (const e of zeilen) {
		const n = e.nachher;
		const v = e.vorher;
		let titel: string | null = null;
		const aenderungen: { feld: string; alt: string; neu: string }[] = [];
		const art = (x: any) => (x?.art === 'fahrt' ? 'Fahrt' : x?.art === 'pause' ? 'Pause' : 'Arbeitszeit');
		if (e.aktion === 'angelegt' && n?.manuell) titel = `${art(n)} von ${e.person ?? '–'} nachgetragen (${uhr(n.beginn)}–${uhr(n.ende)}): ${n.korrektur_grund ?? ''}`;
		else if (e.aktion === 'geloescht' && e.benutzer_name && v?.korrektur_grund) titel = `${art(v)} von ${e.person ?? '–'} gelöscht (${uhr(v.beginn)}–${uhr(v.ende)}): ${v.korrektur_grund ?? ''}`;
		else if (e.aktion === 'geaendert' && n?.korrektur_grund && (n.korrektur_grund !== v?.korrektur_grund || n.beginn !== v?.beginn || n.ende !== v?.ende || n.km !== v?.km || n.pause_min !== v?.pause_min)) {
			titel = `${art(n)} von ${e.person ?? '–'} korrigiert: ${n.korrektur_grund}`;
			if (v.beginn !== n.beginn) aenderungen.push({ feld: 'Beginn', alt: uhr(v.beginn), neu: uhr(n.beginn) });
			if (v.ende !== n.ende && v.ende) aenderungen.push({ feld: 'Ende', alt: uhr(v.ende), neu: uhr(n.ende) });
			if (v.pause_min !== n.pause_min) aenderungen.push({ feld: 'Pause', alt: `${v.pause_min} Min.`, neu: `${n.pause_min} Min.` });
			if (v.km !== n.km) aenderungen.push({ feld: 'Kilometer', alt: v.km === null ? '–' : String(v.km).replace('.', ','), neu: n.km === null ? '–' : String(n.km).replace('.', ',') });
			if (v.auftrag_id !== n.auftrag_id) aenderungen.push({ feld: 'Auftrag', alt: v.auftrag_id ? 'dieser' : '–', neu: n.auftrag_id === auftragId ? 'dieser' : 'anderer' });
		} else if (e.aktion === 'geaendert' && !v?.freigegeben_am && n?.freigegeben_am) continue;
		if (!titel) continue;
		aus.push({
			iso: new Date(e.zeit).toISOString(),
			zeile: { id: `z${e.id}`, zeit: zeitFormat.format(new Date(e.zeit)), wer: `${e.benutzer_name ?? 'System'}${e.quelle === 'sprache' ? ' (per Sprache)' : ''}`, titel, aenderungen }
		});
	}
	return aus;
}

// ——— Arbeitszeitnachweis (Tag/Woche/Zeitraum, Export) ———

export type Nachweis = {
	person: { id: string; name: string };
	von: string;
	bis: string;
	tage: TagesZeile[];
	eintraege: ZeitEintrag[];
	summe: Summe;
	offenFreigabe: number;
	/** Soll laut Kalkulation (Arbeitstage ohne Abwesenheit × Stunden/Tag) – null ohne Eintrag in der Kalkulation */
	sollMin: number | null;
};

/** Stunden pro Tag eines Mitarbeiters aus der Kalkulation (Mitarbeiter → Standard des Betriebs) und seine Abwesenheitstage. */
async function sollGrundlage(z: ZeitZugriff, benutzerIds: string[], von: string, bis: string): Promise<Map<string, { stundenTag: number | null; abwesend: Set<string> }>> {
	const zeilen = await mitBetrieb(z.k, (tx) => tx`
		select m.benutzer_id, coalesce(m.stunden_tag, b.standard_stunden_tag) as stunden_tag
		from app.kalkulation_mitarbeiter m left join app.kalkulation_betrieb b on b.betrieb_id = m.betrieb_id
		where m.betrieb_id = ${z.k.betriebId} and m.benutzer_id = any(${benutzerIds}::uuid[])`);
	const abw = await mitBetrieb(z.k, (tx) => tx`
		select benutzer_id, to_char(greatest(von, ${von}::date), 'YYYY-MM-DD') as von, to_char(least(bis, ${bis}::date), 'YYYY-MM-DD') as bis
		from app.abwesenheiten where betrieb_id = ${z.k.betriebId} and benutzer_id = any(${benutzerIds}::uuid[]) and von <= ${bis}::date and bis >= ${von}::date`);
	const m = new Map<string, { stundenTag: number | null; abwesend: Set<string> }>();
	for (const id of benutzerIds) m.set(id, { stundenTag: null, abwesend: new Set() });
	for (const r of zeilen) m.get(r.benutzer_id)!.stundenTag = r.stunden_tag === null ? null : Number(r.stunden_tag);
	for (const a of abw) for (const t of tageZwischen(a.von, a.bis)) m.get(a.benutzer_id)!.abwesend.add(t);
	return m;
}

export type TeamZeile = { benutzerId: string; name: string; arbeitMin: number; pauseMin: number; fahrtMin: number; km: number; sollMin: number | null; offenFreigabe: number };

/** Teamübersicht für Chef/Büro: je aktivem Mitarbeiter Summen, Soll und offene Freigaben im Zeitraum. */
export async function teamUebersicht(z: ZeitZugriff, von: string, bis: string, jetzt = new Date()): Promise<TeamZeile[]> {
	if (!z.verwalten) throw new ApiFehler(403, 'Keine Berechtigung');
	if (!istTag(von) || !istTag(bis) || bis < von) throw new ApiFehler(400, 'Ungültiger Zeitraum.');
	const personen = await mitBetrieb(z.k, (tx) => tx`select id, name from app.benutzer where betrieb_id = ${z.k.betriebId} and aktiv order by name, id`);
	const alle = await listeZeiten(z, { von, bis });
	const tage = tageZwischen(von, bis);
	const soll = await sollGrundlage(z, personen.map((p) => p.id as string), von, bis);
	const rahmen = { von: tagesGrenzen(von).beginn, bis: tagesGrenzen(tage.at(-1)!).ende };
	return personen.map((p) => {
		const eigene = alle.filter((e) => e.benutzerId === p.id);
		const s = summiere(eigene, jetzt, rahmen);
		const g = soll.get(p.id)!;
		return { benutzerId: p.id, name: p.name, ...s, sollMin: sollMinuten(tage, g.stundenTag, g.abwesend, wochentag), offenFreigabe: eigene.filter((e) => e.ende && !e.freigegeben).length };
	});
}

/** Nachweis einer Person (ohne „Zeiten aller verwalten“ immer die eigene) für die Tage von–bis (höchstens 62). */
export async function nachweis(z: ZeitZugriff, f: { benutzerId?: string; von: string; bis: string }, jetzt = new Date()): Promise<Nachweis> {
	const personId = z.verwalten && f.benutzerId ? f.benutzerId : z.nutzer.id;
	if (!UUID.test(personId)) throw new ApiFehler(400, 'Ungültige Person.');
	if (!istTag(f.von) || !istTag(f.bis) || f.bis < f.von) throw new ApiFehler(400, 'Ungültiger Zeitraum.');
	const tage = tageZwischen(f.von, f.bis);
	const bis = tage.at(-1)!;
	const [p] = await mitBetrieb(z.k, (tx) => tx`select id, name from app.benutzer where id = ${personId} and betrieb_id = ${z.k.betriebId}`);
	if (!p) throw new ApiFehler(404, 'Person nicht gefunden.');
	const eintraege = await listeZeiten({ ...z, verwalten: true }, { benutzerId: personId, von: f.von, bis });
	const zeilen = tagesUebersicht(eintraege, tage, jetzt);
	const summe = zeilen.reduce((s, t) => ({ arbeitMin: s.arbeitMin + t.arbeitMin, pauseMin: s.pauseMin + t.pauseMin, fahrtMin: s.fahrtMin + t.fahrtMin, km: Math.round((s.km + t.km) * 10) / 10 }), { arbeitMin: 0, pauseMin: 0, fahrtMin: 0, km: 0 });
	const g = (await sollGrundlage(z, [personId], f.von, bis)).get(personId)!;
	return {
		person: { id: p.id, name: p.name },
		von: f.von,
		bis,
		tage: zeilen,
		eintraege,
		summe,
		offenFreigabe: eintraege.filter((e) => e.ende && !e.freigegeben).length,
		sollMin: sollMinuten(tage, g.stundenTag, g.abwesend, wochentag)
	};
}
