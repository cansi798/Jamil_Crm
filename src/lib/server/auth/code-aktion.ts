import { fail, redirect } from '@sveltejs/kit';
import {
	loescheVorsitzungsCookie,
	pruefeZweitenFaktor,
	VORSITZUNG_COOKIE,
	vorsitzungsDaten
} from './vorsitzung';
import { setzeSitzungsCookie } from './sitzung';

const MAX_CODE = 32;
const FALSCH = 'Der Code ist falsch oder wurde schon verwendet.';

type Ereignis = {
	request: Request;
	cookies: Parameters<typeof setzeSitzungsCookie>[0] &
		Parameters<typeof loescheVorsitzungsCookie>[0] & { get(name: string): string | undefined };
};

/**
 * Gemeinsame Formular-Aktion für Code-Seite und Einrichtung: prüft den Code zur Vor-Sitzung aus dem Cookie.
 * Erfolg → Vor-Cookie weg, volles Sitzungs-Cookie, Weiterleitung nach „/“. Sonst `fail(400)` (Meldung ohne
 * Code/Geheimnis) bzw. zurück zur Anmeldung, wenn die Vor-Sitzung nicht mehr brauchbar ist.
 */
export async function verarbeiteCode({ request, cookies }: Ereignis, modus: 'anmelden' | 'einrichten') {
	const token = cookies.get(VORSITZUNG_COOKIE);
	if (!token) redirect(303, '/anmelden?hinweis=abgelaufen');
	// Jede Seite bedient nur ihren Fall: Einrichtung nur ohne aktives TOTP, Code-Eingabe nur mit aktivem TOTP.
	const daten = await vorsitzungsDaten(token);
	if (!daten) {
		loescheVorsitzungsCookie(cookies);
		redirect(303, '/anmelden?hinweis=abgelaufen');
	}
	if (modus === 'einrichten' && daten.totpAktiv) redirect(303, '/anmelden/zweiter-faktor');
	if (modus === 'anmelden' && !daten.totpAktiv) redirect(303, '/konto/zwei-faktor');

	const form = await request.formData();
	const code = form.get('code');
	if (typeof code !== 'string' || code.trim() === '' || code.length > MAX_CODE) {
		return fail(400, { fehler: 'Bitte den 6-stelligen Code eingeben.', verbleibend: null as number | null });
	}

	const ergebnis = await pruefeZweitenFaktor(token, code);
	switch (ergebnis.art) {
		case 'ok':
			loescheVorsitzungsCookie(cookies);
			setzeSitzungsCookie(cookies, ergebnis.sitzungToken);
			redirect(303, '/');
		case 'falsch':
			return fail(400, {
				fehler: FALSCH,
				verbleibend: ergebnis.verbleibend
			});
		case 'gesperrt':
			loescheVorsitzungsCookie(cookies);
			redirect(303, '/anmelden?hinweis=gesperrt');
		case 'abgelaufen':
			loescheVorsitzungsCookie(cookies);
			redirect(303, '/anmelden?hinweis=abgelaufen');
	}
}
