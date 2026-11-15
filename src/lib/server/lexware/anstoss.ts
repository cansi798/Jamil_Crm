import type { Kontext } from '../db';

/**
 * Lexware-Warteschlange eines Betriebs sofort anstoßen (z. B. nach „Angebot versenden“ oder einer Annahme im Portal),
 * statt bis zum nächsten Minutenlauf des Dienstes zu warten. Läuft im Hintergrund, Fehler landen nur im Log (die
 * Warteschlange wiederholt selbst). Nie in Tests (VITEST) und nicht, wenn der Dienst aus ist (CRM_LEXWARE_DIENST=aus).
 */
const laufend = new Set<string>();

export function stosseLexwareAn(k: Kontext): void {
	if (process.env.VITEST || process.env.CRM_LEXWARE_DIENST === 'aus' || laufend.has(k.betriebId)) return;
	laufend.add(k.betriebId);
	void (async () => {
		try {
			const { laufFuerBetrieb } = await import('./dienst');
			await laufFuerBetrieb(k, { max: 10 });
		} catch (e) {
			console.error('Lexware-Anstoß:', (e as Error).message);
		} finally {
			laufend.delete(k.betriebId);
		}
	})();
}
