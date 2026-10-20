import { mitBetrieb, type Kontext } from './db';
import { ApiFehler } from './fehler';
import { holeAuftrag, sichtVon } from './auftraege';
import { textFeld, UUID } from './kunden';
import { hatRecht } from './rechte';
import { leseEuroInCent, leseMenge } from '../geld';
import type { ZeitZugriff } from './zeiterfassung';

/**
 * Material je Auftrag (Zeiterfassung, Wunsch Jamil msgs 2770–2774; Migration 080):
 * - geplant = Positionen der angenommenen Angebote des Auftrags (Menge, Einheit, Materialanteil je Einheit),
 * - tatsächlich = app.auftrag_material: „wie geplant“ übernimmt die geplanten Mengen mit einem Tipp, mehr/weniger
 *   lässt sich je Zeile eintragen, zusätzliches Material (auch vom Lieferschein) kommt als eigene Zeile dazu.
 * Preise (Materialanteil, Einkaufspreis) nur mit „Preise sehen“ – ohne das Recht fehlen die Felder.
 */

export type MaterialZeile = {
	/** Ist-Zeile (leer = geplant, aber noch nicht bestätigt) */
	id: string | null;
	positionId: string | null;
	bezeichnung: string;
	einheit: string;
	mengePlan: number | null;
	menge: number | null;
	quelle: 'plan' | 'zusatz' | 'lieferschein';
	/** nur mit „Preise sehen“ */
	planCent?: number | null;
	preisCent?: number | null;
};

export type MaterialStand = { zeilen: MaterialZeile[]; ohneAngebot: boolean; offenePlan: number };

async function auftragPruefen(z: ZeitZugriff, auftragId: unknown): Promise<string> {
	if (typeof auftragId !== 'string' || !UUID.test(auftragId)) throw new ApiFehler(404, 'Auftrag nicht gefunden.');
	const a = await holeAuftrag(z.k, sichtVon(z.nutzer), auftragId);
	return a.id;
}

/** Geplantes Material aus angenommenen Angeboten (Positionen mit Material oder aus dem Katalog). */
export async function geplantesMaterial(k: Kontext, auftragId: string) {
	return mitBetrieb(k, (tx) => tx`
		select p.id, p.bezeichnung, p.einheit, p.menge, p.material_cent
		from app.angebot_positionen p
		join app.angebote an on an.id = p.angebot_id and an.betrieb_id = p.betrieb_id
		where an.auftrag_id = ${auftragId} and an.betrieb_id = ${k.betriebId} and an.status = 'angenommen'
			and coalesce(p.material_cent, 0) > 0
		order by an.angelegt, p.pos`);
}

export async function materialStand(z: ZeitZugriff, auftragId: string): Promise<MaterialStand> {
	const id = await auftragPruefen(z, auftragId);
	const preise = hatRecht(z.nutzer, 'preise.sehen');
	const plan = await geplantesMaterial(z.k, id);
	const ist = await mitBetrieb(z.k, (tx) => tx`
		select id, angebot_position_id, bezeichnung, einheit, menge, preis_cent, quelle from app.auftrag_material
		where auftrag_id = ${id} and betrieb_id = ${z.k.betriebId} order by angelegt, id`);
	const zeilen: MaterialZeile[] = [];
	for (const p of plan) {
		const i = ist.find((x) => x.angebot_position_id === p.id);
		const zeile: MaterialZeile = {
			id: i?.id ?? null,
			positionId: p.id,
			bezeichnung: p.bezeichnung,
			einheit: p.einheit,
			mengePlan: Number(p.menge),
			menge: i ? Number(i.menge) : null,
			quelle: 'plan'
		};
		if (preise) {
			zeile.planCent = p.material_cent === null ? null : Number(p.material_cent);
			zeile.preisCent = i?.preis_cent === null || i?.preis_cent === undefined ? null : Number(i.preis_cent);
		}
		zeilen.push(zeile);
	}
	for (const i of ist.filter((x) => !x.angebot_position_id || !plan.some((p) => p.id === x.angebot_position_id))) {
		const zeile: MaterialZeile = { id: i.id, positionId: null, bezeichnung: i.bezeichnung, einheit: i.einheit, mengePlan: null, menge: Number(i.menge), quelle: i.quelle };
		if (preise) zeile.preisCent = i.preis_cent === null ? null : Number(i.preis_cent);
		zeilen.push(zeile);
	}
	return { zeilen, ohneAngebot: plan.length === 0, offenePlan: zeilen.filter((x) => x.positionId && x.id === null).length };
}

/** „Material wie geplant“: alle noch offenen geplanten Positionen mit der geplanten Menge übernehmen. */
export async function materialWieGeplant(z: ZeitZugriff, auftragId: unknown): Promise<number> {
	const id = await auftragPruefen(z, auftragId);
	const plan = await geplantesMaterial(z.k, id);
	if (plan.length === 0) throw new ApiFehler(409, 'Zu diesem Auftrag gibt es kein angenommenes Angebot mit Material.');
	return mitBetrieb(z.k, async (tx) => {
		const r = await tx`
			insert into app.auftrag_material (betrieb_id, auftrag_id, angebot_position_id, bezeichnung, einheit, menge, quelle, benutzer_id)
			select ${z.k.betriebId}, ${id}, p.id, p.bezeichnung, p.einheit, p.menge, 'plan', ${z.nutzer.id}
			from app.angebot_positionen p where p.betrieb_id = ${z.k.betriebId} and p.id = any(${plan.map((p) => p.id)}::uuid[])
			on conflict do nothing
			returning id`;
		return r.length;
	});
}

