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

export type SchwebendOptionen = {
	/** Element, an dem das Overlay hängt (Feld, Knopf) */
	anker: () => HTMLElement | null | undefined;
	/** Scrollen außerhalb bzw. Größenänderung: schließen (sonst nur neu ausrichten) */
	onschliessen?: () => void;
	/** 'anker' = mindestens so breit wie der Anker; 'eigen' = Breite aus dem CSS des Overlays */
	breite?: 'anker' | 'eigen';
	minBreite?: number;
	maxHoehe?: number;
	rechtsBuendig?: boolean;
};

/**
 * Svelte-Action für schwebende Listen, Menüs und Panels (Regel von Jamil, msg 3116: alles, was aufklappt, schwebt
 * obenauf und verschiebt nie Inhalt, Karten oder Dialoge). Legt das Element in die oberste Ebene (Popover), setzt die
 * Lage am Anker (kippt nach oben, Höhe begrenzt, scrollt in sich) und schließt bei Scrollen außerhalb oder
 * Größenänderung. Schließen bei Klick außerhalb/Esc macht weiter die Komponente selbst.
 */
export function schwebend(el: HTMLElement, start: SchwebendOptionen) {
	let o = start;
	el.classList.add('ui-schwebend');
	if (!el.hasAttribute('popover')) el.setAttribute('popover', 'manual');
	zeigeOverlay(el);
	function lege() {
		const a = o.anker();
		if (!a) return;
		const r = a.getBoundingClientRect();
		const eigen = o.breite === 'eigen';
		const vw = document.documentElement.clientWidth;
		const l = overlayLage(r, el.scrollHeight, {
			minBreite: eigen ? Math.min(el.offsetWidth || 0, vw - 16) : (o.minBreite ?? 192),
			maxHoehe: o.maxHoehe,
			rechtsBuendig: o.rechtsBuendig
		});
		if (eigen) {
			const w = Math.min(el.offsetWidth || l.breite, vw - 16);
			const start = o.rechtsBuendig ? r.right - w : r.left;
			l.links = Math.min(Math.max(8, start), vw - 8 - w);
		} else el.style.width = `${l.breite}px`;
		el.style.position = 'fixed';
		el.style.margin = '0';
		el.style.right = 'auto';
		el.style.left = `${l.links}px`;
		el.style.top = l.oben === null ? 'auto' : `${l.oben}px`;
		el.style.bottom = l.unten === null ? 'auto' : `${l.unten}px`;
		el.style.maxHeight = `${l.maxHoehe}px`;
		el.style.overflowY = 'auto';
	}
	lege();
	// Inhalt kann sich nach dem Öffnen ändern (Treffer laden, Liste wächst) → neu ausrichten
	const ro = new ResizeObserver(() => lege());
	ro.observe(el);
	const zu = (ev: Event) => {
		if (ev.type === 'scroll' && ev.target instanceof Node && el.contains(ev.target)) return;
		// Tippt jemand gerade darin (Handy-Tastatur verkleinert das Fenster, Seite scrollt zum Feld): nur neu ausrichten
		if (o.onschliessen && !el.contains(document.activeElement)) o.onschliessen();
		else lege();
	};
	window.addEventListener('scroll', zu, true);
	window.addEventListener('resize', zu);
	return {
		update(neu: SchwebendOptionen) {
			o = neu;
			lege();
		},
		destroy() {
			ro.disconnect();
			window.removeEventListener('scroll', zu, true);
			window.removeEventListener('resize', zu);
			try {
				if (el.matches(':popover-open')) el.hidePopover();
			} catch {
				/* schon weg */
			}
		}
	};
}

/**
 * Für <details>-Menüs („⋯“): beim Aufklappen schwebt der Inhalt (`panel`, CSS-Selektor) am <summary>; Klick außerhalb,
 * Esc, Scrollen oder Größenänderung klappen wieder zu.
 */
export function schwebendesDetails(details: HTMLDetailsElement, o: { panel: string; rechtsBuendig?: boolean; breite?: 'anker' | 'eigen' }) {
	let aktion: ReturnType<typeof schwebend> | null = null;
	const schliessen = () => {
		details.open = false;
	};
	const aussen = (ev: PointerEvent) => {
		if (ev.target instanceof Node && !details.contains(ev.target)) schliessen();
	};
	const taste = (ev: KeyboardEvent) => {
		if (ev.key === 'Escape' && details.open) {
			schliessen();
			details.querySelector('summary')?.focus();
		}
	};
	const umschalten = () => {
		const panel = details.querySelector<HTMLElement>(o.panel);
		if (details.open && panel) {
			aktion = schwebend(panel, { anker: () => details.querySelector('summary'), onschliessen: schliessen, rechtsBuendig: o.rechtsBuendig ?? true, breite: o.breite ?? 'eigen' });
			document.addEventListener('pointerdown', aussen, true);
		} else {
			aktion?.destroy();
			aktion = null;
			document.removeEventListener('pointerdown', aussen, true);
		}
	};
	details.addEventListener('toggle', umschalten);
	details.addEventListener('keydown', taste);
	return {
		destroy() {
			details.removeEventListener('toggle', umschalten);
			details.removeEventListener('keydown', taste);
			document.removeEventListener('pointerdown', aussen, true);
			aktion?.destroy();
		}
	};
}
