/**
 * Status eines Angebots – ohne Serverbezug (Oberfläche und Server). Nur ein Entwurf ist änderbar; ein versendetes
 * Angebot ist eingefroren und kann angenommen, abgelehnt oder (zurückgeholt) wieder Entwurf werden. Angenommen und
 * abgelehnt sind Endstände – Änderungen danach laufen über „Als neue Version bearbeiten“.
 */

export const ANGEBOT_STATUS = ['entwurf', 'versendet', 'angenommen', 'abgelehnt'] as const;

export type AngebotStatus = (typeof ANGEBOT_STATUS)[number];

export const ANGEBOT_STATUS_NAMEN: Record<AngebotStatus, string> = {
	entwurf: 'Entwurf',
	versendet: 'Versendet',
	angenommen: 'Angenommen',
	abgelehnt: 'Abgelehnt'
};

export function istAngebotStatus(w: unknown): w is AngebotStatus {
	return typeof w === 'string' && (ANGEBOT_STATUS as readonly string[]).includes(w);
}

const ERLAUBT: Record<AngebotStatus, readonly AngebotStatus[]> = {
	entwurf: ['versendet'],
	versendet: ['angenommen', 'abgelehnt', 'entwurf'],
	angenommen: [],
	abgelehnt: []
};

export function erlaubterAngebotWechsel(von: AngebotStatus, nach: AngebotStatus): boolean {
	return ERLAUBT[von]?.includes(nach) ?? false;
}
