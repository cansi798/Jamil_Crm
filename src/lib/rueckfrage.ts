/**
 * Rückfrage vor jedem Löschen/Entfernen (Regel von Jamil, Talk msg 3091): kleine Blase „Wirklich löschen?“ mit
 * „Abbrechen“ und „Löschen“ direkt am Knopf. EIN Baustein für alle Zeilen-Aktionen – kein `confirm()` mehr.
 * Ganze Datensätze löschen weiterhin `LoeschenKnopf` + `LoeschenPanel` oben rechts (docs/design-regeln.md 3a).
 *
 *   <button type="submit" use:rueckfrage={'Notiz wirklich löschen?'}>Löschen</button>     (Formular-Knopf)
 *   <button type="button" use:rueckfrage onclick={weg}>✕</button>                         (Knopf mit Klick)
 *   <form use:rueckfrage={{ frage: 'Gerät entfernen?', ja: 'Entfernen' }}>…</form>         (wenn der Knopf ein Baustein ist)
 *   if (!(await frage(knopf, { frage: '…' }))) return;                                   (mitten im Ablauf)
 *
 * Die Blase liegt im „Top Layer“ (Popover-API) und – in einem offenen <dialog> – innerhalb des Dialogs, damit sie
 * auch über modalen Dialogen bedienbar ist. Escape oder Klick daneben = Abbrechen.
 */

export type RueckfrageOptionen = {
	/** Frage in der Blase, Standard „Wirklich löschen?“ */
	frage?: string;
	/** Text des Bestätigungsknopfs, Standard „Löschen“ */
	ja?: string;
	/** Rückfrage aus (z. B. wenn nichts verloren geht) */
	aus?: boolean;
};

type Offen = { schliessen: (ok: boolean) => void };
let offen: Offen | null = null;

function optionen(o: RueckfrageOptionen | string | undefined): RueckfrageOptionen {
	return typeof o === 'string' ? { frage: o } : (o ?? {});
}

/** Zeigt die Blase am Element `anker` und wartet auf die Antwort (true = bestätigt). */
export function frage(anker: HTMLElement, o?: RueckfrageOptionen | string): Promise<boolean> {
	const { frage: text = 'Wirklich löschen?', ja = 'Löschen' } = optionen(o);
	offen?.schliessen(false);
	return new Promise((fertig) => {
		const blase = document.createElement('div');
		const id = `rf-${Math.random().toString(36).slice(2, 9)}`;
		blase.className = 'rf-blase';
		blase.setAttribute('role', 'alertdialog');
		blase.setAttribute('aria-labelledby', id);
		blase.setAttribute('data-testid', 'rueckfrage');
		const kannPopover = typeof blase.showPopover === 'function';
		if (kannPopover) blase.setAttribute('popover', 'manual');
		const p = document.createElement('p');
		p.id = id;
		p.textContent = text;
		const knoepfe = document.createElement('div');
		knoepfe.className = 'rf-knoepfe';
		const nein = document.createElement('button');
		nein.type = 'button';
		nein.className = 'kd-knopf hell klein';
		nein.textContent = 'Abbrechen';
		const jaKnopf = document.createElement('button');
		jaKnopf.type = 'button';
		jaKnopf.className = 'kd-knopf gefahr klein';
		jaKnopf.textContent = ja;
		knoepfe.append(nein, jaKnopf);
		blase.append(p, knoepfe);
		(anker.closest('dialog[open]') ?? document.body).append(blase);
		if (kannPopover) blase.showPopover();

		const platzieren = () => {
			const r = anker.getBoundingClientRect();
			const b = blase.getBoundingClientRect();
			const rand = 8;
			let links = Math.min(r.right - b.width, window.innerWidth - b.width - rand);
			links = Math.max(rand, links);
			let oben = r.bottom + 6;
			if (oben + b.height > window.innerHeight - rand && r.top - b.height - 6 > rand) oben = r.top - b.height - 6;
			blase.style.left = `${Math.round(links)}px`;
			blase.style.top = `${Math.round(oben)}px`;
		};
		platzieren();

		const taste = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
				schliessen(false);
			}
		};
		const daneben = (e: PointerEvent) => {
			if (!blase.contains(e.target as Node) && !anker.contains(e.target as Node)) schliessen(false);
		};
		const weg = () => schliessen(false);
		function schliessen(ok: boolean) {
			document.removeEventListener('keydown', taste, true);
			document.removeEventListener('pointerdown', daneben, true);
			window.removeEventListener('resize', weg);
			window.removeEventListener('scroll', platzieren, true);
			if (kannPopover && blase.matches(':popover-open')) blase.hidePopover();
			blase.remove();
			if (offen === eintrag) offen = null;
			if (!ok && anker.isConnected) anker.focus({ preventScroll: true });
			fertig(ok);
		}
		const eintrag: Offen = { schliessen };
		offen = eintrag;
		nein.addEventListener('click', () => schliessen(false));
		jaKnopf.addEventListener('click', () => schliessen(true));
		document.addEventListener('keydown', taste, true);
		document.addEventListener('pointerdown', daneben, true);
		window.addEventListener('resize', weg);
		window.addEventListener('scroll', platzieren, true);
		nein.focus({ preventScroll: true });
	});
}

/**
 * Svelte-Aktion: hält den Klick (Knopf) bzw. das Absenden (Formular) an, fragt nach und führt die ursprüngliche
 * Aktion erst nach „Löschen“ aus. Lauscht in der Capture-Phase – läuft also vor `onclick` und `use:enhance`.
 */
export function rueckfrage(node: HTMLElement, o?: RueckfrageOptionen | string) {
	let opt = optionen(o);
	let durchlassen = false;

	async function klick(e: MouseEvent) {
		if (durchlassen || opt.aus || (node as HTMLButtonElement).disabled) return;
		e.preventDefault();
		e.stopImmediatePropagation();
		if (await frage(node, opt)) {
			durchlassen = true;
			try {
				node.click();
			} finally {
				durchlassen = false;
			}
		}
	}
	async function absenden(ereignis: Event) {
		const e = ereignis as SubmitEvent;
		if (durchlassen || opt.aus) return;
		e.preventDefault();
		e.stopImmediatePropagation();
		const form = node as HTMLFormElement;
		const knopf = (e.submitter as HTMLElement | null) ?? form;
		if (await frage(knopf, opt)) {
			durchlassen = true;
			try {
				form.requestSubmit(e.submitter as HTMLButtonElement | null);
			} finally {
				durchlassen = false;
			}
		}
	}

	const istForm = node instanceof HTMLFormElement;
	if (istForm) node.addEventListener('submit', absenden, true);
	else node.addEventListener('click', klick, true);
	node.setAttribute('data-rueckfrage', '');
	return {
		update(neu?: RueckfrageOptionen | string) {
			opt = optionen(neu);
		},
		destroy() {
			if (istForm) node.removeEventListener('submit', absenden, true);
			else node.removeEventListener('click', klick, true);
		}
	};
}
