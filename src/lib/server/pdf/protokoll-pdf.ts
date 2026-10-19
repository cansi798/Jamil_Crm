import PDFDocument from 'pdfkit';
import normalUrl from './schriften/NotoSans-Regular.ttf?url&inline';
import fettUrl from './schriften/NotoSans-Bold.ttf?url&inline';
import type { Profil } from '../betriebsprofil';

/**
 * Protokoll-PDF (A4) mit pdfkit und eingebetteter Schrift „Noto Sans" (OFL, Umlaute und €).
 *
 * Aufbau: Firmenname und Kontakt oben links, Protokoll-Typ und Nummer als Titel, Angaben (Auftrag, Datum, Kunde,
 * Objekt), Inhalt (als Zeilen), Unterschrift unten rechts (wenn vorhanden), Fußzeile mit Firmendaten.
 */

export type ProtokollPdfDaten = {
	profil: Profil;
	logo: { bytes: Uint8Array; typ: string } | null;
	protokoll: {
		nummer: string;
		typ: string;
		datum: string;
		auftragNummer: string;
		auftragTitel: string;
		kundeName: string;
		objektBezeichnung: string | null;
		inhalt: Record<string, unknown>;
	};
	unterschrift: Uint8Array | null; // PNG
};

function ausDataUrl(url: string): Buffer {
	const komma = url.indexOf(',');
	if (!url.startsWith('data:') || komma < 0) throw new Error('Schrift für das Protokoll-PDF ist nicht eingebettet');
	return Buffer.from(url.slice(komma + 1), 'base64');
}

let schriften: { normal: Buffer; fett: Buffer } | null = null;
function holeSchriften() {
	schriften ??= { normal: ausDataUrl(normalUrl), fett: ausDataUrl(fettUrl) };
	return schriften;
}

/** Wirft, wenn die eingebetteten Schriften fehlen oder keine TrueType-Dateien sind. */
export function pruefeSchriften(): void {
	const s = holeSchriften();
	for (const [name, b] of Object.entries(s)) {
		if (b.length < 10_000 || b.readUInt32BE(0) !== 0x00010000) {
			throw new Error(`Schrift „${name}" für das Protokoll-PDF fehlt oder ist beschädigt`);
		}
	}
}

const mm = (w: number) => (w * 72) / 25.4;

// Seitenmaße (A4) und Ränder
const LINKS = mm(25);
const RECHTS = mm(190);
const BREITE = RECHTS - LINKS;
const INHALT_UNTEN = mm(256);
const SEITENZAHL_Y = mm(261);
const FUSS_Y = mm(267);

const FARBE_TEXT = '#1c1f23';
const FARBE_LEISE = '#5b6168';
const FARBE_LINIE = '#c9ced5';
const FARBE_PRIMAER = '#05346b';

const deutschesDatum = (tag: string) => {
	const [j, m, t] = tag.split('-');
	return `${t}.${m}.${j}`;
};

const nichtLeer = (...teile: (string | null | undefined)[]) => teile.filter((t): t is string => !!t && t.trim() !== '');

const TITEL_MAP: Record<string, string> = {
	abnahme: 'Abnahme',
	regiebericht: 'Regiebericht',
	aufmass: 'Aufmaß',
	maengelliste: 'Mängelliste'
};

