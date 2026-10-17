# Auftrags-To-do-Vorlagen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jamil kann Vorlagen für Auftrags-To-dos anlegen (z.B. "Wartung Heizung" mit 5 Aufgaben) und diese beim Erstellen eines Auftrags anwenden – die To-dos werden automatisch erstellt.

**Architecture:** Gleiche Bauweise wie bestehende Module: SQL-Migration mit RLS (`betrieb_id`, ENABLE + FORCE), Dienst in `src/lib/server/auftrag-vorlagen.ts`, JSON-Endpunkte unter `/api/auftrag-vorlagen/`, SvelteKit-Seiten unter `src/routes/(app)/auftrag-vorlagen/`. Integration ins bestehende Auftrag-Formular.

**Tech Stack:** Wie bestehend – Node 22, SvelteKit 2 + Svelte 5 + TypeScript, `postgres` 3.x, Vitest, reines CSS.

**Spec:** Pflichtenheft erwähnt "Gewerk-Vorlage" beim Leistungskatalog, aber keine direkten Auftrags-To-do-Vorlagen. Dies ist eine Erweiterung auf Jamils Wunsch.

## Global Constraints

- Alle Global Constraints aus Plan 1a/1b gelten unverändert.
- Module: Auftrags-To-do-Vorlagen nutzen Modul `auftraege` (keine neuen Rechte nötig).
- Rechte: `auftraege.bearbeiten` zum Anlegen/Ändern/Löschen von Vorlagen; `auftraege.lesen` zum Anwenden auf Aufträge.
- UI Deutsch, mobile first 360 px, Touch-Ziele ≥ 44 px.
- RLS: Jede Vorlage trägt `betrieb_id`, Fremdschlüssel mit `(x_id, betrieb_id)`.

## Review Focus

1. Vorlage aus anderem Betrieb anwenden → 404, keine Daten-Lecks.
2. Vorlage mit 0 To-dos anlegen → muss funktionieren (leere Vorlage ist erlaubt).
3. Vorlage löschen während Auftrag sie referenziert → To-dos bleiben erhalten (nur Vorlage weg).
4. Reihenfolge der To-dos bleibt bei Anwendung erhalten.

---

## File Structure

```
db/migrations/020_auftrag_vorlagen.sql     # Tabellen, RLS, Protokoll
src/lib/server/auftrag-vorlagen.ts         # Dienst: CRUD Vorlagen, anwenden
src/routes/api/auftrag-vorlagen/+server.ts # GET (Liste), POST (anlegen)
src/routes/api/auftrag-vorlagen/[id]/+server.ts # GET, PUT, DELETE
src/routes/(app)/auftrag-vorlagen/+page.server.ts
src/routes/(app)/auftrag-vorlagen/+page.svelte
src/routes/(app)/auftrag-vorlagen/neu/+page.server.ts
src/routes/(app)/auftrag-vorlagen/neu/+page.svelte
src/routes/(app)/auftrag-vorlagen/[id]/+page.server.ts
src/routes/(app)/auftrag-vorlagen/[id]/+page.svelte
src/lib/components/VorlageFormular.svelte
src/lib/navigation.ts                      # Navigationspunkt hinzufügen
tests/db/auftrag-vorlagen.test.ts          # DB-Tests
```

---

### Task 1: Migration Auftrags-To-do-Vorlagen

**Files:**
- Create: `db/migrations/020_auftrag_vorlagen.sql`
- Modify: `src/lib/server/protokoll.ts` (PROTOKOLL_TABELLEN)
- Test: `tests/db/auftrag-vorlagen.test.ts`

**Interfaces:**
- Produces (SQL):
  - `app.auftrag_vorlagen(id uuid pk, betrieb_id uuid not null, name text not null (1–100), beschreibung text ≤ 500, angelegt timestamptz, geaendert timestamptz, unique(id,betrieb_id))`
  - `app.auftrag_vorlagen_todos(id uuid pk, betrieb_id uuid not null, vorlage_id uuid not null, titel text not null (1–200), beschreibung text ≤ 500, sortierung int not null default 0, fk (vorlage_id,betrieb_id)→auftrag_vorlagen on delete cascade)`
  - RLS ENABLE + FORCE mit Richtlinie wie `kunden_mandant`
  - Trigger `setze_geaendert` und `protokolliere('geaendert')` auf `auftrag_vorlagen`
  - `PROTOKOLL_TABELLEN`: `auftrag_vorlagen: 'auftraege.lesen'`

