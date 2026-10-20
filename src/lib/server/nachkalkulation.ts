import { mitBetrieb, type Kontext, type TransactionSql } from './db';
import { ApiFehler } from './fehler';
import { holeAuftrag, type Sicht } from './auftraege';
import { ladeKalkulation } from './kalkulation';
import { UUID } from './kunden';
import { hatRecht, pruefeRecht } from './rechte';
import { darf } from './tarif';
import { GEWERK_NAMEN } from '../katalog-werte';
import { istTag, tagesGrenzen } from '../zeit';
import { summiere } from '../zeiterfassung';
import {
	kmSatz,
	lernVorschlaege,
	nachkalkuliere,
	planWerte,
	type LernVorschlag,
	type Nachkalkulation,
	type PlanPosition
} from '../nachkalkulation';
import type { Ampel, Firmensatz } from '../kalkulation';

/**
 * Nachkalkulation je Auftrag und Auswertung (Wunsch Jamil msgs 2770–2774, Punkt 1). Rechnung: src/lib/nachkalkulation.ts.
 * Zugriff: Modul `zeiterfassung`, „Preise sehen“ UND „Alle Aufträge ansehen“ (Chef/Büro) – Monteure nie.
 * Zeiten auf „Tätigkeiten ohne Auftrag“ (Lager, Werkstatt …) zählen nie auf einen Auftrag, sondern erscheinen in der
 * Auswertung je Mitarbeiter als „nicht produktiv / Gemeinkosten“ (Jamil msg 2776).
 */

export async function nachkalkZugriff(locals: { nutzer: Nutzer | null }): Promise<Kontext> {
	pruefeRecht(locals, 'preise.sehen');
	pruefeRecht(locals, 'auftraege.alle_lesen');
	await darf(locals, 'zeiterfassung', 'preise.sehen');
	const n = locals.nutzer!;
	return { betriebId: n.betriebId!, benutzerId: n.id };
}

/** Darf der Nutzer die Nachkalkulation sehen? (für Seiten, ohne Fehler) */
export function siehtNachkalkulation(nutzer: Nutzer, module: readonly string[]): boolean {
	return module.includes('zeiterfassung') && hatRecht(nutzer, 'preise.sehen') && hatRecht(nutzer, 'auftraege.alle_lesen');
}

type Grundlagen = { satz: Firmensatz | null; kmSatzCent: number | null };

async function grundlagen(k: Kontext): Promise<Grundlagen> {
	const d = await ladeKalkulation(k);
	const u = d.uebersicht;
	const satz = u.kostendeckendCent !== null && u.empfohlenCent !== null ? { kostendeckendCent: u.kostendeckendCent, empfohlenCent: u.empfohlenCent } : null;
	const fahrzeug = u.kategorien.find((x) => x.kategorie === 'fahrzeug')?.jahresCent ?? 0;
	return { satz, kmSatzCent: kmSatz(d.betrieb.kmSatzCent ?? null, fahrzeug, d.betrieb.jahresKm ?? null) };
}

async function planPositionen(tx: TransactionSql, k: Kontext, ids: string[]): Promise<Map<string, PlanPosition[]>> {
	const z = await tx`
		select an.auftrag_id, p.katalog_position_id, p.bezeichnung, p.menge, p.einheit, p.arbeit_minuten, p.material_cent,
			p.einzelpreis_cent, kp.gewerk
		from app.angebot_positionen p
		join app.angebote an on an.id = p.angebot_id and an.betrieb_id = p.betrieb_id
		left join app.katalog_positionen kp on kp.id = p.katalog_position_id and kp.betrieb_id = p.betrieb_id
		where an.betrieb_id = ${k.betriebId} and an.status = 'angenommen' and an.auftrag_id = any(${ids}::uuid[])
		order by an.angelegt, p.pos`;
	const m = new Map<string, PlanPosition[]>();
	for (const r of z) {
		const l = m.get(r.auftrag_id) ?? [];
		l.push({
			katalogPositionId: r.katalog_position_id,
			bezeichnung: r.bezeichnung,
			menge: Number(r.menge),
			einheit: r.einheit,
			arbeitMinuten: r.arbeit_minuten === null ? null : Number(r.arbeit_minuten),
			materialCent: r.material_cent === null ? null : Number(r.material_cent),
			einzelpreisCent: Number(r.einzelpreis_cent),
			gewerk: r.gewerk
		});
		m.set(r.auftrag_id, l);
	}
	return m;
}

