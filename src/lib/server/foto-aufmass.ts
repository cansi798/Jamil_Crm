import { inEinerTransaktion, mitBetrieb, type Kontext } from './db';
import { ApiFehler } from './fehler';
import { angeboteZugriff, legeAngebotAn, speicherePositionen, type AngebotZugriff } from './angebote';
import { holeAuftrag, type Sicht } from './auftraege';
import { pruefeBild } from './bildpruefung';
import { listeKatalog } from './katalog';
import { UUID } from './kunden';
import { betriebKontext } from './rechte';
import { pruefeModul } from './tarif';
import { kiAnbieter, type FotoFuerKi } from './ki/anbieter';
import { verbrauche } from './ki/kontingent';
import type { Werkzeug } from './sprache/aktionen';
import {
	MENGEN,
	MENGEN_SCHLUESSEL,
	OBJEKTE,
	RAUMARTEN,
	RAUMART_NAMEN,
	kalibriert,
	kalibrierung,
	regelSchaetzung,
	type Eingaben,
	type Faktor,
	type Historie,
	type KiMengen,
	type MengenSchluessel,
	type Raumart
} from '../foto-aufmass';

/**
 * Foto-Aufmaß mit KI (Jamil msgs 2770–2774 Punkt 8, 2780; Migration 083). Der Nutzer gibt die bekannten Flächen und
 * Fakten ein; die KI (MiMo über die Anbieter-Schnittstelle) schätzt aus Eingaben und 1–4 Fotos nur die abgeleiteten
 * Mengen und schlägt Katalogpositionen vor. Ergebnis = Entwurf „Schätzung – vor Ort prüfen“; der Nutzer korrigiert
 * und übernimmt es in einen Angebotsentwurf. Lernen: jede Schätzung mit übernommenen Werten (und später Ist-Verbrauch)
 * → Kalibrierfaktoren + Beispiele im Prompt („basiert auf X früheren Aufträgen“).
 *
 * Datensparsamkeit: An die KI gehen die Fotos, Raumart, Zahlen und Katalog-Bezeichnungen (ohne Preise) und frühere
 * Beispiele als reine Zahlen – nie Kunde, Adresse, Auftragstitel oder Preise.
 * Rechte wie beim KI-Angebotsentwurf: Modul ki_angebote + Angebote mit „Preise sehen“.
 */

export const SCHAETZ_MARKER = 'Schätzung – vor Ort prüfen';
export const MAX_FOTOS = 4;
export const FOTO_MAX_BYTES = 5 * 1024 * 1024;

export async function aufmassZugriff(locals: { nutzer: Nutzer | null }): Promise<{ k: Kontext; zg: AngebotZugriff }> {
	const zg = await angeboteZugriff(locals);
	await pruefeModul(locals, 'ki_angebote');
	return { k: betriebKontext(locals), zg };
}

function zahl(w: unknown, name: string, min: number, max: number, pflicht: boolean): number | null {
	if (w === undefined || w === null || (typeof w === 'string' && w.trim() === '')) {
		if (pflicht) throw new ApiFehler(400, `${name}: Bitte einen Wert eingeben.`);
		return null;
	}
	const n = typeof w === 'number' ? w : Number(String(w).trim().replace(',', '.'));
	if (!Number.isFinite(n) || n < min || n > max) throw new ApiFehler(400, `${name}: Bitte eine Zahl von ${min} bis ${max} eingeben.`);
	return Math.round(n * 100) / 100;
}

/** Eingaben prüfen: Wand- und Bodenfläche sind Pflicht (die KI schätzt sie nicht – msg 2780). */
export function pruefeEingaben(e: Record<string, unknown>): Eingaben {
	const raumart = e.raumart;
	if (typeof raumart !== 'string' || !(RAUMARTEN as readonly string[]).includes(raumart)) throw new ApiFehler(400, 'Bitte die Raumart wählen.');
	const objekte: Eingaben['objekte'] = {};
	for (const o of OBJEKTE) {
		const n = zahl(e[o], o, 0, 50, false);
		if (n !== null && n > 0) objekte[o] = Math.round(n);
	}
	const referenz = typeof e.referenz === 'string' && e.referenz.trim() !== '' ? e.referenz.replace(/\s+/g, ' ').trim().slice(0, 120) : null;
	return {
		raumart: raumart as Raumart,
		wandM2: zahl(e.wandM2, 'Wandfläche (m²)', 0, 2000, true)!,
		bodenM2: zahl(e.bodenM2, 'Bodenfläche (m²)', 0.1, 2000, true)!,
		hoeheM: zahl(e.hoeheM, 'Raumhöhe (m)', 1.5, 10, false),
		objekte,
		referenz
	};
}

