# CRM System – Stufe 1b „Aufträge, To-dos, Plantafel“ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bauwelt kann Aufträge mit Statuskette führen, To-dos verteilen und Mitarbeiter auf einer Plantafel (Mitarbeiter × Tage) per Ziehen und Ablegen einplanen – mit Warnungen bei Doppelbelegung, Urlaub und Krankheit; Monteure sehen am Handy „Meine Einsätze heute“, auch bei schlechtem Netz.

**Architecture:** Gleiche Bauweise wie Stufe 1a: SQL-Migrationen mit strikter RLS (`betrieb_id`, ENABLE + FORCE), zusammengesetzte Fremdschlüssel `(x_id, betrieb_id)` gegen Querverweise zwischen Betrieben, Änderungsprotokoll per Trigger `app.protokolliere`. Fachlogik in `src/lib/server/<bereich>.ts` (Validierung + SQL über `mitBetrieb`), dünne JSON-Endpunkte unter `/api/*` und SvelteKit-Seiten unter `src/routes/(app)/*`, beide prüfen `darf(locals, modul, recht)`. Zeiten werden als `timestamptz` gespeichert; Tagesgrenzen, Wochen und „heute“ gelten immer in `Europe/Berlin`.

**Tech Stack:** wie 1a – Node 22, SvelteKit 2 + Svelte 5 + TypeScript, `postgres` 3.x, Vitest, Playwright 1.48.2 (Container), reines CSS. Keine neuen Abhängigkeiten außer, falls nötig, keine: Drag & Drop mit Pointer Events (funktioniert mit Maus, Stift und Touch), keine Bibliothek.

**Spec:** `docs/spec/pflichtenheft-v1.1.html` (Abschnitt 5 Datenmodell, Abschnitt 6 Stufe 1: Zeilen „Aufträge, To-dos“, „Plantafel“, „Rollen“, „Mobil / PWA“; Abschnitt 2 „Termine des Tages bleiben bei schlechtem Netz verfügbar“) und `docs/spec/lastenheft-v1.1.html`. Plan 1a (`docs/superpowers/plans/2026-10-15-stufe1a-fundament.md`) für Konventionen.

Nicht Teil dieses Plans: Leistungskatalog/Angebote/PDF (Plan 1c), Sprachsteuerung/KI (Plan 1d), Zeiterfassung/Fotos (Stufe 2).

## Global Constraints

- Alle Global Constraints aus Plan 1a gelten unverändert (Sandbox `crm-dev`, alle npm-Befehle im Container, nie als `crm` zur Laufzeit, RLS ENABLE + FORCE, UI Deutsch, mobile first 360 px, Touch-Ziele ≥ 44 px, Prüfung immer serverseitig, nie automatisch löschen, Commit-Trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).
- Module (aus `src/lib/tarife.ts`): Aufträge und To-dos = Modul `auftraege`; Einsätze, Abwesenheiten und Plantafel = Modul `plantafel`.
- Rechte (aus `src/lib/server/rechte.ts`, keine neuen Rechte): lesen eigener Aufträge `auftraege.lesen`, aller Aufträge `auftraege.alle_lesen`, anlegen/ändern `auftraege.bearbeiten`, planen (Einsätze, Abwesenheiten) `plantafel.bearbeiten`.
- „Eigene Aufträge“ (nur `auftraege.lesen`, ohne `auftraege.alle_lesen`) = Aufträge, in denen der Benutzer mindestens einen Einsatz hat **oder** für die ihm ein To-do zugewiesen ist. Ein fremder Auftrag liefert **404**, nicht 403 (verrät nicht, dass es ihn gibt).
- Statuskette (exakt diese Schlüssel und Beschriftungen, Reihenfolge fest): `anfrage` „Anfrage“ → `angebot` „Angebot“ → `beauftragt` „Beauftragt“ → `in_arbeit` „In Arbeit“ → `abgenommen` „Abgenommen“ → `abgerechnet` „Abgerechnet“. Erlaubt ist nur ein Schritt vor oder zurück; Löschen eines Auftrags nur im Status `anfrage`.
- Zeitzone `Europe/Berlin` für Tagesgrenzen, Wochen (Montag–Sonntag) und „heute“ – auch in der Woche der Zeitumstellung (So 25.10.2026).
- Intervalle sind halboffen `[beginn, ende)`: angrenzende Einsätze (10–12 und 12–14 Uhr) sind **keine** Doppelbelegung. Abwesenheiten sind ganztägig, `von` und `bis` jeweils **einschließlich**.
- Warnungen blockieren nicht: Doppelbelegung/Urlaub/Krankheit wird beim Speichern zurückgemeldet und angezeigt, gespeichert wird trotzdem (Pflichtenheft: „Warnung“).
- Persönliche Daten werden nicht im Service Worker gespeichert (Ruling aus 1a). Ausnahme nach Spec Abschnitt 2: Die eigenen Einsätze von heute liegen als Kopie im `localStorage` des Geräts des Benutzers (beim Abmelden gelöscht).

