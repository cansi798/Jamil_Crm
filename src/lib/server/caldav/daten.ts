import { createHash } from 'node:crypto';
import { inEinerTransaktion, mitBetrieb, type Kontext, type TransactionSql } from '../db';
import { ApiFehler } from '../fehler';
import { sichtbar, kundeNameAus } from '../auftraege';
import { hatRecht } from '../rechte';
import { aendereTodo, aendereTodoAls, legeTodoAn, loescheTodo, type TodoSicht } from '../todos';
import { setzeErinnerungen, todoFaelligUm } from '../erinnerungen';
import { MAX_ERINNERUNGEN } from '../../erinnerungen';
import { UUID } from '../kunden';
import { aenderungen, erzeugeVtodo, etagVon, felderVon, type CalAufgabe, type Gelesen } from './vtodo';

/**
 * Daten für den CalDAV-Zugang: welche Listen (Sammlungen) ein Benutzer hat, welche Aufgaben darin liegen, Abgleich-
 * Stände (sync-collection) und das Zurückschreiben von Änderungen vom Handy – immer mit den normalen Rechten und im
 * Änderungsprotokoll mit der Quelle „caldav“.
 *
 * „Meine Aufgaben“ = Aufgaben, die mir zugewiesen sind (direkt als Zuständiger/Mitarbeiter oder über einen Auftrag,
 * für den ich zuständig bin) und eigene Aufgaben ohne Auftrag – jeweils nur, was ich auch in der App sehen darf.
 * Erledigte Aufgaben bleiben 30 Tage in der Liste. Mit „Liste je Auftrag“ liegen Aufgaben mit Auftrag in einer
 * eigenen Liste je Auftrag; „Meine Aufgaben“ enthält dann nur die ohne Auftrag.
 */

export const MEINE = 'meine';
export const ERLEDIGT_TAGE = 30;
export const MAX_AUFGABEN = 2000;

export type Sitzung = {
	k: Kontext;
	nutzer: Nutzer & { email: string; name: string };
	sicht: TodoSicht;
	/** Link-Basis fürs CRM (z. B. https://crm.example.de) */
	origin: string;
	/** Zwischenspeicher je Anfrage (nur Lesen): Aufgaben und Einstellung „Liste je Auftrag“ */
	zwischen?: { zeilen?: Promise<Zeile[]>; jeAuftrag?: Promise<boolean> };
};

export type Sammlung = { schluessel: string; name: string; auftragId: string | null };
export type Objekt = { name: string; aufgabe: CalAufgabe; ics: string; etag: string };

export const darfBearbeiten = (s: Sitzung) => hatRecht(s.nutzer, 'auftraege.bearbeiten');
export const darfErinnern = (s: Sitzung) => hatRecht(s.nutzer, 'erinnerungen.nutzen');

export async function listenJeAuftrag(k: Kontext): Promise<boolean> {
	return mitBetrieb(k, async (tx) => {
		const [z] = await tx`select listen_je_auftrag from app.caldav_einstellungen where benutzer_id = ${k.benutzerId} and betrieb_id = ${k.betriebId}`;
		return z?.listen_je_auftrag === true;
	});
}

export async function setzeListenJeAuftrag(k: Kontext, an: boolean): Promise<void> {
	await mitBetrieb(k, async (tx) => {
		await tx`
			insert into app.caldav_einstellungen (benutzer_id, betrieb_id, listen_je_auftrag) values (${k.benutzerId}, ${k.betriebId}, ${an})
			on conflict (benutzer_id) do update set listen_je_auftrag = excluded.listen_je_auftrag`;
	});
}

/** Aufgabe ist mir zugewiesen: Zuständiger oder einer der Mitarbeiter (Alias t). */
function zugewiesen(tx: TransactionSql, benutzerId: string) {
	return tx`(t.zustaendig_id = ${benutzerId} or exists (
		select 1 from app.todo_mitarbeiter tm where tm.todo_id = t.id and tm.betrieb_id = t.betrieb_id and tm.benutzer_id = ${benutzerId}))`;
}

