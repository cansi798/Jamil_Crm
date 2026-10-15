import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import NurLesenHinweis from '../../src/lib/components/NurLesenHinweis.svelte';

describe('NurLesenHinweis (Hinweis im (app)-Layout)', () => {
	it('zeigt den Hinweis, wenn das Formular-Ergebnis nurLesen trägt', () => {
		const { body } = render(NurLesenHinweis, { props: { form: { fehler: 'x', nurLesen: true } } });
		expect(body).toContain('role="alert"');
		expect(body).toContain('Nur Lesezugriff');
		expect(body).toContain('Änderungen sind derzeit nicht möglich');
	});

	it('zeigt nichts bei anderen Ergebnissen oder ohne Formular', () => {
		for (const form of [null, undefined, { fehler: 'Bitte eine gültige E-Mail-Adresse angeben.' }, { nurLesen: 'ja' }]) {
			expect(render(NurLesenHinweis, { props: { form } }).body).not.toContain('Nur Lesezugriff');
		}
	});
});
