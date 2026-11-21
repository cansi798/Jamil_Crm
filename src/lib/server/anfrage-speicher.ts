import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Kurzlebiger Speicher für EINE lesende Anfrage (GET/HEAD): Werte, die sich während einer Seitenanfrage nicht ändern
 * (z. B. die Module des Tarifs), werden nur einmal aus der Datenbank geholt, auch wenn Layout, Seite und Helfer sie
 * mehrfach brauchen (vorher bis zu ~12 Abfragen je Auftragsseite).
 *
 * Bewusst NUR für lesende Anfragen: Bei Formular-Aktionen (POST) laufen Aktion und anschließendes `load` in derselben
 * Anfrage – ändert die Aktion etwas, muss das `load` den neuen Stand sehen. Außerhalb einer Anfrage (Tests, Skripte,
 * Hintergrund-Dienste) gibt es keinen Speicher; dann wird immer frisch gelesen.
 */
type Speicher = Map<string, Promise<unknown>>;

const speicher = new AsyncLocalStorage<Speicher>();

/** Führt `fn` mit eigenem Anfrage-Speicher aus (nur lesende Methoden bekommen einen). */
export function mitAnfrageSpeicher<T>(methode: string, fn: () => T): T {
	if (methode !== 'GET' && methode !== 'HEAD') return fn();
	return speicher.run(new Map(), fn);
}

/**
 * Liefert den Wert für `schluessel` aus dem Speicher der laufenden Anfrage oder lädt ihn mit `laden` (gleichzeitige
 * Aufrufe teilen sich dieselbe Abfrage). Schlägt das Laden fehl, wird der Eintrag verworfen (nächster Aufruf lädt neu).
 */
export function ausAnfrageSpeicher<T>(schluessel: string, laden: () => Promise<T>): Promise<T> {
	const s = speicher.getStore();
	if (!s) return laden();
	const vorhanden = s.get(schluessel) as Promise<T> | undefined;
	if (vorhanden) return vorhanden;
	const p = laden();
	s.set(schluessel, p);
	p.catch(() => s.delete(schluessel));
	return p;
}