/** Wie in der App sichtbar (siehe todos.ts): alle, zugewiesene oder in sichtbaren Aufträgen (Aliasse t, a). */
function todoSichtbar(tx: TransactionSql, sicht: TodoSicht) {
	if (sicht.alle) return tx`true`;
	return tx`(${zugewiesen(tx, sicht.benutzerId)} or (a.id is not null and ${sichtbar(tx, { alle: false, benutzerId: sicht.benutzerId })}))`;
}

function meine(tx: TransactionSql, benutzerId: string) {
	return tx`(${zugewiesen(tx, benutzerId)}
		or exists (select 1 from app.auftrag_zustaendige az where az.auftrag_id = t.auftrag_id and az.betrieb_id = t.betrieb_id and az.benutzer_id = ${benutzerId})
		or (t.auftrag_id is null and t.angelegt_von = ${benutzerId}))`;
}

type Zeile = CalAufgabe & { name: string; auftragId: string | null };

/** Meine Aufgaben (alle Listen) – optional nur eine. */
async function ladeAufgaben(s: Sitzung, nurId?: string): Promise<Zeile[]> {
	const { k } = s;
	return mitBetrieb(k, async (tx) => {
		const z = await tx`
			select t.id, t.titel, t.beschreibung, to_char(t.faellig, 'YYYY-MM-DD') as faellig, to_char(t.faellig_zeit, 'HH24:MI') as faellig_zeit,
				to_char(t.von_tag, 'YYYY-MM-DD') as von_tag, to_char(t.von_zeit, 'HH24:MI') as von_zeit, t.erledigt_am, t.prioritaet,
				t.auftrag_id, a.nummer as auftrag_nummer, a.titel as auftrag_titel, a.einmal_name,
				kn.art as kunde_art, kn.firma as kunde_firma, kn.vorname as kunde_vorname, kn.nachname as kunde_nachname,
				t.serie_id, t.angelegt, t.geaendert, o.uid as caldav_uid, o.name as caldav_name,
				(select coalesce(array_agg(e.zeitpunkt order by e.zeitpunkt), '{}') from app.erinnerungen e
					where e.todo_id = t.id and e.betrieb_id = t.betrieb_id and e.benutzer_id = ${k.benutzerId} and e.gesendet_am is null) as erinnerungen
			from app.todos t
			left join app.auftraege a on a.id = t.auftrag_id and a.betrieb_id = t.betrieb_id
			left join app.kunden kn on kn.id = a.kunde_id and kn.betrieb_id = a.betrieb_id
			left join app.caldav_objekte o on o.todo_id = t.id and o.betrieb_id = t.betrieb_id
			where t.betrieb_id = ${k.betriebId}
				${nurId ? tx`and t.id = ${nurId}` : tx``}
				and ${todoSichtbar(tx, s.sicht)}
				and ${meine(tx, k.benutzerId)}
				and (t.erledigt_am is null or t.erledigt_am > now() - make_interval(days => ${ERLEDIGT_TAGE}))
			order by t.angelegt, t.id
			limit ${MAX_AUFGABEN}`;
		const erinnern = darfErinnern(s);
		return z.map((r) => ({
			id: r.id,
			uid: r.caldav_uid ?? r.id,
			name: r.caldav_name ?? `${r.id}.ics`,
			auftragId: r.auftrag_id ?? null,
			titel: r.titel,
			beschreibung: r.beschreibung ?? null,
			faellig: r.faellig ?? null,
			faelligZeit: r.faellig_zeit ?? null,
			vonTag: r.von_tag ?? null,
			vonZeit: r.von_zeit ?? null,
			erledigtAm: r.erledigt_am ? new Date(r.erledigt_am).toISOString() : null,
			prioritaet: r.prioritaet ?? null,
			auftrag: r.auftrag_id ? { id: r.auftrag_id, nummer: r.auftrag_nummer ?? null, titel: r.auftrag_titel } : null,
			kundeName: r.auftrag_id && (r.kunde_art || r.einmal_name) ? kundeNameAus(r) : null,
			wiederkehrend: r.serie_id !== null,
			erinnerungen: erinnern ? (r.erinnerungen as Date[]).map((d) => new Date(d).toISOString()) : [],
			angelegt: new Date(r.angelegt).toISOString(),
			geaendert: new Date(r.geaendert).toISOString(),
			link: `${s.origin}${r.auftrag_id ? `/auftraege/${r.auftrag_id}` : '/todos'}`
		}));
	});
}

