import { describe, expect, it } from 'vitest';
import { angebotAbzeichen, nachfassenAbzeichen } from '../../src/lib/auftrag-hinweise';

describe('Abzeichen Angebot und Nachfassen (msg 2674)', () => {
	it('Angebot verschickt / angenommen (grün) / abgelehnt (leise) / keins', () => {
		expect(angebotAbzeichen({ status: 'versendet', tag: '2026-10-18' })).toMatchObject({ text: 'Angebot verschickt 18.10.', ton: 'neutral' });
		expect(angebotAbzeichen({ status: 'angenommen', tag: '2026-10-19' })).toMatchObject({ text: 'Angebot angenommen 19.10.', ton: 'gut' });
		expect(angebotAbzeichen({ status: 'abgelehnt', tag: '2026-10-19' })).toMatchObject({ text: 'Angebot abgelehnt', ton: 'leise' });
		expect(angebotAbzeichen(null)).toBeNull();
	});
	it('Nachfassen: künftig mit Wochentag, heute, überfällig rot, pausiert', () => {
		const heute = '2026-10-20';
		expect(nachfassenAbzeichen({ tag: '2026-10-23', pausiert: false }, heute)).toMatchObject({ text: 'Nachfassen: Fr 23.10.', ton: 'neutral' });
		expect(nachfassenAbzeichen({ tag: heute, pausiert: false }, heute)).toMatchObject({ text: 'Nachfassen: heute', ton: 'warnung' });
		expect(nachfassenAbzeichen({ tag: '2026-10-17', pausiert: false }, heute)).toMatchObject({ ton: 'ueberfaellig', titel: expect.stringMatching(/überfällig/) });
		expect(nachfassenAbzeichen({ tag: '2026-10-17', pausiert: true }, heute)).toMatchObject({ text: 'Nachfassen pausiert', ton: 'leise' });
		expect(nachfassenAbzeichen(null, heute)).toBeNull();
	});
});