export const AUFMASS_WERKZEUG: Werkzeug = {
	type: 'function',
	function: {
		name: 'foto_aufmass',
		description: 'Abgeleitete Mengen für einen Raum und passende Katalogpositionen.',
		parameters: {
			type: 'object',
			properties: {
				mengen: {
					type: 'object',
					properties: Object.fromEntries(MENGEN_SCHLUESSEL.map((k) => [k, { type: 'number', description: `${MENGEN[k].name} in ${MENGEN[k].einheit}` }])),
					additionalProperties: false
				},
				positionen: {
					type: 'array',
					maxItems: 30,
					items: {
						type: 'object',
						properties: { schluessel: { type: 'string', description: 'Katalog-Schlüssel, z. B. K3' }, menge: { type: 'number' } },
						required: ['schluessel', 'menge'],
						additionalProperties: false
					}
				},
				konfidenz: { type: 'number', description: '0 bis 1 – wie sicher die Schätzung ist' },
				annahmen: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 200 } },
				erkannt: { type: 'string', maxLength: 300, description: 'Was auf den Fotos zu sehen ist (kurz)' }
			},
			required: ['mengen', 'konfidenz', 'annahmen'],
			additionalProperties: false
		}
	}
};

export type KiAufmass = { mengen: KiMengen; positionen: { schluessel: string; menge: number }[]; konfidenz: number; annahmen: string[]; erkannt: string | null };

export function pruefeKiAufmass(x: unknown): KiAufmass {
	const o = x as Record<string, any>;
	if (!o || typeof o !== 'object' || !o.mengen || typeof o.mengen !== 'object') throw new Error('mengen fehlt');
	const mengen: KiMengen = {};
	for (const k of MENGEN_SCHLUESSEL) {
		const v = o.mengen[k];
		if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 100000) mengen[k] = Math.round(v * 10) / 10;
	}
	const positionen = (Array.isArray(o.positionen) ? o.positionen : [])
		.filter((p: any) => p && typeof p.schluessel === 'string' && typeof p.menge === 'number' && p.menge > 0 && p.menge < 1e6)
		.slice(0, 30)
		.map((p: any) => ({ schluessel: p.schluessel.trim().slice(0, 20), menge: Math.round(p.menge * 100) / 100 }));
	const konf = typeof o.konfidenz === 'number' && Number.isFinite(o.konfidenz) ? Math.min(1, Math.max(0, o.konfidenz)) : 0.3;
	const annahmen = (Array.isArray(o.annahmen) ? o.annahmen : []).filter((a: unknown) => typeof a === 'string').map((a: string) => a.slice(0, 200)).slice(0, 10);
	return { mengen, positionen, konfidenz: Math.round(konf * 100) / 100, annahmen, erkannt: typeof o.erkannt === 'string' ? o.erkannt.slice(0, 300) : null };
}

const zuEingaben = (raumart: string, j: any): Eingaben => ({ raumart: raumart as Raumart, wandM2: Number(j.wandM2), bodenM2: Number(j.bodenM2), hoeheM: j.hoeheM ?? null, objekte: j.objekte ?? {}, referenz: j.referenz ?? null });
const json = (w: unknown) => (typeof w === 'string' ? JSON.parse(w) : w);

/** Lern-Historie des Betriebs für eine Raumart (übernommene Schätzungen, neueste zuerst, höchstens 50). */
export async function ladeHistorie(k: Kontext, raumart: Raumart): Promise<Historie[]> {
	await istNachtragen(k);
	const z = await mitBetrieb(k, (tx) => tx`
		select raumart, eingaben, ki, final, ist from app.aufmass_schaetzungen
		where betrieb_id = ${k.betriebId} and raumart = ${raumart} and status = 'uebernommen' and final is not null
		order by angelegt desc limit 50`);
	return z.map((r) => {
		const ki = json(r.ki);
		const fin = json(r.final);
		const posKi = new Map<string, number>((ki.positionenKatalog ?? []).map((p: any) => [p.katalogPositionId, p.menge]));
		const positionen: Record<string, [number, number]> = {};
		for (const p of fin.positionen ?? []) if (posKi.has(p.katalogPositionId)) positionen[p.katalogPositionId] = [posKi.get(p.katalogPositionId)!, p.menge];
		return { eingaben: zuEingaben(r.raumart, json(r.eingaben)), ki: ki.mengen ?? {}, final: fin.mengen ?? {}, ist: r.ist ? json(r.ist) : null, positionen };
	});
}

