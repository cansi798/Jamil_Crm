import { describe, expect, it } from 'vitest';
import { todoSpalte, todoVerschiebung } from '../../src/lib/todo-board';

describe('To-do-Board', () => {
	it('ordnet To-dos den Spalten zu', () => {
		expect(todoSpalte({ erledigt: false, faellig: null })).toBe('offen');
		expect(todoSpalte({ erledigt: false, faellig: '2026-10-20' })).toBe('in-arbeit');
		expect(todoSpalte({ erledigt: true, faellig: '2026-10-20' })).toBe('erledigt');
	});

	it('liefert die Änderung je Zielspalte', () => {
		const heute = '2026-10-20';
		expect(todoVerschiebung({ erledigt: false, faellig: null }, 'erledigt', heute)).toEqual({ erledigt: true });
		expect(todoVerschiebung({ erledigt: false, faellig: null }, 'in-arbeit', heute)).toEqual({ erledigt: false, faellig: heute });
		expect(todoVerschiebung({ erledigt: true, faellig: '2026-11-01' }, 'in-arbeit', heute)).toEqual({ erledigt: false, faellig: '2026-11-01' });
		expect(todoVerschiebung({ erledigt: true, faellig: '2026-11-01' }, 'offen', heute)).toEqual({ erledigt: false, faellig: null });
		// Ergebnis landet wirklich in der Zielspalte
		for (const nach of ['offen', 'in-arbeit', 'erledigt'] as const) {
			const t = { erledigt: false, faellig: '2026-10-01' as string | null };
			expect(todoSpalte({ ...t, ...todoVerschiebung(t, nach, heute) })).toBe(nach);
		}
	});
});
