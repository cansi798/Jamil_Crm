import { STATUS, type AuftragStatus } from './auftrag-status';

/**
 * Auftragsstatus, wie der KUNDE ihn im Kundenportal liest (Jamil msg 3131) – an EINER Stelle. Die Namen im CRM
 * (`STATUS_NAMEN`: Anfrage, Angebot, Beauftragt …) bleiben unverändert.
 */
export const PORTAL_STATUS_NAMEN: Record<AuftragStatus, string> = {
	anfrage: 'Anfrage eingegangen',
	angebot: 'Angebot erhalten',
	beauftragt: 'Auftrag bestätigt',
	in_arbeit: 'Arbeiten laufen',
	abgenommen: 'Arbeiten abgeschlossen',
	abgerechnet: 'Projekt erfolgreich beendet'
};

export function portalStatusName(status: AuftragStatus): string {
	return PORTAL_STATUS_NAMEN[status];
}

/** Stufen des Fortschrittswegs im Portal, in der Reihenfolge der Statuskette. */
export const PORTAL_STUFEN = STATUS.map((schluessel) => ({ schluessel, name: PORTAL_STATUS_NAMEN[schluessel] }));
