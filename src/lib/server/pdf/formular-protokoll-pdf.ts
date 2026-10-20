import PDFDocument from 'pdfkit';
import normalUrl from './schriften/NotoSans-Regular.ttf?url&inline';
import fettUrl from './schriften/NotoSans-Bold.ttf?url&inline';
import type { Profil } from '../betriebsprofil';
import { pruefeBild } from '../bildpruefung';
import { alleFelder, auswerten, dateiIds, hatWert, wertText, type Antworten, type Schema, type UnterschriftWert } from '../../protokoll-formular';

/**
 * PDF eines frei gestalteten Protokolls (A4, pdfkit, eingebettete Schrift Noto Sans wie Angebot und Baustellen-
 * Protokoll): Briefkopf mit Logo, Titel mit Nummer/Version/Abschluss, Angaben (Auftrag, Kunde, Objekt, Anlage), dann je
 * Seite der Vorlage die sichtbaren Felder mit Antworten, Fotos (zwei je Reihe) und Unterschriften (Bild, Name, Zeit).
 * Verborgene Felder (Bedingung nicht erfüllt) fehlen.
 */

export type PdfBild = { typ: string; bytes: Uint8Array };

export type FormularPdfDaten = {
	profil: Profil;
	logo: { bytes: Uint8Array; typ: string } | null;
	titel: string;
	version: number;
	nummer: string;
	status: 'entwurf' | 'abgeschlossen';
	/** ISO-Zeitpunkt des Abschlusses (bei Entwurf: jetzt) */
	abgeschlossen: string;
	abgeschlossenVon: string | null;
	angaben: [string, string][];
	schema: Schema;
	antworten: Antworten;
	bilder: Map<string, PdfBild>;
};

function ausDataUrl(url: string): Buffer {
	const komma = url.indexOf(',');
	if (!url.startsWith('data:') || komma < 0) throw new Error('Schrift für das Protokoll-PDF ist nicht eingebettet');
	return Buffer.from(url.slice(komma + 1), 'base64');
}
let schriften: { normal: Buffer; fett: Buffer } | null = null;
const holeSchriften = () => (schriften ??= { normal: ausDataUrl(normalUrl), fett: ausDataUrl(fettUrl) });

const mm = (w: number) => (w * 72) / 25.4;
const LINKS = mm(20);
const RECHTS = mm(190);
const BREITE = RECHTS - LINKS;
const OBEN = mm(18);
const INHALT_UNTEN = mm(268);
const FUSS_Y = mm(280);
const LABEL_BREITE = mm(58);

const FARBE_TEXT = '#1f2430';
const FARBE_LEISE = '#646b7d';
const FARBE_LINIE = '#cdd2de';
const FARBE_PRIMAER = '#1e3a8a';
const FARBE_BAND = '#f2f4f8';

const zeitFormat = new Intl.DateTimeFormat('de-DE', {
	timeZone: 'Europe/Berlin',
	day: '2-digit',
	month: '2-digit',
	year: 'numeric',
	hour: '2-digit',
	minute: '2-digit',
	hour12: false
});

const nichtLeer = (...teile: (string | null | undefined)[]) => teile.filter((t): t is string => !!t && t.trim() !== '');

