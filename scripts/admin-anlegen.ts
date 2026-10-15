import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import postgres from 'postgres';
import { ladeEnv, urlAusUmgebung } from './migrate';
import { hashePasswort } from '../src/lib/server/auth/passwort';

/**
 * Legt den ersten (oder einen weiteren) Plattform-Admin an – für Datenbanken ohne Entwicklungsdaten, also jede
 * echte Umgebung. Läuft wie die Migrationen als Superuser (PGHOST/PGPORT/PGUSER/PGDATABASE/PGPASSWORD bzw. `.env`).
 *
 *   npm run admin:anlegen -- --email <e-mail> --name "<Name>"                     (fragt das Passwort verdeckt ab)
 *   printf '%s\n' "$PASSWORT" | npm run admin:anlegen -- --email … --name … --passwort-stdin   (Automatisierung)
 *
 * Das Passwort wird nie als Argument angenommen (Shell-Historie, Prozessliste) und nie ausgegeben. Es wird mit
 * Argon2id gehasht (`hashePasswort`, wie bei jeder Anmeldung). Benutzer (ohne Betrieb, ohne Rolle) und Eintrag in
 * `plattform_admins` entstehen in einer Transaktion. Gibt es die E-Mail schon, bricht das Skript ab (Exit-Code 1)
 * und ändert nichts. Die Zwei-Faktor-Anmeldung richtet der Admin bei der ersten Anmeldung selbst ein (Pflicht).
 */

export const MIN_PASSWORT = 10;
/** Wie die Anmeldeseite: längere Passwörter nimmt sie nicht an. */
export const MAX_PASSWORT = 1024;
const MAX_EMAIL = 254;

const AUFRUF =
	'Aufruf: npm run admin:anlegen -- --email <e-mail> --name "<Name>" [--passwort-stdin]';

/** Fehler mit einer Meldung für die Konsole (deutsch, ohne Geheimnisse). */
export class AdminFehler extends Error {
	override name = 'AdminFehler';
}

export type NeuerAdmin = { email: string; name: string; passwort: string };

function pruefe(daten: NeuerAdmin): { email: string; name: string } {
	const email = daten.email.trim().toLowerCase();
	const name = daten.name.trim();
	if (email.length > MAX_EMAIL || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		throw new AdminFehler(`Die E-Mail-Adresse „${daten.email.trim()}“ ist ungültig.`);
	}
	if (name === '') throw new AdminFehler('Der Name darf nicht leer sein.');
	if ([...daten.passwort].length < MIN_PASSWORT) {
		throw new AdminFehler(`Das Passwort muss mindestens ${MIN_PASSWORT} Zeichen lang sein.`);
	}
	if (daten.passwort.length > MAX_PASSWORT) {
		throw new AdminFehler(`Das Passwort darf höchstens ${MAX_PASSWORT} Zeichen lang sein.`);
	}
	return { email, name };
}

const existiert = (email: string) =>
	new AdminFehler(`Ein Benutzer mit der E-Mail „${email}“ existiert bereits – es wurde nichts geändert.`);

/** Legt den Plattform-Admin an (eine Transaktion) und liefert seine ID. */
export async function adminAnlegen(url: string, daten: NeuerAdmin): Promise<{ id: string }> {
	const { email, name } = pruefe(daten);
	const hash = await hashePasswort(daten.passwort);
	const sql = postgres(url, { max: 1, onnotice: () => {} });
	try {
		return await sql.begin(async (tx) => {
			const [vorhanden] = await tx`select 1 as da from app.benutzer where email = ${email}`;
			if (vorhanden) throw existiert(email);
			const [b] = await tx<{ id: string }[]>`
				insert into app.benutzer (betrieb_id, email, name, passwort_hash, rolle_id)
				values (null, ${email}, ${name}, ${hash}, null)
				returning id`;
			await tx`insert into app.plattform_admins (benutzer_id) values (${b.id})`;
			return { id: b.id };
		});
	} catch (fehler) {
		// gleichzeitig angelegt (Eindeutigkeit der E-Mail): dieselbe Meldung
		if ((fehler as { code?: string }).code === '23505') throw existiert(email);
		throw fehler;
	} finally {
		await sql.end();
	}
}

export type Argumente = { email: string; name: string; passwortStdin: boolean };

