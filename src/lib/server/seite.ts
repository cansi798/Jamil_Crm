import { error, redirect } from '@sveltejs/kit';
import type { Kontext } from './db';
import { ApiFehler } from './fehler';
import { betriebKontext, type Recht } from './rechte';
import { darf } from './tarif';
import type { Modul } from '../tarife';

/**
 * Zugriffsprüfung für `load`-Funktionen von Seiten: Gäste gehen zur Anmeldung, sonst gilt dieselbe Prüfung wie in
 * der API (`darf`: Recht und Modul). Fehlendes Recht → 403, Modul nicht im Tarif → 402 als Fehlerseite.
 */
export async function seitenZugriff(
	locals: { nutzer: Nutzer | null },
	modul: Modul,
	recht: Recht
): Promise<Kontext> {
	if (!locals.nutzer) redirect(303, '/anmelden');
	try {
		await darf(locals, modul, recht);
		return betriebKontext(locals);
	} catch (e) {
		if (e instanceof ApiFehler) error(e.status, e.message);
		throw e;
	}
}

/** Für `load`: ApiFehler (z. B. 404 „Kunde nicht gefunden.“) als Fehlerseite statt als 500. */
export async function alsSeitenFehler<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (e) {
		if (e instanceof ApiFehler) error(e.status, e.message);
		throw e;
	}
}

/** Textfelder eines Formulars als einfache Zeichenketten (Dateien und fehlende Felder werden zu ''). */
export function formWerte(form: FormData, felder: readonly string[]): Record<string, string> {
	const werte: Record<string, string> = {};
	for (const f of felder) {
		const w = form.get(f);
		werte[f] = typeof w === 'string' ? w : '';
	}
	return werte;
}
