import PDFDocument from 'pdfkit';
import normalUrl from './schriften/NotoSans-Regular.ttf?url&inline';
import fettUrl from './schriften/NotoSans-Bold.ttf?url&inline';
import type { Angebot, AngebotPosition } from '../angebote';
import type { Profil } from '../betriebsprofil';
import { pruefeBild } from '../bildpruefung';
import { euro, mengeText } from '../../geld';

/**
 * Angebots-PDF (A4) mit pdfkit und eingebetteter Schrift „Noto Sans“ (OFL, Umlaute und €).
 *
 * Aufbau: Logo oben rechts (höchstens 45 × 25 mm), Firmenname links; Absenderzeile und Empfänger im Anschriftfeld
 * nach DIN 5008 Form B; rechts daneben Angebotsnummer, Datum, gültig bis, Auftrag, Bauvorhaben; Titel, Einleitung,
 * Positionstabelle (Pos | Bezeichnung + Beschreibung | Menge | Einheit | Einzelpreis | Gesamt), Summenblock, Schlusstext.
 * Jede Seite hat die Fußzeile aus dem Briefkopf und „Seite x von y“; Folgeseiten einen Kurzkopf und wieder den
 * Tabellenkopf. Der Summenblock steht nie allein: Passt er nicht mehr hinter die letzte Position, wandert diese mit
 * auf die neue Seite.
 */

export type PdfKunde = { name: string; ansprechpartner?: string | null; strasse: string | null; plz: string | null; ort: string | null };
export type PdfObjekt = { bezeichnung: string; strasse: string | null; plz: string | null; ort: string | null };

export type AngebotPdfDaten = {
	profil: Profil;
	logo: { bytes: Uint8Array; typ: string } | null;
	angebot: Angebot;
	kunde: PdfKunde;
	objekt: PdfObjekt | null;
};

/**
 * Schriften als Teil des Server-Bundles (Vite `?url&inline` = data:-URL, base64): unabhängig vom Arbeitsverzeichnis
 * und ohne zusätzliche Dateien neben dem Build. `pruefeSchriften` wird beim Serverstart aufgerufen (hooks.server.ts)
 * und bricht laut ab, falls etwas fehlt.
 */
function ausDataUrl(url: string): Buffer {
	const komma = url.indexOf(',');
	if (!url.startsWith('data:') || komma < 0) throw new Error('Schrift für das Angebots-PDF ist nicht eingebettet');
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
			throw new Error(`Schrift „${name}“ für das Angebots-PDF fehlt oder ist beschädigt`);
		}
	}
}

const mm = (w: number) => (w * 72) / 25.4;

// Seitenmaße (A4) und Ränder
const LINKS = mm(25);
const RECHTS = mm(190);
const BREITE = RECHTS - LINKS;
const INHALT_OBEN_FOLGESEITE = mm(28);
const INHALT_UNTEN = mm(256);
const SEITENZAHL_Y = mm(261);
const FUSS_Y = mm(267);

const FARBE_TEXT = '#1c1f23';
const FARBE_LEISE = '#5b6168';
const FARBE_LINIE = '#c9ced5';
const FARBE_KOPF = '#eef1f5';
const FARBE_PRIMAER = '#05346b';

// Tabellenspalten: Pos | Bezeichnung | Menge | Einheit | Einzelpreis | Gesamt (Summe = 165 mm)
const SPALTEN = [
	{ key: 'pos', titel: 'Pos.', breite: mm(11), rechts: false },
	{ key: 'bez', titel: 'Bezeichnung', breite: mm(74), rechts: false },
	{ key: 'menge', titel: 'Menge', breite: mm(18), rechts: true },
	{ key: 'einheit', titel: 'Einheit', breite: mm(14), rechts: false },
	{ key: 'ep', titel: 'Einzelpreis', breite: mm(24), rechts: true },
	{ key: 'gp', titel: 'Gesamt', breite: mm(24), rechts: true }
] as const;
const ZELLE_ABSTAND = mm(1.5);
const TABELLENKOPF_HOEHE = mm(7);
const SUMMEN_HOEHE = mm(26);

const deutschesDatum = (tag: string) => {
	const [j, m, t] = tag.split('-');
	return `${t}.${m}.${j}`;
};
const ibanText = (iban: string) => iban.replace(/(.{4})/g, '$1 ').trim();
const nichtLeer = (...teile: (string | null | undefined)[]) => teile.filter((t): t is string => !!t && t.trim() !== '');

