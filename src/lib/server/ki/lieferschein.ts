import { ApiFehler } from '../fehler';
import { pruefeBild } from '../bildpruefung';
import { kiAnbieter } from './anbieter';
import { verbrauche } from './kontingent';
import type { Werkzeug } from '../sprache/aktionen';
import type { ZeitZugriff } from '../zeiterfassung';
import { holeAuftrag, sichtVon } from '../auftraege';
import { UUID } from '../kunden';

/**
 * Lieferschein fotografieren → KI liest die Positionen aus (Zeiterfassung/Material, Wunsch Jamil msgs 2770–2774).
 * An die KI geht NUR das Foto und eine feste Anweisung – kein Kunde, kein Auftrag, keine Preise aus der Datenbank.
 * Gespeichert wird hier nichts: Die Oberfläche zeigt die Positionen zum Prüfen; erst „Übernehmen“ legt sie an.
 */

export const LIEFERSCHEIN_MAX_BYTES = 5 * 1024 * 1024;

export type LieferscheinPosition = { bezeichnung: string; menge: number; einheit: string; einzelpreisCent: number | null; unsicher: boolean };

export const LIEFERSCHEIN_WERKZEUG: Werkzeug = {
	type: 'function',
	function: {
		name: 'lieferschein_positionen',
		description: 'Positionen eines Lieferscheins (Material) mit Menge und Einheit.',
		parameters: {
			type: 'object',
			properties: {
				positionen: {
					type: 'array',
					maxItems: 60,
					items: {
						type: 'object',
						properties: {
							bezeichnung: { type: 'string', maxLength: 200, description: 'Artikelbezeichnung wie gedruckt' },
							menge: { type: 'number', description: 'gelieferte Menge' },
							einheit: { type: 'string', maxLength: 20, description: 'Einheit wie gedruckt (Stk, Sack, m, m², kg, l, Pkt …)' },
							einzelpreis: { type: 'number', description: 'Netto-Einzelpreis in Euro, nur wenn gedruckt' },
							unsicher: { type: 'boolean', description: 'true, wenn schlecht lesbar' }
						},
						required: ['bezeichnung', 'menge', 'einheit', 'unsicher'],
						additionalProperties: false
					}
				}
			},
			required: ['positionen'],
			additionalProperties: false
		}
	}
};

const SYSTEM = [
	'Du liest einen Lieferschein eines Baustoff- oder Großhändlers für einen Handwerksbetrieb aus.',
	'Gib jede Artikelzeile mit Bezeichnung, gelieferter Menge und Einheit an. Einzelpreis nur, wenn er gedruckt ist.',
	'Lass Adressen, Kundennummern, Summenzeilen, Pfand- und Versandzeilen weg. Setze unsicher=true, wenn eine Zeile schlecht lesbar ist.',
	'Erfinde nichts. Ist kein Lieferschein zu sehen, gib eine leere Liste zurück.'
].join('\n');

export function pruefeLieferschein(x: unknown): LieferscheinPosition[] {
	const o = x as { positionen?: unknown };
	if (!o || typeof o !== 'object' || !Array.isArray(o.positionen)) throw new Error('positionen fehlt');
	const aus: LieferscheinPosition[] = [];
	for (const p of o.positionen as Record<string, unknown>[]) {
		if (!p || typeof p !== 'object') continue;
		const bezeichnung = typeof p.bezeichnung === 'string' ? p.bezeichnung.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
		const menge = typeof p.menge === 'number' && Number.isFinite(p.menge) ? Math.round(p.menge * 1000) / 1000 : NaN;
		if (bezeichnung === '' || !(menge > 0) || menge > 1_000_000) continue;
		const einheit = typeof p.einheit === 'string' && p.einheit.trim() !== '' ? p.einheit.trim().slice(0, 20) : 'Stk';
		const preis = typeof p.einzelpreis === 'number' && Number.isFinite(p.einzelpreis) && p.einzelpreis >= 0 && p.einzelpreis < 1e7 ? Math.round(p.einzelpreis * 100) : null;
		aus.push({ bezeichnung, menge, einheit, einzelpreisCent: preis, unsicher: p.unsicher === true });
		if (aus.length >= 60) break;
	}
	return aus;
}

export async function lieferscheinAuslesen(z: ZeitZugriff, auftragId: unknown, foto: Uint8Array | null, zustimmung: boolean): Promise<LieferscheinPosition[]> {
	if (typeof auftragId !== 'string' || !UUID.test(auftragId)) throw new ApiFehler(404, 'Auftrag nicht gefunden.');
	await holeAuftrag(z.k, sichtVon(z.nutzer), auftragId);
	if (!foto || foto.byteLength === 0) throw new ApiFehler(400, 'Bitte ein Foto des Lieferscheins aufnehmen.');
	if (foto.byteLength > LIEFERSCHEIN_MAX_BYTES) throw new ApiFehler(413, 'Das Foto ist zu groß (höchstens 5 MB).');
	const info = pruefeBild(foto);
	if (!info) throw new ApiFehler(400, 'Das Foto muss ein JPEG- oder PNG-Bild sein.');
	if (!zustimmung) throw new ApiFehler(400, 'Bitte zustimmen, dass das Foto zur Auswertung an die KI gesendet wird.');
	await verbrauche(z.k, 'entwurf');
	const liste = await kiAnbieter().bildAuswertung({
		system: SYSTEM,
		text: 'Lieferschein auslesen.',
		bilder: [{ bytes: foto, typ: info.typ }],
		werkzeug: LIEFERSCHEIN_WERKZEUG,
		pruefe: pruefeLieferschein
	});
	if (liste.length === 0) throw new ApiFehler(422, 'Auf dem Foto wurden keine Positionen erkannt – bitte schärfer fotografieren oder von Hand eintragen.');
	return liste;
}