type Ist = { arbeitMin: number; fahrtMin: number; km: number; jePerson: Map<string, { arbeitMin: number; fahrtMin: number }> };

async function istZeiten(tx: TransactionSql, k: Kontext, ids: string[], jetzt: Date): Promise<Map<string, Ist>> {
	const z = await tx`
		select auftrag_id, benutzer_id, art, beginn, ende, pause_min, km from app.zeit_eintraege
		where betrieb_id = ${k.betriebId} and auftrag_id = any(${ids}::uuid[])`;
	const m = new Map<string, Ist>();
	for (const id of ids) {
		const eigene = z.filter((r) => r.auftrag_id === id);
		const alsEintrag = (r: (typeof z)[number]) => ({ art: r.art, beginn: new Date(r.beginn).toISOString(), ende: r.ende ? new Date(r.ende).toISOString() : null, pauseMin: Number(r.pause_min), km: r.km === null ? null : Number(r.km) });
		const s = summiere(eigene.map(alsEintrag), jetzt);
		const jePerson = new Map<string, { arbeitMin: number; fahrtMin: number }>();
		for (const b of new Set(eigene.map((r) => r.benutzer_id as string))) {
			const sp = summiere(eigene.filter((r) => r.benutzer_id === b).map(alsEintrag), jetzt);
			jePerson.set(b, { arbeitMin: sp.arbeitMin, fahrtMin: sp.fahrtMin });
		}
		m.set(id, { arbeitMin: s.arbeitMin, fahrtMin: s.fahrtMin, km: s.km, jePerson });
	}
	return m;
}

async function istMaterial(tx: TransactionSql, k: Kontext, ids: string[]): Promise<Map<string, number>> {
	const z = await tx`
		select m.auftrag_id, sum(round(m.menge * coalesce(m.preis_cent, p.material_cent, 0)))::bigint as cent
		from app.auftrag_material m
		left join app.angebot_positionen p on p.id = m.angebot_position_id and p.betrieb_id = m.betrieb_id
		where m.betrieb_id = ${k.betriebId} and m.auftrag_id = any(${ids}::uuid[])
		group by m.auftrag_id`;
	return new Map(z.map((r) => [r.auftrag_id as string, Number(r.cent)]));
}

async function rechne(k: Kontext, ids: string[], jetzt: Date) {
	const g = await grundlagen(k);
	return mitBetrieb(k, async (tx) => {
		const [plan, ist, mat] = [await planPositionen(tx, k, ids), await istZeiten(tx, k, ids, jetzt), await istMaterial(tx, k, ids)];
		const aus = new Map<string, { nk: Nachkalkulation; positionen: PlanPosition[]; ist: Ist }>();
		for (const id of ids) {
			const positionen = plan.get(id) ?? [];
			const i = ist.get(id)!;
			aus.set(id, {
				positionen,
				ist: i,
				nk: nachkalkuliere({ positionen, istArbeitMin: i.arbeitMin, istFahrtMin: i.fahrtMin, istKm: i.km, istMaterialCent: mat.has(id) ? mat.get(id)! : null, satz: g.satz, kmSatzCent: g.kmSatzCent })
			});
		}
		return { g, aus };
	});
}

/** Nachkalkulation eines Auftrags (Plan/Ist/Ampel). */
export async function nachkalkulationAuftrag(k: Kontext, auftragId: string, sicht: Sicht, jetzt = new Date()): Promise<Nachkalkulation & { kmSatzCent: number | null; satz: Firmensatz | null }> {
	if (!UUID.test(auftragId)) throw new ApiFehler(404, 'Auftrag nicht gefunden.');
	await holeAuftrag(k, sicht, auftragId);
	const { g, aus } = await rechne(k, [auftragId], jetzt);
	return { ...aus.get(auftragId)!.nk, kmSatzCent: g.kmSatzCent, satz: g.satz };
}

// ——— Auswertung ———

