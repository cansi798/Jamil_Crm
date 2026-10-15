import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import postgres from 'postgres';
import * as OTPAuth from 'otpauth';
import { ladeEnv, urlAusUmgebung } from './migrate';
import { hashePasswort, pruefePasswort } from '../src/lib/server/auth/passwort';
import { VORLAGEN, VORLAGEN_NAMEN, type Vorlage } from '../src/lib/server/rechte';
import { totpUri } from '../src/lib/server/auth/totp';

/**
 * Entwicklungsdaten (nur für die lokale Sandbox, nie für Produktion): Betrieb „Bauwelt“ (Tarif test) mit den
 * drei Rollen aus den Vorlagen, je ein Benutzer Chef/Büro/Monteur, ein Plattform-Admin und 5 Beispielkunden.
 *
 * Idempotent: Was es schon gibt (Betrieb nach Name, Rolle nach Vorlage, Benutzer nach E-Mail, Kunde nach Name),
 * wird nicht noch einmal angelegt und nicht verändert. Passwörter sind zufällig und stehen nur in der Datei
 * `.zugangsdaten-dev` (gitignored, Modus 600) – nie in der Ausgabe. Ein schon notiertes Passwort bleibt beim
 * nächsten Lauf gleich (passt der Hash nicht mehr dazu, wird er wieder auf das notierte Passwort gesetzt); fehlt es
 * in der Datei, bekommt der Benutzer ein neues.
 *
 * Läuft als Superuser `crm` (wie Migrationen): `crm_app` darf keine Benutzer anlegen (Carry T9).
 *
 * Zwei-Faktor: Der Chef richtet sie bei der ersten Anmeldung selbst ein (Pflicht wegen Recht „einstellungen“).
 * Für den Plattform-Admin legt der Seed das TOTP-Geheimnis gleich fest und notiert es (samt otpauth-URI für die
 * Authenticator-App) in der Zugangsdatei – so kann sich das Team als Admin anmelden und der E2E-Test mit einem
 * echten Code arbeiten. Ein Code ist trotzdem bei jeder Admin-Anmeldung nötig.
 *
 * Aufruf: `npm run seed:dev` (im Container crm-dev).
 */

export const STANDARD_DATEI = fileURLToPath(new URL('../.zugangsdaten-dev', import.meta.url));

const BETRIEB = 'Bauwelt';

const BENUTZER: { email: string; name: string; vorlage: Vorlage }[] = [
	{ email: 'chef@bauwelt.test', name: 'Jürgen Weiß', vorlage: 'chef' },
	{ email: 'buero@bauwelt.test', name: 'Sabine Schäfer', vorlage: 'buero' },
	{ email: 'monteur@bauwelt.test', name: 'Murat Öztürk', vorlage: 'monteur' }
];
const ADMIN = { email: 'admin@crm.test', name: 'Plattform-Admin' };

type Kunde = {
	art: 'privat' | 'firma';
	firma?: string;
	anrede?: string;
	vorname?: string;
	nachname?: string;
	email?: string;
	telefon?: string;
	strasse?: string;
	plz?: string;
	ort?: string;
	notiz?: string;
};

const KUNDEN: Kunde[] = [
	{
		art: 'privat',
		anrede: 'Herr',
		vorname: 'Jörg',
		nachname: 'Größer',
		telefon: '089 1234567',
		strasse: 'Hauptstraße 5',
		plz: '80331',
		ort: 'München'
	},
	{
		art: 'privat',
		anrede: 'Frau',
		vorname: 'Ursula',
		nachname: 'Weißenböck',
		email: 'ursula.weissenboeck@example.org',
		strasse: 'Königsweg 12',
		plz: '90402',
		ort: 'Nürnberg',
		notiz: 'Schlüssel liegt bei der Nachbarin (Erdgeschoss links).'
	},
	{
		art: 'firma',
		firma: 'Bäckerei Krümel GmbH',
		vorname: 'Özlem',
		nachname: 'Yılmaz',
		telefon: '0221 987654',
		strasse: 'Domstraße 3',
		plz: '50668',
		ort: 'Köln'
	},
	{
		art: 'firma',
		firma: 'Gärtnerei Grünfeld',
		email: 'info@gaertnerei-gruenfeld.example',
		strasse: 'Am Rübenacker 7',
		plz: '40210',
		ort: 'Düsseldorf'
	},
	{
		art: 'privat',
		anrede: 'Herr',
		vorname: 'Björn',
		nachname: 'Schröder',
		telefon: '0451 445566',
		strasse: 'Fischergrube 21',
		plz: '23552',
		ort: 'Lübeck'
	}
];