- [ ] **Step 1: Write the failing tests** (`tests/db/auftrag-vorlagen.test.ts`):
  - `it('Vorlage mit To-dos anlegen und lesen')`
  - `it('To-dos sind nach sortierung sortiert')`
  - `it('Betrieb B sieht keine Vorlagen von A (RLS)')`
  - `it('Vorlage löschen löscht auch To-dos (CASCADE)')`
  - `it('Änderung an Vorlage landet im Änderungsprotokoll')`

- [ ] **Step 2: Run** `npx vitest run tests/db/auftrag-vorlagen.test.ts` → FAIL

- [ ] **Step 3: Write** `020_auftrag_vorlagen.sql` nach obiger Schnittstelle.

- [ ] **Step 4: Run** Test → PASS; zusätzlich `npm run test:db` komplett grün.

- [ ] **Step 5: Commit** `feat(vorlagen): Migration Auftrags-To-do-Vorlagen`

---

### Task 2: Dienst Auftrags-To-do-Vorlagen

**Files:**
- Create: `src/lib/server/auftrag-vorlagen.ts`
- Test: `tests/db/auftrag-vorlagen.test.ts` (erweitern)

**Interfaces:**
- Produces:
  - `export type Vorlage = { id; name; beschreibung: string|null; angelegt: string; geaendert: string }`
  - `export type VorlageTodo = { id; titel; beschreibung: string|null; sortierung: number }`
  - `export type VorlageMitTodos = Vorlage & { todos: VorlageTodo[] }`
  - `export function listeVorlagen(k: Kontext): Promise<Vorlage[]>`
  - `export function holeVorlage(k: Kontext, id: string): Promise<VorlageMitTodos>` (404 wenn nicht gefunden oder fremder Betrieb)
  - `export function legeVorlageAn(k: Kontext, e: { name: string; beschreibung?: string; todos?: { titel: string; beschreibung?: string; sortierung?: number }[] }): Promise<VorlageMitTodos>`
  - `export function aendereVorlage(k: Kontext, id: string, e: { name?: string; beschreibung?: string; todos?: { titel: string; beschreibung?: string; sortierung?: number }[] }): Promise<VorlageMitTodos>` (ersetzt Todos komplett)
  - `export function loescheVorlage(k: Kontext, id: string): Promise<void>`

- [ ] **Step 1: Write the failing tests** (erweitern `tests/db/auftrag-vorlagen.test.ts`):
  - `listeVorlagen` liefert alle Vorlagen des Betriebs
  - `holeVorlage` mit fremder ID → 404
  - `legeVorlageAn` mit Todos → Todos sind gespeichert und sortiert
  - `aendereVorlage` mit neuen Todos → alte Todos sind weg, neue da
  - `loescheVorlage` → Vorlage und Todos weg

- [ ] **Step 2: Run** → FAIL

- [ ] **Step 3: Implement** `src/lib/server/auftrag-vorlagen.ts` mit `mitBetrieb` wie in `auftraege.ts`.

- [ ] **Step 4: Run** → PASS; `npm run check` 0 Fehler.

- [ ] **Step 5: Commit** `feat(vorlagen): Dienst für Auftrags-To-do-Vorlagen`

---

### Task 3: API Endpunkte

**Files:**
- Create: `src/routes/api/auftrag-vorlagen/+server.ts`, `src/routes/api/auftrag-vorlagen/[id]/+server.ts`
- Test: `tests/db/auftrag-vorlagen.test.ts` (erweitern)

**Interfaces:**
- `GET /api/auftrag-vorlagen` → Liste aller Vorlagen (nur mit `auftraege.lesen`)
- `POST /api/auftrag-vorlagen` → Vorlage anlegen (mit `auftraege.bearbeiten`)
- `GET /api/auftrag-vorlagen/[id]` → Vorlage mit Todos
- `PUT /api/auftrag-vorlagen/[id]` → Vorlage ändern (mit `auftraege.bearbeiten`)
- `DELETE /api/auftrag-vorlagen/[id]` → Vorlage löschen (mit `auftraege.bearbeiten`)

- [ ] **Step 1: Write the failing tests** (API-Handler direkt testen wie in `tests/db/kunden.test.ts`):
  - `GET` ohne Recht → 403
  - `POST` mit Todos → 201 mit Todos
  - `GET [id]` mit fremder ID → 404
  - `PUT` → Todos werden ersetzt
  - `DELETE` → 204

- [ ] **Step 2: Run** → FAIL

