import { chmodSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import * as OTPAuth from 'otpauth';
import { ladeEnv, urlAusUmgebung } from './migrate';
import { hashePasswort } from '../src/lib/server/auth/passwort';
import type { Vorlage } from '../src/lib/server/rechte';
import { totpUri } from '../src/lib/server/auth/totp';
import { leseZugangsdaten, pruefeSandbox, seedDev, sichereBeispielplanung } from './seed-dev';

/**
 * Persönliche Test-Zugänge für die Vorschau (Wunsch Can 16.10.2026: „verschiedene Testzugänge für verschiedene
 * Ansichten, damit Jamil und ich simulieren können“). Je Person ein Zugang pro Rolle im Testbetrieb „Bauwelt“
 * plus ein Plattform-Admin mit fest eingerichteter Zwei-Faktor-Anmeldung. Die Monteur-Zugänge bekommen Beispiel-
 * Einsätze für heute und morgen („Meine Einsätze heute“, Stufe 1b).
 *
 * Idempotent: Vorhandene Zugänge behalten ihr notiertes Passwort. Passwörter stehen nur in `.zugangsdaten-test`
 * (gitignored, Modus 600), nie in der Ausgabe. Aufruf: `npx tsx scripts/testzugaenge.ts` (nur Sandbox-Datenbank).
 */

const DATEI = fileURLToPath(new URL('../.zugangsdaten-test', import.meta.url));
const BETRIEB = 'Bauwelt';
const PERSONEN = [
	{ kurz: 'can', name: 'Can' },
	{ kurz: 'jamil', name: 'Jamil' }
];
const ROLLEN: { vorlage: Vorlage; titel: string }[] = [
	{ vorlage: 'chef', titel: 'Chef' },
	{ vorlage: 'buero', titel: 'Büro' },
	{ vorlage: 'monteur', titel: 'Monteur' }
];

const neuesPasswort = () => randomBytes(15).toString('base64url'); // 20 Zeichen

async function main(): Promise<void> {
	ladeEnv();
	const grund = pruefeSandbox(process.env, process.argv.slice(2));
	if (grund) throw new Error(grund);
	const url = urlAusUmgebung();
	await seedDev(url); // Betrieb, Rollen und Beispielkunden sicherstellen

	const daten = leseZugangsdaten(DATEI);
	const sql = postgres(url, { max: 1, onnotice: () => {} });
	try {
		await sql.begin(async (tx) => {
			const [betrieb] = await tx<{ id: string }[]>`
				select id from app.betriebe where name = ${BETRIEB} order by angelegt limit 1`;
			const rolleId = async (vorlage: Vorlage) =>
				(await tx<{ id: string }[]>`
					select id from app.rollen where betrieb_id = ${betrieb.id} and vorlage = ${vorlage} order by name limit 1`)[0]
					.id;

			const sichere = async (email: string, name: string, betriebId: string | null, rolle: string | null) => {
				const [da] = await tx<{ id: string }[]>`select id from app.benutzer where email = ${email}`;
				if (da && daten.has(email)) return da.id;
				const passwort = daten.get(email) ?? neuesPasswort();
				const hash = await hashePasswort(passwort);
				daten.set(email, passwort);
				if (da) {
					await tx`update app.benutzer set passwort_hash = ${hash} where id = ${da.id}`;
					return da.id;
				}
				const [z] = await tx<{ id: string }[]>`
					insert into app.benutzer (betrieb_id, email, name, passwort_hash, rolle_id)
					values (${betriebId}, ${email}, ${name}, ${hash}, ${rolle}) returning id`;
				return z.id;
			};

			for (const p of PERSONEN) {
				for (const r of ROLLEN) {
					await sichere(`${p.kurz}.${r.vorlage}@bauwelt.test`, `${p.name} (Test) – ${r.titel}`, betrieb.id, await rolleId(r.vorlage));
				}
				const adminEmail = `${p.kurz}.admin@crm.test`;
				const adminId = await sichere(adminEmail, `${p.name} (Test) – Plattform-Admin`, null, null);
				await tx`insert into app.plattform_admins (benutzer_id) values (${adminId}) on conflict do nothing`;
				const schluessel = `totp:${adminEmail}`;
				const [t] = await tx<{ totp_aktiv: boolean; totp_geheim: string | null }[]>`
					select totp_aktiv, totp_geheim from app.benutzer where id = ${adminId}`;
				if (!t.totp_aktiv || t.totp_geheim !== daten.get(schluessel)) {
					const geheimnis = new OTPAuth.Secret({ size: 20 }).base32;
					await tx`
						update app.benutzer
						set totp_geheim = ${geheimnis}, totp_aktiv = true, totp_letzter_schritt = null,
							totp_fehlversuche = 0, totp_gesperrt_bis = null, totp_sperr_stufe = 0
						where id = ${adminId}`;
					daten.set(schluessel, geheimnis);
				}
				daten.set(`totp-uri:${adminEmail}`, totpUri(daten.get(schluessel)!, adminEmail));
			}
			// Beispiel-Einsätze auch für die eben angelegten Monteur-Zugänge (idempotent)
			await sichereBeispielplanung(tx, betrieb.id);
		});
	} finally {
		await sql.end();
	}
	const kopf = [
		'# Persönliche Test-Zugänge der CRM-Vorschau – nicht committen. Erzeugt von scripts/testzugaenge.ts.',
		'# Format: Schlüssel<TAB>Wert. Chef-Zugänge richten die Zwei-Faktor-Anmeldung bei der ersten Anmeldung ein.'
	];
	writeFileSync(DATEI, [...kopf, ...[...daten].map(([k, v]) => `${k}\t${v}`), ''].join('\n'), { mode: 0o600 });
	chmodSync(DATEI, 0o600);
	console.log(`Test-Zugänge bereit (${PERSONEN.length * (ROLLEN.length + 1)}): ${DATEI}`);
}

main().catch((fehler) => {
	console.error(fehler instanceof Error ? fehler.message : fehler);
	process.exit(1);
});
