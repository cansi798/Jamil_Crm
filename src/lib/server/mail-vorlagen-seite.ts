import { error, redirect } from '@sveltejs/kit';
import { hatRecht } from './rechte';
import { vorschauBeispiele } from './nachfassen';
import { holeSignatur, listeMailVorlagen, vorlagenZugriff } from './mail-vorlagen';
import { BEISPIELE_ALLE } from '../mail-vorlagen';

/** Zugriff und Beispieldaten – gemeinsam für Liste, „Neue Vorlage“ und Detailseite. */
export async function mailSeite(locals: App.Locals) {
	if (!locals.nutzer) redirect(303, '/anmelden');
	if (!hatRecht(locals.nutzer, 'vorlagen.verwalten') || !locals.nutzer.betriebId) error(403, 'Keine Berechtigung');
	const k = vorlagenZugriff(locals);
	const [vorlagen, signatur, beispiele] = await Promise.all([listeMailVorlagen(k), holeSignatur(k), vorschauBeispiele(k, hatRecht(locals.nutzer, 'preise.sehen'))]);
	// Beispielwerte für alle Platzhalter (auch Termin, Portal-Link …); echte Angebote überschreiben ihre Felder
	return { vorlagen, signatur, beispiele: beispiele.map((b) => ({ ...b, werte: { ...BEISPIELE_ALLE, ...b.werte } })) };
}