const objektVon = (z: Zeile): Objekt => {
	const ics = erzeugeVtodo(z);
	return { name: z.name, aufgabe: z, ics, etag: etagVon(ics) };
};

/** Sammlung einer Aufgabe in der gewählten Darstellung. */
const sammlungVon = (z: { auftragId: string | null }, jeAuftrag: boolean) => (jeAuftrag && z.auftragId ? `auftrag-${z.auftragId}` : MEINE);

/** Alle Listen des Benutzers. */
export async function sammlungen(s: Sitzung): Promise<Sammlung[]> {
	const liste: Sammlung[] = [{ schluessel: MEINE, name: 'Meine Aufgaben (CRM)', auftragId: null }];
	if (!(await jeAuftragVon(s))) return liste;
	const { k } = s;
	const auftraege = await mitBetrieb(k, async (tx) => {
		// Aufträge mit eigenen Aufgaben (siehe ladeAufgaben) und offene Aufträge, für die ich zuständig bin
		return tx`
			select a.id, a.nummer, a.titel from app.auftraege a
			where a.betrieb_id = ${k.betriebId}
				and (
					exists (
						select 1 from app.todos t
						where t.auftrag_id = a.id and t.betrieb_id = a.betrieb_id and ${todoSichtbar(tx, s.sicht)} and ${meine(tx, k.benutzerId)}
							and (t.erledigt_am is null or t.erledigt_am > now() - make_interval(days => ${ERLEDIGT_TAGE}))
					)
					or (a.status <> 'abgerechnet' and exists (
						select 1 from app.auftrag_zustaendige az where az.auftrag_id = a.id and az.betrieb_id = a.betrieb_id and az.benutzer_id = ${k.benutzerId}))
				)
			order by a.nummer nulls last, a.titel, a.id
			limit 200`;
	});
	for (const a of auftraege) {
		liste.push({ schluessel: `auftrag-${a.id}`, name: [a.nummer, a.titel].filter(Boolean).join(' '), auftragId: a.id });
	}
	return liste;
}

export async function sammlung(s: Sitzung, schluessel: string): Promise<Sammlung | null> {
	if (schluessel !== MEINE && !/^auftrag-[0-9a-f-]{36}$/.test(schluessel)) return null;
	return (await sammlungen(s)).find((x) => x.schluessel === schluessel) ?? null;
}

const jeAuftragVon = (s: Sitzung) => ((s.zwischen ??= {}).jeAuftrag ??= listenJeAuftrag(s.k));

/** Inhalt einer Liste: Name → Objekt. `frisch`: ohne Zwischenspeicher (beim Schreiben). */
export async function inhalt(s: Sitzung, schluessel: string, frisch = false): Promise<Map<string, Objekt>> {
	const je = frisch ? await listenJeAuftrag(s.k) : await jeAuftragVon(s);
	const zeilen = frisch ? await ladeAufgaben(s) : await ((s.zwischen ??= {}).zeilen ??= ladeAufgaben(s));
	const m = new Map<string, Objekt>();
	for (const z of zeilen) {
		if (sammlungVon(z, je) === schluessel) m.set(z.name, objektVon(z));
	}
	return m;
}

const pruefsummeVon = (eintraege: Record<string, string>) =>
	createHash('sha256')
		.update(JSON.stringify(Object.entries(eintraege).sort(([a], [b]) => (a < b ? -1 : 1))))
		.digest('base64url')
		.slice(0, 32);

