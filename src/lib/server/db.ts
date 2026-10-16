import postgres from 'postgres';

/**
 * DB-Zugriffsschicht. Drei Pools mit eingeschränkten Rollen (nie der Superuser `crm`):
 * - `crm_app` für alle fachlichen Abfragen (mit Mandantenkontext),
 * - `crm_admin` für die Plattform-Verwaltung,
 * - `crm_auth` nur für die Anmelde-/Sitzungsfunktionen (`systemAbfrage`); fachlicher Code läuft nie damit.
 *
 * Der Mandantenkontext steht in Sitzungsvariablen, die per `set_config(..., true)` nur innerhalb
 * derselben Transaktion gelten. Dadurch kann er nie in eine andere Anfrage der Verbindung durchsickern.
 */

export type Sql = postgres.Sql;
export type TransactionSql = postgres.TransactionSql;
export type Kontext = { betriebId: string; benutzerId: string };
export type DbUrls = { urlApp: string; urlAdmin: string; urlAuth: string };

type Pools = { app: Sql; admin: Sql; auth: Sql };

let konfiguration: DbUrls | null = null;
let pools: Pools | null = null;

/** Kleiner Zugriff auf Umgebungsvariablen – funktioniert in SvelteKit und unter reinem node/vitest. */
function umgebung(name: string): string | undefined {
	const wert = process.env[name];
	return wert === undefined || wert === '' ? undefined : wert;
}

function pflicht(name: string): string {
	const wert = umgebung(name);
	if (!wert) throw new Error(`Umgebungsvariable ${name} fehlt`);
	return wert;
}

/**
 * Bestimmt die Verbindungs-URLs: `DATABASE_URL_APP` / `DATABASE_URL_ADMIN`, sonst aus
 * `PGHOST`, `PGPORT`, `PGDATABASE` plus `CRM_APP_PASSWORT` / `CRM_ADMIN_PASSWORT` zusammengesetzt;
 * `DATABASE_URL_AUTH` bzw. `CRM_AUTH_PASSWORT` für die Rolle `crm_auth`.
 */
function urlsAusUmgebung(): DbUrls {
	const baue = (rolle: string, passwortName: string): string => {
		const host = pflicht('PGHOST');
		const port = umgebung('PGPORT') ?? '5432';
		const datenbank = pflicht('PGDATABASE');
		const passwort = pflicht(passwortName);
		return `postgres://${encodeURIComponent(rolle)}:${encodeURIComponent(passwort)}@${host}:${port}/${datenbank}`;
	};
	return {
		urlApp: umgebung('DATABASE_URL_APP') ?? baue('crm_app', 'CRM_APP_PASSWORT'),
		urlAdmin: umgebung('DATABASE_URL_ADMIN') ?? baue('crm_admin', 'CRM_ADMIN_PASSWORT'),
		urlAuth: umgebung('DATABASE_URL_AUTH') ?? baue('crm_auth', 'CRM_AUTH_PASSWORT')
	};
}

/**
 * Verweigert den Start, wenn eine Verbindung den Superuser `crm` benutzt (der umgeht Row Level Security
 * komplett). Die Meldung nennt nur den Namen der Variable, nie die URL oder das Passwort.
 */
function pruefeKeinSuperuser(url: string, variable: string): void {
	let benutzer: string;
	let ueberschrieben: string | null;
	try {
		const u = new URL(url);
		benutzer = decodeURIComponent(u.username);
		ueberschrieben = u.searchParams.get('user');
	} catch {
		throw new Error(`${variable} ist keine gültige Verbindungs-URL`);
	}
	if (benutzer === '') {
		throw new Error(`${variable} muss einen Benutzer enthalten (crm_app bzw. crm_admin)`);
	}
	for (const name of [benutzer, ueberschrieben]) {
		if (name !== null && name.trim().toLowerCase() === 'crm') {
			throw new Error(
				`${variable} darf nicht den Superuser "crm" verwenden – nur die eingeschränkten Rollen crm_app bzw. crm_admin`
			);
		}
	}
}

