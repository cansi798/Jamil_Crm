import { describe, expect, it } from 'vitest';
import { MAX_TODOS_AUF_EINMAL, pruefeTodoListe, todosAusFormular } from '../../src/lib/server/todos';

const form = (felder: [string, string][]) => {
	const f = new FormData();
	for (const [k, v] of felder) f.append(k, v);
	return f;
};

describe('todosAusFormular', () => {
	it('liest todo_<n> und todo_beschreibung_<n> in der Reihenfolge von n (auch zweistellig)', () => {
		const f = form([
			['titel', 'Auftrag'],
			['todo_10', 'Zehn'],
			['todo_2', 'Zwei'],
			['todo_beschreibung_2', 'B2'],
			['todo_beschreibung_10', '']
		]);
		expect(todosAusFormular(f)).toEqual([
			{ titel: 'Zwei', beschreibung: 'B2' },
			{ titel: 'Zehn', beschreibung: '' }
		]);
	});

	it('ganz leere Zeilen fallen weg, Beschreibung ohne Titel bleibt (wird beim Prüfen abgelehnt)', () => {
		const f = form([
			['todo_0', '  '],
			['todo_beschreibung_0', ''],
			['todo_1', ''],
			['todo_beschreibung_1', 'nur Beschreibung']
		]);
		const liste = todosAusFormular(f);
		expect(liste).toEqual([{ titel: '', beschreibung: 'nur Beschreibung' }]);
		expect(() => pruefeTodoListe(liste)).toThrow(/Titel/);
	});

	it('ohne To-do-Felder → leere Liste; fremde Felder werden ignoriert', () => {
		expect(todosAusFormular(form([['titel', 'x'], ['todo_x', 'y'], ['beschreibung', 'z']]))).toEqual([]);
	});
});

describe('pruefeTodoListe', () => {
	it('bereinigt Titel/Beschreibung, leere Beschreibung → null', () => {
		expect(pruefeTodoListe([{ titel: ' A ', beschreibung: ' ' }, { titel: 'B', beschreibung: 'b' }])).toEqual([
			{ titel: 'A', beschreibung: null },
			{ titel: 'B', beschreibung: 'b' }
		]);
	});

	it(`mehr als ${MAX_TODOS_AUF_EINMAL} To-dos oder zu lange Texte → 400`, () => {
		const viele = Array.from({ length: MAX_TODOS_AUF_EINMAL + 1 }, (_, i) => ({ titel: `T${i}` }));
		expect(() => pruefeTodoListe(viele)).toThrow(/Höchstens/);
		expect(() => pruefeTodoListe([{ titel: 'x'.repeat(201) }])).toThrow(/zu lang/);
		expect(() => pruefeTodoListe([{ titel: 'x', beschreibung: 'y'.repeat(501) }])).toThrow(/zu lang/);
	});
});