## Review Focus

1. Einsatz mit `ende <= beginn` oder länger als 14 Stunden → 400 mit klarer Meldung – Test in Task 4.
2. Angrenzende Einsätze (12:00 Ende / 12:00 Beginn) erzeugen keine Warnung, überlappende um eine Minute schon – Test in Task 4.
3. Urlaub 20.–24.10. warnt auch für einen Einsatz am 24.10. ab 15:00, nicht für den 25.10. – Test in Task 4.
4. Woche mit Zeitumstellung (19.–25.10.2026 und 26.10.–01.11.2026): Plantafel-Spalten und „heute“ stimmen in Berlin-Zeit, kein Einsatz rutscht in einen falschen Tag – Test in Task 5.
5. Monteur ruft per Link einen fremden Auftrag, ein fremdes To-do oder die Plantafel-API auf → 404 bzw. 403, nie fremde Daten – Test in Task 3 und Task 6.

---

## File Structure

```
db/migrations/011_auftraege.sql          # unique(id,betrieb_id) auf benutzer; auftraege, todos, Nummernkreis, RLS, Protokoll
db/migrations/012_plantafel.sql          # einsaetze, abwesenheiten, RLS, Protokoll
src/lib/auftrag-status.ts                # Statuskette ohne Serverbezug (auch für UI)
src/lib/zeit.ts                          # Berlin-Tage/Wochen ohne Serverbezug (auch für UI)
src/lib/server/auftraege.ts              # Aufträge: prüfen, listen, holen, anlegen, ändern, Status, löschen
src/lib/server/todos.ts                  # To-dos
src/lib/server/plantafel.ts              # Einsätze, Abwesenheiten, Warnungen, Wochenansicht, heute
src/routes/api/auftraege/…, api/todos/…, api/einsaetze/…, api/abwesenheiten/…, api/plantafel/+server.ts, api/heute/+server.ts
src/routes/(app)/auftraege/…, (app)/todos/+page.*, (app)/plantafel/+page.*, (app)/plantafel/abwesenheiten/+page.*
src/lib/components/{AuftragFormular,StatusKette,EinsatzDialog,PlantafelRaster}.svelte
src/routes/(app)/+page.* (Start: „Meine Einsätze heute“), src/routes/offline/+page.svelte (vorgerendert), src/service-worker.ts
src/lib/navigation.ts, src/lib/server/protokoll.ts, scripts/seed-dev.ts
tests/unit/{auftrag-status,zeit,plantafel-warnungen}.test.ts, tests/db/{auftraege,todos,plantafel}.test.ts, tests/e2e/plantafel.spec.ts
```

---

### Task 1: Statuskette und Berlin-Zeit (ohne Server)

**Files:**
- Create: `src/lib/auftrag-status.ts`, `src/lib/zeit.ts`
- Test: `tests/unit/auftrag-status.test.ts`, `tests/unit/zeit.test.ts`

**Interfaces:**
- Produces:
  - `export const STATUS = ['anfrage','angebot','beauftragt','in_arbeit','abgenommen','abgerechnet'] as const; export type AuftragStatus = (typeof STATUS)[number];`
  - `export const STATUS_NAMEN: Record<AuftragStatus, string>` (Beschriftungen exakt wie Global Constraints)
  - `export function istStatus(w: unknown): w is AuftragStatus`
  - `export function erlaubterWechsel(von: AuftragStatus, nach: AuftragStatus): boolean` – nur ±1 Schritt
  - `export function berlinTag(d: Date): string` → `'YYYY-MM-DD'` in Europe/Berlin
  - `export function tagesGrenzen(tag: string): { beginn: Date; ende: Date }` – Berlin-Mitternacht bis nächste Mitternacht (23 bzw. 25 Stunden an Umstellungstagen)
  - `export function wocheVon(tag: string): string[]` – 7 Tage Montag–Sonntag der Woche, die `tag` enthält
  - `export function verschiebeAufTag(beginn: Date, ende: Date, zielTag: string): { beginn: Date; ende: Date }` – behält Berlin-Uhrzeit von `beginn` und die Dauer

- [ ] **Step 1: Write the failing tests**

