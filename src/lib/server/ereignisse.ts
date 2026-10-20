/**
 * Fachliche Ereignisse (Jamil msg 2778: „Das CRM ist die Quelle der Wahrheit“). Wird ein Angebot „angenommen“ – im
 * Kundenportal, von Hand im Büro oder per Sprache –, meldet der Dienst `angebotAngenommen`. Wer daran hängt:
 *   • eingebaut: Auftragsbestätigung erzeugen (src/lib/server/auftragsbestaetigung.ts),
 *   • später z. B. Lexware („Angebot angenommen“ dort setzen) – über `abonniere('angebotAngenommen', …)`.
 *
 * Läuft im selben Ablauf wie die Statusänderung (bei einer gemeinsamen Transaktion, z. B. Sprache, auch darin). Fehler
 * eines Abonnenten brechen die Annahme nie ab: sie werden geloggt und als Hinweis zurückgegeben.
 */

export type AngebotAngenommen = {
	betriebId: string;
	/** null = ohne Anmeldung (Kundenportal) */
	benutzerId: string | null;
	angebotId: string;
	auftragId: string | null;
	quelle: 'oberflaeche' | 'sprache' | 'kundenportal';
};

type Ereignisse = { angebotAngenommen: AngebotAngenommen };
type Abonnent<E extends keyof Ereignisse> = (e: Ereignisse[E]) => Promise<string | void>;

const abonnenten: { [E in keyof Ereignisse]: Abonnent<E>[] } = { angebotAngenommen: [] };

/** Eingebaute Abonnenten (dynamisch geladen, damit keine Import-Kreise entstehen). */
const EINGEBAUT: { [E in keyof Ereignisse]: (() => Promise<Abonnent<E>>)[] } = {
	angebotAngenommen: [async () => (await import('./auftragsbestaetigung')).beiAngebotAngenommen]
};

/** Für Anbindungen (z. B. Lexware): eigenen Abonnenten eintragen; liefert eine Abmelde-Funktion. */
export function abonniere<E extends keyof Ereignisse>(ereignis: E, f: Abonnent<E>): () => void {
	(abonnenten[ereignis] as Abonnent<E>[]).push(f);
	return () => {
		const l = abonnenten[ereignis] as Abonnent<E>[];
		const i = l.indexOf(f);
		if (i >= 0) l.splice(i, 1);
	};
}

/** Meldet ein Ereignis an alle Abonnenten (nacheinander). Liefert Hinweise (z. B. „Auftragsbestätigung AB-… erstellt“). */
export async function melde<E extends keyof Ereignisse>(ereignis: E, daten: Ereignisse[E]): Promise<string[]> {
	const hinweise: string[] = [];
	const liste = [...(await Promise.all(EINGEBAUT[ereignis].map((l) => l()))), ...(abonnenten[ereignis] as Abonnent<E>[])];
	for (const f of liste) {
		try {
			const h = await f(daten);
			if (h) hinweise.push(h);
		} catch (e) {
			console.error(`Ereignis ${ereignis}: Abonnent fehlgeschlagen`, e);
			hinweise.push('Ein Folgeschritt nach der Annahme ist fehlgeschlagen – bitte im Verlauf prüfen.');
		}
	}
	return hinweise;
}
