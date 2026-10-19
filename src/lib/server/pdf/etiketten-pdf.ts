import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import normalUrl from './schriften/NotoSans-Regular.ttf?url&inline';
import fettUrl from './schriften/NotoSans-Bold.ttf?url&inline';

/**
 * QR-Etiketten für Anlagen (Wunsch Jamil, msg 2505): QR-Code (Link /a/<Kürzel>), Anlagenname, Typ, Seriennummer,
 * Firmenlogo und Telefon. Zwei Formate:
 * - `einzel`: ein Etikett 90 × 50 mm (eine Seite je Anlage – z. B. für Etikettendrucker),
 * - `bogen`: A4 mit 3 × 8 Etiketten à 70 × 37 mm (gängige Klebe-Etikettenbögen, z. B. Zweckform 3475).
 */

export type Etikett = { url: string; bezeichnung: string; typName: string; seriennummer: string | null };
export type EtikettenDaten = {
	etiketten: Etikett[];
	firmenname: string | null;
	telefon: string | null;
	logo: { bytes: Uint8Array; typ: string } | null;
};
export type EtikettFormat = 'einzel' | 'bogen';

const mm = (w: number) => (w * 72) / 25.4;

function ausDataUrl(url: string): Buffer {
	const komma = url.indexOf(',');
	if (!url.startsWith('data:') || komma < 0) throw new Error('Schrift für das Etiketten-PDF ist nicht eingebettet');
	return Buffer.from(url.slice(komma + 1), 'base64');
}
let schriften: { normal: Buffer; fett: Buffer } | null = null;
const holeSchriften = () => (schriften ??= { normal: ausDataUrl(normalUrl), fett: ausDataUrl(fettUrl) });

export const BOGEN = { spalten: 3, zeilen: 8, breite: mm(70), hoehe: mm(297 / 8) };
const EINZEL = { breite: mm(90), hoehe: mm(50) };

/** Ein Etikett mit linker oberer Ecke (x, y) und Größe (b × h) zeichnen. */
function zeichne(doc: PDFKit.PDFDocument, e: Etikett, qr: Buffer, d: EtikettenDaten, x: number, y: number, b: number, h: number) {
	const rand = mm(3);
	const qrGroesse = h - 2 * rand;
	doc.image(qr, x + rand, y + rand, { width: qrGroesse, height: qrGroesse });
	const tx = x + rand + qrGroesse + mm(2.5);
	const tb = x + b - rand - tx;
	let ty = y + rand;
	if (d.logo) {
		try {
			const lh = h * 0.2;
			doc.image(Buffer.from(d.logo.bytes), tx, ty, { fit: [tb, lh] });
			ty += lh + mm(1);
		} catch {
			// kaputtes Logo: Etikett trotzdem drucken
		}
	} else if (d.firmenname) {
		doc.font('fett').fontSize(h > mm(45) ? 8 : 6.5).fillColor('#05346b');
		doc.text(d.firmenname, tx, ty, { width: tb, height: mm(4), ellipsis: true, lineBreak: false });
		ty += mm(4);
	}
	const gross = h > mm(45) ? 10.5 : 8.5;
	doc.font('fett').fontSize(gross).fillColor('#1c1f23');
	doc.text(e.bezeichnung, tx, ty, { width: tb, height: gross * 2.5, ellipsis: true });
	ty = Math.max(doc.y, ty + gross * 1.3) + mm(0.5);
	doc.font('normal').fontSize(gross - 2.5).fillColor('#5b6168');
	doc.text(e.typName, tx, ty, { width: tb, lineBreak: false, ellipsis: true });
	ty += (gross - 2.5) * 1.35;
	if (e.seriennummer) {
		doc.text(`SN ${e.seriennummer}`, tx, ty, { width: tb, lineBreak: false, ellipsis: true });
	}
	// Fußzeile: Hinweis + Telefon
	const fuss = gross - 3;
	const fy = y + h - rand - fuss * 1.3 * (d.telefon ? 2 : 1);
	doc.font('fett').fontSize(fuss).fillColor('#05346b');
	doc.text('Störung? QR-Code scannen', tx, fy, { width: tb, lineBreak: false, ellipsis: true });
	if (d.telefon) {
		doc.font('normal').fillColor('#1c1f23');
		doc.text(`Tel. ${d.telefon}`, tx, fy + fuss * 1.3, { width: tb, lineBreak: false, ellipsis: true });
	}
}

export async function etikettenPdf(d: EtikettenDaten, format: EtikettFormat): Promise<Uint8Array> {
	if (d.etiketten.length === 0) throw new Error('Keine Etiketten');
	const s = holeSchriften();
	const qrs = await Promise.all(
		d.etiketten.map((e) => QRCode.toBuffer(e.url, { type: 'png', errorCorrectionLevel: 'M', margin: 1, width: 360 }))
	);
	const doc = new PDFDocument({
		size: format === 'einzel' ? [EINZEL.breite, EINZEL.hoehe] : 'A4',
		margins: { top: 0, bottom: 0, left: 0, right: 0 },
		autoFirstPage: false,
		compress: true,
		info: { Title: 'Anlagen-Etiketten', Author: d.firmenname ?? '', Creator: 'CRM System' },
		lang: 'de-DE'
	});
	doc.registerFont('normal', s.normal);
	doc.registerFont('fett', s.fett);
	const teile: Buffer[] = [];
	doc.on('data', (c: Buffer) => teile.push(c));
	const fertig = new Promise<void>((ok) => doc.on('end', () => ok()));

	const proBogen = BOGEN.spalten * BOGEN.zeilen;
	d.etiketten.forEach((e, i) => {
		if (format === 'einzel') {
			doc.addPage();
			zeichne(doc, e, qrs[i], d, 0, 0, EINZEL.breite, EINZEL.hoehe);
			return;
		}
		if (i % proBogen === 0) doc.addPage();
		const n = i % proBogen;
		const x = (n % BOGEN.spalten) * BOGEN.breite;
		const y = Math.floor(n / BOGEN.spalten) * BOGEN.hoehe;
		zeichne(doc, e, qrs[i], d, x, y, BOGEN.breite, BOGEN.hoehe);
	});
	doc.end();
	await fertig;
	return new Uint8Array(Buffer.concat(teile));
}