```ts
expect(erlaubterWechsel('anfrage','angebot')).toBe(true);
expect(erlaubterWechsel('angebot','anfrage')).toBe(true);
expect(erlaubterWechsel('anfrage','beauftragt')).toBe(false);
expect(erlaubterWechsel('abgerechnet','abgerechnet')).toBe(false);
expect(STATUS_NAMEN.in_arbeit).toBe('In Arbeit');
expect(berlinTag(new Date('2026-10-25T22:30:00Z'))).toBe('2026-10-25');   // 23:30 MEZ
expect(berlinTag(new Date('2026-10-24T22:30:00Z'))).toBe('2026-10-25');   // 00:30 MESZ
const g = tagesGrenzen('2026-10-25'); expect((g.ende.getTime() - g.beginn.getTime()) / 3.6e6).toBe(25);
expect(wocheVon('2026-10-21')).toEqual(['2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23','2026-10-24','2026-10-25']);
const v = verschiebeAufTag(new Date('2026-10-23T06:00:00Z'), new Date('2026-10-23T10:00:00Z'), '2026-10-26');
expect(v.beginn.toISOString()).toBe('2026-10-26T07:00:00.000Z');   // 08:00 Berlin bleibt 08:00 nach Umstellung
expect(v.ende.getTime() - v.beginn.getTime()).toBe(4 * 3.6e6);
```

- [ ] **Step 2: Run** `sudo docker exec crm-dev sh -lc 'cd /work/crm && npx vitest run tests/unit/auftrag-status.test.ts tests/unit/zeit.test.ts'` → FAIL (Module fehlen)
- [ ] **Step 3: Implement** both modules. Berlin-Umrechnung mit `Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', … }).formatToParts` (kein neues Paket); `tagesGrenzen` sucht den UTC-Zeitpunkt der Berliner Mitternacht über den Offset des Tages.
- [ ] **Step 4: Run** dieselben Tests → PASS
- [ ] **Step 5: Commit** `feat(1b): Statuskette und Berlin-Zeit`

### Task 2: Migration Aufträge und To-dos

**Files:**
- Create: `db/migrations/011_auftraege.sql`
- Modify: `src/lib/server/protokoll.ts` (PROTOKOLL_TABELLEN + PROTOKOLL_MODULE)
- Test: `tests/db/auftraege.test.ts` (Teil Schema/RLS)

**Interfaces:**
- Produces (SQL):
  - `alter table app.benutzer add constraint benutzer_id_betrieb unique (id, betrieb_id)` (Ziel für zusammengesetzte FKs)
  - `app.auftraege(id uuid pk, betrieb_id uuid not null, nummer text not null, titel text not null (1–200), kunde_id uuid not null, objekt_id uuid null, status text not null default 'anfrage' check in STATUS, beschreibung text ≤ 4000, geplant_ab date null, angelegt, geaendert, unique(id,betrieb_id), unique(betrieb_id,nummer), fk (kunde_id,betrieb_id)→kunden, fk (objekt_id,betrieb_id)→objekte)`; Objekt muss zum Kunden gehören (Check per Trigger `auftrag_objekt_passt`, Fehler `23514`).
  - `app.auftrag_nummern(betrieb_id uuid, jahr int, letzte int, primary key(betrieb_id, jahr))` + Funktion `app.naechste_auftragsnummer(p_betrieb uuid) returns text` (SECURITY DEFINER, Format `A-2026-0001`, je Betrieb und Jahr laufend, sperrsicher per `insert … on conflict do update … returning`); Default von `nummer` über Before-Insert-Trigger.
  - `app.todos(id, betrieb_id, auftrag_id uuid null, titel text not null (1–200), zustaendig_id uuid null, faellig date null, erledigt_am timestamptz null, angelegt, geaendert, fk (auftrag_id,betrieb_id)→auftraege on delete cascade, fk (zustaendig_id,betrieb_id)→benutzer)`
  - RLS ENABLE + FORCE mit Richtlinie wie `kunden_mandant`; Spaltenrechte für `crm_app` wie in 007 (id, betrieb_id, nummer nie änderbar); Trigger `setze_geaendert` und `protokolliere('geaendert')` auf beiden Tabellen.
  - `PROTOKOLL_TABELLEN`: `auftraege: 'auftraege.lesen'`, `todos: 'auftraege.lesen'`; `PROTOKOLL_MODULE`: beide `'auftraege'`.

- [ ] **Step 1: Write the failing test** (Muster `tests/db/kunden.test.ts`: frische DB, zwei Betriebe):
  - `it('vergibt Nummern je Betrieb und Jahr: A-2026-0001, A-2026-0002; Betrieb B beginnt wieder bei 0001')`
  - `it('Betrieb B sieht und ändert keine Aufträge/To-dos von A (RLS)')`
  - `it('Objekt eines anderen Kunden wird abgelehnt (23514)')` und `it('Kunde aus Betrieb B wird abgelehnt (23503)')`
  - `it('zustaendig_id aus anderem Betrieb wird abgelehnt (23503)')`
  - `it('Änderung am Auftrag landet im Änderungsprotokoll')`
