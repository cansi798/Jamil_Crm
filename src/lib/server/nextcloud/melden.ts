import type { Kontext } from '../db';
import type { ErinnerungsKanal } from '../erinnerungen';
import type { PushNachricht } from '../erinnerungen';
import { nextcloud } from './konfig';
import { anbindungsBetrieb, ncBenutzerVon } from './konten';
import { talkNachricht } from './dav';

/**
 * Erinnerungen zusätzlich als Nextcloud-Talk-Nachricht (NEXTCLOUD_TALK=ja): das Technik-Konto schreibt der
 * verknüpften Person in einer 1:1-Unterhaltung; Talk benachrichtigt dann auf Handy/PC wie bei jeder Nachricht.
 * Personen ohne Nextcloud-Verknüpfung bekommen nichts. Kein Admin-Recht nötig (anders als Nextcloud-Benachrichtigungen
 * über die Notifications-API, die nur Admins für andere anlegen dürfen).
 */
export function talkText(n: PushNachricht, origin: string | undefined): string {
	const link = origin && n.link.startsWith('/') ? `\n${origin}${n.link}` : '';
	return `🔔 ${n.titel}\n${n.text}${link}`;
}

export const nextcloudKanal: ErinnerungsKanal = {
	name: 'nextcloud-talk',
	async sende(k: Kontext, n: PushNachricht) {
		const nc = nextcloud();
		if (!nc?.talk || !nc.technik) return;
		if ((await anbindungsBetrieb(nc)) !== k.betriebId) return;
		const wer = await ncBenutzerVon(k, k.benutzerId);
		if (!wer) return;
		await talkNachricht(nc, wer, talkText(n, process.env.ORIGIN));
	}
};