/** Liest die Zugangsdatei (Schlüssel TAB Wert je Zeile, # = Kommentar). Fehlt sie, ist das Ergebnis leer. */
export function leseZugangsdaten(datei: string): Map<string, string> {
	const daten = new Map<string, string>();
	if (!existsSync(datei)) return daten;
	for (const zeile of readFileSync(datei, 'utf8').split('\n')) {
		if (zeile.startsWith('#') || !zeile.includes('\t')) continue;
		const [schluessel, ...rest] = zeile.split('\t');
		daten.set(schluessel.trim(), rest.join('\t').trim());
	}
	return daten;
}

function schreibeZugangsdaten(datei: string, daten: Map<string, string>): void {
	const kopf = [
		'# Zugangsdaten der lokalen Entwicklungsumgebung (CRM System) – nicht weitergeben, nicht committen.',
		'# Erzeugt von scripts/seed-dev.ts. Format: Schlüssel<TAB>Wert. Vorschau: http://127.0.0.1:8300',
		'# chef@bauwelt.test richtet die Zwei-Faktor-Anmeldung bei der ersten Anmeldung ein.',
		'# admin@crm.test: Code aus dem Geheimnis „totp:admin@crm.test“ (otpauth-URI für die Authenticator-App).'
	];
	const zeilen = [...daten].map(([k, v]) => `${k}\t${v}`);
	writeFileSync(datei, [...kopf, ...zeilen, ''].join('\n'), { mode: 0o600 });
	chmodSync(datei, 0o600); // bestehende Datei behält sonst ihren alten Modus
}

const neuesPasswort = () => randomBytes(15).toString('base64url'); // 20 Zeichen

type Tx = postgres.TransactionSql;

/** Benutzer anlegen bzw. Passwort nachziehen, wenn es nicht (mehr) in der Datei steht. Liefert die ID. */
async function sichereBenutzer(
	tx: Tx,
	daten: Map<string, string>,
	b: { email: string; name: string; betriebId: string | null; rolleId: string | null }
): Promise<{ id: string; neu: boolean }> {
	const [vorhanden] = await tx<{ id: string; passwort_hash: string }[]>`
		select id, passwort_hash from app.benutzer where email = ${b.email}`;
	const notiert = daten.get(b.email);
	if (vorhanden && notiert && (await pruefePasswort(vorhanden.passwort_hash, notiert))) {
		return { id: vorhanden.id, neu: false };
	}
	// Neu, oder notiertes Passwort fehlt bzw. passt nicht mehr (z. B. in der Oberfläche geändert): Datei gilt.
	const passwort = notiert ?? neuesPasswort();
	const hash = await hashePasswort(passwort);
	daten.set(b.email, passwort);
	if (vorhanden) {
		await tx`update app.benutzer set passwort_hash = ${hash} where id = ${vorhanden.id}`;
		return { id: vorhanden.id, neu: false };
	}
	const [z] = await tx<{ id: string }[]>`
		insert into app.benutzer (betrieb_id, email, name, passwort_hash, rolle_id)
		values (${b.betriebId}, ${b.email}, ${b.name}, ${hash}, ${b.rolleId})
		returning id`;
	return { id: z.id, neu: true };
}

export type SeedErgebnis = { neueBenutzer: number; neueKunden: number };