- [ ] **Step 2: Run** `sudo docker exec crm-dev sh -lc 'cd /work/crm && npx vitest run tests/db/auftraege.test.ts'` → FAIL
- [ ] **Step 3: Write** `011_auftraege.sql` nach obiger Schnittstelle (Kommentare im Stil von 007).
- [ ] **Step 4: Run** Test → PASS; zusätzlich `npm run test:db` komplett grün (bestehende Tests unverändert).
- [ ] **Step 5: Commit** `feat(1b): Migration Aufträge, To-dos, Nummernkreis`

### Task 3: Aufträge – Dienst, API, Seiten

**Files:**
- Create: `src/lib/server/auftraege.ts`, `src/routes/api/auftraege/+server.ts`, `src/routes/api/auftraege/[id]/+server.ts`, `src/routes/api/auftraege/[id]/status/+server.ts`, `src/routes/(app)/auftraege/+page.{server.ts,svelte}`, `(app)/auftraege/neu/+page.*`, `(app)/auftraege/[id]/+page.*`, `(app)/auftraege/[id]/bearbeiten/+page.*`, `src/lib/components/AuftragFormular.svelte`, `src/lib/components/StatusKette.svelte`
- Modify: `src/routes/(app)/kunden/[id]/+page.{server.ts,svelte}` (Abschnitt „Aufträge“ des Kunden)
- Test: `tests/db/auftraege.test.ts` (Teil Dienst/API), `tests/unit/auftrag-status.test.ts` bleibt

**Interfaces:**
- Consumes: Task 1 `STATUS`, `erlaubterWechsel`; Task 2 Tabellen; aus 1a `mitBetrieb`, `darf`, `betriebKontext`, `ApiFehler`, `holeKunde`, `holeObjekt`, `anzeigeName`.
- Produces (`src/lib/server/auftraege.ts`):
  - `export type Auftrag = { id; nummer; titel; kundeId; kundeName; objektId: string|null; objektBezeichnung: string|null; status: AuftragStatus; beschreibung: string|null; geplantAb: string|null; angelegt: string; geaendert: string }`
  - `export function pruefeAuftragEingabe(e: Record<string, unknown>): { titel: string; kundeId: string; objektId: string|null; beschreibung: string|null; geplantAb: string|null }` – 400 bei leerem Titel, > 200 Zeichen, ungültiger UUID/Datum
  - `export type Sicht = { alle: boolean; benutzerId: string }` (aus `locals.nutzer`: `alle = hatRecht('auftraege.alle_lesen')`)
  - `listeAuftraege(k, sicht, filter: { status?: AuftragStatus; kundeId?: string; suche?: string }): Promise<Auftrag[]>` (max. 100, neueste zuerst; Suche wie `sucheWoerter` aus `kunden.ts` über Nummer, Titel, Kundenname)
  - `holeAuftrag(k, sicht, id): Promise<Auftrag>` (404 wenn nicht sichtbar)
  - `legeAuftragAn(k, e)`, `aendereAuftrag(k, id, e)`, `setzeStatus(k, id, nach: AuftragStatus): Promise<Auftrag>` (409 `Statuswechsel nicht erlaubt`), `loescheAuftrag(k, id)` (409 `Nur Anfragen können gelöscht werden`)
- API: `GET/POST /api/auftraege` (`?status=&kunde=&suche=`), `GET/PATCH/DELETE /api/auftraege/[id]`, `POST /api/auftraege/[id]/status` `{ status }`. Lesen: `darf(locals,'auftraege','auftraege.lesen')` **oder** `auftraege.alle_lesen`; Schreiben: `auftraege.bearbeiten`.
- Seiten: Liste mit Status-Reitern (Alle + 6 Status, mobil als waagerecht wischbare Leiste), Suche; Detail mit `StatusKette` (6 Stationen, aktuelle hervorgehoben, Knöpfe „← Zurück“/„Weiter →“ nur mit Recht), Kunde/Objekt-Links, Bereiche „Einsätze“ (ab Task 6 gefüllt) und „To-dos“ (Task 4), Verlauf (Änderungsprotokoll wie bei Kunden); Formular neu/bearbeiten mit Kunden-Suche und Objektauswahl des gewählten Kunden.

