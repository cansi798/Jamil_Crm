import type { SubmitFunction } from '@sveltejs/kit';

/**
 * Schutz gegen doppeltes Absenden (Doppeltipp auf der Baustelle, langsames Netz): solange die Formular-Aktion läuft,
 * sind die Absende-Knöpfe des Formulars gesperrt und das Formular trägt `aria-busy="true"`. Danach wie gewohnt
 * (`update()` bzw. die eigene Rückgabe von `weiter`).
 *
 *   <form method="POST" action="?/angebotErstellen" use:enhance={einmalig()}>…</form>
 *   <form … use:enhance={einmalig(() => async ({ update }) => update({ reset: false }))}>…</form>
 */
export function einmalig(weiter?: SubmitFunction): SubmitFunction {
	return async (eingabe) => {
		const form = eingabe.formElement;
		const knoepfe = [...form.querySelectorAll<HTMLButtonElement>('button[type="submit"], button:not([type])')].filter((k) => !k.disabled);
		const freigeben = () => {
			for (const k of knoepfe) k.disabled = false;
			form.removeAttribute('aria-busy');
		};
		const danach = await weiter?.(eingabe);
		if (eingabe.controller.signal.aborted) return;
		// Erst NACH dem Zusammenstellen der Formulardaten sperren – der Wert des gedrückten Knopfs ist dann schon drin
		for (const k of knoepfe) k.disabled = true;
		form.setAttribute('aria-busy', 'true');
		return async (opts) => {
			try {
				if (danach) await danach(opts);
				else await opts.update();
			} finally {
				freigeben();
			}
		};
	};
}
