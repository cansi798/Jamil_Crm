/**
 * Links für Monteure vor Ort (Wunsch Jamil, msg 2549): Route zur Adresse (Google Maps; auf dem iPhone bietet das System
 * auch Apple Karten an) und Anrufen per tel:.
 */
export function navigationsLink(adresse: string | null | undefined): string | null {
	const a = adresse?.trim();
	if (!a) return null;
	return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(a)}`;
}

/** tel:-Link (nur Ziffern und führendes +); null ohne verwertbare Nummer. */
export function telefonLink(nummer: string | null | undefined): string | null {
	if (!nummer) return null;
	const n = nummer.trim();
	const ziffern = n.replace(/[^0-9]/g, '');
	if (ziffern.length < 3) return null;
	return `tel:${n.startsWith('+') ? '+' : ''}${ziffern}`;
}