function menge(w: unknown): number {
	try {
		const m = leseMenge(typeof w === 'number' ? w : String(w ?? ''));
		return m;
	} catch {
		if (w === 0 || w === '0' || w === '0,0') return 0;
		throw new ApiFehler(400, 'Bitte eine Menge eingeben (z. B. 2,5).');
	}
}

function preisAus(z: ZeitZugriff, w: unknown): number | null {
	if (w === undefined || w === null || w === '') return null;
	if (!hatRecht(z.nutzer, 'preise.sehen')) return null;
	try {
		return leseEuroInCent(typeof w === 'number' ? w : String(w));
	} catch (e) {
		throw new ApiFehler(400, `Preis: ${(e as Error).message}`);
	}
}

/** Ist-Menge einer geplanten Position (anlegen oder ändern) bzw. einer Zusatzzeile setzen. */
export async function setzeMaterialMenge(z: ZeitZugriff, auftragId: unknown, e: { positionId?: unknown; id?: unknown; menge?: unknown; preis?: unknown }): Promise<void> {
	const id = await auftragPruefen(z, auftragId);
	const m = menge(e.menge);
	const preis = preisAus(z, e.preis);
	await mitBetrieb(z.k, async (tx) => {
		if (typeof e.id === 'string' && UUID.test(e.id)) {
			const r = await tx`
				update app.auftrag_material set menge = ${m}, benutzer_id = ${z.nutzer.id}
					${preis !== null ? tx`, preis_cent = ${preis}` : tx``}
				where id = ${e.id} and auftrag_id = ${id} and betrieb_id = ${z.k.betriebId} returning id`;
			if (r.length === 0) throw new ApiFehler(404, 'Material nicht gefunden.');
			return;
		}
		if (typeof e.positionId !== 'string' || !UUID.test(e.positionId)) throw new ApiFehler(404, 'Material nicht gefunden.');
		const plan = await geplantesMaterial(z.k, id);
		const p = plan.find((x) => x.id === e.positionId);
		if (!p) throw new ApiFehler(404, 'Material nicht gefunden.');
		await tx`
			insert into app.auftrag_material (betrieb_id, auftrag_id, angebot_position_id, bezeichnung, einheit, menge, preis_cent, quelle, benutzer_id)
			values (${z.k.betriebId}, ${id}, ${p.id}, ${p.bezeichnung}, ${p.einheit}, ${m}, ${preis}, 'plan', ${z.nutzer.id})
			on conflict (betrieb_id, auftrag_id, angebot_position_id) where angebot_position_id is not null
			do update set menge = excluded.menge, benutzer_id = excluded.benutzer_id`;
	});
}

export type NeuesMaterial = { bezeichnung?: unknown; einheit?: unknown; menge?: unknown; preis?: unknown };

/** Zusätzliches Material (auch mehrere Zeilen vom Lieferschein auf einmal). */
export async function materialHinzufuegen(z: ZeitZugriff, auftragId: unknown, liste: NeuesMaterial[], quelle: 'zusatz' | 'lieferschein' = 'zusatz'): Promise<number> {
	const id = await auftragPruefen(z, auftragId);
	if (liste.length === 0) throw new ApiFehler(400, 'Bitte mindestens eine Zeile angeben.');
	if (liste.length > 100) throw new ApiFehler(400, 'Höchstens 100 Zeilen auf einmal.');
	const zeilen = liste.map((e) => {
		const b = textFeld(e.bezeichnung, 'Bezeichnung', 200);
		if (!b) throw new ApiFehler(400, 'Bitte eine Bezeichnung eingeben.');
		const einheit = textFeld(e.einheit, 'Einheit', 20) ?? 'Stk';
		return { b, einheit, m: menge(e.menge), preis: preisAus(z, e.preis) };
	});
	return mitBetrieb(z.k, async (tx) => {
		const [{ anzahl }] = await tx`select count(*)::int as anzahl from app.auftrag_material where auftrag_id = ${id} and betrieb_id = ${z.k.betriebId}`;
		if (anzahl + zeilen.length > 300) throw new ApiFehler(409, 'Höchstens 300 Materialzeilen je Auftrag.');
		for (const r of zeilen) {
			await tx`
				insert into app.auftrag_material (betrieb_id, auftrag_id, bezeichnung, einheit, menge, preis_cent, quelle, benutzer_id)
				values (${z.k.betriebId}, ${id}, ${r.b}, ${r.einheit}, ${r.m}, ${r.preis}, ${quelle}, ${z.nutzer.id})`;
		}
		return zeilen.length;
	});
}

export async function materialLoeschen(z: ZeitZugriff, auftragId: unknown, materialId: unknown): Promise<void> {
	const id = await auftragPruefen(z, auftragId);
	if (typeof materialId !== 'string' || !UUID.test(materialId)) throw new ApiFehler(404, 'Material nicht gefunden.');
	const r = await mitBetrieb(z.k, (tx) => tx`delete from app.auftrag_material where id = ${materialId} and auftrag_id = ${id} and betrieb_id = ${z.k.betriebId} returning id`);
	if (r.length === 0) throw new ApiFehler(404, 'Material nicht gefunden.');
}