- [ ] **Step 1: Write the failing tests** (`tests/db/auftraege.test.ts`, Dienst über `mitBetrieb` und API-Handler direkt wie in `tests/db/kunden.test.ts`):
  - `legeAuftragAn` liefert `status 'anfrage'` und Nummer `A-<Jahr>-0001`
  - `setzeStatus('anfrage'→'beauftragt')` → `ApiFehler` 409; `'anfrage'→'angebot'` ok
  - Monteur (nur `auftraege.lesen`): `listeAuftraege` liefert nur Aufträge mit eigenem To-do (Einsätze ab Task 6 ergänzt den Test); `holeAuftrag(fremd)` → 404
  - Büro ohne `auftraege.bearbeiten` → `POST /api/auftraege` 403; Tarif ohne Modul `auftraege` → 402
  - `loescheAuftrag` im Status `angebot` → 409
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement** Dienst, Endpunkte, Seiten und Komponenten (Seiten-Server mit `seitenZugriff`/`alsSeitenFehler`/`formWerte` aus `seite.ts` wie bei Kunden).
- [ ] **Step 4: Run** Test + `npm run check` → PASS, 0 Fehler
- [ ] **Step 5: Commit** `feat(1b): Aufträge mit Statuskette`

### Task 4: To-dos – Dienst, API, Seite

**Files:**
- Create: `src/lib/server/todos.ts`, `src/routes/api/todos/+server.ts`, `src/routes/api/todos/[id]/+server.ts`, `src/routes/(app)/todos/+page.{server.ts,svelte}`
- Modify: `src/routes/(app)/auftraege/[id]/+page.*` (To-do-Bereich mit „+ To-do“)
- Test: `tests/db/todos.test.ts`

**Interfaces:**
- Produces: `export type Todo = { id; titel; auftragId: string|null; auftragNummer: string|null; zustaendigId: string|null; zustaendigName: string|null; faellig: string|null; erledigt: boolean; erledigtAm: string|null }`; `listeTodos(k, sicht, filter: { auftragId?: string; nur?: 'meine'|'offen'|'alle' })`, `legeTodoAn(k, e)`, `aendereTodo(k, id, e)` (inkl. `erledigt: boolean` → setzt/löscht `erledigt_am`), `loescheTodo(k, id)`.
- Regeln: Anlegen/Ändern/Löschen mit `auftraege.bearbeiten`; **zusätzlich** darf der Zuständige sein eigenes To-do auf erledigt/offen setzen (nur dieses Feld) mit `auftraege.lesen`. Zuständig nur aktive Benutzer des Betriebs (400 sonst). Sortierung: offen vor erledigt, dann `faellig` aufsteigend (ohne Datum zuletzt).
- Seite „To-dos“: Reiter „Meine“ / „Offen“ / „Alle“ (die letzten beiden nur mit `auftraege.alle_lesen`), große Abhak-Flächen (≥ 44 px), überfällige rot markiert (Berlin-„heute“ aus `src/lib/zeit.ts`).

- [ ] **Step 1: Write the failing tests:** Zuständiger Monteur setzt eigenes To-do erledigt → ok; ändert Titel → 403; fremdes To-do → 404; zuständig = deaktivierter Benutzer → 400; Sortierreihenfolge wie oben (konkrete Liste mit 4 To-dos); Monteur sieht durch eigenes To-do den Auftrag in `listeAuftraege` (Ergänzung zu Task 3).
- [ ] **Step 2: Run** `npx vitest run tests/db/todos.test.ts` → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** → PASS; `npm run check` 0 Fehler
- [ ] **Step 5: Commit** `feat(1b): To-dos`

### Task 5: Migration Einsätze/Abwesenheiten und Warnlogik

**Files:**
- Create: `db/migrations/012_plantafel.sql`, `src/lib/server/plantafel.ts` (Teil Daten + Warnungen)
- Modify: `src/lib/server/protokoll.ts` (`einsaetze`, `abwesenheiten` → `'plantafel.bearbeiten'`, Modul `'plantafel'`)
- Test: `tests/unit/plantafel-warnungen.test.ts`, `tests/db/plantafel.test.ts`