export type Gruppe = 'gewerk' | 'leistung' | 'quelle' | 'mitarbeiter';
export const GRUPPEN: Record<Gruppe, string> = { gewerk: 'Gewerk (Auftragsart)', leistung: 'Leistung', quelle: 'Auftragsquelle', mitarbeiter: 'Mitarbeiter' };
export const istGruppe = (w: unknown): w is Gruppe => typeof w === 'string' && Object.hasOwn(GRUPPEN, w);

export type GruppenZeile = {
	schluessel: string;
	name: string;
	auftraege: number;
	erloesCent: number;
	istKostenCent: number | null;
	istGewinnCent: number | null;
	planGewinnCent: number | null;
	planStunden: number;
	istStunden: number;
	ampel: Ampel | null;
	/** nur Mitarbeiter: Stunden auf Tätigkeiten ohne Auftrag */
	nichtProduktivStunden?: number;
	produktivProzent?: number | null;
};

export type AuswertungsAuftrag = {
	id: string;
	nummer: string;
	titel: string;
	kundeName: string;
	status: string;
	quelle: string | null;
	gewerk: string | null;
	nk: Nachkalkulation;
};

export type Auswertung = {
	von: string;
	bis: string;
	gruppe: Gruppe;
	auftraege: AuswertungsAuftrag[];
	zeilen: GruppenZeile[];
	nichtProduktiv: { mitarbeiter: string; taetigkeit: string; stunden: number }[];
	lernen: LernVorschlag[];
	satz: Firmensatz | null;
	kmSatzCent: number | null;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

function ampelVon(dbCent: number, stunden: number, satz: Firmensatz | null, erloes: number): Ampel | null {
	if (!satz || stunden <= 0 || erloes <= 0) return null;
	const eff = dbCent / stunden;
	return eff < satz.kostendeckendCent ? 'rot' : eff < satz.empfohlenCent ? 'gelb' : 'gruen';
}

/**
 * Aufträge mit erfasster Zeit im Zeitraum (Berliner Tage von–bis); für sie zählt die GANZE Ist-Zeit (Nachkalkulation je
 * Auftrag). Gruppiert nach Gewerk (überwiegendes Gewerk der geplanten Stunden), Leistung (Katalogposition, Ist anteilig
 * nach geplanten Minuten), Auftragsquelle oder Mitarbeiter (Anteil an den Stunden; dazu nicht produktive Stunden).
 * Lernvorschläge aus abgenommenen/abgerechneten Aufträgen (alle Zeiträume).
 */
export async function auswertung(k: Kontext, f: { von: string; bis: string; gruppe: Gruppe }, jetzt = new Date()): Promise<Auswertung> {
	if (!istTag(f.von) || !istTag(f.bis) || f.bis < f.von) throw new ApiFehler(400, 'Ungültiger Zeitraum.');
	const ab = tagesGrenzen(f.von).beginn;
	const bis = tagesGrenzen(f.bis).ende;
	const kopf = await mitBetrieb(k, (tx) => tx`
		select a.id, a.nummer, a.titel, a.status, q.name as quelle,
			coalesce(k.firma, nullif(btrim(concat_ws(' ', k.vorname, k.nachname)), ''), a.einmal_name, 'Ohne Kunde') as kunde_name
		from app.auftraege a
		left join app.auftrag_quellen q on q.id = a.quelle_id and q.betrieb_id = a.betrieb_id
		left join app.kunden k on k.id = a.kunde_id and k.betrieb_id = a.betrieb_id
		where a.betrieb_id = ${k.betriebId} and exists (
			select 1 from app.zeit_eintraege z where z.auftrag_id = a.id and z.betrieb_id = a.betrieb_id and z.art <> 'pause'
				and z.beginn < ${bis} and coalesce(z.ende, now()) > ${ab})
		order by a.nummer
		limit 500`);
	const ids = kopf.map((a) => a.id as string);
	const { g, aus } = await rechne(k, ids, jetzt);
	const satz = g.satz?.kostendeckendCent ?? null;

	const gewerkVon = (pos: PlanPosition[]) => {
		const je = new Map<string, number>();
		for (const p of pos) {
			const w = planWerte([p]).minuten || Math.round(p.menge * p.einzelpreisCent) / 1e6;
			const gw = p.gewerk ?? 'sonstiges';
			je.set(gw, (je.get(gw) ?? 0) + w);
		}
		return [...je].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
	};
	const auftraege: AuswertungsAuftrag[] = kopf.map((a) => {
		const x = aus.get(a.id)!;
		return { id: a.id, nummer: a.nummer, titel: a.titel, kundeName: a.kunde_name, status: a.status, quelle: a.quelle, gewerk: gewerkVon(x.positionen), nk: x.nk };
	});

	// Gruppen
	type Summe = { name: string; ids: Set<string>; erloes: number; kosten: number | null; gewinn: number | null; planGewinn: number | null; planStd: number; istStd: number; db: number; std: number };
	const gruppen = new Map<string, Summe>();
	const add = (schluessel: string, name: string, auftragId: string, w: { erloes: number; kosten: number | null; planGewinn: number | null; planStd: number; istStd: number; db: number; std: number }) => {
		const s = gruppen.get(schluessel) ?? { name, ids: new Set(), erloes: 0, kosten: 0, gewinn: 0, planGewinn: 0, planStd: 0, istStd: 0, db: 0, std: 0 };
		s.ids.add(auftragId);
		s.erloes += w.erloes;
		s.kosten = s.kosten === null || w.kosten === null ? null : s.kosten + w.kosten;
		s.gewinn = s.kosten === null ? null : s.erloes - s.kosten;
		s.planGewinn = s.planGewinn === null || w.planGewinn === null ? null : s.planGewinn + w.planGewinn;
		s.planStd += w.planStd;
		s.istStd += w.istStd;
		s.db += w.db;
		s.std += w.std;
		gruppen.set(schluessel, s);
	};
	const personNamen = new Map<string, string>();
	if (f.gruppe === 'mitarbeiter') {
		for (const p of await mitBetrieb(k, (tx) => tx`select id, name from app.benutzer where betrieb_id = ${k.betriebId}`)) personNamen.set(p.id, p.name);
	}
	for (const a of auftraege) {
		const x = aus.get(a.id)!;
		const nk = a.nk;
		const ganz = { erloes: nk.ist.erloesCent, kosten: nk.ist.kostenCent, planGewinn: nk.plan.gewinnCent, planStd: nk.plan.stunden, istStd: nk.ist.stunden, db: nk.ist.deckungsbeitragCent, std: nk.ist.stunden + nk.ist.fahrtStunden };
		if (f.gruppe === 'gewerk') add(a.gewerk ?? '–', a.gewerk ? (GEWERK_NAMEN as Record<string, string>)[a.gewerk] ?? a.gewerk : 'ohne Gewerk', a.id, ganz);
		else if (f.gruppe === 'quelle') add(a.quelle ?? '–', a.quelle ?? 'ohne Quelle', a.id, ganz);
		else if (f.gruppe === 'mitarbeiter') {
			const gesamt = [...x.ist.jePerson.values()].reduce((s, p) => s + p.arbeitMin + p.fahrtMin, 0);
			for (const [b, p] of x.ist.jePerson) {
				const anteil = gesamt > 0 ? (p.arbeitMin + p.fahrtMin) / gesamt : 0;
				add(b, personNamen.get(b) ?? '–', a.id, {
					erloes: Math.round(ganz.erloes * anteil),
					kosten: ganz.kosten === null ? null : Math.round(ganz.kosten * anteil),
					planGewinn: ganz.planGewinn === null ? null : Math.round(ganz.planGewinn * anteil),
					planStd: ganz.planStd * anteil,
					istStd: p.arbeitMin / 60,
					db: Math.round(ganz.db * anteil),
					std: (p.arbeitMin + p.fahrtMin) / 60
				});
			}
		} else {
			// Leistung: Ist anteilig nach geplanten Minuten (ohne Minuten: nach Erlös)
			const planMin = planWerte(x.positionen).minuten;
			const planErloes = nk.plan.erloesCent;
			for (const p of x.positionen) {
				const pw = planWerte([p]);
				const anteil = planMin > 0 ? pw.minuten / planMin : planErloes > 0 ? pw.erloesCent / planErloes : 0;
				const matAnteil = nk.plan.materialCent > 0 ? pw.materialCent / nk.plan.materialCent : anteil;
				const lohn = satz === null ? null : Math.round((nk.ist.stunden + nk.ist.fahrtStunden) * anteil * satz);
				const kosten = lohn === null ? null : lohn + Math.round(nk.ist.materialCent * matAnteil) + Math.round((nk.ist.kmKostenCent ?? 0) * anteil);
				add(p.katalogPositionId ?? `frei:${p.bezeichnung}`, p.bezeichnung, a.id, {
					erloes: pw.erloesCent,
					kosten,
					planGewinn: satz === null ? null : pw.erloesCent - pw.materialCent - Math.round((pw.minuten / 60) * satz),
					planStd: pw.minuten / 60,
					istStd: nk.ist.stunden * anteil,
					db: pw.erloesCent - Math.round(nk.ist.materialCent * matAnteil) - Math.round((nk.ist.kmKostenCent ?? 0) * anteil),
					std: (nk.ist.stunden + nk.ist.fahrtStunden) * anteil
				});
			}
		}
	}

	// Nicht produktiv (Tätigkeiten ohne Auftrag) im Zeitraum, je Mitarbeiter und Tätigkeit
	const np = await mitBetrieb(k, (tx) => tx`
		select z.benutzer_id, b.name, t.name as taetigkeit, z.art, z.beginn, z.ende, z.pause_min, z.km
		from app.zeit_eintraege z
		join app.benutzer b on b.id = z.benutzer_id and b.betrieb_id = z.betrieb_id
		left join app.zeit_taetigkeiten t on t.id = z.taetigkeit_id and t.betrieb_id = z.betrieb_id
		where z.betrieb_id = ${k.betriebId} and z.auftrag_id is null and z.beginn < ${bis} and coalesce(z.ende, now()) > ${ab}`);
	const npMap = new Map<string, { mitarbeiter: string; taetigkeit: string; min: number; benutzerId: string }>();
	for (const r of np) {
		if (r.art !== 'arbeit') continue;
		const s = summiere([{ art: 'arbeit', beginn: new Date(r.beginn).toISOString(), ende: r.ende ? new Date(r.ende).toISOString() : null, pauseMin: Number(r.pause_min), km: null }], jetzt, { von: ab, bis });
		const key = `${r.benutzer_id}|${r.taetigkeit ?? ''}`;
		const e = npMap.get(key) ?? { mitarbeiter: r.name, taetigkeit: r.taetigkeit ?? 'ohne Auftrag', min: 0, benutzerId: r.benutzer_id };
		e.min += s.arbeitMin;
		npMap.set(key, e);
	}
	const nichtProduktiv = [...npMap.values()].map((e) => ({ mitarbeiter: e.mitarbeiter, taetigkeit: e.taetigkeit, stunden: r2(e.min / 60) }));

	const zeilen: GruppenZeile[] = [...gruppen].map(([schluessel, s]) => {
		const z: GruppenZeile = {
			schluessel,
			name: s.name,
			auftraege: s.ids.size,
			erloesCent: s.erloes,
			istKostenCent: s.kosten,
			istGewinnCent: s.gewinn,
			planGewinnCent: s.planGewinn,
			planStunden: r2(s.planStd),
			istStunden: r2(s.istStd),
			ampel: ampelVon(s.db, s.std, g.satz, s.erloes)
		};
		if (f.gruppe === 'mitarbeiter') {
			const npStd = [...npMap.values()].filter((e) => e.benutzerId === schluessel).reduce((x, e) => x + e.min / 60, 0);
			z.nichtProduktivStunden = r2(npStd);
			z.produktivProzent = s.std + npStd > 0 ? Math.round((s.std / (s.std + npStd)) * 100) : null;
		}
		return z;
	});
	// Mitarbeiter nur mit nicht produktiven Stunden
	if (f.gruppe === 'mitarbeiter') {
		for (const e of npMap.values()) {
			if (zeilen.some((z) => z.schluessel === e.benutzerId)) continue;
			const npStd = [...npMap.values()].filter((x) => x.benutzerId === e.benutzerId).reduce((x, y) => x + y.min / 60, 0);
			zeilen.push({ schluessel: e.benutzerId, name: e.mitarbeiter, auftraege: 0, erloesCent: 0, istKostenCent: 0, istGewinnCent: 0, planGewinnCent: 0, planStunden: 0, istStunden: 0, ampel: null, nichtProduktivStunden: r2(npStd), produktivProzent: 0 });
		}
	}
	zeilen.sort((a, b) => (a.istGewinnCent ?? 0) - (b.istGewinnCent ?? 0));

	return { von: f.von, bis: f.bis, gruppe: f.gruppe, auftraege, zeilen, nichtProduktiv, lernen: await lernen(k, jetzt), satz: g.satz, kmSatzCent: g.kmSatzCent };
}

/** Lernvorschläge „Minuten pro Einheit“ aus abgenommenen/abgerechneten Aufträgen mit erfasster Arbeitszeit. */
export async function lernen(k: Kontext, jetzt = new Date()): Promise<LernVorschlag[]> {
	const fertig = await mitBetrieb(k, (tx) => tx`
		select a.id from app.auftraege a
		where a.betrieb_id = ${k.betriebId} and a.status in ('abgenommen', 'abgerechnet')
			and exists (select 1 from app.zeit_eintraege z where z.auftrag_id = a.id and z.betrieb_id = a.betrieb_id and z.art = 'arbeit')
		order by a.geaendert desc limit 300`);
	if (fertig.length === 0) return [];
	const ids = fertig.map((r) => r.id as string);
	const proben = await mitBetrieb(k, async (tx) => {
		const plan = await planPositionen(tx, k, ids);
		const ist = await istZeiten(tx, k, ids, jetzt);
		return ids.map((id) => ({ auftragId: id, positionen: plan.get(id) ?? [], istArbeitMin: ist.get(id)!.arbeitMin }));
	});
	// Der aktuelle Katalogwert gilt als Vergleich (nicht der damals im Angebot)
	const kat = await mitBetrieb(k, (tx) => tx`select id, arbeit_minuten, einheit from app.katalog_positionen where betrieb_id = ${k.betriebId}`);
	const aktuell = new Map(kat.map((r) => [r.id as string, r.arbeit_minuten === null ? (r.einheit === 'h' ? 60 : null) : Number(r.arbeit_minuten)]));
	return lernVorschlaege(proben).flatMap((v) => {
		const a = aktuell.get(v.katalogPositionId);
		if (a === undefined || a === null || a <= 0) return [];
		const abw = Math.round(((v.vorschlagMin - a) / a) * 100);
		return Math.abs(abw) < 10 ? [] : [{ ...v, aktuellMin: a, abweichungProzent: abw }];
	});
}

/** Chef übernimmt einen Lernvorschlag: Minuten je Einheit der Katalogposition setzen (protokolliert). */
export async function uebernimmMinuten(k: Kontext, katalogPositionId: unknown, minuten: unknown): Promise<void> {
	if (typeof katalogPositionId !== 'string' || !UUID.test(katalogPositionId)) throw new ApiFehler(404, 'Katalogposition nicht gefunden.');
	const m = typeof minuten === 'number' ? minuten : Number(String(minuten ?? '').replace(',', '.'));
	if (!Number.isFinite(m) || m <= 0 || m > 100000) throw new ApiFehler(400, 'Ungültige Minuten.');
	const z = await mitBetrieb(k, (tx) => tx`
		update app.katalog_positionen set arbeit_minuten = ${Math.round(m * 100) / 100}
		where id = ${katalogPositionId} and betrieb_id = ${k.betriebId} returning id`);
	if (z.length === 0) throw new ApiFehler(404, 'Katalogposition nicht gefunden.');
}

/** „Welche Aufträge machen Verlust?“: Aufträge der letzten `tage` Tage mit negativem Ist-Gewinn, schlechteste zuerst. */
export async function verlustAuftraege(k: Kontext, tage = 90, jetzt = new Date()): Promise<AuswertungsAuftrag[]> {
	const bis = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(jetzt);
	const von = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date(jetzt.getTime() - tage * 86_400_000));
	const a = await auswertung(k, { von, bis, gruppe: 'gewerk' }, jetzt);
	return a.auftraege.filter((x) => (x.nk.ist.gewinnCent ?? 0) < 0).sort((x, y) => (x.nk.ist.gewinnCent ?? 0) - (y.nk.ist.gewinnCent ?? 0));
}
