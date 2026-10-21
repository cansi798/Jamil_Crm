import type { RequestEvent } from '@sveltejs/kit';
import { alsFormFehler, ApiFehler } from './fehler';
import { todoSicht, todoSichtVon } from './todos';
import { betriebKontext, hatRecht } from './rechte';
import { formWerte } from './seite';
import { darf } from './tarif';
import { aendereTodo, aendereTodoAls, beendeSerie, erledigtWert, legeTodoAn, loescheTodo, TODO_FELDER } from './todos';

/**
 * Formular-Aktionen für Aufgaben – gemeinsam für die Seite „Aufgaben“ und den Aufgaben-Bereich eines Auftrags.
 * Erfolg liefert nichts (die Seite lädt neu), Fehler `fail(status, { fehler, todoFehler: true })`.
 * Mit `auftragAusPfad` hängen neue Aufgaben immer am Auftrag der URL (`params.id`).
 */
type Ereignis = Pick<RequestEvent, 'locals' | 'request'> & { params: Partial<Record<string, string>> };

const text = (form: FormData, feld: string) => {
	const w = form.get(feld);
	return typeof w === 'string' ? w : '';
};

/**
 * Mehrere Mitarbeiter (PersonWahl mehrfach, Felder `mitarbeiterIds`). Das Feld `mitarbeiterFeld` sagt, dass die
 * Auswahl im Formular war – auch wenn niemand gewählt ist (dann wird die Liste geleert).
 */
export function mitarbeiterAus(form: FormData): { mitarbeiterIds?: string[] } {
	if (!form.has('mitarbeiterFeld')) return {};
	return { mitarbeiterIds: form.getAll('mitarbeiterIds').filter((w): w is string => typeof w === 'string' && w !== '') };
}

export function todoAktionen(auftragAusPfad: boolean) {
	return {
		anlegen: async ({ locals, request, params }: Ereignis) => {
			const form = await request.formData();
			const werte = formWerte(form, TODO_FELDER);
			try {
				await darf(locals, 'auftraege', 'auftraege.bearbeiten');
				if (auftragAusPfad) werte.auftragId = params.id ?? '';
				await legeTodoAn(betriebKontext(locals), { ...werte, ...mitarbeiterAus(form) }, todoSichtVon(locals.nutzer!));
			} catch (e) {
				return alsFormFehler(e, { todoFehler: true, todoWerte: { ...werte, mitarbeiterIds: form.getAll('mitarbeiterIds').map(String).join(',') } });
			}
		},
		umschalten: async ({ locals, request }: Ereignis) => {
			const form = await request.formData();
			try {
				const n = locals.nutzer;
				if (n && hatRecht(n, 'auftraege.bearbeiten')) {
					await darf(locals, 'auftraege', 'auftraege.bearbeiten');
					await aendereTodo(
						betriebKontext(locals),
						text(form, 'id'),
						{ erledigt: erledigtWert(text(form, 'erledigt')) },
						todoSichtVon(n)
					);
				} else {
					const sicht = await todoSicht(locals);
					await aendereTodoAls(betriebKontext(locals), sicht, false, text(form, 'id'), {
						erledigt: text(form, 'erledigt')
					});
				}
			} catch (e) {
				return alsFormFehler(e, { todoFehler: true });
			}
		},
		aendern: async ({ locals, request }: Ereignis) => {
			const form = await request.formData();
			try {
				await darf(locals, 'auftraege', 'auftraege.bearbeiten');
				const id = text(form, 'id');
				if (!id) throw new ApiFehler(404, 'Aufgabe nicht gefunden.');
				// Nur gesendete Felder ändern: Das Kanban-Ziehen schickt z. B. nur `faellig` (und ggf. `erledigt`) –
				// fehlende Felder dürfen Titel oder Beschreibung nicht leeren.
				const gesendet = ['titel', 'beschreibung', 'zustaendigId', 'faellig', 'faelligZeit', 'vonTag', 'vonZeit', 'lautstaerke', 'schmutz', 'erledigt'].filter((f) => form.has(f));
				const e: Record<string, unknown> = { ...formWerte(form, gesendet), ...mitarbeiterAus(form) };
				// „Nacharbeit“ (msg 2858): Häkchen fehlt im Formular, wenn aus – das Feld `nacharbeitFeld` sagt, dass es da war
				if (form.has('nacharbeitFeld')) e.nacharbeit = form.has('nacharbeit');
				await aendereTodo(betriebKontext(locals), id, e, todoSichtVon(locals.nutzer!));
			} catch (e) {
				return alsFormFehler(e, { todoFehler: true });
			}
		},
		/** Wiederholung beenden (keine neuen Instanzen); bestehende Aufgaben bleiben. */
		serieBeenden: async ({ locals, request }: Ereignis) => {
			const form = await request.formData();
			try {
				await darf(locals, 'auftraege', 'auftraege.bearbeiten');
				await beendeSerie(betriebKontext(locals), text(form, 'id'), todoSichtVon(locals.nutzer!));
			} catch (e) {
				return alsFormFehler(e, { todoFehler: true });
			}
		},
		loeschen: async ({ locals, request }: Ereignis) => {
			const form = await request.formData();
			try {
				await darf(locals, 'auftraege', 'auftraege.bearbeiten');
				await loescheTodo(betriebKontext(locals), text(form, 'id'), todoSichtVon(locals.nutzer!));
			} catch (e) {
				return alsFormFehler(e, { todoFehler: true });
			}
		}
	};
}