**Interfaces:**
- Produces (SQL): `app.einsaetze(id, betrieb_id, auftrag_id uuid not null, benutzer_id uuid not null, beginn timestamptz not null, ende timestamptz not null, notiz text ≤ 500, angelegt, geaendert, check (ende > beginn and ende - beginn <= interval '14 hours'), fk (auftrag_id,betrieb_id)→auftraege on delete cascade, fk (benutzer_id,betrieb_id)→benutzer)`, Index `(betrieb_id, benutzer_id, beginn)`; `app.abwesenheiten(id, betrieb_id, benutzer_id, art text check in ('urlaub','krank','sonstiges'), von date not null, bis date not null, notiz text ≤ 200, check (bis >= von), fk (benutzer_id,betrieb_id)→benutzer)`; RLS, Spaltenrechte, Trigger wie Task 2.
- Produces (TS):
  - `export type Warnung = { art: 'doppelt'; einsatzId: string } | { art: 'urlaub'|'krank'|'sonstiges'; abwesenheitId: string }`
  - `export function berechneWarnungen(einsatz: { id?: string; benutzerId: string; beginn: Date; ende: Date }, andere: { id: string; benutzerId: string; beginn: Date; ende: Date }[], abwesenheiten: { id: string; benutzerId: string; art: string; von: string; bis: string }[]): Warnung[]` – rein, ohne DB: halboffene Überlappung; Abwesenheit trifft, wenn ein Berlin-Tag im Bereich `[berlinTag(beginn), berlinTag(ende - 1 ms)]` zwischen `von` und `bis` liegt
  - `export type Einsatz = { id; auftragId; auftragNummer; auftragTitel; kundeName; ort: string|null; benutzerId; benutzerName; beginn: string; ende: string; notiz: string|null; warnungen: Warnung[] }`
  - `legeEinsatzAn(k, e): Promise<Einsatz>`, `aendereEinsatz(k, id, e): Promise<Einsatz>` (beide liefern `warnungen`), `loescheEinsatz(k, id)`, `legeAbwesenheitAn(k, e)`, `aendereAbwesenheit`, `loescheAbwesenheit`, `listeAbwesenheiten(k, von: string, bis: string)`
  - Eingabeprüfung: `beginn`/`ende` als ISO-Zeitpunkte; 400 `Ende muss nach dem Beginn liegen` bzw. `Ein Einsatz darf höchstens 14 Stunden dauern`; Mitarbeiter muss aktiver Benutzer des Betriebs sein.

