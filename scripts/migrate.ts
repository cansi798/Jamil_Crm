import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import postgres from 'postgres';

const MIGRATIONS_VERZEICHNIS = fileURLToPath(new URL('../db/migrations/', import.meta.url));
const ENV_DATEI = fileURLToPath(new URL('../.env', import.meta.url));
// Beliebige feste Zahl für den Advisory Lock, damit nie zwei Migrationen gleichzeitig laufen.
const SPERR_SCHLUESSEL = 748_113_001;

export type MigrateOptionen = {
	/** Verzeichnis mit den *.sql-Dateien (Standard: db/migrations). */
	verzeichnis?: string;
	/** Passwort der Rolle crm_app (Standard: Umgebungsvariable CRM_APP_PASSWORT). */
	appPasswort?: string;
	/** Passwort der Rolle crm_admin (Standard: Umgebungsvariable CRM_ADMIN_PASSWORT). */
	adminPasswort?: string;
};

/** Lädt `.env` im Projektverzeichnis (falls vorhanden); bereits gesetzte Variablen bleiben unverändert. */
export function ladeEnv(): void {
	if (existsSync(ENV_DATEI)) process.loadEnvFile(ENV_DATEI);
}

/**
 * Wendet alle noch nicht angewendeten Migrationen an (sortiert nach Dateiname, je Datei eine Transaktion)
 * und liefert die Namen der in diesem Lauf angewendeten Dateien.
 * Die Passwörter der Rollen stehen nie in den SQL-Dateien, sondern werden hier gesetzt.
 */
export async function migrate(url: string, opts: MigrateOptionen = {}): Promise<string[]> {
	ladeEnv();
	const verzeichnis = opts.verzeichnis ?? MIGRATIONS_VERZEICHNIS;
	const dateien = readdirSync(verzeichnis)
		.filter((name) => name.endsWith('.sql'))
		.sort();

	const sql = postgres(url, { max: 1, onnotice: () => {} });
	const angewendet: string[] = [];
	try {
		await sql.unsafe('select pg_advisory_lock($1)', [SPERR_SCHLUESSEL]);
		await sql`
			create table if not exists schema_migrationen (
				name text primary key,
				angewendet timestamptz not null default now()
			)`;
		const erledigt = new Set(
			(await sql<{ name: string }[]>`select name from schema_migrationen`).map((z) => z.name)
		);
		for (const name of dateien) {
			if (erledigt.has(name)) continue;
			const inhalt = readFileSync(`${verzeichnis}/${name}`, 'utf8');
			await sql.begin(async (tx) => {
				await tx.unsafe(inhalt);
				await tx`insert into schema_migrationen (name) values (${name})`;
			});
			angewendet.push(name);
		}
		await setzePasswoerter(sql, {
			crm_app: opts.appPasswort ?? process.env.CRM_APP_PASSWORT,
			crm_admin: opts.adminPasswort ?? process.env.CRM_ADMIN_PASSWORT
		});
	} finally {
		await sql.unsafe('select pg_advisory_unlock($1)', [SPERR_SCHLUESSEL]).catch(() => {});
		await sql.end();
	}
	return angewendet;
}

/** Setzt die Passwörter der (clusterweiten) Rollen. Rollen, die es nicht gibt, werden übersprungen. */
async function setzePasswoerter(
	sql: postgres.Sql,
	passwoerter: Record<string, string | undefined>
): Promise<void> {
	for (const [rolle, passwort] of Object.entries(passwoerter)) {
		if (!passwort) continue;
		const [vorhanden] = await sql`select 1 as da from pg_roles where rolname = ${rolle}`;
		if (!vorhanden) continue;
		// ALTER ROLE nimmt keine Bind-Parameter; format() mit %I/%L quotet Name und Wert sicher.
		const [{ befehl }] = await sql<{ befehl: string }[]>`
			select format('alter role %I password %L', ${rolle}::text, ${passwort}::text) as befehl`;
		await sql.unsafe(befehl);
	}
}

function urlAusUmgebung(): string {
	const { PGHOST = 'localhost', PGPORT = '5432', PGUSER, PGDATABASE, PGPASSWORD } = process.env;
	if (!PGUSER || !PGDATABASE || !PGPASSWORD) {
		throw new Error('PGUSER, PGDATABASE und PGPASSWORD müssen gesetzt sein.');
	}
	return `postgres://${encodeURIComponent(PGUSER)}:${encodeURIComponent(PGPASSWORD)}@${PGHOST}:${PGPORT}/${PGDATABASE}`;
}

// Aufruf als Skript: `npm run migrate`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	ladeEnv();
	migrate(process.argv[2] ?? urlAusUmgebung())
		.then((namen) => {
			console.log(namen.length ? `Angewendet: ${namen.join(', ')}` : 'Keine neuen Migrationen.');
		})
		.catch((fehler) => {
			console.error(fehler instanceof Error ? fehler.message : fehler);
			process.exit(1);
		});
}