export async function protokollPdf(daten: ProtokollPdfDaten): Promise<Uint8Array> {
	const { profil, protokoll: p, unterschrift } = daten;
	const doc = new PDFDocument({
		size: 'A4',
		margins: { top: 0, bottom: 0, left: 0, right: 0 },
		bufferPages: true,
		compress: true,
		info: {
			Title: `Protokoll ${p.nummer}`,
			Author: profil.firmenname ?? '',
			Subject: p.auftragTitel ?? '',
			Creator: 'CRM System'
		},
		lang: 'de-DE'
	});
	const s = holeSchriften();
	doc.registerFont('normal', s.normal);
	doc.registerFont('fett', s.fett);

	const teile: Buffer[] = [];
	doc.on('data', (t: Buffer) => teile.push(t));
	const fertig = new Promise<void>((ok, fehler) => {
		doc.on('end', ok);
		doc.on('error', fehler);
	});

	const schrift = (art: 'normal' | 'fett', groesse: number, farbe = FARBE_TEXT) => {
		doc.font(art).fontSize(groesse).fillColor(farbe);
	};
	const linie = (x1: number, y: number, x2: number, farbe = FARBE_LINIE, staerke = 0.6) => {
		doc.moveTo(x1, y).lineTo(x2, y).lineWidth(staerke).strokeColor(farbe).stroke();
	};
	const zeile = (text: string, x: number, y: number, breite: number, ausrichtung: 'left' | 'right' = 'left') => {
		doc.text(text, x, y, { width: breite, height: doc.currentLineHeight(true), ellipsis: true, lineBreak: false, align: ausrichtung });
	};

	let y = mm(15);

	// ---------- Kopf ----------
	if (profil.firmenname) {
		schrift('fett', 15, FARBE_PRIMAER);
		doc.text(profil.firmenname, LINKS, y, { width: BREITE, height: mm(14), ellipsis: true });
		y += mm(10);
	}
	const kontakt = nichtLeer(profil.strasse, nichtLeer(profil.plz, profil.ort).join(' '), profil.telefon && `Tel. ${profil.telefon}`, profil.email);
	if (kontakt.length > 0) {
		schrift('normal', 8, FARBE_LEISE);
		doc.text(kontakt.join(' · '), LINKS, y, { width: BREITE, height: mm(8), ellipsis: true });
		y += mm(10);
	}

	// Trennlinie
	y += mm(3);
	linie(LINKS, y, RECHTS);
	y += mm(8);

	// ---------- Titel ----------
	const typTitel = TITEL_MAP[p.typ] ?? p.typ;
	schrift('fett', 18, FARBE_PRIMAER);
	doc.text(`Protokoll ${typTitel}`, LINKS, y, { width: BREITE });
	y += mm(10);
	schrift('normal', 10, FARBE_LEISE);
	zeile(p.nummer, LINKS, y, mm(60));
	zeile(deutschesDatum(p.datum), RECHTS - mm(40), y, mm(40), 'right');
	y += mm(10);

	// ---------- Angaben ----------
	schrift('normal', 10);
	const angaben: [string, string][] = [
		['Auftrag', p.auftragNummer],
		['Kunde', p.kundeName],
		['Bauvorhaben', p.auftragTitel]
	];
	if (p.objektBezeichnung) angaben.push(['Objekt', p.objektBezeichnung]);
	for (const [label, wert] of angaben) {
		schrift('fett', 9, FARBE_LEISE);
		zeile(label, LINKS, y, mm(30));
		schrift('normal', 10);
		zeile(wert, LINKS + mm(32), y, BREITE - mm(32));
		y += mm(6);
	}

	// Trennlinie
	y += mm(3);
	linie(LINKS, y, RECHTS);
	y += mm(8);

	// ---------- Inhalt ----------
	schrift('fett', 11);
	doc.text('Inhalt', LINKS, y, { width: BREITE });
	y += mm(8);

	schrift('normal', 10);
	const inhaltEintraege = Object.entries(p.inhalt).filter(([, v]) => v !== null && v !== undefined && v !== '');
	if (inhaltEintraege.length === 0) {
		schrift('normal', 10, FARBE_LEISE);
		doc.text('(kein Inhalt)', LINKS, y, { width: BREITE });
		y += mm(8);
	} else {
		for (const [key, value] of inhaltEintraege) {
			const labelText = key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');
			const wertText = typeof value === 'string' ? value : JSON.stringify(value);
			schrift('fett', 9, FARBE_LEISE);
			zeile(labelText, LINKS, y, mm(30));
			schrift('normal', 10);
			// Mehrzeiliger Text
			doc.text(wertText, LINKS + mm(32), y, { width: BREITE - mm(32) });
			y = doc.y + mm(3);
			if (y > INHALT_UNTEN) {
				doc.addPage();
				y = mm(20);
			}
		}
	}

	// ---------- Unterschrift ----------
	if (unterschrift) {
		y += mm(10);
		if (y > INHALT_UNTEN - mm(50)) {
			doc.addPage();
			y = mm(20);
		}
		schrift('fett', 10);
		doc.text('Unterschrift des Kunden', LINKS, y, { width: BREITE });
		y += mm(5);
		try {
			doc.image(Buffer.from(unterschrift), LINKS, y, { fit: [mm(60), mm(30)] });
		} catch {
			// kaputtes Bild: PDF trotzdem erzeugen
			schrift('normal', 9, FARBE_LEISE);
			doc.text('(Unterschrift konnte nicht angezeigt werden)', LINKS, y, { width: BREITE });
		}
		y += mm(35);
		linie(LINKS, y, LINKS + mm(60));
	}

	// ---------- Fußzeile auf jeder Seite ----------
	const seiten = doc.bufferedPageRange();
	for (let i = 0; i < seiten.count; i++) {
		doc.switchToPage(i);
		schrift('normal', 7, FARBE_LEISE);
		const fussTeile = nichtLeer(profil.firmenname, profil.strasse, nichtLeer(profil.plz, profil.ort).join(' '));
		if (fussTeile.length > 0) {
			doc.text(fussTeile.join(' · '), LINKS, FUSS_Y, { width: BREITE, align: 'center' });
		}
		doc.text(`Seite ${i + 1} von ${seiten.count}`, LINKS, SEITENZAHL_Y, { width: BREITE, align: 'right' });
	}

	doc.end();
	await fertig;
	return Buffer.concat(teile);
}