export async function angebotPdf(daten: AngebotPdfDaten, opts: { komprimieren?: boolean } = {}): Promise<Uint8Array> {
	const { profil, logo, angebot: a, kunde, objekt } = daten;
	const doc = new PDFDocument({
		size: 'A4',
		margins: { top: 0, bottom: 0, left: 0, right: 0 },
		bufferPages: true,
		compress: opts.komprimieren ?? true,
		info: {
			Title: `Angebot ${a.nummer}`,
			Author: profil.firmenname ?? '',
			Subject: a.auftragTitel ?? '',
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
	/** Eine Zeile Text ohne Umbruch (zu Langes wird mit „…“ gekürzt). */
	const zeile = (text: string, x: number, y: number, breite: number, ausrichtung: 'left' | 'right' = 'left') => {
		doc.text(text, x, y, { width: breite, height: doc.currentLineHeight(true), ellipsis: true, lineBreak: false, align: ausrichtung });
	};

	let y = 0;

	// ---------- Seite 1: Kopf, Anschrift, Angaben ----------
	const logoBreite = mm(45);
	let logoGezeichnet = false;
	// Logo nur, wenn es vollständig gültig ist: pdfkit dekodiert manche PNGs asynchron, ein Fehler dort würde den
	// Server beenden. Ein kaputtes Logo (z. B. direkt in der Datenbank) wird übersprungen – das PDF entsteht trotzdem.
	if (logo && !pruefeBild(logo.bytes)) {
		console.warn('Angebots-PDF: Logo ist kein gültiges PNG/JPEG und wird weggelassen.');
	} else if (logo) {
		try {
			doc.image(Buffer.from(logo.bytes), RECHTS - logoBreite, mm(12), { fit: [logoBreite, mm(25)], align: 'right' });
			logoGezeichnet = true;
		} catch {
			// kaputtes Bild: PDF trotzdem erzeugen (das Logo wurde beim Hochladen geprüft)
		}
	}
	const kopfBreite = BREITE - (logoGezeichnet ? logoBreite + mm(5) : 0);
	if (profil.firmenname) {
		schrift('fett', 15, FARBE_PRIMAER);
		doc.text(profil.firmenname, LINKS, mm(14), { width: kopfBreite, height: mm(14), ellipsis: true });
	}
	const kontakt = nichtLeer(profil.strasse, nichtLeer(profil.plz, profil.ort).join(' '), profil.telefon && `Tel. ${profil.telefon}`, profil.email);
	if (kontakt.length > 0) {
		schrift('normal', 8, FARBE_LEISE);
		doc.text(kontakt.join(' · '), LINKS, mm(28), { width: kopfBreite, height: mm(8), ellipsis: true });
	}

	// Anschriftfeld DIN 5008 Form B (ab 45 mm von oben): Rücksendeangabe, dann Empfänger ab 62,7 mm
	const absender = nichtLeer(profil.firmenname, profil.strasse, nichtLeer(profil.plz, profil.ort).join(' ')).join(' · ');
	if (absender) {
		schrift('normal', 7, FARBE_LEISE);
		zeile(absender, LINKS, mm(54), mm(80));
		linie(LINKS, mm(57.5), LINKS + Math.min(mm(80), doc.widthOfString(absender)), FARBE_LEISE, 0.4);
	}
	schrift('normal', 10.5);
	const empfaenger = nichtLeer(kunde.name, kunde.ansprechpartner, kunde.strasse, nichtLeer(kunde.plz, kunde.ort).join(' '));
	empfaenger.forEach((t, i) => zeile(t, LINKS, mm(62.7) + i * mm(4.8), mm(80)));

	// Angaben rechts
	const infoX = mm(125);
	const infoBreite = RECHTS - infoX;
	const angaben: [string, string][] = [
		['Angebot-Nr.', a.nummer],
		['Datum', deutschesDatum(a.datum)],
		['Gültig bis', deutschesDatum(a.gueltigBis)],
		['Auftrag', a.auftragNummer]
	];
	let iy = mm(50);
	for (const [titel, wert] of angaben) {
		schrift('normal', 8.5, FARBE_LEISE);
		zeile(titel, infoX, iy, mm(22));
		schrift('fett', 8.5);
		zeile(wert, infoX + mm(22), iy, infoBreite - mm(22));
		iy += mm(4.6);
	}
	if (objekt) {
		schrift('normal', 8.5, FARBE_LEISE);
		zeile('Bauvorhaben', infoX, iy, mm(22));
		schrift('normal', 8.5);
		const ort = nichtLeer(objekt.bezeichnung, objekt.strasse, nichtLeer(objekt.plz, objekt.ort).join(' ')).join(', ');
		doc.text(ort, infoX + mm(22), iy, { width: infoBreite - mm(22), height: mm(14), ellipsis: true });
	}

	// Titel und Einleitung
	y = mm(98);
	schrift('fett', 15);
	doc.text(`Angebot ${a.nummer}`, LINKS, y, { width: BREITE });
	y = doc.y + mm(1);
	if (a.auftragTitel) {
		schrift('normal', 10, FARBE_LEISE);
		doc.text(a.auftragTitel, LINKS, y, { width: BREITE, height: mm(10), ellipsis: true });
		y = doc.y;
	}
	y += mm(4);
	if (a.einleitung) {
		schrift('normal', 10);
		doc.text(a.einleitung, LINKS, y, { width: BREITE });
		y = doc.y + mm(4);
	}

	// ---------- Tabelle ----------
	let kopfAufDieserSeite = false;

	const folgeseite = () => {
		doc.addPage({ size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } });
		schrift('fett', 9);
		zeile(profil.firmenname ?? '', LINKS, mm(15), BREITE / 2);
		schrift('normal', 9, FARBE_LEISE);
		zeile(`Angebot ${a.nummer} vom ${deutschesDatum(a.datum)}`, LINKS + BREITE / 2, mm(15), BREITE / 2, 'right');
		linie(LINKS, mm(21), RECHTS);
		y = INHALT_OBEN_FOLGESEITE;
		kopfAufDieserSeite = false;
	};

	const tabellenkopf = () => {
		doc.rect(LINKS, y, BREITE, TABELLENKOPF_HOEHE).fill(FARBE_KOPF);
		schrift('fett', 8.5);
		let x = LINKS;
		for (const sp of SPALTEN) {
			zeile(sp.titel, x + ZELLE_ABSTAND, y + mm(1.9), sp.breite - 2 * ZELLE_ABSTAND, sp.rechts ? 'right' : 'left');
			x += sp.breite;
		}
		y += TABELLENKOPF_HOEHE;
		kopfAufDieserSeite = true;
	};

	const bezBreite = SPALTEN[1].breite - 2 * ZELLE_ABSTAND;
	const zeilenHoehe = (p: AngebotPosition) => {
		schrift('normal', 9);
		let h = doc.heightOfString(p.bezeichnung, { width: bezBreite });
		if (p.beschreibung) {
			schrift('normal', 7.5);
			h += mm(0.8) + doc.heightOfString(p.beschreibung, { width: bezBreite });
		}
		return h + 2 * mm(1.8);
	};

	const positionZeichnen = (p: AngebotPosition, h: number) => {
		const oben = y + mm(1.8);
		let x = LINKS;
		const zellen: Record<string, string> = {
			pos: String(p.pos),
			menge: mengeText(p.menge),
			einheit: p.einheit,
			ep: euro(p.einzelpreisCent),
			gp: euro(p.summeCent)
		};
		for (const sp of SPALTEN) {
			const innen = sp.breite - 2 * ZELLE_ABSTAND;
			if (sp.key === 'bez') {
				schrift('normal', 9);
				doc.text(p.bezeichnung, x + ZELLE_ABSTAND, oben, { width: innen });
				if (p.beschreibung) {
					const by = doc.y + mm(0.8);
					schrift('normal', 7.5, FARBE_LEISE);
					doc.text(p.beschreibung, x + ZELLE_ABSTAND, by, { width: innen });
				}
			} else {
				schrift(sp.key === 'gp' ? 'fett' : 'normal', 9);
				zeile(zellen[sp.key], x + ZELLE_ABSTAND, oben, innen, sp.rechts ? 'right' : 'left');
			}
			x += sp.breite;
		}
		y += h;
		linie(LINKS, y, RECHTS);
	};

	/** Platz für `hoehe` (plus Tabellenkopf, falls auf dieser Seite noch keiner steht) – sonst neue Seite. */
	const sorgePlatz = (hoehe: number) => {
		const mitKopf = kopfAufDieserSeite ? 0 : TABELLENKOPF_HOEHE;
		if (y + mitKopf + hoehe > INHALT_UNTEN) folgeseite();
		if (!kopfAufDieserSeite) tabellenkopf();
	};

	const positionen = a.positionen;
	if (positionen.length === 0) {
		sorgePlatz(mm(9) + SUMMEN_HOEHE);
		schrift('normal', 9, FARBE_LEISE);
		zeile('Keine Positionen.', LINKS + ZELLE_ABSTAND, y + mm(2), BREITE);
		y += mm(9);
		linie(LINKS, y, RECHTS);
	}
	positionen.forEach((p, i) => {
		const h = zeilenHoehe(p);
		const letzte = i === positionen.length - 1;
		// Die letzte Position nimmt den Summenblock mit – so steht er nie allein auf einer Seite.
		sorgePlatz(h + (letzte ? SUMMEN_HOEHE : 0));
		positionZeichnen(p, h);
	});

	// ---------- Summenblock ----------
	const sx = RECHTS - mm(80);
	const sBreite = mm(80);
	y += mm(3);
	const summenZeile = (titel: string, betrag: string, fett = false) => {
		schrift(fett ? 'fett' : 'normal', fett ? 10.5 : 9.5);
		zeile(titel, sx, y, sBreite - mm(32));
		zeile(betrag, sx + sBreite - mm(32), y, mm(32), 'right');
		y += fett ? mm(6) : mm(5);
	};
	summenZeile('Nettobetrag', euro(a.nettoCent));
	summenZeile(`zzgl. MwSt ${a.mwstSatz} %`, euro(a.mwstCent));
	y += mm(0.8);
	linie(sx, y, RECHTS, FARBE_TEXT, 0.8);
	y += mm(1.5);
	summenZeile('Gesamtbetrag', euro(a.bruttoCent), true);

	// ---------- Schlusstext ----------
	if (a.schluss) {
		y += mm(5);
		schrift('normal', 10);
		const h = doc.heightOfString(a.schluss, { width: BREITE });
		if (y + h > INHALT_UNTEN) {
			folgeseite();
			kopfAufDieserSeite = true; // nach der Tabelle braucht der Schlusstext keinen Tabellenkopf
		}
		schrift('normal', 10);
		doc.text(a.schluss, LINKS, y, { width: BREITE });
		y = doc.y;
	}

	// ---------- Fußzeile und Seitenzahl auf jeder Seite ----------
	const spalte1 = nichtLeer(profil.firmenname, profil.strasse, nichtLeer(profil.plz, profil.ort).join(' '));
	const spalte2 = nichtLeer(profil.telefon && `Tel. ${profil.telefon}`, profil.email, profil.web);
	const spalte3 = nichtLeer(
		profil.steuernummer && `St.-Nr. ${profil.steuernummer}`,
		profil.ustId && `USt-IdNr. ${profil.ustId}`,
		profil.bank,
		profil.iban && `IBAN ${ibanText(profil.iban)}`,
		profil.bic && `BIC ${profil.bic}`
	);
	const bereich = doc.bufferedPageRange();
	const gesamt = bereich.count;
	for (let i = 0; i < gesamt; i++) {
		doc.switchToPage(bereich.start + i);
		schrift('normal', 8, FARBE_LEISE);
		zeile(`Seite ${i + 1} von ${gesamt}`, LINKS, SEITENZAHL_Y, BREITE, 'right');
		linie(LINKS, FUSS_Y, RECHTS);
		const spBreite = BREITE / 3;
		schrift('normal', 7, FARBE_LEISE);
		const zh = mm(3.2);
		[spalte1, spalte2, spalte3].forEach((sp, n) => {
			sp.slice(0, 5).forEach((t, j) => zeile(t, LINKS + n * spBreite, FUSS_Y + mm(2) + j * zh, spBreite - mm(2)));
		});
		if (profil.fusszeile) {
			zeile(profil.fusszeile.replace(/\s+/g, ' '), LINKS, FUSS_Y + mm(2) + 5 * zh + mm(0.5), BREITE);
		}
	}

	doc.end();
	await fertig;
	return new Uint8Array(Buffer.concat(teile));
}