/** Liest die Kommandozeile. Ein Passwort als Argument wird immer abgelehnt. */
export function leseArgumente(argv: readonly string[]): Argumente {
	if (argv.some((a) => /^--passwort(=|$)/.test(a))) {
		throw new AdminFehler(
			'Das Passwort wird nie als Argument übergeben (es stünde in der Shell-Historie und in der Prozessliste). ' +
				'Ohne Angabe fragt das Skript verdeckt danach; für Automatisierung --passwort-stdin verwenden.'
		);
	}
	let werte: { email?: string; name?: string; 'passwort-stdin'?: boolean };
	try {
		({ values: werte } = parseArgs({
			args: [...argv],
			options: {
				email: { type: 'string' },
				name: { type: 'string' },
				'passwort-stdin': { type: 'boolean', default: false }
			},
			strict: true,
			allowPositionals: false
		}));
	} catch {
		throw new AdminFehler(`Unbekanntes oder unvollständiges Argument. ${AUFRUF}`);
	}
	if (!werte.email) throw new AdminFehler(`--email fehlt. ${AUFRUF}`);
	if (!werte.name) throw new AdminFehler(`--name fehlt. ${AUFRUF}`);
	return { email: werte.email, name: werte.name, passwortStdin: werte['passwort-stdin'] === true };
}

/** Erste Zeile der Standardeingabe (ohne Zeilenende). */
async function leseStdin(): Promise<string> {
	const teile: Buffer[] = [];
	for await (const teil of process.stdin) teile.push(teil as Buffer);
	return Buffer.concat(teile).toString('utf8').split(/\r?\n/)[0];
}

/** Fragt verdeckt im Terminal (keine Anzeige der Zeichen). Die Frage geht nach stderr, stdout bleibt sauber. */
function frageVerdeckt(frage: string): Promise<string> {
	const ein = process.stdin;
	return new Promise((erfuellt, abgelehnt) => {
		let wert = '';
		const ende = (fehler?: Error) => {
			ein.removeListener('data', beiDaten);
			ein.setRawMode(false);
			ein.pause();
			process.stderr.write('\n');
			if (fehler) abgelehnt(fehler);
			else erfuellt(wert);
		};
		const beiDaten = (stueck: string) => {
			for (const zeichen of stueck) {
				if (zeichen === '\r' || zeichen === '\n' || zeichen === '\u0004') return ende();
				if (zeichen === '\u0003') return ende(new AdminFehler('Abgebrochen.'));
				if (zeichen === '\u007f' || zeichen === '\b') wert = [...wert].slice(0, -1).join('');
				else wert += zeichen;
			}
		};
		process.stderr.write(frage);
		ein.setEncoding('utf8');
		ein.setRawMode(true);
		ein.resume();
		ein.on('data', beiDaten);
	});
}

async function lesePasswort(passwortStdin: boolean): Promise<string> {
	if (passwortStdin) return leseStdin();
	if (!process.stdin.isTTY) {
		throw new AdminFehler(
			'Kein Terminal für die verdeckte Passwort-Eingabe. Für Automatisierung das Passwort über die ' +
				'Standardeingabe übergeben und --passwort-stdin angeben.'
		);
	}
	const erst = await frageVerdeckt(`Passwort (mindestens ${MIN_PASSWORT} Zeichen): `);
	if ([...erst].length < MIN_PASSWORT) {
		throw new AdminFehler(`Das Passwort muss mindestens ${MIN_PASSWORT} Zeichen lang sein.`);
	}
	const zweit = await frageVerdeckt('Passwort wiederholen: ');
	if (erst !== zweit) throw new AdminFehler('Die beiden Eingaben stimmen nicht überein – es wurde nichts geändert.');
	return erst;
}

async function hauptprogramm(): Promise<void> {
	const args = leseArgumente(process.argv.slice(2));
	ladeEnv();
	const url = urlAusUmgebung();
	const passwort = await lesePasswort(args.passwortStdin);
	await adminAnlegen(url, { email: args.email, name: args.name, passwort });
	console.log(
		`Plattform-Admin „${args.email.trim().toLowerCase()}“ angelegt. ` +
			'Die Zwei-Faktor-Anmeldung wird bei der ersten Anmeldung eingerichtet (Pflicht).'
	);
}

// Aufruf als Skript: `npm run admin:anlegen -- --email … --name …`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	hauptprogramm().catch((fehler) => {
		// Nur die Meldung, nie Objekte (die könnten Werte enthalten)
		console.error(fehler instanceof Error ? fehler.message : 'Unbekannter Fehler.');
		process.exit(1);
	});
}
