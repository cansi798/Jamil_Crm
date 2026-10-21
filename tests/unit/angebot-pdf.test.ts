import { describe, expect, it, vi } from 'vitest';
import { angebotPdf, pruefeSchriften } from '../../src/lib/server/pdf/angebot-pdf';
import type { Angebot, AngebotPosition } from '../../src/lib/server/angebote';
import type { Profil } from '../../src/lib/server/betriebsprofil';
import { positionsSumme, summen } from '../../src/lib/geld';
import { pdfSeiten, pdfText, pdfTextSeiten } from './pdf-text';
import { testPng } from '../db/hilfe-1c';

const PROFIL: Profil = {
	firmenname: 'Bauwelt Handwerk GmbH',
	strasse: 'Musterweg 1',
	plz: '22846',
	ort: 'Norderstedt',
	telefon: '040 123456',
	email: 'info@bauwelt.example',
	web: 'bauwelt.example',
	steuernummer: null,
	ustId: null,
	iban: 'DE89370400440532013000',
	bic: null,
	bank: 'Beispielbank',
	fusszeile: 'Geschäftsführer: Max Muster',
	farbe: null,
	dunkelFarbe: null,
	hintergrundFarbe: null,
	titelSchrift: null,
	textSchrift: null,
	titelGross: 'nein',
	hatLogo: false,
	logoTyp: null,
	logoGeaendert: null,
	hatLogoDunkel: false,
	logoDunkelGeaendert: null,
	logoFarbe: null,
	farbeEigen: false
};

function position(i: number, menge: number, einzelpreisCent: number, bezeichnung: string, beschreibung: string | null = null): AngebotPosition {
	return {
		id: `p${i}`,
		pos: i,
		katalogPositionId: null,
		bezeichnung,
		beschreibung,
		menge,
		einheit: 'm²',
		einzelpreisCent,
		summeCent: positionsSumme(menge, einzelpreisCent),
		arbeitMinuten: null,
		materialCent: null
	};
}

function angebot(positionen: AngebotPosition[], mwstSatz: 0 | 7 | 19 = 19): Angebot {
	return {
		id: 'a1',
		nummer: 'AN-2026-0001',
		auftragId: 'x',
		auftragNummer: 'A-2026-0007',
		auftragTitel: 'Badsanierung',
		kundeId: 'k',
		kundeName: 'Hans Müller',
		objektId: null,
		status: 'entwurf',
		datum: '2026-10-17',
		gueltigBis: '2026-11-16',
		mwstSatz,
		einleitung: 'Vielen Dank für Ihre Anfrage. Gerne bieten wir Ihnen folgende Leistungen an:',
		schluss: 'Wir freuen uns auf Ihren Auftrag.',
		positionen,
		...summen(positionen, mwstSatz),
		vorgaengerId: null,
		warnungen: [],
		angelegt: '2026-10-17T08:00:00.000Z',
		geaendert: '2026-10-17T08:00:00.000Z'
	};
}

const KUNDE = { name: 'Herr Hans Müller', strasse: 'Lindenweg 3', plz: '22846', ort: 'Norderstedt' };
const OBJEKT = { bezeichnung: 'Haus Müller', strasse: 'Lindenweg 3', plz: '22846', ort: 'Norderstedt' };