export function aufmassSystemText(katalog: { schluessel: string; bezeichnung: string; einheit: string; gewerk: string | null }[], beispiele: Historie[], e: Eingaben): string {
	const zeilen = katalog.map((p) => `${p.schluessel} | ${p.bezeichnung} | ${p.einheit} | ${p.gewerk ?? '-'}`);
	const bsp = beispiele.map((h, i) => {
		const ein = `Raum ${RAUMART_NAMEN[h.eingaben.raumart]}, Wand ${h.eingaben.wandM2} m², Boden ${h.eingaben.bodenM2} m²${h.eingaben.hoeheM ? `, Höhe ${h.eingaben.hoeheM} m` : ''}, Objekte ${JSON.stringify(h.eingaben.objekte)}`;
		const aus = MENGEN_SCHLUESSEL.filter((k) => (h.ist?.[k] ?? h.final[k]) !== undefined).map((k) => `${k}=${h.ist?.[k] ?? h.final[k]}`).join(', ');
		return `Beispiel ${i + 1}: ${ein} → richtig war: ${aus}`;
	});
	return [
		'Du hilfst einem Handwerksbetrieb beim Aufmaß. Der Nutzer hat Wand- und Bodenfläche, ggf. Raumhöhe und die Anzahl der Objekte selbst angegeben – diese Werte sind richtig, übernimm sie und schätze sie NICHT neu.',
		'Schätze aus diesen Angaben und den Fotos nur die abgeleiteten Mengen:',
		...MENGEN_SCHLUESSEL.map((k) => `- ${k}: ${MENGEN[k].name} (${MENGEN[k].einheit})`),
		'Faustwerte: Fliesenkleber ca. 3–5 kg je m² Fliesenfläche (Wand + Boden), Fugenmörtel ca. 0,3–0,8 kg je m²; Abdichtung im Bad: Boden plus Spritzwasserbereiche an Dusche/Wanne; Silikonfugen an allen Innenecken im Fliesenbereich, Anschlüssen von Wanne/Dusche/Waschtisch/WC und Boden-Wand.',
		`Fotos helfen beim Erkennen von Ecken, Nischen, Vorsprüngen, Fenstern, Ablagen und der Lage der Objekte.${e.referenz ? ` Maßstab laut Nutzer: ${e.referenz}.` : ''}`,
		...(beispiele.length ? ['Frühere Aufträge dieses Betriebs (eingegebene Werte → tatsächlich richtige Mengen) – richte dich danach:', ...bsp] : []),
		...(zeilen.length ? ['Schlage zusätzlich passende Positionen nur aus diesem Leistungskatalog vor (Schlüssel | Bezeichnung | Einheit | Gewerk), mit Menge in der Einheit der Position:', ...zeilen] : []),
		'Gib konfidenz (0–1) und deine Annahmen kurz an. Nenne keine Preise.'
	].join('\n');
}

export type Schaetzung = {
	id: string;
	auftragId: string | null;
	status: 'entwurf' | 'uebernommen' | 'verworfen';
	eingaben: Eingaben;
	mengen: { schluessel: MengenSchluessel; name: string; einheit: string; ki: number | null; vorschlag: number | null; regel: number; faktor: Faktor | null }[];
	positionen: { katalogPositionId: string; bezeichnung: string; einheit: string; ki: number; vorschlag: number; faktor: Faktor | null }[];
	konfidenz: number | null;
	annahmen: string[];
	erkannt: string | null;
	basisN: number;
	angebotId: string | null;
	fotos: number;
};

/**
 * Schätzung erstellen (KI-Anfrage): prüft Eingaben, Fotos (JPEG/PNG, höchstens 4 × 5 MB, Zustimmung) und Rechte, lädt
 * die Lern-Historie, fragt die KI und speichert den Entwurf. Liefert die ID.
 */