export async function formularProtokollPdf(d: FormularPdfDaten): Promise<Uint8Array> {
	const doc = new PDFDocument({
		size: 'A4',
		margins: { top: 0, bottom: 0, left: 0, right: 0 },
		bufferPages: true,
		compress: true,
		info: { Title: `${d.titel} ${d.nummer}`, Author: d.profil.firmenname ?? '', Creator: 'CRM System' },
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

	const schrift = (art: 'normal' | 'fett', groesse: number, farbe = FARBE_TEXT) => doc.font(art).fontSize(groesse).fillColor(farbe);
	const linie = (y: number, x1 = LINKS, x2 = RECHTS) => doc.moveTo(x1, y).lineTo(x2, y).lineWidth(0.6).strokeColor(FARBE_LINIE).stroke();
	let y = OBEN;
	const platz = (h: number) => {
		if (y + h > INHALT_UNTEN) {
			doc.addPage();
			y = OBEN;
		}
	};
	const bild = (b: PdfBild | undefined, x: number, yy: number, w: number, h: number): boolean => {
		if (!b || !pruefeBild(b.bytes)) return false;
		try {
			doc.image(Buffer.from(b.bytes), x, yy, { fit: [w, h], align: 'center', valign: 'center' });
			return true;
		} catch {
			return false;
		}
	};

	// ---------- Kopf ----------
	const logoBreite = mm(42);
	const mitLogo = d.logo ? bild({ typ: d.logo.typ, bytes: d.logo.bytes }, RECHTS - logoBreite, y - mm(3), logoBreite, mm(20)) : false;
	const kopfBreite = BREITE - (mitLogo ? logoBreite + mm(5) : 0);
	if (d.profil.firmenname) {
		schrift('fett', 13, FARBE_PRIMAER).text(d.profil.firmenname, LINKS, y, { width: kopfBreite, height: mm(8), ellipsis: true });
	}
	const kontakt = nichtLeer(d.profil.strasse, nichtLeer(d.profil.plz, d.profil.ort).join(' '), d.profil.telefon && `Tel. ${d.profil.telefon}`, d.profil.email);
	if (kontakt.length > 0) schrift('normal', 8, FARBE_LEISE).text(kontakt.join(' · '), LINKS, y + mm(7), { width: kopfBreite, height: mm(8), ellipsis: true });
	y += mm(22);
	linie(y);
	y += mm(6);

	// ---------- Titel ----------
	schrift('fett', 17, FARBE_PRIMAER).text(d.titel, LINKS, y, { width: BREITE });
	y = doc.y + mm(1);
	const zeit = zeitFormat.format(new Date(d.abgeschlossen));
	const meta =
		d.status === 'abgeschlossen'
			? `Nr. ${d.nummer} · Vorlage Version ${d.version} · abgeschlossen am ${zeit} Uhr${d.abgeschlossenVon ? ` von ${d.abgeschlossenVon}` : ''}`
			: `Nr. ${d.nummer} · Vorlage Version ${d.version} · ENTWURF (nicht abgeschlossen), Stand ${zeit} Uhr`;
	schrift('normal', 9, FARBE_LEISE).text(meta, LINKS, y, { width: BREITE });
	y = doc.y + mm(4);
	for (const [label, wert] of d.angaben) {
		schrift('fett', 9, FARBE_LEISE).text(label, LINKS, y, { width: mm(30) });
		schrift('normal', 10).text(wert, LINKS + mm(32), y, { width: BREITE - mm(32) });
		y = Math.max(doc.y, y + mm(5)) + mm(1);
	}
	y += mm(3);

	// ---------- Inhalt ----------
	const zustand = auswerten(d.schema, d.antworten);
	d.schema.seiten.forEach((seite) => {
		const sichtbare = seite.abschnitte.map((a) => ({ a, felder: a.felder.filter((f) => zustand.get(f.id)?.sichtbar) }));
		if (sichtbare.every((x) => x.felder.length === 0)) return;
		platz(mm(20));
		doc.rect(LINKS, y, BREITE, mm(8)).fill(FARBE_BAND);
		schrift('fett', 11, FARBE_PRIMAER).text(seite.titel, LINKS + mm(3), y + mm(1.8), { width: BREITE - mm(6), height: mm(6), ellipsis: true });
		y += mm(11);
		for (const { a, felder } of sichtbare) {
			if (felder.length === 0) continue;
			if (a.titel) {
				platz(mm(12));
				schrift('fett', 10).text(a.titel, LINKS, y, { width: BREITE });
				y = doc.y + mm(2);
			}
			for (const f of felder) {
				const wert = d.antworten[f.id];
				if (f.typ === 'hinweis') {
					schrift('fett', 9.5);
					const h = doc.heightOfString(f.label, { width: BREITE }) + (f.hilfe ? doc.heightOfString(f.hilfe, { width: BREITE }) : 0);
					platz(h + mm(3));
					doc.text(f.label, LINKS, y, { width: BREITE });
					if (f.hilfe) schrift('normal', 9, FARBE_LEISE).text(f.hilfe, LINKS, doc.y, { width: BREITE });
					y = doc.y + mm(3);
					continue;
				}
				if (f.typ === 'foto') {
					const ids = dateiIds(f, wert);
					platz(mm(8));
					schrift('fett', 9, FARBE_LEISE).text(f.label, LINKS, y, { width: LABEL_BREITE });
					if (ids.length === 0) {
						schrift('normal', 10).text('– kein Foto –', LINKS + LABEL_BREITE, y, { width: BREITE - LABEL_BREITE });
						y = Math.max(doc.y, y + mm(5)) + mm(2);
						continue;
					}
					y += mm(6);
					const w = (BREITE - mm(6)) / 2;
					const h = mm(62);
					for (let i = 0; i < ids.length; i += 2) {
						platz(h + mm(4));
						for (let j = 0; j < 2 && i + j < ids.length; j++) {
							const x = LINKS + j * (w + mm(6));
							doc.rect(x, y, w, h).lineWidth(0.5).strokeColor(FARBE_LINIE).stroke();
							if (!bild(d.bilder.get(ids[i + j]), x + mm(1), y + mm(1), w - mm(2), h - mm(2))) {
								schrift('normal', 8, FARBE_LEISE).text('(Foto nicht lesbar)', x, y + h / 2, { width: w, align: 'center' });
							}
						}
						y += h + mm(4);
					}
					continue;
				}
				if (f.typ === 'unterschrift') {
					platz(mm(42));
					schrift('fett', 9, FARBE_LEISE).text(f.label, LINKS, y, { width: BREITE });
					y += mm(5);
					const u = hatWert(f, wert) ? (wert as UnterschriftWert) : null;
					if (u) bild(d.bilder.get(u.dateiId), LINKS, y, mm(70), mm(25));
					y += mm(26);
					linie(y, LINKS, LINKS + mm(75));
					y += mm(1.5);
					const unter = u
						? nichtLeer(u.name, u.zeit ? `${zeitFormat.format(new Date(u.zeit))} Uhr` : null).join(' · ')
						: '– nicht unterschrieben –';
					schrift('normal', 8.5, FARBE_LEISE).text(unter, LINKS, y, { width: mm(120) });
					y = doc.y + mm(5);
					continue;
				}
				const text = wertText(f, wert);
				schrift('normal', 10);
				const h = Math.max(doc.heightOfString(text, { width: BREITE - LABEL_BREITE }), mm(5));
				platz(h + mm(3));
				schrift('fett', 9, FARBE_LEISE).text(f.label, LINKS, y, { width: LABEL_BREITE - mm(3) });
				const yLabel = doc.y;
				schrift('normal', 10).text(text, LINKS + LABEL_BREITE, y, { width: BREITE - LABEL_BREITE });
				y = Math.max(doc.y, yLabel) + mm(2.5);
			}
		}
		y += mm(3);
	});
	if (alleFelder(d.schema).length === 0) schrift('normal', 10, FARBE_LEISE).text('(keine Felder)', LINKS, y);

	// ---------- Fußzeile ----------
	const seiten = doc.bufferedPageRange();
	for (let i = 0; i < seiten.count; i++) {
		doc.switchToPage(i);
		schrift('normal', 7, FARBE_LEISE);
		const fuss = nichtLeer(d.profil.firmenname, d.profil.strasse, nichtLeer(d.profil.plz, d.profil.ort).join(' '), `${d.titel} Nr. ${d.nummer}`);
		doc.text(fuss.join(' · '), LINKS, FUSS_Y, { width: BREITE - mm(25), height: mm(5), ellipsis: true, lineBreak: false });
		doc.text(`Seite ${i + 1} von ${seiten.count}`, RECHTS - mm(25), FUSS_Y, { width: mm(25), align: 'right', lineBreak: false });
	}
	doc.end();
	await fertig;
	return Buffer.concat(teile);
}
