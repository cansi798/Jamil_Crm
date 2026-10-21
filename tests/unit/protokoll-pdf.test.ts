import { describe, expect, it } from 'vitest';
import { protokollPdf, pruefeSchriften } from '../../src/lib/server/pdf/protokoll-pdf';
import type { Profil } from '../../src/lib/server/betriebsprofil';
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

describe('Protokoll-PDF', () => {
	it('erzeugt ein Protokoll-PDF mit allen Feldern', async () => {
		const pdf = await protokollPdf({
			profil: PROFIL,
			logo: null,
			protokoll: {
				nummer: 'P-2026-0001',
				typ: 'Abnahme',
				datum: '2026-10-17',
				auftragNummer: 'A-2026-0001',
				auftragTitel: 'Badsanierung Müller',
				kundeName: 'Hans Müller',
				objektBezeichnung: 'Hauptstraße 1, Hamburg',
				inhalt: { bemerkung: 'Alles fertig', maengel: 'Keine' }
			},
			unterschrift: testPng(4, 2)
		});
		expect(pdf.length).toBeGreaterThan(0);
		// PDF muss mit %PDF beginnen
		expect(Buffer.from(pdf.slice(0, 4)).toString()).toBe('%PDF');
	});

	it('erzeugt ein PDF ohne Unterschrift', async () => {
		const pdf = await protokollPdf({
			profil: PROFIL,
			logo: null,
			protokoll: {
				nummer: 'P-2026-0002',
				typ: 'Regiebericht',
				datum: '2026-10-17',
				auftragNummer: 'A-2026-0002',
				auftragTitel: 'Küchenrenovierung',
				kundeName: 'Eva Schulz',
				objektBezeichnung: null,
				inhalt: { text: 'Zusätzliche Arbeiten durchgeführt' }
			},
			unterschrift: null
		});
		expect(pdf.length).toBeGreaterThan(0);
		expect(Buffer.from(pdf.slice(0, 4)).toString()).toBe('%PDF');
	});

	it('erzeugt ein PDF mit allen Protokoll-Typen', async () => {
		for (const typ of ['Abnahme', 'Regiebericht', 'Aufmaß', 'Mängelliste']) {
			const pdf = await protokollPdf({
				profil: PROFIL,
				logo: null,
				protokoll: {
					nummer: 'P-2026-0003',
					typ,
					datum: '2026-10-17',
					auftragNummer: 'A-2026-0003',
					auftragTitel: 'Testauftrag',
					kundeName: 'Testkunde',
					objektBezeichnung: null,
					inhalt: { test: 'wert' }
				},
				unterschrift: null
			});
			expect(pdf.length).toBeGreaterThan(0);
		}
	});
});