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

/**
 * Kurze Erklärung unter dem Status (Jamil msg 3135). „Arbeiten laufen“ verweist auf die Arbeitsschritte, wenn der
 * Auftrag welche zeigt (`mitSchritten`) – der Hinweis-Teil kommt dann als eigener Link (`schritteLink`).
 */
export const PORTAL_STATUS_TEXTE: Record<AuftragStatus, string> = {
	anfrage: 'Wir kümmern uns jetzt um die Prüfung Ihrer Anfrage.',
	angebot: 'Ihr Angebot ist fertig. Nach Ihrer Freigabe übernehmen wir die weitere Planung.',
	beauftragt: 'Wir bereiten Ihr Projekt für einen reibungslosen Start vor.',
	in_arbeit: 'Wir sind bei Ihnen im Einsatz.',
	abgenommen: 'Die Arbeiten sind beendet. Nun prüfen wir gemeinsam das Ergebnis.',
	abgerechnet: 'Vielen Dank für Ihr Vertrauen. Auch künftig sind wir gerne für Sie da.'
};

export function portalStatusText(status: AuftragStatus, mitSchritten = false): { text: string; schritteLink: string | null } {
	if (status === 'in_arbeit' && mitSchritten) {
		return { text: 'Wir sind bei Ihnen im Einsatz – welche Schritte schon erledigt sind, sehen Sie unten bei den', schritteLink: 'Arbeitsschritten' };
	}
	return { text: PORTAL_STATUS_TEXTE[status], schritteLink: null };
}

/** Stufen des Fortschrittswegs im Portal, in der Reihenfolge der Statuskette. */
export const PORTAL_STUFEN = STATUS.map((schluessel) => ({ schluessel, name: PORTAL_STATUS_NAMEN[schluessel] }));