- [ ] **Step 1: Write the failing tests**
  - Unit: 10–12 + 12–14 → `[]`; 10–12 + 11:59–13 → `[{art:'doppelt'}]`; anderer Mitarbeiter → `[]`; Urlaub 2026-10-20..2026-10-24 + Einsatz 24.10. 15–17 Berlin → `[{art:'urlaub'}]`; Einsatz 25.10. → `[]`; Einsatz 25.10. 01:00–03:00 Berlin (Umstellungsnacht) korrekt dem 25.10. zugeordnet.
  - DB: `ende <= beginn` → 400; 14 h 1 min → 400; Mitarbeiter aus Betrieb B → 400/23503; RLS Betrieb B sieht nichts; `legeEinsatzAn` mit Überlappung speichert **und** liefert `warnungen.length === 1`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/plantafel-warnungen.test.ts tests/db/plantafel.test.ts` → FAIL
- [ ] **Step 3: Implement** Migration und Funktionen.
- [ ] **Step 4: Run** → PASS; `npm run test:db` komplett grün
- [ ] **Step 5: Commit** `feat(1b): Einsätze, Abwesenheiten, Warnungen`

### Task 6: Plantafel-API, Wochenansicht und „heute“

**Files:**
- Modify: `src/lib/server/plantafel.ts` (Lesefunktionen)
- Create: `src/routes/api/plantafel/+server.ts`, `src/routes/api/einsaetze/+server.ts`, `src/routes/api/einsaetze/[id]/+server.ts`, `src/routes/api/abwesenheiten/+server.ts`, `src/routes/api/abwesenheiten/[id]/+server.ts`, `src/routes/api/heute/+server.ts`
- Modify: `src/lib/server/auftraege.ts` (Sichtbarkeit „eigene“: auch über Einsatz), `(app)/auftraege/[id]/+page.*` (Bereich „Einsätze“)
- Test: `tests/db/plantafel.test.ts` (Ergänzung)

**Interfaces:**
- Produces:
  - `export type Wochenansicht = { tage: string[]; mitarbeiter: { id: string; name: string; aktiv: boolean }[]; einsaetze: Einsatz[]; abwesenheiten: Abwesenheit[] }`
  - `ladeWoche(k, tag: string): Promise<Wochenansicht>` – Woche aus `wocheVon(tag)`, Zeitraum `[tagesGrenzen(montag).beginn, tagesGrenzen(sonntag).ende)`; Mitarbeiter = aktive Benutzer des Betriebs + deaktivierte, die in der Woche Einsätze haben (`aktiv:false`), sortiert nach Name
  - `meineEinsaetzeHeute(k, benutzerId, jetzt = new Date()): Promise<Einsatz[]>` – Berlin-Tag von `jetzt`, sortiert nach Beginn, inkl. Kundenname, Objekt-/Kundenadresse als `ort`
- API: `GET /api/plantafel?tag=YYYY-MM-DD` (`plantafel.bearbeiten` oder `auftraege.alle_lesen`; Modul `plantafel`); `POST/PATCH/DELETE /api/einsaetze…` und `/api/abwesenheiten…` mit `plantafel.bearbeiten`; `GET /api/heute` für jeden Betriebsnutzer mit `auftraege.lesen` oder `auftraege.alle_lesen` (Modul `plantafel`), nur eigene Einsätze.

- [ ] **Step 1: Write the failing tests:** `ladeWoche('2026-10-21')` liefert 7 Tage 19.–25.10. und einen Einsatz vom So 25.10. 22:00–23:30 Berlin am 25.10.; Woche 26.10.–01.11. enthält ihn nicht; deaktivierter Mitarbeiter mit Einsatz erscheint mit `aktiv:false`; `meineEinsaetzeHeute(jetzt = 2026-10-25T23:30 Berlin)` enthält nur Einsätze dieses Tages; Monteur → `GET /api/plantafel` 403, `GET /api/heute` nur eigene; Monteur sieht Auftrag mit eigenem Einsatz in `listeAuftraege`, fremden weiterhin 404.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** `feat(1b): Plantafel-API, Wochenansicht, heute`

### Task 7: Plantafel-Oberfläche mit Ziehen und Ablegen

**Files:**
- Create: `src/routes/(app)/plantafel/+page.{server.ts,svelte}`, `src/routes/(app)/plantafel/abwesenheiten/+page.{server.ts,svelte}`, `src/lib/components/PlantafelRaster.svelte`, `src/lib/components/EinsatzDialog.svelte`
- Modify: `src/lib/navigation.ts` (Plantafel aktiv; neue Einträge), `src/lib/components/NavSymbol.svelte` (Symbole `auftraege`, `todos`)
- Test: `tests/unit/navigation.test.ts` (Ergänzung), `tests/e2e/plantafel.spec.ts`

**Interfaces:**
- Consumes: Task 6 API und `Wochenansicht`, Task 1 `verschiebeAufTag`.
- Navigation (exakt): Haupt: „Start“, „Kunden“ (wie bisher), „Aufträge“ `/auftraege` (Modul `auftraege` + `auftraege.lesen` oder `auftraege.alle_lesen`), „Plantafel“ `/plantafel` (Modul `plantafel` + `plantafel.bearbeiten` oder `auftraege.alle_lesen`; ohne `hinweis`); Mehr: „To-dos“ `/todos` (Modul `auftraege` + Leserecht), „Abwesenheiten“ `/plantafel/abwesenheiten` (`plantafel.bearbeiten`). Monteur (nur `auftraege.lesen`) sieht Start, Kunden, Aufträge und To-dos, **keine** Plantafel.
- Raster: Zeilen = Mitarbeiter, Spalten = 7 Tage (Kopf „Mo 19.10.“), Woche vor/zurück und „Heute“; Einsatz-Kärtchen zeigen Uhrzeit, Auftragsnummer, Kunde; Abwesenheiten als schraffierte Zelle mit „Urlaub“/„Krank“; Warnungen als gelbe Umrandung + Symbol, Text in `title`/`aria-label`. Ab 700 px Breite (Tablet hochkant und größer) Raster mit Ziehen und Ablegen, darunter (Handy) eine Tagesliste je Mitarbeiter mit Tag-Wischleiste ohne Ziehen.
- Ziehen und Ablegen mit Pointer Events (`pointerdown` → Platzhalter folgt, `pointerup` über Zelle → `PATCH /api/einsaetze/[id]` mit `verschiebeAufTag(…, zielTag)` und ggf. neuem `benutzerId`); bei Fehler zurück an alte Stelle + Meldung; danach Warnungen der Antwort anzeigen („Achtung: Doppelbelegung bei Ali am Di 20.10.“). Tastatur-Alternative: Kärtchen fokussieren → „Verschieben“ im Dialog (Tag/Mitarbeiter wählen).
- Klick auf leere Zelle → `EinsatzDialog` (Auftrag suchen, Beginn/Ende, Mitarbeiter vorbelegt, Notiz).

- [ ] **Step 1: Write the failing tests**
  - Unit `navigation.test.ts`: Monteur-Rechte `['kunden.lesen','auftraege.lesen']` + alle Module → Haupt-Namen `['Start','Kunden','Aufträge']`, Mehr `['To-dos']`; Chef → Haupt `['Start','Kunden','Aufträge','Plantafel']`, Mehr enthält `'To-dos','Abwesenheiten','Benutzer','Rollen'`; Tarif ohne `plantafel` → keine Plantafel.
  - E2E `plantafel.spec.ts` (Vorschau mit Seed, 1280×800): Chef öffnet `/plantafel`, zieht das Kärtchen von „Mo“ auf „Di“ desselben Mitarbeiters (`page.mouse` down/move/up) → nach Neuladen steht es am Dienstag; Ziehen auf einen Tag mit vorhandenem Einsatz → Warnhinweis sichtbar; Monteur `/plantafel` → 403-Seite.
- [ ] **Step 2: Run** Unit-Test → FAIL (E2E läuft nach Task 9 mit Seed)
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** Unit-Test + `npm run check` → PASS
- [ ] **Step 5: Commit** `feat(1b): Plantafel mit Ziehen und Ablegen`

### Task 8: Start „Meine Einsätze heute“ und Offline-Kopie

**Files:**
- Modify: `src/routes/(app)/+page.{server.ts,svelte}`, `src/service-worker.ts`, `src/routes/api/abmelden/+server.ts` (bzw. Abmelde-Knopf: Kopie löschen)
- Create: `src/routes/offline/+page.svelte` (+ `+page.ts` mit `export const prerender = true`), `src/lib/heute-kopie.ts`
- Test: `tests/unit/heute-kopie.test.ts`, E2E-Ergänzung in `tests/e2e/plantafel.spec.ts`

**Interfaces:**
- Produces: `src/lib/heute-kopie.ts`: `export const SCHLUESSEL = 'crm-heute-v1'`; `speichere(benutzerId: string, tag: string, einsaetze: HeuteEinsatz[], jetzt: Date): void`; `lade(jetzt: Date): { benutzerId; tag; stand: string; einsaetze: HeuteEinsatz[] } | null` (nur wenn `tag === berlinTag(jetzt)`, sonst `null` und Eintrag löschen); `loesche(): void`. `HeuteEinsatz` = Teilmenge von `Einsatz` (Zeit, Auftragsnummer/-titel, Kunde, Ort, Notiz) – **ohne** Preise.
- Start-Seite: Abschnitt „Meine Einsätze heute“ (Karten mit Uhrzeit, Kunde, Adresse als Link `https://www.google.com/maps/search/?api=1&query=…` in neuem Tab, Auftragslink), leerer Zustand „Heute keine Einsätze“. Nach dem Laden `speichere(…)`.
- Service Worker: Navigationen, die offline scheitern, beantwortet er mit der vorab gespeicherten Seite `/offline` (Teil der App-Hülle, enthält keine personenbezogenen Daten). Die Seite liest `lade(new Date())` und zeigt „Offline – Stand hh:mm“ + die Einsätze; ohne Kopie „Keine Verbindung“.
- Abmelden ruft `loesche()` vor dem Absenden auf.

