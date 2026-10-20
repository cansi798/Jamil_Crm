import { mitBetrieb, type Kontext } from './db';
import { ApiFehler } from './fehler';
import { textFeld, UUID } from './kunden';

/**
 * Kolonnen (Wunsch Jamil msg 2510): Name, Mitglieder, optional Kolonnenführer und Fahrzeug. Verwalten und einplanen
 * darf, wer die Plantafel bearbeiten darf (prüft der Aufrufer); sehen alle, die die Plantafel sehen.
 */

export type Kolonne = {
	id: string;
	name: string;
	leiterId: string | null;
	leiterName: string | null;
	fahrzeug: string | null;
	aktiv: boolean;
	mitglieder: { id: string; name: string }[];
};

export const KOLONNEN_FELDER = ['name', 'leiterId', 'fahrzeug', 'aktiv'] as const;
export const MAX_MITGLIEDER = 30;

const nichtGefunden = () => new ApiFehler(404, 'Kolonne nicht gefunden.');
const pruefeId = (id: unknown) => {
	if (typeof id !== 'string' || !UUID.test(id.trim())) throw nichtGefunden();
	return id.trim().toLowerCase();
};

const AUSWAHL = `ko.id, ko.name, ko.leiter_id, l.name as leiter_name, ko.fahrzeug, ko.aktiv,
	(select coalesce(json_agg(json_build_object('id', b.id, 'name', b.name) order by public.unaccent(lower(b.name)), b.id), '[]')
		from app.kolonnen_mitglieder m join app.benutzer b on b.id = m.benutzer_id and b.betrieb_id = m.betrieb_id
		where m.kolonne_id = ko.id and m.betrieb_id = ko.betrieb_id and b.aktiv) as mitglieder`;
const VON = `app.kolonnen ko left join app.benutzer l on l.id = ko.leiter_id and l.betrieb_id = ko.betrieb_id`;

const zuKolonne = (z: Record<string, any>): Kolonne => ({
	id: z.id,
	name: z.name,
	leiterId: z.leiter_id ?? null,
	leiterName: z.leiter_name ?? null,
	fahrzeug: z.fahrzeug ?? null,
	aktiv: z.aktiv,
	mitglieder: typeof z.mitglieder === 'string' ? JSON.parse(z.mitglieder) : (z.mitglieder ?? [])
});

export async function listeKolonnen(k: Kontext, nurAktive = false): Promise<Kolonne[]> {
	return mitBetrieb(k, async (tx) =>
		(
			await tx`
				select ${tx.unsafe(AUSWAHL)} from ${tx.unsafe(VON)}
				where ko.betrieb_id = ${k.betriebId} ${nurAktive ? tx`and ko.aktiv` : tx``}
				order by public.unaccent(lower(ko.name)), ko.id`
		).map(zuKolonne)
	);
}

export async function holeKolonne(k: Kontext, id: unknown): Promise<Kolonne> {
	const kid = pruefeId(id);
	return mitBetrieb(k, async (tx) => {
		const [z] = await tx`select ${tx.unsafe(AUSWAHL)} from ${tx.unsafe(VON)} where ko.id = ${kid} and ko.betrieb_id = ${k.betriebId}`;
		if (!z) throw nichtGefunden();
		return zuKolonne(z);
	});
}

function pruefe(e: Record<string, unknown>) {
	const name = textFeld(e.name, 'Name', 100);
	if (!name) throw new ApiFehler(400, 'Name: Bitte einen Namen eingeben (z. B. Kolonne A).');
	const leiter = e.leiterId;
	let leiterId: string | null = null;
	if (leiter !== undefined && leiter !== null && leiter !== '') {
		if (typeof leiter !== 'string' || !UUID.test(leiter)) throw new ApiFehler(400, 'Kolonnenführer: ungültige Auswahl.');
		leiterId = leiter.toLowerCase();
	}
	const roh = e.mitglieder === undefined || e.mitglieder === null || e.mitglieder === '' ? [] : Array.isArray(e.mitglieder) ? e.mitglieder : [e.mitglieder];
	if (roh.length > MAX_MITGLIEDER) throw new ApiFehler(400, `Höchstens ${MAX_MITGLIEDER} Mitglieder.`);
	const mitglieder = [...new Set(roh.map((m) => {
		if (typeof m !== 'string' || !UUID.test(m)) throw new ApiFehler(400, 'Mitglieder: ungültige Auswahl.');
		return m.toLowerCase();
	}))];
	if (leiterId && !mitglieder.includes(leiterId)) mitglieder.push(leiterId);
	return {
		name,
		leiterId,
		fahrzeug: textFeld(e.fahrzeug, 'Fahrzeug', 100),
		aktiv: e.aktiv === undefined || e.aktiv === '' ? true : e.aktiv === true || e.aktiv === 'true' || e.aktiv === 'on',
		mitglieder
	};
}

/** Neu (`id` leer) oder ändern; Mitglieder werden ersetzt. Doppelter Name → 409. */
export async function speichereKolonne(k: Kontext, id: unknown, e: Record<string, unknown>): Promise<Kolonne> {
	const w = pruefe(e);
	return mitBetrieb(k, async (tx) => {
		if (w.mitglieder.length > 0) {
			const da = await tx`select id from app.benutzer where betrieb_id = ${k.betriebId} and aktiv and id = any(${w.mitglieder}::uuid[])`;
			if (da.length !== w.mitglieder.length) throw new ApiFehler(400, 'Mitglieder: nur aktive Mitarbeiter des Betriebs.');
		}
		const bisherigeId = id === null || id === undefined || id === '' ? null : pruefeId(id);
		const [gleich] = await tx`
			select id from app.kolonnen where betrieb_id = ${k.betriebId} and lower(btrim(name)) = lower(${w.name})
				and id is distinct from ${bisherigeId}::uuid`;
		if (gleich) throw new ApiFehler(409, `Es gibt schon eine Kolonne „${w.name}“.`);
		let kid: string;
		if (id === null || id === undefined || id === '') {
			const [z] = await tx`
				insert into app.kolonnen (betrieb_id, name, leiter_id, fahrzeug, aktiv) values (${k.betriebId}, ${w.name}, ${w.leiterId}, ${w.fahrzeug}, ${w.aktiv})
				returning id`;
			kid = z.id;
		} else {
			kid = pruefeId(id);
			const z = await tx`
				update app.kolonnen set name = ${w.name}, leiter_id = ${w.leiterId}, fahrzeug = ${w.fahrzeug}, aktiv = ${w.aktiv}
				where id = ${kid} and betrieb_id = ${k.betriebId} returning id`;
			if (z.length === 0) throw nichtGefunden();
			await tx`delete from app.kolonnen_mitglieder where kolonne_id = ${kid} and betrieb_id = ${k.betriebId}`;
		}
		for (const m of w.mitglieder) {
			await tx`insert into app.kolonnen_mitglieder (betrieb_id, kolonne_id, benutzer_id) values (${k.betriebId}, ${kid}, ${m})`;
		}
		const [r] = await tx`select ${tx.unsafe(AUSWAHL)} from ${tx.unsafe(VON)} where ko.id = ${kid} and ko.betrieb_id = ${k.betriebId}`;
		return zuKolonne(r);
	});
}

export async function loescheKolonne(k: Kontext, id: unknown): Promise<void> {
	const kid = pruefeId(id);
	await mitBetrieb(k, async (tx) => {
		const z = await tx`delete from app.kolonnen where id = ${kid} and betrieb_id = ${k.betriebId} returning id`;
		if (z.length === 0) throw nichtGefunden();
	});
}