export async function schaetze(locals: { nutzer: Nutzer | null }, auftragId: unknown, e: Record<string, unknown>, fotos: Uint8Array[], zustimmung: boolean): Promise<string> {
	const { k, zg } = await aufmassZugriff(locals);
	if (typeof auftragId !== 'string' || !UUID.test(auftragId)) throw new ApiFehler(404, 'Auftrag nicht gefunden.');
	await holeAuftrag(k, zg.sicht, auftragId);
	const eingaben = pruefeEingaben(e);
	const liste = fotos.filter((f) => f.byteLength > 0);
	if (liste.length > MAX_FOTOS) throw new ApiFehler(400, `Höchstens ${MAX_FOTOS} Fotos.`);
	const bilder: FotoFuerKi[] = liste.map((f) => {
		if (f.byteLength > FOTO_MAX_BYTES) throw new ApiFehler(413, 'Ein Foto ist zu groß (höchstens 5 MB).');
		const info = pruefeBild(f);
		if (!info) throw new ApiFehler(400, 'Fotos müssen JPEG- oder PNG-Bilder sein.');
		return { bytes: f, typ: info.typ };
	});
	if (bilder.length > 0 && !zustimmung) throw new ApiFehler(400, 'Bitte zustimmen, dass die Fotos zur Auswertung an die KI gesendet werden.');
	const katalog = await listeKatalog(k, { nurAktive: true }, false);
	const nachSchluessel = new Map(katalog.slice(0, 300).map((p, i) => [`K${i + 1}`, p]));
	const historie = await ladeHistorie(k, eingaben.raumart);
	await verbrauche(k, 'entwurf');
	const ki = await kiAnbieter().bildAuswertung({
		system: aufmassSystemText([...nachSchluessel].map(([schluessel, p]) => ({ schluessel, bezeichnung: p.bezeichnung, einheit: p.einheit, gewerk: p.gewerk })), historie.slice(0, 3), eingaben),
		text: `Raum: ${RAUMART_NAMEN[eingaben.raumart]}. Wandfläche ${eingaben.wandM2} m², Bodenfläche ${eingaben.bodenM2} m²${eingaben.hoeheM ? `, Raumhöhe ${eingaben.hoeheM} m` : ''}. Objekte: ${Object.entries(eingaben.objekte).map(([o, n]) => `${o} ${n}`).join(', ') || 'keine angegeben'}.${bilder.length ? '' : ' (Keine Fotos – nur aus den Angaben schätzen.)'}`,
		bilder,
		werkzeug: AUFMASS_WERKZEUG,
		pruefe: pruefeKiAufmass
	});
	const positionenKatalog = ki.positionen.flatMap((p) => {
		const kat = nachSchluessel.get(p.schluessel);
		return kat ? [{ katalogPositionId: kat.id, menge: p.menge }] : [];
	});
	const [z] = await mitBetrieb(k, (tx) => tx`
		insert into app.aufmass_schaetzungen (betrieb_id, auftrag_id, angelegt_von, raumart, eingaben, ki, basis_n, konfidenz, fotos)
		values (${k.betriebId}, ${auftragId}, ${k.benutzerId}, ${eingaben.raumart},
			${tx.json({ wandM2: eingaben.wandM2, bodenM2: eingaben.bodenM2, hoeheM: eingaben.hoeheM, objekte: eingaben.objekte, referenz: eingaben.referenz })},
			${tx.json({ mengen: ki.mengen, positionenKatalog, annahmen: ki.annahmen, erkannt: ki.erkannt })},
			${historie.length}, ${ki.konfidenz}, ${bilder.length})
		returning id`);
	return z.id;
}