export const eintraegeVon = (m: Map<string, Objekt>): Record<string, string> => Object.fromEntries([...m].map(([n, o]) => [n, o.etag]));

/** Prüfsumme (CTag) einer Liste. */
export const ctagVon = (m: Map<string, Objekt>) => pruefsummeVon(eintraegeVon(m));

/**
 * Token für den aktuellen Stand der Liste: der letzte gespeicherte, wenn er gleich ist, sonst ein neuer. Alte Stände
 * (älter als 30 Tage bzw. mehr als 50 je Liste) werden aufgeräumt – wer einen davon schickt, gleicht neu ab.
 */
export async function aktuellerStand(s: Sitzung, schluessel: string, m: Map<string, Objekt>): Promise<string> {
	const eintraege = eintraegeVon(m);
	const summe = pruefsummeVon(eintraege);
	const { k } = s;
	return mitBetrieb(k, async (tx) => {
		const [letzter] = await tx`
			select token, pruefsumme from app.caldav_sync
			where betrieb_id = ${k.betriebId} and benutzer_id = ${k.benutzerId} and sammlung = ${schluessel}
			order by angelegt desc limit 1`;
		if (letzter && letzter.pruefsumme === summe) return letzter.token as string;
		const [neu] = await tx`
			insert into app.caldav_sync (betrieb_id, benutzer_id, sammlung, eintraege, pruefsumme)
			values (${k.betriebId}, ${k.benutzerId}, ${schluessel}, ${tx.json(eintraege)}, ${summe}) returning token`;
		await tx`
			delete from app.caldav_sync
			where betrieb_id = ${k.betriebId} and benutzer_id = ${k.benutzerId} and sammlung = ${schluessel}
				and (angelegt < now() - interval '30 days' or token in (
					select token from app.caldav_sync
					where betrieb_id = ${k.betriebId} and benutzer_id = ${k.benutzerId} and sammlung = ${schluessel}
					order by angelegt desc offset 50))`;
		return neu.token as string;
	});
}

/** Gespeicherter Stand zu einem Token (nur eigene, nur diese Liste) oder null. */
export async function ladeStand(s: Sitzung, schluessel: string, token: string): Promise<Record<string, string> | null> {
	if (!UUID.test(token)) return null;
	const { k } = s;
	return mitBetrieb(k, async (tx) => {
		const [z] = await tx`
			select eintraege from app.caldav_sync
			where token = ${token} and betrieb_id = ${k.betriebId} and benutzer_id = ${k.benutzerId} and sammlung = ${schluessel}`;
		return z ? (z.eintraege as Record<string, string>) : null;
	});
}

// ——— Schreiben ———

export class Vorbedingung extends Error {
	constructor(
		public readonly status: 412 | 403 | 409,
		meldung: string,
		/** DAV-/CalDAV-Vorbedingung für den Fehlerkörper */
		public readonly bedingung?: { ns: string; name: string }
	) {
		super(meldung);
		this.name = 'Vorbedingung';
	}
}

export type Bedingungen = { ifMatch: string | null; ifNoneMatch: string | null };