export async function seedDev(url: string, opts: { datei?: string } = {}): Promise<SeedErgebnis> {
	const datei = opts.datei ?? STANDARD_DATEI;
	const daten = leseZugangsdaten(datei);
	const sql = postgres(url, { max: 1, onnotice: () => {} });
	let ergebnis: SeedErgebnis;
	try {
		ergebnis = await sql.begin(async (tx) => {
			const [tarif] = await tx<{ id: string }[]>`select id from app.tarife where schluessel = 'test'`;
			if (!tarif) throw new Error('Tarif „test“ fehlt – bitte zuerst `npm run migrate` ausführen.');

			// Betrieb
			let [betrieb] = await tx<{ id: string }[]>`
				select id from app.betriebe where name = ${BETRIEB} order by angelegt limit 1`;
			if (!betrieb) {
				[betrieb] = await tx<{ id: string }[]>`
					insert into app.betriebe (name, tarif_id, abo_status) values (${BETRIEB}, ${tarif.id}, 'test')
					returning id`;
			}

			// Rollen aus den Vorlagen
			const rollen = new Map<Vorlage, string>();
			for (const vorlage of Object.keys(VORLAGEN) as Vorlage[]) {
				let [rolle] = await tx<{ id: string }[]>`
					select id from app.rollen where betrieb_id = ${betrieb.id} and vorlage = ${vorlage}
					order by name limit 1`;
				if (!rolle) {
					[rolle] = await tx<{ id: string }[]>`
						insert into app.rollen (betrieb_id, name, rechte, vorlage)
						values (${betrieb.id}, ${VORLAGEN_NAMEN[vorlage]}, ${[...VORLAGEN[vorlage]]}, ${vorlage})
						returning id`;
				}
				rollen.set(vorlage, rolle.id);
			}

			// Benutzer des Betriebs
			let neueBenutzer = 0;
			let chefId = '';
			for (const b of BENUTZER) {
				const r = await sichereBenutzer(tx, daten, {
					email: b.email,
					name: b.name,
					betriebId: betrieb.id,
					rolleId: rollen.get(b.vorlage)!
				});
				if (r.neu) neueBenutzer++;
				if (b.vorlage === 'chef') chefId = r.id;
			}

			// Plattform-Admin (ohne Betrieb) mit fest eingerichteter Zwei-Faktor-Anmeldung
			const admin = await sichereBenutzer(tx, daten, { ...ADMIN, betriebId: null, rolleId: null });
			if (admin.neu) neueBenutzer++;
			await tx`insert into app.plattform_admins (benutzer_id) values (${admin.id}) on conflict do nothing`;
			const totpSchluessel = `totp:${ADMIN.email}`;
			const [totp] = await tx<{ totp_aktiv: boolean; totp_geheim: string | null }[]>`
				select totp_aktiv, totp_geheim from app.benutzer where id = ${admin.id}`;
			if (!totp.totp_aktiv || totp.totp_geheim !== daten.get(totpSchluessel)) {
				const geheimnis = new OTPAuth.Secret({ size: 20 }).base32;
				await tx`
					update app.benutzer
					set totp_geheim = ${geheimnis}, totp_aktiv = true, totp_letzter_schritt = null,
						totp_fehlversuche = 0, totp_gesperrt_bis = null, totp_sperr_stufe = 0
					where id = ${admin.id}`;
				daten.set(totpSchluessel, geheimnis);
			}
			daten.set(`totp-uri:${ADMIN.email}`, totpUri(daten.get(totpSchluessel)!, ADMIN.email));

			// Beispielkunden (Protokoll-Einträge im Namen des Chefs)
			await tx`select set_config('app.betrieb_id', ${betrieb.id}, true), set_config('app.benutzer_id', ${chefId}, true)`;
			let neueKunden = 0;
			for (const k of KUNDEN) {
				const [da] = await tx`
					select 1 from app.kunden
					where betrieb_id = ${betrieb.id} and art = ${k.art}
						and coalesce(firma, '') = ${k.firma ?? ''} and coalesce(nachname, '') = ${k.nachname ?? ''}
						and coalesce(vorname, '') = ${k.vorname ?? ''}`;
				if (da) continue;
				await tx`
					insert into app.kunden (betrieb_id, art, firma, anrede, vorname, nachname, email, telefon, strasse, plz, ort, notiz)
					values (${betrieb.id}, ${k.art}, ${k.firma ?? null}, ${k.anrede ?? null}, ${k.vorname ?? null},
						${k.nachname ?? null}, ${k.email ?? null}, ${k.telefon ?? null}, ${k.strasse ?? null},
						${k.plz ?? null}, ${k.ort ?? null}, ${k.notiz ?? null})`;
				neueKunden++;
			}
			return { neueBenutzer, neueKunden };
		});
	} finally {
		await sql.end();
	}
	// Erst nach erfolgreicher Transaktion schreiben: Datei und Datenbank passen immer zusammen.
	schreibeZugangsdaten(datei, daten);
	console.log(
		`Entwicklungsdaten bereit: Betrieb „${BETRIEB}“, ${BENUTZER.length + 1} Benutzer ` +
			`(${ergebnis.neueBenutzer} neu), ${KUNDEN.length} Beispielkunden (${ergebnis.neueKunden} neu). ` +
			`Zugangsdaten: ${datei}`
	);
	return ergebnis;
}

// Aufruf als Skript: `npm run seed:dev`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	ladeEnv();
	seedDev(urlAusUmgebung()).catch((fehler) => {
		console.error(fehler instanceof Error ? fehler.message : fehler);
		process.exit(1);
	});
}
