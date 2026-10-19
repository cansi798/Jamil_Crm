import { inEinerTransaktion } from '../db';
import { ApiFehler } from '../fehler';
import { angeboteZugriff, legeAngebotAn, speicherePositionen } from '../angebote';
import { holeAuftrag } from '../auftraege';
import { pruefeBild } from '../bildpruefung';
import { listeKatalog } from '../katalog';
import { UUID } from '../kunden';
import { betriebKontext } from '../rechte';
import { pruefeModul } from '../tarif';
import { KI_PRUEF_MARKER } from '../../ki-entwurf';
import { kiAnbieter, type KatalogFuerKi } from './anbieter';
import { verbrauche } from './kontingent';

/**
 * KI-Angebotsentwurf nur aus dem Leistungskatalog (Pflichtenheft 4/6): Die KI bekommt den Text (Stichworte bzw.
 * gesprochene Leistungen), ggf. ein Foto und die aktiven Katalogpositionen als kurze Schlüssel K1…Kn mit Bezeichnung,
 * Einheit und Gewerk – nie Preise oder IDs. Sie liefert Schlüssel + Menge (+ unsicher). Der Server legt daraus einen
 * Entwurf an: unbekannte Schlüssel werden verworfen, Preise kommen immer aus dem Katalog, unsichere Positionen
 * bekommen „Bitte prüfen (KI-Vorschlag)“ in die Beschreibung (gelb im Editor). Der Entwurf wird nie versendet.
 *
 * Rechte: Modul `ki_angebote` + `angebote` mit `angebote.bearbeiten` und `preise.sehen`. Alles wird vor der
 * KI-Anfrage geprüft (Auftrag sichtbar, Katalog nicht leer, Foto gültig); erst dann zählt das Kontingent.
 */

export const ENTWURF_MAX_ZEICHEN = 2000;
export const FOTO_MAX_BYTES = 5 * 1024 * 1024;

export type EntwurfAnfrage = { stichworte?: unknown; foto?: Uint8Array | null; zustimmung?: boolean };
export type EntwurfErgebnis = { angebotId: string; nummer: string; pruefen: number[]; verworfen: number };

function pruefeText(w: unknown, mitFoto: boolean): string {
	if (w !== undefined && w !== null && typeof w !== 'string') throw new ApiFehler(400, 'Bitte Leistungen (Stichworte) angeben.');
	const text = (w ?? '').toString().replaceAll('\u0000', '').replace(/\s+/g, ' ').trim();
	if (text === '' && !mitFoto) throw new ApiFehler(400, 'Bitte Leistungen (Stichworte) angeben.');
	if ([...text].length > ENTWURF_MAX_ZEICHEN) {
		throw new ApiFehler(400, `Die Stichworte sind zu lang (höchstens ${ENTWURF_MAX_ZEICHEN} Zeichen).`);
	}
	return text;
}

function pruefeFoto(foto: Uint8Array, zustimmung: boolean): 'image/jpeg' | 'image/png' {
	if (foto.byteLength > FOTO_MAX_BYTES) throw new ApiFehler(413, 'Das Foto ist zu groß (höchstens 5 MB).');
	const info = pruefeBild(foto);
	if (!info) throw new ApiFehler(400, 'Das Foto muss ein JPEG- oder PNG-Bild sein.');
	if (!zustimmung) throw new ApiFehler(400, 'Bitte zustimmen, dass das Foto zur Auswertung an die KI gesendet wird.');
	return info.typ;
}

export async function entwirfAngebot(
	locals: { nutzer: Nutzer | null },
	auftragId: unknown,
	eingabe: EntwurfAnfrage,
	quelle: 'ki' | 'sprache' = 'ki'
): Promise<EntwurfErgebnis> {
	const zg = await angeboteZugriff(locals);
	await pruefeModul(locals, 'ki_angebote');
	const k = betriebKontext(locals);
	const foto = eingabe.foto && eingabe.foto.byteLength > 0 ? eingabe.foto : null;
	const text = pruefeText(eingabe.stichworte, foto !== null);
	const fotoTyp = foto ? pruefeFoto(foto, eingabe.zustimmung === true) : null;
	if (typeof auftragId !== 'string' || !UUID.test(auftragId)) throw new ApiFehler(404, 'Auftrag nicht gefunden.');
	await holeAuftrag(k, zg.sicht, auftragId);
	const katalog = await listeKatalog(k, { nurAktive: true }, false);
	if (katalog.length === 0) throw new ApiFehler(409, 'Der Katalog ist leer – bitte zuerst Leistungen anlegen.');
	const nachSchluessel = new Map(katalog.map((p, i) => [`K${i + 1}`, p]));
	const fuerKi: KatalogFuerKi[] = [...nachSchluessel].map(([schluessel, p]) => ({
		schluessel,
		bezeichnung: p.bezeichnung,
		einheit: p.einheit,
		gewerk: p.gewerk
	}));

	await verbrauche(k, 'entwurf');
	const entwurf = await kiAnbieter().angebotsEntwurf({
		text,
		katalog: fuerKi,
		...(foto && fotoTyp ? { foto: { bytes: foto, typ: fotoTyp } } : {})
	});

	let verworfen = 0;
	const pruefen: number[] = [];
	const positionen: { katalogPositionId: string; menge: number; beschreibung?: string }[] = [];
	for (const p of entwurf.positionen) {
		const kat = nachSchluessel.get(p.schluessel);
		if (!kat) {
			verworfen++;
			continue;
		}
		const eintrag: (typeof positionen)[number] = { katalogPositionId: kat.id, menge: p.menge };
		if (p.unsicher) {
			eintrag.beschreibung = kat.beschreibung ? `${KI_PRUEF_MARKER}\n${kat.beschreibung}` : KI_PRUEF_MARKER;
			pruefen.push(positionen.length + 1);
		}
		positionen.push(eintrag);
	}
	if (positionen.length === 0) throw new ApiFehler(422, 'Die KI hat keine passende Position im Katalog gefunden.');

	return inEinerTransaktion(k, quelle, async () => {
		const angebot = await legeAngebotAn(k, auftragId, zg);
		await speicherePositionen(k, angebot.id, positionen, zg);
		return { angebotId: angebot.id, nummer: angebot.nummer, pruefen, verworfen };
	});
}

/** Hinweise zum Entwurf (für Karte/Meldung). */
export function entwurfHinweise(e: EntwurfErgebnis): string[] {
	const h: string[] = [];
	if (e.pruefen.length > 0) h.push(`Bitte prüfen: Position ${e.pruefen.join(', ')} (gelb markiert).`);
	if (e.verworfen > 0) {
		h.push(`${e.verworfen} ${e.verworfen === 1 ? 'Vorschlag passte' : 'Vorschläge passten'} zu keiner Katalogposition und ${e.verworfen === 1 ? 'wurde' : 'wurden'} verworfen.`);
	}
	return h;
}