function pruefeBedingungen(b: Bedingungen, etag: string | null): void {
	if (b.ifNoneMatch !== null) {
		const liste = b.ifNoneMatch.split(',').map((x) => x.trim());
		if (etag !== null && (liste.includes('*') || liste.includes(etag))) throw new Vorbedingung(412, 'Die Aufgabe gibt es schon.');
	}
	if (b.ifMatch !== null) {
		const liste = b.ifMatch.split(',').map((x) => x.trim().replace(/^W\//, ''));
		if (etag === null || !(liste.includes('*') || liste.includes(etag))) {
			throw new Vorbedingung(412, 'Die Aufgabe wurde inzwischen geändert.');
		}
	}
}

const jetztMinute = () => Date.now() - 60_000;

/** Erinnerungen vom Handy: nur zukünftige, höchstens zwei. */
const kuenftige = (liste: number[]) => liste.filter((ms) => ms >= jetztMinute()).slice(0, MAX_ERINNERUNGEN);

async function setzePrioritaet(tx: TransactionSql, k: Kontext, id: string, prioritaet: number | null): Promise<void> {
	await tx`update app.todos set prioritaet = ${prioritaet} where id = ${id} and betrieb_id = ${k.betriebId}`;
}

async function erinnerungenSetzen(tx: TransactionSql, s: Sitzung, id: string, liste: number[], faellig: string | null, faelligZeit: string | null) {
	await setzeErinnerungen(
		tx,
		s.k,
		{ todoId: id },
		liste.map((ms) => ({ zeitpunkt: new Date(ms) })),
		todoFaelligUm(faellig, faelligZeit)
	);
}

/**
 * Speichert eine Aufgabe vom Handy (PUT). Gibt `neu` zurück, wenn sie angelegt wurde. Rechte wie in der App: Mit
 * „Aufträge anlegen und ändern“ alles; sonst nur Abhaken/Öffnen der eigenen Aufgabe und eigene Erinnerungen. ETag-
 * Prüfung (If-Match / If-None-Match) und Speichern laufen in einer Transaktion mit gesperrter Zeile.
 */
export async function speichere(
	s: Sitzung,
	schluessel: string,
	name: string,
	g: Gelesen,
	b: Bedingungen
): Promise<{ neu: boolean }> {
	const { k } = s;
	return inEinerTransaktion(k, 'caldav', async () => {
		const je = await listenJeAuftrag(k);
		// Bestehende Aufgabe über den Namen (ID oder vom Handy gewählter Name)
		const idAusName = /^([0-9a-f-]{36})\.ics$/.exec(name)?.[1] ?? null;
		const id = await mitBetrieb(k, async (tx) => {
			const [z] = await tx`
				select t.id from app.todos t left join app.caldav_objekte o on o.todo_id = t.id and o.betrieb_id = t.betrieb_id
				where t.betrieb_id = ${k.betriebId} and (o.name = ${name} or (o.name is null and t.id = ${idAusName}::uuid))
				for update of t`;
			return (z?.id as string | undefined) ?? null;
		});
		const vorhanden = id ? (await ladeAufgaben(s, id)).find((z) => sammlungVon(z, je) === schluessel) ?? null : null;
		if (id && !vorhanden) {
			// gibt es, gehört aber nicht (mehr) in diese Liste bzw. ist nicht sichtbar
			throw new ApiFehler(404, 'Aufgabe nicht gefunden.');
		}
		pruefeBedingungen(b, vorhanden ? objektVon(vorhanden).etag : null);

		if (vorhanden) {
			const alt = felderVon(vorhanden);
			const neu = { ...g, erinnerungen: kuenftige(g.erinnerungen) };
			const a = aenderungen({ ...alt, erinnerungen: kuenftige(alt.erinnerungen) }, neu);
			const fachlich: Record<string, unknown> = {};
			if (a.titel !== undefined) fachlich.titel = a.titel;
			if (a.beschreibung !== undefined) fachlich.beschreibung = a.beschreibung ?? '';
			if (a.zeit) Object.assign(fachlich, { faellig: a.zeit.faellig ?? '', faelligZeit: a.zeit.faelligZeit ?? '', vonTag: a.zeit.vonTag ?? '', vonZeit: a.zeit.vonZeit ?? '' });
			if (Object.keys(fachlich).length > 0 || a.prioritaet !== undefined) {
				if (!darfBearbeiten(s)) throw new ApiFehler(403, 'Ändern darfst du diese Aufgabe nicht – nur abhaken.');
			}
			if (a.erledigt !== undefined) fachlich.erledigt = a.erledigt;
			if (Object.keys(fachlich).length > 0) {
				if (darfBearbeiten(s)) await aendereTodo(k, vorhanden.id, fachlich, s.sicht);
				else await aendereTodoAls(k, s.sicht, false, vorhanden.id, fachlich);
			}
			await mitBetrieb(k, async (tx) => {
				if (a.prioritaet !== undefined) await setzePrioritaet(tx, k, vorhanden.id, a.prioritaet);
				if (a.erinnerungen !== undefined && darfErinnern(s)) {
					const f = a.zeit ?? vorhanden;
					await erinnerungenSetzen(tx, s, vorhanden.id, neu.erinnerungen, f.faellig, f.faelligZeit);
				}
			});
			return { neu: false };
		}

		// Neue Aufgabe vom Handy
		if (!darfBearbeiten(s)) throw new ApiFehler(403, 'Neue Aufgaben darfst du nicht anlegen.');
		if (!/^[A-Za-z0-9._@~+=-]{1,200}\.ics$/.test(name)) throw new ApiFehler(400, 'Ungültiger Dateiname.');
		const auftragId = schluessel.startsWith('auftrag-') ? schluessel.slice('auftrag-'.length) : null;
		const t = await legeTodoAn(
			k,
			{
				titel: g.titel,
				beschreibung: g.beschreibung ?? '',
				faellig: g.faellig ?? '',
				faelligZeit: g.faelligZeit ?? '',
				vonTag: g.vonTag ?? '',
				vonZeit: g.vonZeit ?? '',
				zustaendigId: k.benutzerId,
				auftragId: auftragId ?? ''
			},
			s.sicht
		);
		await mitBetrieb(k, async (tx) => {
			const [doppelt] = await tx`select 1 from app.caldav_objekte where betrieb_id = ${k.betriebId} and uid = ${g.uid}`;
			const [idUid] = UUID.test(g.uid) ? await tx`select 1 from app.todos where betrieb_id = ${k.betriebId} and id = ${g.uid.toLowerCase()}` : [];
			if (doppelt || idUid) throw new Vorbedingung(403, 'Diese Aufgabe (UID) gibt es schon.', { ns: 'urn:ietf:params:xml:ns:caldav', name: 'no-uid-conflict' });
			await tx`insert into app.caldav_objekte (todo_id, betrieb_id, uid, name) values (${t.id}, ${k.betriebId}, ${g.uid}, ${name})`;
			if (g.prioritaet !== null) await setzePrioritaet(tx, k, t.id, g.prioritaet);
		});
		if (g.erledigt) await aendereTodo(k, t.id, { erledigt: true }, s.sicht);
		const kuenftig = kuenftige(g.erinnerungen);
		if (kuenftig.length > 0 && darfErinnern(s)) {
			await mitBetrieb(k, (tx) => erinnerungenSetzen(tx, s, t.id, kuenftig, g.faellig, g.faelligZeit));
		}
		return { neu: true };
	});
}

/** Löscht eine Aufgabe vom Handy (DELETE) – nur mit „Aufträge anlegen und ändern“. */
export async function loesche(s: Sitzung, schluessel: string, name: string, b: Bedingungen): Promise<void> {
	const { k } = s;
	await inEinerTransaktion(k, 'caldav', async () => {
		const objekt = (await inhalt(s, schluessel, true)).get(name);
		if (!objekt) throw new ApiFehler(404, 'Aufgabe nicht gefunden.');
		await mitBetrieb(k, (tx) => tx`select 1 from app.todos where id = ${objekt.aufgabe.id} and betrieb_id = ${k.betriebId} for update`);
		const aktuell = (await inhalt(s, schluessel, true)).get(name);
		if (!aktuell) throw new ApiFehler(404, 'Aufgabe nicht gefunden.');
		pruefeBedingungen(b, aktuell.etag);
		if (!darfBearbeiten(s)) throw new ApiFehler(403, 'Löschen darfst du diese Aufgabe nicht.');
		await loescheTodo(k, aktuell.aufgabe.id, s.sicht);
	});
}
