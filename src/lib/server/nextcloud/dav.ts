import { createHash } from 'node:crypto';
import type { NextcloudKonfig } from './konfig';
import { erwarte, ncAnfrage, NextcloudFehler, pfadTeil } from './http';

/**
 * CalDAV, CardDAV, WebDAV und Talk – alles im Namen des Technik-Kontos (NEXTCLOUD_TECHNIK_BENUTZER, App-Passwort).
 * Prinzip der geringsten Rechte: Das Technik-Konto ist ein normales Nextcloud-Konto ohne Admin-Rechte. Es legt eigene
 * Kalender/Adressbücher an und TEILT sie nur lesend mit den Personen bzw. der Gruppe; in fremde Kalender, Adressbücher
 * oder Dateien schreibt es nie. Dateien legt es nur in seinem Ordner (z. B. einem Gruppenordner „CRM“) ab.
 */

const xml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const XML = { 'content-type': 'application/xml; charset=utf-8' };

const tech = (k: NextcloudKonfig) => {
	if (!k.technik) throw new NextcloudFehler('Technik-Konto fehlt', 0);
	return pfadTeil(k.technik.benutzer);
};

/** Stabiler, nicht sprechender Kalender-Name je Nextcloud-Person. */
export const kalenderUri = (ncBenutzer: string) =>
	`crm-einsaetze-${createHash('sha256').update(ncBenutzer).digest('hex').slice(0, 16)}`;
export const ADRESSBUCH_URI = 'crm-kunden';

export const kalenderPfad = (k: NextcloudKonfig, uri: string) => `/remote.php/dav/calendars/${tech(k)}/${pfadTeil(uri)}/`;
export const adressbuchPfad = (k: NextcloudKonfig) => `/remote.php/dav/addressbooks/users/${tech(k)}/${ADRESSBUCH_URI}/`;
export const dateiPfad = (k: NextcloudKonfig, teile: string[]) =>
	`/remote.php/dav/files/${tech(k)}/${teile.map(pfadTeil).join('/')}`;

/** Kalender anlegen (falls neu) und mit der Person lesend teilen. Beides ist wiederholbar. */
export async function sichereKalender(k: NextcloudKonfig, ncBenutzer: string, anzeige: string): Promise<string> {
	const pfad = kalenderPfad(k, kalenderUri(ncBenutzer));
	const neu = await ncAnfrage(k, pfad, {
		methode: 'MKCALENDAR',
		kopf: XML,
		koerper: `<?xml version="1.0" encoding="utf-8"?>
<c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/">
 <d:set><d:prop>
  <d:displayname>${xml(anzeige)}</d:displayname>
  <a:calendar-color>#0079A6</a:calendar-color>
  <c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>
 </d:prop></d:set>
</c:mkcalendar>`
	});
	erwarte(neu, [201, 405], 'Kalender anlegen');
	await teile(k, pfad, `principal:principals/users/${encodeURIComponent(ncBenutzer)}`, 'Kalender teilen');
	return pfad;
}

/** Adressbuch „CRM Kunden“ anlegen (falls neu) und – falls eingestellt – mit einer Gruppe lesend teilen. */
export async function sichereAdressbuch(k: NextcloudKonfig, gruppe: string | null): Promise<string> {
	const pfad = adressbuchPfad(k);
	const neu = await ncAnfrage(k, pfad, {
		methode: 'MKCOL',
		kopf: XML,
		koerper: `<?xml version="1.0" encoding="utf-8"?>
<d:mkcol xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
 <d:set><d:prop>
  <d:resourcetype><d:collection/><card:addressbook/></d:resourcetype>
  <d:displayname>CRM Kunden</d:displayname>
 </d:prop></d:set>
</d:mkcol>`
	});
	erwarte(neu, [201, 405], 'Adressbuch anlegen');
	if (gruppe) await teile(k, pfad, `principal:principals/groups/${encodeURIComponent(gruppe)}`, 'Adressbuch teilen');
	return pfad;
}

/** Nextcloud-Freigabe einer DAV-Sammlung (nur lesen: ohne <o:read-write/>). */
async function teile(k: NextcloudKonfig, pfad: string, principal: string, was: string): Promise<void> {
	const a = await ncAnfrage(k, pfad, {
		methode: 'POST',
		kopf: XML,
		koerper: `<?xml version="1.0" encoding="utf-8"?>
<o:share xmlns:d="DAV:" xmlns:o="http://owncloud.org/ns">
 <o:set><d:href>${xml(principal)}</d:href></o:set>
</o:share>`
	});
	erwarte(a, [200, 204], was);
}