/** Schätzung für die Seite: KI-Werte, kalibrierte Vorschläge (mit Faktor und n), Faustwert, Positionen. */
export async function ladeSchaetzung(k: Kontext, sicht: Sicht, id: unknown, auftragId: unknown): Promise<Schaetzung> {
	if (typeof auftragId !== 'string' || !UUID.test(auftragId)) throw new ApiFehler(404, 'Auftrag nicht gefunden.');
	await holeAuftrag(k, sicht, auftragId);
	if (typeof id !== 'string' || !UUID.test(id)) throw new ApiFehler(404, 'Schätzung nicht gefunden.');
	const [r] = await mitBetrieb(k, (tx) => tx`select * from app.aufmass_schaetzungen where id = ${id} and betrieb_id = ${k.betriebId} and auftrag_id = ${auftragId}`);
	if (!r) throw new ApiFehler(404, 'Schätzung nicht gefunden.');
	const eingaben = zuEingaben(r.raumart, json(r.eingaben));
	const ki = json(r.ki);
	const fin = r.final ? json(r.final) : null;
	const historie = await ladeHistorie(k, eingaben.raumart);
	const faktoren = kalibrierung(historie);
	const regel = regelSchaetzung(eingaben);
	const katalog = await listeKatalog(k, {}, false);
	const kat = new Map(katalog.map((p) => [p.id, p]));
	return {
		id: r.id,
		auftragId: r.auftrag_id,
		status: r.status,
		eingaben,
		mengen: MENGEN_SCHLUESSEL.map((s) => {
			const kiWert = ki.mengen?.[s] ?? null;
			const vorschlag = fin?.mengen?.[s] ?? (kiWert === null ? null : kalibriert(s, kiWert, faktoren));
			return { schluessel: s, name: MENGEN[s].name, einheit: MENGEN[s].einheit, ki: kiWert, vorschlag, regel: regel[s], faktor: faktoren[s] ?? null };
		}),
		positionen: (ki.positionenKatalog ?? []).flatMap((p: { katalogPositionId: string; menge: number }) => {
			const kp = kat.get(p.katalogPositionId);
			if (!kp) return [];
			const f = faktoren[`pos:${p.katalogPositionId}`] ?? null;
			return [{ katalogPositionId: p.katalogPositionId, bezeichnung: kp.bezeichnung, einheit: kp.einheit, ki: p.menge, vorschlag: kalibriert(`pos:${p.katalogPositionId}`, p.menge, faktoren), faktor: f }];
		}),
		konfidenz: r.konfidenz === null ? null : Number(r.konfidenz),
		annahmen: ki.annahmen ?? [],
		erkannt: ki.erkannt ?? null,
		basisN: historie.length,
		angebotId: r.angebot_id,
		fotos: r.fotos
	};
}

/**
 * Übernehmen: die (korrigierten) Mengen speichern – sie sind die Lerngrundlage – und aus den angehakten Positionen einen
 * Angebotsentwurf anlegen; jede Position trägt „Schätzung – vor Ort prüfen“ (gelb im Editor). Ohne Positionen nur
 * speichern. Liefert die Angebots-ID (oder null).
 */
export async function uebernimm(locals: { nutzer: Nutzer | null }, auftragId: unknown, id: unknown, f: { mengen: Record<string, unknown>; positionen: { katalogPositionId: unknown; menge: unknown; nehmen: boolean }[] }): Promise<string | null> {
	const { k, zg } = await aufmassZugriff(locals);
	if (typeof auftragId !== 'string' || !UUID.test(auftragId)) throw new ApiFehler(404, 'Auftrag nicht gefunden.');
	await holeAuftrag(k, zg.sicht, auftragId);
	const s = await ladeSchaetzung(k, zg.sicht, id, auftragId);
	if (s.status !== 'entwurf') throw new ApiFehler(409, 'Diese Schätzung wurde schon übernommen.');
	const mengen: KiMengen = {};
	for (const m of MENGEN_SCHLUESSEL) {
		const v = zahl(f.mengen[m], MENGEN[m].name, 0, 100000, false);
		if (v !== null) mengen[m] = v;
	}
	const erlaubt = new Set(s.positionen.map((p) => p.katalogPositionId));
	const positionen = f.positionen
		.filter((p) => p.nehmen && typeof p.katalogPositionId === 'string' && erlaubt.has(p.katalogPositionId))
		.map((p) => ({ katalogPositionId: p.katalogPositionId as string, menge: zahl(p.menge, 'Menge', 0.001, 1000000, true)! }));
	return inEinerTransaktion(k, 'ki', async () => {
		let angebotId: string | null = null;
		if (positionen.length > 0) {
			const a = await legeAngebotAn(k, auftragId, zg);
			await speicherePositionen(k, a.id, positionen.map((p) => ({ katalogPositionId: p.katalogPositionId, menge: p.menge, beschreibung: `${SCHAETZ_MARKER} (Foto-Aufmaß)` })), zg);
			angebotId = a.id;
		}
		await mitBetrieb(k, (tx) => tx`
			update app.aufmass_schaetzungen set final = ${tx.json({ mengen, positionen })}, status = 'uebernommen', angebot_id = ${angebotId}
			where id = ${s.id} and betrieb_id = ${k.betriebId}`);
		return angebotId;
	});
}

