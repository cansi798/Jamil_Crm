/**
 * Lage eines schwebenden Menüs bzw. einer Liste am Auslöser (Auswahl, Status-Menü; Jamil msgs 3067, 3112): liegt in
 * der obersten Ebene (Popover-API, sonst position: fixed), öffnet nach unten, wenn dort genug Platz ist, sonst nach
 * oben; Höhe auf den freien Platz begrenzt, nie breiter als der Bildschirm.
 */
export type OverlayLage = { links: number; breite: number; oben: number | null; unten: number | null; maxHoehe: number };

const RAND = 8;

export function overlayLage(anker: DOMRect, inhaltHoehe: number, opts: { minBreite?: number; maxHoehe?: number; rechtsBuendig?: boolean } = {}): OverlayLage {
	const vh = window.innerHeight;
	const vw = document.documentElement.clientWidth;
	const maxH = opts.maxHoehe ?? 320;
	const unten = vh - anker.bottom - RAND - 4;
	const oben = anker.top - RAND - 4;
	const gewuenscht = Math.min(inhaltHoehe, maxH);
	const nachOben = unten < gewuenscht && oben > unten;
	const breite = Math.min(Math.max(anker.width, opts.minBreite ?? 192), vw - 2 * RAND);
	const start = opts.rechtsBuendig ? anker.right - breite : anker.left;
	const links = Math.min(Math.max(RAND, start), vw - RAND - breite);
	return nachOben
		? { links, breite, oben: null, unten: vh - anker.top + 4, maxHoehe: Math.max(120, Math.min(maxH, oben)) }
		: { links, breite, oben: anker.bottom + 4, unten: null, maxHoehe: Math.max(120, Math.min(maxH, unten)) };
}

/** Als Inline-Stil für das schwebende Element. */
export function overlayStil(l: OverlayLage): string {
	return [
		`left:${l.links}px`,
		`width:${l.breite}px`,
		`top:${l.oben === null ? 'auto' : `${l.oben}px`}`,
		`bottom:${l.unten === null ? 'auto' : `${l.unten}px`}`,
		`max-height:${l.maxHoehe}px`
	].join(';');
}

/** Popover öffnen, wenn der Browser es kann (sonst bleibt es ein fixed-Element mit hohem z-index). */
export function zeigeOverlay(el: HTMLElement | undefined): void {
	if (!el) return;
	try {
		if (typeof el.showPopover === 'function' && !el.matches(':popover-open')) el.showPopover();
	} catch {
		/* ohne Popover-API */
	}
}
