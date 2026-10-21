import { mitBetrieb, type Kontext } from './db';
import { ApiFehler } from './fehler';
import { legeAngebotAn, loescheAngebot, speicherePositionen, type AngebotZugriff } from './angebote';
import { holeProtokoll } from './protokoll-formulare';
import { aufmassMengen } from '../protokoll-formular';

/**
 * Aufmaß → Angebot (Wunsch Jamil, Talk msg 2842): Felder mit Katalog-Verknüpfung liefern Mengen (über alle Räume
 * summiert); daraus entsteht mit einem Klick ein Angebots-Entwurf am Auftrag des Aufmaßes. Bezeichnung, Einheit und
 * Preis kommen wie immer aus dem Katalog. Rechte wie beim Angebot (`angeboteZugriff`); Sicht wie beim Auftrag.
 */

export type AufmassMenge = { positionId: string; bezeichnung: string; einheit: string; menge: number; felder: string[]; fehlt: boolean };

/** Mengen eines Aufmaßes mit Katalogtext (fehlende/abgeschaltete Positionen markiert). */
export async function mengenAusAufmass(k: Kontext, zg: Pick<AngebotZugriff, 'sicht'>, protokollId: unknown): Promise<AufmassMenge[]> {
	const p = await holeProtokoll(k, zg.sicht, protokollId);
	if (p.art !== 'aufmass') throw new ApiFehler(400, 'Das ist kein Aufmaß.');
	const mengen = aufmassMengen(p.schema, p.antworten);
	if (mengen.length === 0) return [];
	const z = await mitBetrieb(k, (tx) => tx`
		select id, bezeichnung, einheit::text as einheit, aktiv from app.katalog_positionen
		where betrieb_id = ${k.betriebId} and id = any(${mengen.map((m) => m.positionId)}::uuid[])`);
	const kat = new Map(z.map((r) => [r.id as string, r]));
	return mengen.map((m) => {
		const r = kat.get(m.positionId);
		return { ...m, bezeichnung: r?.bezeichnung ?? 'Katalogposition fehlt', einheit: r?.einheit ?? '', fehlt: !r || !r.aktiv };
	});
}

/** Angebots-Entwurf aus dem Aufmaß; fehlende/abgeschaltete Katalogpositionen werden übersprungen (Hinweis). */
export async function angebotAusAufmass(k: Kontext, zg: AngebotZugriff, protokollId: unknown): Promise<{ angebotId: string; uebersprungen: string[] }> {
	const p = await holeProtokoll(k, zg.sicht, protokollId);
	if (!p.auftrag) throw new ApiFehler(400, 'Das Aufmaß gehört zu keinem Auftrag.');
	const mengen = await mengenAusAufmass(k, zg, protokollId);
	const nutzbar = mengen.filter((m) => !m.fehlt);
	if (nutzbar.length === 0) {
		throw new ApiFehler(400, mengen.length ? 'Die verknüpften Katalogpositionen gibt es nicht mehr.' : 'Keine Mengen: In der Vorlage sind keine ausgefüllten Felder mit dem Katalog verknüpft.');
	}
	const a = await legeAngebotAn(k, p.auftrag.id, zg);
	try {
		await speicherePositionen(k, a.id, nutzbar.map((m) => ({ katalogPositionId: m.positionId, menge: String(Math.round(m.menge * 1000) / 1000) })), zg);
	} catch (e) {
		await loescheAngebot(k, a.id, zg).catch(() => undefined);
		throw e;
	}
	return { angebotId: a.id, uebersprungen: mengen.filter((m) => m.fehlt).map((m) => m.bezeichnung) };
}
