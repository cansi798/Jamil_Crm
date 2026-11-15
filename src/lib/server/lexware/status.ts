import { mitBetrieb, type Kontext } from '../db';
import { berlinTag } from '../../zeit';
import { ladeLexwareKonfig, type LexwareKonfig } from './konfig';
import { webhookUrl } from './abgleich';

/** Zusammenfassung für Einstellungsseite und Sprache („Ist Lexware verbunden? Hängt etwas?“). */
export type LexwareStatus = LexwareKonfig & {
	offen: number;
	pruefen: number;
	seitWartet: string | null;
	abos: number;
	webhookUrl: string | null;
	laeuftBaldAb: boolean;
	tageBisAblauf: number | null;
	belege: number;
	ungelesen: number;
};

export async function lexwareStatus(k: Kontext, heute = new Date()): Promise<LexwareStatus> {
	const c = await ladeLexwareKonfig(k);
	const [z] = await mitBetrieb(k, (tx) => tx`
		select
			(select count(*)::int from app.lexware_auftraege where betrieb_id = ${k.betriebId} and status in ('wartet', 'laeuft', 'ungewiss')) as offen,
			(select count(*)::int from app.lexware_auftraege where betrieb_id = ${k.betriebId} and status = 'pruefen') as pruefen,
			(select min(angelegt) from app.lexware_auftraege where betrieb_id = ${k.betriebId} and status in ('wartet', 'ungewiss') and versuche > 0) as seit,
			(select count(*)::int from app.lexware_abos where betrieb_id = ${k.betriebId} and lexware_id is not null) as abos,
			(select count(*)::int from app.lexware_belege where betrieb_id = ${k.betriebId}) as belege,
			(select count(*)::int from app.lexware_ereignisse where betrieb_id = ${k.betriebId} and verarbeitet_am is null) as ungelesen`);
	const tage = c.gueltigBis ? Math.round((Date.parse(c.gueltigBis) - Date.parse(berlinTag(heute))) / 86_400_000) : null;
	return {
		...c,
		offen: z.offen,
		pruefen: z.pruefen,
		seitWartet: z.seit ? new Date(z.seit).toISOString() : null,
		abos: z.abos,
		webhookUrl: webhookUrl(),
		laeuftBaldAb: tage !== null && tage <= 30,
		tageBisAblauf: tage,
		belege: z.belege,
		ungelesen: z.ungelesen
	};
}

/** Ein Satz zum Vorlesen. */
export function statusSatz(s: LexwareStatus): string {
	if (!s.schluesselGesetzt) return 'Lexware ist noch nicht verbunden. Den Schlüssel trägst du unter Einstellungen, Lexware verbinden, ein.';
	const teile: string[] = [];
	if (s.status === 'verbunden') teile.push(`Lexware ist verbunden${s.firmenname ? ` mit ${s.firmenname}` : ''}.`);
	else if (s.status === 'schluessel_ungueltig') teile.push('Der Lexware-Schlüssel ist ungültig oder abgelaufen – bitte einen neuen eintragen.');
	else teile.push(`Lexware meldet ein Problem${s.letzterFehler ? `: ${s.letzterFehler}` : ''}.`);
	if (s.pruefen > 0) teile.push(`${s.pruefen} Auftrag${s.pruefen === 1 ? '' : 'e'} an Lexware ${s.pruefen === 1 ? 'muss' : 'müssen'} geprüft werden.`);
	if (s.offen > 0) teile.push(`${s.offen} ${s.offen === 1 ? 'wartet' : 'warten'} noch.`);
	if (s.pruefen === 0 && s.offen === 0 && s.status === 'verbunden') teile.push('Es hängt nichts.');
	if (s.laeuftBaldAb && s.tageBisAblauf !== null) teile.push(s.tageBisAblauf < 0 ? 'Der Schlüssel ist abgelaufen.' : `Der Schlüssel läuft in ${s.tageBisAblauf} Tagen ab.`);
	return teile.join(' ');
}
