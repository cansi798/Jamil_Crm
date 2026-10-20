import PDFDocument from 'pdfkit';
import normalUrl from './schriften/NotoSans-Regular.ttf?url&inline';
import fettUrl from './schriften/NotoSans-Bold.ttf?url&inline';
import { stundenText, ZEIT_ART_NAMEN, type TagesZeile, type ZeitEintrag } from '../../zeiterfassung';
import { berlinUhrzeit, tagDeutsch, tagKurz } from '../../zeit';

/**
 * Arbeitszeitnachweis als PDF (A4 quer): Kopf mit Betrieb, Person und Zeitraum, Tagestabelle (Beginn, Ende, Arbeit,
 * Pausen, Fahrt, km, Hinweise nach ArbZG), Summe, danach alle Einzeleinträge und Unterschriftsfelder.
 */

const mm = (w: number) => (w * 72) / 25.4;
function ausDataUrl(url: string): Buffer {
	const komma = url.indexOf(',');
	if (!url.startsWith('data:') || komma < 0) throw new Error('Schrift für das Zeiten-PDF ist nicht eingebettet');
	return Buffer.from(url.slice(komma + 1), 'base64');
}
let schriften: { normal: Buffer; fett: Buffer } | null = null;
const holeSchriften = () => (schriften ??= { normal: ausDataUrl(normalUrl), fett: ausDataUrl(fettUrl) });

export type ZeitenPdfDaten = {
	firmenname: string | null;
	person: string;
	von: string;
	bis: string;
	tage: TagesZeile[];
	eintraege: ZeitEintrag[];
	/** Soll laut Kalkulation (Minuten) – dann mit Überstunden-Saldo */
	sollMin?: number | null;
	erstellt: Date;
};

export async function zeitenPdf(d: ZeitenPdfDaten): Promise<Uint8Array> {
	const s = holeSchriften();
	const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: mm(15), info: { Title: `Arbeitszeitnachweis ${d.person}` } });
	doc.registerFont('n', s.normal);
	doc.registerFont('f', s.fett);
	const teile: Buffer[] = [];
	doc.on('data', (b: Buffer) => teile.push(b));
	const fertig = new Promise<void>((ok) => doc.on('end', () => ok()));

	const links = mm(15);
	const breite = doc.page.width - mm(30);
	doc.font('f').fontSize(16).text('Arbeitszeitnachweis', links, mm(15));
	doc.font('n').fontSize(10).text(`${d.firmenname ?? ''}`, { continued: false });
	doc.text(`Mitarbeiter: ${d.person}   ·   Zeitraum: ${tagDeutsch(d.von)} – ${tagDeutsch(d.bis)}`);
	doc.moveDown(0.6);

	const spalten = [
		{ t: 'Tag', b: 0.12 },
		{ t: 'Beginn', b: 0.07 },
		{ t: 'Ende', b: 0.07 },
		{ t: 'Arbeit', b: 0.08 },
		{ t: 'Pausen', b: 0.08 },
		{ t: 'Fahrt', b: 0.08 },
		{ t: 'km', b: 0.06 },
		{ t: 'Hinweise', b: 0.44 }
	];
	const zeile = (werte: string[], fett = false) => {
		if (doc.y > doc.page.height - mm(25)) doc.addPage();
		const y = doc.y;
		let x = links;
		let hoehe = 0;
		doc.font(fett ? 'f' : 'n').fontSize(9);
		werte.forEach((w, i) => {
			const b = spalten[i].b * breite;
			doc.text(w, x + 2, y, { width: b - 4 });
			hoehe = Math.max(hoehe, doc.heightOfString(w, { width: b - 4 }));
			x += b;
		});
		doc.y = y + hoehe + 4;
		doc.moveTo(links, doc.y - 2).lineTo(links + breite, doc.y - 2).strokeColor('#dddddd').lineWidth(0.5).stroke();
	};
	zeile(spalten.map((s2) => s2.t), true);
	for (const t of d.tage) {
		zeile([
			tagKurz(t.tag),
			t.beginn ?? '–',
			t.ende ?? '–',
			t.eintraege ? stundenText(t.arbeitMin) : '–',
			t.eintraege ? stundenText(t.pauseMin) : '–',
			t.eintraege ? stundenText(t.fahrtMin) : '–',
			t.km ? String(t.km).replace('.', ',') : '',
			t.hinweise.join(' ')
		]);
	}
	const summe = d.tage.reduce((a, t) => ({ arbeit: a.arbeit + t.arbeitMin, pause: a.pause + t.pauseMin, fahrt: a.fahrt + t.fahrtMin, km: a.km + t.km }), { arbeit: 0, pause: 0, fahrt: 0, km: 0 });
	zeile(['Summe', '', '', stundenText(summe.arbeit), stundenText(summe.pause), stundenText(summe.fahrt), String(Math.round(summe.km * 10) / 10).replace('.', ','), ''], true);

	if (d.sollMin !== undefined && d.sollMin !== null) {
		doc.moveDown(0.4);
		doc.font('f').fontSize(10).text(`Soll laut Kalkulation: ${stundenText(d.sollMin)}   ·   Überstunden-Saldo: ${summe.arbeit - d.sollMin > 0 ? '+' : ''}${stundenText(summe.arbeit - d.sollMin)}`, links);
	}
	doc.moveDown(1);
	doc.font('f').fontSize(11).text('Einzelne Einträge', links);
	doc.moveDown(0.3);
	doc.font('n').fontSize(8.5);
	for (const e of d.eintraege) {
		if (doc.y > doc.page.height - mm(25)) doc.addPage();
		const b = new Date(e.beginn);
		const was = `${e.auftragNummer ?? ''} ${e.auftragTitel ?? ''}`.trim();
		const text = `${new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', weekday: 'short', day: '2-digit', month: '2-digit' }).format(b)} ${berlinUhrzeit(b)}–${e.ende ? berlinUhrzeit(new Date(e.ende)) : 'läuft'}  ${ZEIT_ART_NAMEN[e.art]}  ${was}${e.pauseMin ? `  (Pause ${e.pauseMin} Min.)` : ''}${e.km !== null ? `  ${String(e.km).replace('.', ',')} km` : ''}${e.manuell ? `  – korrigiert/nachgetragen: ${e.korrekturGrund ?? ''}` : ''}${e.freigegeben ? '  ✓ freigegeben' : ''}`;
		doc.text(text, links, doc.y, { width: breite });
	}

	if (doc.y > doc.page.height - mm(40)) doc.addPage();
	doc.moveDown(2.5);
	const y = doc.y;
	doc.moveTo(links, y).lineTo(links + mm(80), y).strokeColor('#000').lineWidth(0.7).stroke();
	doc.moveTo(links + mm(120), y).lineTo(links + mm(200), y).stroke();
	doc.font('n').fontSize(8).text('Datum, Unterschrift Mitarbeiter', links, y + 3);
	doc.text('Datum, Unterschrift Arbeitgeber', links + mm(120), y + 3);
	doc.fontSize(7).fillColor('#666').text(
		`Erstellt am ${new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short' }).format(d.erstellt)} · Aufzeichnung der Arbeitszeit nach § 16 Abs. 2 ArbZG`,
		links,
		doc.page.height - mm(12),
		{ width: breite, lineBreak: false }
	);
	doc.end();
	await fertig;
	return new Uint8Array(Buffer.concat(teile));
}
