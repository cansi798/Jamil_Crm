import { createHash } from 'node:crypto';

/**
 * Konfigurationsprofil fürs iPhone/iPad/Mac (.mobileconfig, Apple „CalDAV Account“): einmal antippen, installieren –
 * fertig. Unsigniert (iOS zeigt deshalb „Nicht signiert“). Das App-Passwort steht nur drin, wenn es direkt nach dem
 * Erstellen mitgegeben wird; sonst fragt das iPhone beim Installieren danach.
 */

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Stabile UUID (Version-4-Form) aus einem Text – gleiche Eingabe, gleiches Profil (Neuinstallation ersetzt das alte). */
function uuidAus(text: string): string {
	const h = createHash('sha256').update(text).digest('hex');
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`.toUpperCase();
}

export function iosProfil(e: { host: string; email: string; passwort: string | null; principal: string; bezeichnung: string }): string {
	const kennung = `de.waybuild.crm.caldav.${uuidAus(`${e.host}|${e.email}`).toLowerCase()}`;
	const eintrag = (schluessel: string, wert: string) => `\t\t\t<key>${schluessel}</key>\n\t\t\t<string>${esc(wert)}</string>`;
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>PayloadContent</key>
	<array>
		<dict>
${eintrag('CalDAVAccountDescription', e.bezeichnung)}
${eintrag('CalDAVHostName', e.host)}
			<key>CalDAVPort</key>
			<integer>443</integer>
${eintrag('CalDAVPrincipalURL', e.principal)}
			<key>CalDAVUseSSL</key>
			<true/>
${eintrag('CalDAVUsername', e.email)}
${e.passwort ? eintrag('CalDAVPassword', e.passwort) + '\n' : ''}${eintrag('PayloadDescription', 'Aufgaben aus dem CRM in der Erinnerungen-App')}
${eintrag('PayloadDisplayName', e.bezeichnung)}
${eintrag('PayloadIdentifier', `${kennung}.konto`)}
${eintrag('PayloadType', 'com.apple.caldav.account')}
${eintrag('PayloadUUID', uuidAus(`${kennung}.konto`))}
			<key>PayloadVersion</key>
			<integer>1</integer>
		</dict>
	</array>
	<key>PayloadDescription</key>
	<string>Verbindet die Erinnerungen-App mit den Aufgaben aus dem CRM.</string>
	<key>PayloadDisplayName</key>
	<string>${esc(e.bezeichnung)}</string>
	<key>PayloadIdentifier</key>
	<string>${esc(kennung)}</string>
	<key>PayloadRemovalDisallowed</key>
	<false/>
	<key>PayloadType</key>
	<string>Configuration</string>
	<key>PayloadUUID</key>
	<string>${uuidAus(kennung)}</string>
	<key>PayloadVersion</key>
	<integer>1</integer>
</dict>
</plist>
`;
}