describe('Angebots-PDF', () => {
	it('ist ein PDF mit Nummer, Kunde, Brutto (Umlaute, €), Briefkopf und Seitenzahl', async () => {
		const pdf = await angebotPdf(
			{ profil: PROFIL, logo: null, angebot: angebot([position(1, 3, 3333, 'Fliesen verlegen')]), kunde: KUNDE, objekt: OBJEKT },
			{ komprimieren: false }
		);
		expect(Buffer.from(pdf.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
		const text = pdfText(pdf);
		expect(text).toContain('Angebot AN-2026-0001');
		expect(text).toContain('Müller');
		expect(text).toContain('118,99');
		expect(text).toContain('99,99');
		expect(text).toContain('19,00');
		expect(text).toContain('€');
		expect(text).toContain('Bauwelt Handwerk GmbH');
		expect(text).toContain('Haus Müller');
		expect(text).toContain('A-2026-0007');
		expect(text).toContain('17.10.2026');
		expect(text).toContain('16.11.2026');
		expect(text).toContain('MwSt 19 %');
		expect(text).toContain('IBAN DE89 3704 0044 0532 0130 00');
		expect(text).toContain('Geschäftsführer: Max Muster');
		expect(text).toContain('Seite 1 von 1');
		expect(pdfSeiten(pdf)).toBe(1);
		expect(Buffer.from(pdf).toString('latin1')).not.toContain('/Subtype /Image');
	});

	it('Review Focus 3: 60 Positionen mit langen Texten → mehrere Seiten, Kopf und Seitenzahl je Seite, Summen nie allein', async () => {
		const lang = 'Untergrund prüfen, grundieren, abdichten nach DIN 18534, Fliesen im Dünnbett verlegen und verfugen. '.repeat(4);
		const positionen = Array.from({ length: 60 }, (_, i) =>
			position(i + 1, 2.5, 4999, `Position ${i + 1}: ${'Bodenfliesen verlegen bis 60×60 inkl. Zuschnitt '.repeat(2).trim()}`, lang)
		);
		const pdf = await angebotPdf({ profil: PROFIL, logo: null, angebot: angebot(positionen), kunde: KUNDE, objekt: null }, { komprimieren: false });
		const seiten = pdfTextSeiten(pdf);
		expect(pdfSeiten(pdf)).toBeGreaterThanOrEqual(3);
		expect(seiten.length).toBe(pdfSeiten(pdf));
		const n = seiten.length;
		expect(pdfText(pdf)).toContain('Seite 3 von');
		seiten.forEach((s, i) => {
			expect(s, `Seite ${i + 1}`).toContain(`Seite ${i + 1} von ${n}`);
			expect(s, `Seite ${i + 1}`).toContain('Bezeichnung'); // Tabellenkopf auf jeder Seite
			expect(s, `Seite ${i + 1}`).toContain('Bauwelt Handwerk GmbH');
		});
		for (let i = 1; i < n; i++) expect(seiten[i]).toContain('AN-2026-0001'); // Folgekopf
		const summenSeite = seiten.findIndex((s) => s.includes('Nettobetrag'));
		expect(summenSeite).toBe(n - 1);
		expect(seiten[summenSeite]).toContain('Position 60');
		// jede Position steht genau einmal im Dokument
		const alles = seiten.join('\n');
		for (const nr of [1, 30, 59, 60]) expect(alles.split(`Position ${nr}:`).length - 1, `Position ${nr}`).toBe(1);
	});

	it('Summenblock rutscht mit der letzten Position auf die nächste Seite, wenn er allein nicht mehr passt', async () => {
		// Positionen so wählen, dass genau eine Seite gefüllt wird – der Summenblock passt nicht mehr dahinter
		for (let anzahl = 8; anzahl <= 30; anzahl++) {
			const positionen = Array.from({ length: anzahl }, (_, i) => position(i + 1, 1, 100, `Leistung ${i + 1}`, 'Kurze Beschreibung der Leistung.'));
			const pdf = await angebotPdf({ profil: PROFIL, logo: null, angebot: angebot(positionen), kunde: KUNDE, objekt: null }, { komprimieren: false });
			const seiten = pdfTextSeiten(pdf);
			const s = seiten.findIndex((t) => t.includes('Nettobetrag'));
			expect(seiten[s], `${anzahl} Positionen`).toMatch(/Leistung \d+/);
			expect(seiten[s], `${anzahl} Positionen`).toContain(`Leistung ${anzahl}`);
		}
	}, 20_000); // mehrere PDFs mit eingebetteter Schrift – unter Last länger als die üblichen 5 s

	it('ohne Logo kein Fehler; mit PNG-Logo ein Bild; MwSt 7 % und 0 Positionen gehen', async () => {
		const mitLogo = await angebotPdf(
			{ profil: { ...PROFIL, hatLogo: true }, logo: { bytes: testPng(120, 40), typ: 'image/png' }, angebot: angebot([], 7), kunde: KUNDE, objekt: null },
			{ komprimieren: false }
		);
		expect(Buffer.from(mitLogo).toString('latin1')).toContain('/Subtype /Image');
		const text = pdfText(mitLogo);
		expect(text).toContain('MwSt 7 %');
		expect(text).toContain('0,00');
		const leer = await angebotPdf({
			profil: { ...PROFIL, firmenname: null, strasse: null, plz: null, ort: null, iban: null, bank: null, fusszeile: null },
			logo: null,
			angebot: angebot([position(1, 1, 0, 'Ohne Preis')]),
			kunde: { name: 'Firma X', strasse: null, plz: null, ort: null },
			objekt: null
		});
		expect(Buffer.from(leer.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
		expect(leer.length).toBeGreaterThan(5000);
	});

	it('Gesamtprüfung 6: Schriften hängen nicht vom Arbeitsverzeichnis ab', async () => {
		const vorher = process.cwd();
		process.chdir('/tmp');
		try {
			expect(() => pruefeSchriften()).not.toThrow();
			const pdf = await angebotPdf(
				{ profil: PROFIL, logo: null, angebot: angebot([position(1, 1, 100, 'Ä')]), kunde: KUNDE, objekt: null },
				{ komprimieren: false }
			);
			expect(pdfText(pdf)).toContain('Angebot AN-2026-0001');
		} finally {
			process.chdir(vorher);
		}
	});

	it('Gesamtprüfung 1: kaputtes Logo (gültiger Kopf, Müll-Daten) → PDF ohne Bild, kein Absturz', async () => {
		const muell = new TextEncoder().encode('incorrect header check');
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			for (const opts of [{ farbtyp: 6 as const, idat: muell }, { farbtyp: 6 as const, interlace: true, idat: muell }, { idat: muell }]) {
				const pdf = await angebotPdf(
					{ profil: PROFIL, logo: { bytes: testPng(40, 20, opts), typ: 'image/png' }, angebot: angebot([]), kunde: KUNDE, objekt: null },
					{ komprimieren: false }
				);
				expect(Buffer.from(pdf).toString('latin1')).not.toContain('/Subtype /Image');
			}
			await new Promise((ok) => setTimeout(ok, 200));
			expect(warn).toHaveBeenCalled();
		} finally {
			warn.mockRestore();
		}
		// gültiges RGBA-Logo (Transparenz) wird eingebettet
		const gut = await angebotPdf(
			{ profil: PROFIL, logo: { bytes: testPng(40, 20, { farbtyp: 6 }), typ: 'image/png' }, angebot: angebot([]), kunde: KUNDE, objekt: null },
			{ komprimieren: false }
		);
		expect(Buffer.from(gut).toString('latin1')).toContain('/Subtype /Image');
	});
});
