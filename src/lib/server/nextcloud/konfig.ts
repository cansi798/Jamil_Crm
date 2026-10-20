/**
 * Nextcloud-Anbindung (optional, Entscheidung Can msg 2748: „CRM bleibt separat und wird in Nextcloud eingebunden“).
 *
 * Alles wird über Umgebungsvariablen eingeschaltet (installation/.env, Abschnitt „Nextcloud“). Ohne `NEXTCLOUD_URL`
 * ist die Anbindung komplett aus – keine Schaltfläche, kein Hintergrund-Dienst, keine Verbindung nach außen.
 * Geheimnisse (OIDC-Client-Secret, App-Passwort des Technik-Kontos) stehen nur in der Umgebung, nie in der Datenbank,
 * nie in Logs.
 */

export type NextcloudKonfig = {
	/** Öffentliche Adresse (Browser, Aussteller „iss“ im ID-Token), ohne Schrägstrich am Ende. */
	url: string;
	/** Adresse, unter der der CRM-Server Nextcloud erreicht (Standard: `url`). */
	internUrl: string;
	/** Betrieb, zu dem die Anbindung gehört (leer: der einzige Betrieb der Installation). */
	betrieb: string | null;
	anmeldung: null | {
		clientId: string;
		clientSecret: string;
		/** Nextcloud erzwingt 2FA → keine zweite Abfrage im CRM. Sonst gilt die CRM-eigene Zwei-Faktor-Regel. */
		zweiFaktorVertrauen: boolean;
		/** Erste Anmeldung: mit bestätigter E-Mail an vorhandenen CRM-Benutzer koppeln (nie neu anlegen). */
		perEmail: boolean;
	};
	technik: null | { benutzer: string; token: string };
	kalender: boolean;
	kontakte: null | { gruppe: string | null };
	dateien: null | { ordner: string };
	talk: boolean;
	/** Abstand des Hintergrund-Abgleichs in Minuten. */
	intervallMinuten: number;
};

const ja = (w: string | undefined) => /^(ja|1|true|an)$/i.test((w ?? '').trim());
const wert = (env: Env, name: string) => {
	const w = env[name]?.trim();
	return w ? w : null;
};
type Env = Record<string, string | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * https ist Pflicht. http nur für `localhost`/`127.0.0.1` (Tests) – und für die interne Adresse, die nur im
 * Docker-Netz des Servers verwendet wird (dort verlässt nichts den Rechner).
 */
export function pruefeUrl(roh: string, intern: boolean): string {
	let u: URL;
	try {
		u = new URL(roh);
	} catch {
		throw new Error('NEXTCLOUD_URL ist keine gültige Adresse');
	}
	const lokal = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
	if (u.protocol !== 'https:' && !(u.protocol === 'http:' && (lokal || intern))) {
		throw new Error('Nextcloud muss über https:// erreichbar sein');
	}
	if (u.username || u.password || u.search || u.hash) throw new Error('Nextcloud-Adresse ohne Zugangsdaten/Parameter angeben');
	return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}

/** Liest die Konfiguration; `null` = Anbindung aus. Wirft bei widersprüchlichen Angaben (lauter Fehler beim Start). */
export function leseKonfig(env: Env = process.env): NextcloudKonfig | null {
	const roh = wert(env, 'NEXTCLOUD_URL');
	if (!roh) return null;
	const url = pruefeUrl(roh, false);
	const internRoh = wert(env, 'NEXTCLOUD_INTERN_URL');
	const internUrl = internRoh ? pruefeUrl(internRoh, true) : url;
	const betrieb = wert(env, 'NEXTCLOUD_BETRIEB');
	if (betrieb && !UUID.test(betrieb)) throw new Error('NEXTCLOUD_BETRIEB muss die ID (UUID) eines Betriebs sein');

	let anmeldung: NextcloudKonfig['anmeldung'] = null;
	if (ja(env.NEXTCLOUD_ANMELDUNG)) {
		const clientId = wert(env, 'NEXTCLOUD_OIDC_CLIENT_ID');
		const clientSecret = wert(env, 'NEXTCLOUD_OIDC_CLIENT_SECRET');
		if (!clientId || !clientSecret) throw new Error('NEXTCLOUD_ANMELDUNG=ja braucht NEXTCLOUD_OIDC_CLIENT_ID und NEXTCLOUD_OIDC_CLIENT_SECRET');
		anmeldung = {
			clientId,
			clientSecret,
			zweiFaktorVertrauen: ja(env.NEXTCLOUD_2FA_VERTRAUEN),
			perEmail: env.NEXTCLOUD_PER_EMAIL_VERKNUEPFEN === undefined || env.NEXTCLOUD_PER_EMAIL_VERKNUEPFEN.trim() === ''
				? true
				: ja(env.NEXTCLOUD_PER_EMAIL_VERKNUEPFEN)
		};
	}

	const kalender = ja(env.NEXTCLOUD_KALENDER);
	const kontakte = ja(env.NEXTCLOUD_KONTAKTE);
	const dateien = ja(env.NEXTCLOUD_DATEIEN);
	const talk = ja(env.NEXTCLOUD_TALK);
	let technik: NextcloudKonfig['technik'] = null;
	const tb = wert(env, 'NEXTCLOUD_TECHNIK_BENUTZER');
	const tt = wert(env, 'NEXTCLOUD_TECHNIK_APP_TOKEN');
	if (tb && tt) technik = { benutzer: tb, token: tt };
	if ((kalender || kontakte || dateien || talk) && !technik) {
		throw new Error('Kalender/Kontakte/Dateien/Talk brauchen NEXTCLOUD_TECHNIK_BENUTZER und NEXTCLOUD_TECHNIK_APP_TOKEN');
	}
	if (tb && !/^[A-Za-z0-9 _.@-]{1,64}$/.test(tb)) throw new Error('NEXTCLOUD_TECHNIK_BENUTZER enthält unerlaubte Zeichen');

	const ordner = (wert(env, 'NEXTCLOUD_DATEIEN_ORDNER') ?? 'CRM').replace(/^\/+|\/+$/g, '');
	if (!ordner || ordner.split('/').some((t) => t === '' || t === '.' || t === '..')) {
		throw new Error('NEXTCLOUD_DATEIEN_ORDNER ist ungültig');
	}
	const minuten = Number(wert(env, 'NEXTCLOUD_ABGLEICH_MINUTEN') ?? '5');
	return {
		url,
		internUrl,
		betrieb,
		anmeldung,
		technik,
		kalender,
		kontakte: kontakte ? { gruppe: wert(env, 'NEXTCLOUD_KONTAKTE_GRUPPE') } : null,
		dateien: dateien ? { ordner } : null,
		talk,
		intervallMinuten: Number.isFinite(minuten) && minuten >= 1 && minuten <= 1440 ? Math.floor(minuten) : 5
	};
}

let zwischen: { konfig: NextcloudKonfig | null } | null = null;

/** Konfiguration des laufenden Prozesses (einmal gelesen). */
export function nextcloud(): NextcloudKonfig | null {
	if (!zwischen) zwischen = { konfig: leseKonfig() };
	return zwischen.konfig;
}

/** Nur Tests: Konfiguration setzen bzw. (null) zurück auf Umgebung. */
export function setzeNextcloudKonfig(k: NextcloudKonfig | null | undefined): void {
	zwischen = k === undefined ? null : { konfig: k };
}
