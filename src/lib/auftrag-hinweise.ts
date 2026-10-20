/**
 * Abzeichen auf Auftragskarte, Listenzeile und Auftragskopf (Wunsch Jamil msg 2674): Hat der Kunde ein Angebot
 * bekommen (verschickt am / angenommen / abgelehnt) und wann ist das nächste Nachfassen fällig (rot = überfällig,
 * Pause-Zeichen = pausiert). Kurz: Zeichen + wenig Text.
 */
import { tagKurz } from './zeit';

export type AngebotInfo = { status: 'versendet' | 'angenommen' | 'abgelehnt'; tag: string };
export type NachfassenInfo = { tag: string; pausiert: boolean };
export type Abzeichen = { text: string; ton: 'neutral' | 'gut' | 'leise' | 'warnung' | 'ueberfaellig'; titel: string };

const kurz = (tag: string) => `${tag.slice(8, 10)}.${tag.slice(5, 7)}.`;

export function angebotAbzeichen(a: AngebotInfo | null): Abzeichen | null {
	if (!a) return null;
	if (a.status === 'angenommen') return { text: `Angebot angenommen ${kurz(a.tag)}`, ton: 'gut', titel: `Angebot angenommen am ${kurz(a.tag)}` };
	if (a.status === 'abgelehnt') return { text: 'Angebot abgelehnt', ton: 'leise', titel: `Angebot abgelehnt am ${kurz(a.tag)}` };
	return { text: `Angebot verschickt ${kurz(a.tag)}`, ton: 'neutral', titel: `Angebot verschickt am ${kurz(a.tag)}` };
}

/** „Nachfassen: Do 23.10.“ – heute „heute“, überfällig rot, pausiert mit Pause-Zeichen. */
export function nachfassenAbzeichen(n: NachfassenInfo | null, heute: string): Abzeichen | null {
	if (!n) return null;
	if (n.pausiert) return { text: 'Nachfassen pausiert', ton: 'leise', titel: `Nachfassen pausiert (wäre am ${tagKurz(n.tag)})` };
	if (n.tag < heute) return { text: `Nachfassen: ${tagKurz(n.tag)}`, ton: 'ueberfaellig', titel: `Nachfassen überfällig seit ${tagKurz(n.tag)}` };
	if (n.tag === heute) return { text: 'Nachfassen: heute', ton: 'warnung', titel: 'Nachfassen heute fällig' };
	return { text: `Nachfassen: ${tagKurz(n.tag)}`, ton: 'neutral', titel: `Nächstes Nachfassen am ${tagKurz(n.tag)}` };
}
