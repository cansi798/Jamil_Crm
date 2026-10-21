/** Partner (Jamil msgs 2854/2856) – Namen und Regeln ohne Server, auch im Browser. */
import { tagPlus } from './zeit';

export const PARTNER_ARTEN = ['auftraggeber', 'subunternehmer', 'lieferant'] as const;
export type PartnerArt = (typeof PARTNER_ARTEN)[number];
export const PARTNER_ART_NAMEN: Record<PartnerArt, string> = { auftraggeber: 'Auftraggeber', subunternehmer: 'Subunternehmer', lieferant: 'Lieferant' };
export const istPartnerArt = (w: unknown): w is PartnerArt => typeof w === 'string' && (PARTNER_ARTEN as readonly string[]).includes(w);

export const NACHWEIS_ARTEN = ['meisterbrief', 'versicherung', 'freistellung_48b', 'sonstiges'] as const;
export type NachweisArt = (typeof NACHWEIS_ARTEN)[number];
export const NACHWEIS_ART_NAMEN: Record<NachweisArt, string> = {
	meisterbrief: 'Meisterbrief',
	versicherung: 'Betriebshaftpflicht-Versicherung',
	freistellung_48b: 'Freistellungsbescheinigung § 48b',
	sonstiges: 'Sonstiger Nachweis'
};

/** So viele Tage vor Ablauf kommt die Erinnerung. */
export const ERINNERN_TAGE = 30;
export const NACHWEIS_MAX_BYTES = 10 * 1024 * 1024;

export type NachweisStatus = 'ok' | 'bald' | 'abgelaufen' | 'ohne';
export function nachweisStatus(gueltigBis: string | null, heute: string): NachweisStatus {
	if (!gueltigBis) return 'ohne';
	if (gueltigBis < heute) return 'abgelaufen';
	return gueltigBis <= tagPlus(heute, ERINNERN_TAGE) ? 'bald' : 'ok';
}

