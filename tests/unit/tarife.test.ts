import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { MODULE, niedrigsterTarif, sortiereTarifSchluessel, type TarifInfo } from '../../src/lib/tarife';
import TarifHinweis from '../../src/lib/components/TarifHinweis.svelte';

const alle = MODULE as readonly string[];
const basisModule = ['kunden', 'auftraege', 'plantafel', 'katalog', 'angebote'];
const profiModule = [...basisModule, 'ki_angebote', 'sprache', 'zeiterfassung', 'protokolle'];

// bewusst durcheinander, damit die Reihenfolge nicht zufällig stimmt
const tarife: TarifInfo[] = [
	{ schluessel: 'test', name: 'Test', module: [...alle] },
	{ schluessel: 'premium', name: 'Premium', module: [...alle] },
	{ schluessel: 'basis', name: 'Basis', module: basisModule },
	{ schluessel: 'profi', name: 'Profi', module: profiModule }
];

describe('Tarif-Reihenfolge', () => {
	it('sortiert nach Stufe: basis, profi, premium, test zuletzt, Unbekannte vor test alphabetisch', () => {
		expect(sortiereTarifSchluessel(['test', 'premium', 'profi', 'basis'])).toEqual(['basis', 'profi', 'premium', 'test']);
		expect(sortiereTarifSchluessel(['test', 'zzz', 'aaa', 'profi'])).toEqual(['profi', 'aaa', 'zzz', 'test']);
	});

	it('niedrigsterTarif: günstigster Tarif mit dem Modul, test zählt nie', () => {
		expect(niedrigsterTarif(tarife, 'kunden')?.schluessel).toBe('basis');
		expect(niedrigsterTarif(tarife, 'sprache')?.schluessel).toBe('profi');
		expect(niedrigsterTarif(tarife, 'lexware')?.schluessel).toBe('premium');
		expect(niedrigsterTarif(tarife.filter((t) => t.schluessel === 'test'), 'kunden')).toBeNull();
		expect(niedrigsterTarif(tarife, 'gibtsnicht')).toBeNull();
	});
});

describe('TarifHinweis.svelte', () => {
	const html = (props: { modul: string; tarife: TarifInfo[] }) => render(TarifHinweis, { props }).body;

	it('zeigt "Im Tarif Profi enthalten" für ein Profi-Modul', () => {
		expect(html({ modul: 'sprache', tarife })).toContain('Im Tarif Profi enthalten');
	});

	it('zeigt Premium für Module, die nur Premium hat', () => {
		expect(html({ modul: 'kundenportal', tarife })).toContain('Im Tarif Premium enthalten');
	});

	it('zeigt nichts, wenn kein (echter) Tarif das Modul enthält', () => {
		expect(html({ modul: 'gibtsnicht', tarife })).not.toContain('Im Tarif');
	});

	it('escaped den Tarifnamen', () => {
		const t: TarifInfo[] = [{ schluessel: 'profi', name: '<b>Profi</b>', module: ['sprache'] }];
		const h = html({ modul: 'sprache', tarife: t });
		expect(h).not.toContain('<b>');
		expect(h).toContain('&lt;b');
	});
});