function pruefeUrls(urls: DbUrls): void {
	pruefeKeinSuperuser(urls.urlApp, 'DATABASE_URL_APP');
	pruefeKeinSuperuser(urls.urlAdmin, 'DATABASE_URL_ADMIN');
	pruefeKeinSuperuser(urls.urlAuth, 'DATABASE_URL_AUTH');
}

function oeffnePool(url: string): Sql {
	return postgres(url, { max: 10, onnotice: () => {} });
}

/** Wichtig für Tests: legt die Verbindungs-URLs explizit fest. Bereits offene Pools werden verworfen (siehe `schliesseDb`). */
export function initDb(urls: DbUrls): void {
	pruefeUrls(urls); // vor allem anderen: bei Fehlkonfiguration bleibt der bisherige Zustand unverändert
	if (pools) {
		// Alte Pools im Hintergrund schließen; Aufrufer, die sauber wechseln wollen, rufen vorher schliesseDb().
		void pools.app.end({ timeout: 5 }).catch(() => {});
		void pools.admin.end({ timeout: 5 }).catch(() => {});
		void pools.auth.end({ timeout: 5 }).catch(() => {});
		pools = null;
	}
	konfiguration = { ...urls };
}

/** Schließt beide Pools (z. B. beim Beenden oder am Testende). Ein späterer Zugriff öffnet sie neu. */
export async function schliesseDb(): Promise<void> {
	const alt = pools;
	pools = null;
	if (alt) {
		await Promise.all([
			alt.app.end({ timeout: 5 }),
			alt.admin.end({ timeout: 5 }),
			alt.auth.end({ timeout: 5 })
		]);
	}
}

function hole(): Pools {
	if (!pools) {
		if (!konfiguration) {
			const ausUmgebung = urlsAusUmgebung();
			pruefeUrls(ausUmgebung);
			konfiguration = ausUmgebung;
		}
		const urls = konfiguration;
		pools = {
			app: oeffnePool(urls.urlApp),
			admin: oeffnePool(urls.urlAdmin),
			auth: oeffnePool(urls.urlAuth)
		};
	}
	return pools;
}

function nichtLeer(wert: string, name: string): string {
	if (typeof wert !== 'string' || wert.trim() === '') throw new Error(`${name} darf nicht leer sein`);
	return wert;
}

/** Führt `fn` in einer Transaktion aus; die Kontextwerte gelten nur dort (`set_config(…, true)`). */
async function inTransaktion<T>(
	pool: Sql,
	kontext: Record<string, string>,
	fn: (sql: TransactionSql) => Promise<T>
): Promise<T> {
	return (await pool.begin(async (tx) => {
		for (const [name, wert] of Object.entries(kontext)) {
			await tx`select set_config(${name}, ${wert}, true)`;
		}
		return fn(tx);
	})) as T;
}

/** Fachliche Abfrage als `crm_app` im Kontext eines Betriebs und Benutzers (RLS greift). */
export async function mitBetrieb<T>(k: Kontext, fn: (sql: TransactionSql) => Promise<T>): Promise<T> {
	const kontext = {
		'app.betrieb_id': nichtLeer(k.betriebId, 'betriebId'),
		'app.benutzer_id': nichtLeer(k.benutzerId, 'benutzerId')
	};
	return inTransaktion(hole().app, kontext, fn);
}

/** Plattform-Verwaltung als `crm_admin`; `adminId` landet in `app.admin_id` (z. B. fürs Protokoll). */
export async function mitAdmin<T>(adminId: string, fn: (sql: TransactionSql) => Promise<T>): Promise<T> {
	return inTransaktion(hole().admin, { 'app.admin_id': nichtLeer(adminId, 'adminId') }, fn);
}

/**
 * Abfrage als `crm_auth` OHNE Kontext. Die Rolle hat keine Tabellenrechte und darf nur die SECURITY-DEFINER-Funktionen
 * für Anmeldung und Sitzungen aufrufen (nur dafür verwenden, nie für fachliche Abfragen).
 */
export async function systemAbfrage<T>(fn: (sql: TransactionSql) => Promise<T>): Promise<T> {
	return inTransaktion(hole().auth, {}, fn);
}