- [ ] **Step 1: Write the failing tests:** Unit: Kopie von gestern → `lade` liefert `null` und entfernt den Schlüssel; Kopie von heute → Einträge zurück; `loesche` entfernt. E2E: Monteur lädt Start (sieht Einsatz), `context.setOffline(true)`, Navigation zu `/` → Offline-Seite zeigt denselben Einsatz und „Offline“.
- [ ] **Step 2: Run** Unit → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** Unit → PASS; `npm run build` ok
- [ ] **Step 5: Commit** `feat(1b): Meine Einsätze heute, Offline-Kopie`

### Task 9: Testdaten, Gesamtprüfung, Abnahme-Fotos

**Files:**
- Modify: `scripts/seed-dev.ts` (Bauwelt: 6 Beispielaufträge über alle Status, To-dos, Einsätze in der aktuellen und nächsten Woche inkl. einer Doppelbelegung und eines Urlaubs; Monteur-Einsätze auch für die persönlichen Test-Zugänge aus `scripts/testzugaenge.ts`, idempotent), `tests/e2e/bildschirmfotos.spec.ts` (Plantafel, Auftragsdetail, To-dos, Start heute – Handy und PC), `README.md` (neue Bereiche, Befehle)
- Test: `tests/db/seed.test.ts` (Ergänzung: zweiter Lauf legt nichts doppelt an)

- [ ] **Step 1: Write the failing test:** `seedDev` zweimal → Anzahl Aufträge/Einsätze/To-dos unverändert; Auftragsnummern lückenlos `A-<Jahr>-0001…0006`.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement** Seed + README.
- [ ] **Step 4: Run** komplette Suite: `npm run check && npm test && npm run test:db`, Vorschau neu bauen (`-e VORSCHAU_ORIGIN=https://crm.waybuild-software.de -e CRM_TESTMODUS=1 … sh scripts/start-vorschau.sh`), dann E2E (README-Befehl) inkl. `plantafel.spec.ts` → alles grün; Bildschirmfotos nach `Team/CRM System/Screenshots Stufe 1b`.
- [ ] **Step 5: Commit** `feat(1b): Testdaten, Abnahme-Fotos, README`