/** Eintrag schreiben (Termin .ics oder Kontakt .vcf). Gleiche UID = gleiche Datei = Überschreiben. */
export async function schreibeEintrag(k: NextcloudKonfig, sammlung: string, name: string, inhalt: string, typ: string): Promise<string> {
	const pfad = `${sammlung}${pfadTeil(name)}`;
	erwarte(
		await ncAnfrage(k, pfad, { methode: 'PUT', kopf: { 'content-type': `${typ}; charset=utf-8` }, koerper: inhalt }),
		[200, 201, 204],
		'Eintrag schreiben'
	);
	return pfad;
}

/** Löschen; schon weg (404) ist auch in Ordnung. */
export async function loesche(k: NextcloudKonfig, pfad: string): Promise<void> {
	erwarte(await ncAnfrage(k, pfad, { methode: 'DELETE' }), [200, 204, 404], 'Löschen');
}

/** Ordnerkette anlegen (jede Ebene; vorhandene sind in Ordnung). Der erste Teil (Basisordner) muss existieren. */
export async function sichereOrdner(k: NextcloudKonfig, teile: string[]): Promise<void> {
	const basis = await ncAnfrage(k, dateiPfad(k, teile.slice(0, 1)), { methode: 'PROPFIND', kopf: { depth: '0' } });
	if (basis.status === 404) {
		throw new NextcloudFehler(`Ordner „${teile[0]}“ fehlt beim Technik-Konto (Gruppenordner anlegen und freigeben)`, 404);
	}
	erwarte(basis, [207], 'Basisordner prüfen');
	for (let i = 2; i <= teile.length; i++) {
		erwarte(await ncAnfrage(k, dateiPfad(k, teile.slice(0, i)), { methode: 'MKCOL' }), [201, 405], 'Ordner anlegen');
	}
}

export async function schreibeDatei(k: NextcloudKonfig, teile: string[], inhalt: Uint8Array, typ: string): Promise<string> {
	await sichereOrdner(k, teile.slice(0, -1));
	const pfad = dateiPfad(k, teile);
	erwarte(
		await ncAnfrage(k, pfad, { methode: 'PUT', kopf: { 'content-type': typ }, koerper: inhalt, zeitMs: 60_000 }),
		[200, 201, 204],
		'Datei hochladen'
	);
	return pfad;
}

// ——— Talk (Benachrichtigung als Chat-Nachricht des Technik-Kontos an die Person) ———

const OCS = { 'ocs-apirequest': 'true', accept: 'application/json' };
const raumZwischen = new Map<string, string>();

export async function talkNachricht(k: NextcloudKonfig, ncBenutzer: string, text: string): Promise<void> {
	let token = raumZwischen.get(ncBenutzer);
	if (!token) {
		const a = erwarte(
			await ncAnfrage(k, '/ocs/v2.php/apps/spreed/api/v4/room', {
				methode: 'POST',
				kopf: { ...OCS, 'content-type': 'application/json' },
				koerper: JSON.stringify({ roomType: 1, invite: ncBenutzer })
			}),
			[200, 201],
			'Talk-Unterhaltung'
		);
		const t = (JSON.parse(a.text) as { ocs?: { data?: { token?: unknown } } }).ocs?.data?.token;
		if (typeof t !== 'string' || !/^[a-z0-9]{4,32}$/i.test(t)) throw new NextcloudFehler('Talk: kein Raum-Token', 0);
		token = t;
		raumZwischen.set(ncBenutzer, token);
	}
	const r = await ncAnfrage(k, `/ocs/v2.php/apps/spreed/api/v1/chat/${token}`, {
		methode: 'POST',
		kopf: { ...OCS, 'content-type': 'application/json' },
		koerper: JSON.stringify({ message: text.slice(0, 4000) })
	});
	if (r.status === 404) raumZwischen.delete(ncBenutzer); // Unterhaltung gelöscht → beim nächsten Mal neu
	erwarte(r, [200, 201], 'Talk-Nachricht');
}
