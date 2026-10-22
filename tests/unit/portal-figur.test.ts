import { describe, expect, it } from 'vitest';
import { figurFuer, istAnrede, teamRolle, FIGUR_NAMEN } from '../../src/lib/portal-figur';

/** Comic-Figuren im Kundenportal (Jamil msg 3113): Rolle × Anrede → Figur. */
describe('figurFuer', () => {
	it.each([
		['projektbegleiter', 'herr', 'projektbegleiter'],
		['projektbegleiter', 'frau', 'projektbegleiterin'],
		['projektbegleiter', null, 'projektbegleiter'],
		['monteur', 'herr', 'monteur'],
		['monteur', 'frau', 'monteurin'],
		['monteur', undefined, 'monteur']
	] as const)('%s + %s → %s', (rolle, anrede, figur) => {
		expect(figurFuer(rolle, anrede)).toBe(figur);
	});

	it('Projektbegleiter und Monteure bekommen verschiedene Figuren', () => {
		for (const a of ['herr', 'frau', null] as const) expect(figurFuer('projektbegleiter', a)).not.toBe(figurFuer('monteur', a));
	});

	it('hat für jede Figur einen Namen (Alt-Text)', () => {
		expect(Object.keys(FIGUR_NAMEN).sort()).toEqual(['monteur', 'monteurin', 'projektbegleiter', 'projektbegleiterin']);
	});
});

describe('teamRolle', () => {
	it('wer alle Aufträge sieht (Chef, Büro), ist Projektbegleiter – sonst Monteur', () => {
		expect(teamRolle(['auftraege.lesen', 'auftraege.alle_lesen'])).toBe('projektbegleiter');
		expect(teamRolle(['auftraege.lesen'])).toBe('monteur');
		expect(teamRolle([])).toBe('monteur');
		expect(teamRolle(null)).toBe('monteur');
	});
});

describe('istAnrede', () => {
	it('nimmt nur herr/frau', () => {
		expect(istAnrede('herr')).toBe(true);
		expect(istAnrede('frau')).toBe(true);
		for (const x of ['', 'Herr', 'divers', null, undefined, 1]) expect(istAnrede(x)).toBe(false);
	});
});