- [ ] **Step 3: Implement** Endpunkte mit `mitBetrieb`, `darf`-Prüfung, JSON-Validierung.

- [ ] **Step 4: Run** → PASS; `npm run check` 0 Fehler.

- [ ] **Step 5: Commit** `feat(vorlagen): API Endpunkte`

---

### Task 4: UI Seite Vorlagen verwalten

**Files:**
- Create: `src/routes/(app)/auftrag-vorlagen/+page.server.ts`, `src/routes/(app)/auftrag-vorlagen/+page.svelte`, `src/routes/(app)/auftrag-vorlagen/neu/+page.server.ts`, `src/routes/(app)/auftrag-vorlagen/neu/+page.svelte`, `src/routes/(app)/auftrag-vorlagen/[id]/+page.server.ts`, `src/routes/(app)/auftrag-vorlagen/[id]/+page.svelte`, `src/lib/components/VorlageFormular.svelte`
- Modify: `src/lib/navigation.ts` (Navigationspunkt „Vorlagen" unter Aufträge)

**Interfaces:**
- Consumes: API-Endpunkte aus Task 3
- Produces: SvelteKit-Seiten mit Formular

- [ ] **Step 1: Write the failing tests** (Playwright oder manuelle Prüfung):
  - Seite `/auftrag-vorlagen` ist erreichbar
  - Vorlage anlegen → erscheint in der Liste
  - Vorlage bearbeiten → Todos werden aktualisiert
  - Vorlage löschen → Bestätigungsdialog

- [ ] **Step 2: Run** → FAIL (Seiten existieren noch nicht)

- [ ] **Step 3: Implement** Seiten und Komponenten:
  - Liste: Karten mit Name, Anzahl Todos, Löschen-Button
  - Formular: Name, Beschreibung, dynamische Todo-Liste (hinzufügen/entfernen/sortieren)
  - Fluent Design (weiße Karten, Schatten, wie M365)

- [ ] **Step 4: Run** → PASS; `npm run check` 0 Fehler; `npm run test` grün.

- [ ] **Step 5: Commit** `feat(vorlagen): UI Seite Vorlagen verwalten`

---

### Task 5: Integration Auftrag-Formular

**Files:**
- Modify: `src/routes/(app)/auftraege/neu/+page.server.ts`, `src/routes/(app)/auftraege/neu/+page.svelte`, `src/lib/components/AuftragFormular.svelte`

**Interfaces:**
- Consumes: `listeVorlagen` aus Task 2, `holeVorlage` aus Task 2
- Produces: Vorlage-Auswahl im Auftrag-Formular; bei Auswahl → Todos werden vorausgefüllt

- [ ] **Step 1: Write the failing test** (Playwright oder manuelle Prüfung):
  - Beim Neuen-Auftrag: Dropdown „Vorlage auswählen" ist sichtbar
  - Vorlage wählen → Todos werden ins Formular geladen
  - Auftrag speichern → Todos sind im Auftrag vorhanden

- [ ] **Step 2: Run** → FAIL

- [ ] **Step 3: Implement**:
  - Dropdown im Auftrag-Formular mit allen Vorlagen
  - Bei Auswahl: AJAX-Call `GET /api/auftrag-vorlagen/[id]` → Todos vorausfüllen
  - Todos können nachträglich bearbeitet/entfernt werden

- [ ] **Step 4: Run** → PASS; `npm run check` 0 Fehler.

- [ ] **Step 5: Commit** `feat(vorlagen): Integration ins Auftrag-Formular`

---

### Task 6: Vorschau neu bauen und Gesamtprüfung

**Files:**
- Modify: `scripts/seed-dev.ts` (Beispiel-Vorlagen hinzufügen)

**Interfaces:**
- Consumes: Alle vorherigen Tasks

- [ ] **Step 1: Seed-Daten** – 2-3 Beispiel-Vorlagen in `seed-dev.ts` (z.B. "Wartung Heizung" mit 4 Todos, "Bad-Sanitär" mit 3 Todos)

- [ ] **Step 2: Run** `npm run test` + `npm run test:db` → alles grün

- [ ] **Step 3: Run** `npm run check` → 0 Fehler

- [ ] **Step 4: Vorschau neu bauen** → `touch /work/crm/.vorschau-neubauen`

- [ ] **Step 5: Prüfen** → https://crm.waybuild-software.de/api/gesundheit ok; Vorlagen-Seite erreichbar

- [ ] **Step 6: Commit** `feat(vorlagen): Seed-Daten und Gesamtprüfung`