export async function verwirf(locals: { nutzer: Nutzer | null }, auftragId: unknown, id: unknown): Promise<void> {
	const { k, zg } = await aufmassZugriff(locals);
	if (typeof auftragId !== 'string' || !UUID.test(auftragId)) throw new ApiFehler(404, 'Auftrag nicht gefunden.');
	await holeAuftrag(k, zg.sicht, auftragId);
	const s = await ladeSchaetzung(k, zg.sicht, id, auftragId);
	await mitBetrieb(k, (tx) => tx`update app.aufmass_schaetzungen set status = 'verworfen' where id = ${s.id} and betrieb_id = ${k.betriebId} and status = 'entwurf'`);
}

export async function listeSchaetzungen(k: Kontext, sicht: Sicht, auftragId: string): Promise<{ id: string; raumart: string; status: string; angelegt: string; angebotId: string | null }[]> {
	await holeAuftrag(k, sicht, auftragId);
	const z = await mitBetrieb(k, (tx) => tx`
		select id, raumart, status, angelegt, angebot_id from app.aufmass_schaetzungen
		where betrieb_id = ${k.betriebId} and auftrag_id = ${auftragId} order by angelegt desc limit 20`);
	return z.map((r) => ({ id: r.id, raumart: r.raumart, status: r.status, angelegt: new Date(r.angelegt).toISOString(), angebotId: r.angebot_id }));
}

/** Material-Zeile → Menge in der Einheit der Schätzung (oder null). Säcke mit „25 kg“ im Namen werden umgerechnet. */
export function materialAlsMenge(bezeichnung: string, einheit: string, menge: number): { schluessel: MengenSchluessel; menge: number } | null {
	const b = bezeichnung.toLowerCase();
	const e = einheit.toLowerCase();
	const kgJe = /(\d+(?:[.,]\d+)?)\s*kg/.exec(b);
	const inKg = e === 'kg' ? menge : kgJe && /sack|eimer|stk|pkt|gebinde/.test(e) ? menge * Number(kgJe[1].replace(',', '.')) : null;
	if (/fliesenkleber|kleber/.test(b) && inKg !== null) return { schluessel: 'fliesenkleber_kg', menge: inKg };
	if (/fug(en|e)?(mörtel|moertel|masse)|fugenmörtel/.test(b) && inKg !== null) return { schluessel: 'fugenmoertel_kg', menge: inKg };
	if (/silikon/.test(b) && /^(lfm|m)$/.test(e)) return { schluessel: 'silikon_lfm', menge };
	if (/dichtband/.test(b) && /^(lfm|m)$/.test(e)) return { schluessel: 'dichtband_lfm', menge };
	if (/abdicht/.test(b) && /^m²|m2$/.test(e)) return { schluessel: 'abdichtung_m2', menge };
	return null;
}

/**
 * Ist-Verbrauch nachtragen: für übernommene Schätzungen, deren Auftrag abgenommen/abgerechnet ist, das erfasste
 * Material (Zeiterfassung → Material) den Mengen zuordnen. Nur Mengen, die sich eindeutig zuordnen lassen.
 */
export async function istNachtragen(k: Kontext): Promise<number> {
	const offen = await mitBetrieb(k, (tx) => tx`
		select s.id, s.auftrag_id from app.aufmass_schaetzungen s
		join app.auftraege a on a.id = s.auftrag_id and a.betrieb_id = s.betrieb_id
		where s.betrieb_id = ${k.betriebId} and s.status = 'uebernommen' and s.ist is null and a.status in ('abgenommen', 'abgerechnet')
		limit 50`);
	let n = 0;
	for (const o of offen) {
		await mitBetrieb(k, async (tx) => {
			const m = await tx`select bezeichnung, einheit, menge from app.auftrag_material where auftrag_id = ${o.auftrag_id} and betrieb_id = ${k.betriebId}`;
			const ist: KiMengen = {};
			for (const r of m) {
				const x = materialAlsMenge(r.bezeichnung, r.einheit, Number(r.menge));
				if (x) ist[x.schluessel] = Math.round(((ist[x.schluessel] ?? 0) + x.menge) * 10) / 10;
			}
			if (Object.keys(ist).length === 0) return;
			await tx`update app.aufmass_schaetzungen set ist = ${tx.json(ist)} where id = ${o.id} and betrieb_id = ${k.betriebId}`;
			n++;
		});
	}
	return n;
}
