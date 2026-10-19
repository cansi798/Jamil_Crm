# CRM System – Stufe 2a „Fotos, Notizen und Baustellen-Protokolle" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fotos und Notizen zu Aufträgen hochladen und anzeigen; digitale Baustellen-Protokolle (Abnahme, Regiebericht, Aufmaß, Mängelliste) auf dem Handy erstellen, vom Kunden unterschreiben lassen und automatisch als PDF per E-Mail an den Kunden senden.

**Architecture:** Neue Tabellen `app.dateien` (Fotos/PDFs je Auftrag) und `app.baustellen_protokolle` (Protokoll-Typ, Inhalt als JSON, Unterschrift als PNG, PDF als bytea) mit RLS. Dateien werden in der PostgreSQL-Datenbank gespeichert (bytea, max 10 MB je Datei). Unterschrift über HTML5 Canvas auf dem Handy (Touch-Events). PDF-Erzeugung mit pdfkit (wie Angebots-PDF). E-Mail-Versand über einen neuen E-Mail-Dienst (noch nicht konfiguriert – Platzhalter mit Konfigurationsfehler).

**Tech Stack:** wie 1a–1d; neu: pdfkit für Protokoll-PDFs, HTML5 Canvas für Unterschrift, FormData für Datei-Uploads.

**Spec:** `docs/spec/pflichtenheft-v1.1.html` – Abschnitt 6 (Stufe 2: „Fotos und Notizen. Protokolle mit Unterschrift des Kunden auf dem Handy, PDF automatisch per E-Mail an den Kunden"), Abschnitt 4.6 (Baustellen-Dokumentation), Abschnitt 5 (Datenmodell: Protokoll, Foto/Datei).

## Global Constraints

- Alle Global Constraints aus 1a–1d gelten.
- Module: Protokolle = `protokolle`, Dateien/Fotos = `kunden` (kein eigenes Modul – Fotos gehören zum Auftrag). Jede Protokoll-Aktion prüft `pruefeModul(locals, 'protokolle')`.
- Dateien: max. 10 MB je Datei, nur JPEG/PNG/PDF/DOCX/XLSX, Magic-Bytes-Prüfung. Dateien werden in der DB gespeichert (bytea), nie auf dem Dateisystem.
- Unterschrift: HTML5 Canvas (Touch-Events), PNG-Export, max. 500 KB. Unterschrift wird im Protokoll gespeichert (bytea).
- PDF: pdfkit wie Angebots-PDF, eingebettete Schriften (Noto Sans). PDF enthält Protokoll-Typ, Auftrag-Nummer, Kunde, Objekt, Inhalt, Unterschrift.
- E-Mail: Platzhalter – `CRM_SMTP_URL` muss gesetzt sein (sonst 500 „E-Mail-Dienst nicht konfiguriert"). E-Mail enthält PDF als Anhang.
- Rechte: Protokolle anlegen/bearbeiten = `protokolle.bearbeiten`, Protokolle lesen = `protokolle.lesen` (eigene oder alle, wie Aufträge). Fotos hochladen = `auftraege.bearbeiten`.
- Sprachsteuerung: „Protokoll für Auftrag [Nr.] ausfüllen: [Typ], [Inhalt]" – erweitert die Aktionssprache um `protokoll_ausfuellen`.

## Review Focus

1. Unterschrift auf dem Handy: Touch-Events funktionieren, Canvas wird nicht gescrollt, PNG wird korrekt exportiert – Test in Task 4.
2. PDF mit Unterschrift: Unterschrift wird im PDF angezeigt, Umlaute korrekt, Seitenzahlen – Test in Task 5.
3. Datei-Upload: max. 10 MB, Magic-Bytes-Prüfung, korrekte MIME-Typen – Test in Task 2.
4. E-Mail mit PDF-Anhang: Platzhalter funktioniert, PDF ist lesbar – Test in Task 6.
5. Sprachsteuerung: „Protokoll für Auftrag A-2026-0001 ausfüllen: Abnahme, alles fertig" – Test in Task 8.

---

## File Structure

```
db/migrations/017_protokolle_dateien.sql   # app.dateien, app.baustellen_protokolle, RLS, Trigger
src/lib/server/dateien.ts                  # Dateien hochladen/lesen/löschen
src/lib/server/baustellen-protokolle.ts    # Protokolle CRUD, Unterschrift, PDF
src/lib/server/pdf/protokoll-pdf.ts        # PDF-Erzeugung für Protokolle
src/lib/server/email.ts                    # E-Mail-Versand (Platzhalter)
src/routes/api/dateien/+server.ts          # POST (Upload), GET (Liste)
src/routes/api/dateien/[id]/+server.ts     # GET (Download), DELETE
src/routes/api/protokolle/+server.ts       # POST (anlegen), GET (Liste)
src/routes/api/protokolle/[id]/+server.ts  # GET (lesen), PUT (aktualisieren)
src/routes/api/protokolle/[id]/unterschrift/+server.ts  # POST (Unterschrift)
src/routes/api/protokolle/[id]/pdf/+server.ts           # GET (PDF)
src/routes/api/protokolle/[id]/email/+server.ts         # POST (E-Mail senden)
src/lib/components/DateiUpload.svelte      # Datei-Upload-Komponente
src/lib/components/Unterschrift.svelte     # Canvas-basierte Unterschrift
src/routes/(app)/auftraege/[id]/dokumentation/+page.svelte  # Fotos/Notizen/Protokolle
tests/db/dateien.test.ts                   # DB-Tests für Dateien
tests/db/baustellen-protokolle.test.ts     # DB-Tests für Protokolle
tests/unit/protokoll-pdf.test.ts           # Unit-Tests für PDF
```

---

### Task 1: Datenbank-Migration `017_protokolle_dateien.sql`

**Files:**
- Create: `db/migrations/017_protokolle_dateien.sql`
- Test: `tests/db/dateien.test.ts`, `tests/db/baustellen-protokolle.test.ts`

**Interfaces:**
- Consumes: `app.auftraege` (id, betrieb_id, nummer, titel, kunde_id), `app.kunden` (id, betrieb_id, name), `app.benutzer` (id, betrieb_id, name)
- Produces: `app.dateien` (id, betrieb_id, auftrag_id, name, typ, groesse, inhalt bytea, beschreibung, angelegt, geaendert), `app.baustellen_protokolle` (id, betrieb_id, auftrag_id, typ, inhalt jsonb, unterschrift bytea, pdf bytea, angelegt, geaendert, von_benutzer_id)

- [ ] **Step 1: Write failing tests for `app.dateien`**

```typescript
// tests/db/dateien.test.ts
it('legt eine Datei an und liest sie', async () => {
  const datei = await root`insert into app.dateien (betrieb_id, auftrag_id, name, typ, groesse, inhalt, beschreibung)
    values (${u.betriebA}, ${auftragId}, 'foto.jpg', 'image/jpeg', 1024, ${Buffer.from('test')}, 'Foto von der Baustelle')
    returning id`;
  expect(datei).toHaveLength(1);
  const gelesen = await root`select * from app.dateien where id = ${datei[0].id}`;
  expect(gelesen[0].name).toBe('foto.jpg');
});

it('Dateien sind nach Betrieb getrennt (RLS)', async () => {
  await root`insert into app.dateien (betrieb_id, auftrag_id, name, typ, groesse, inhalt)
    values (${u.betriebA}, ${auftragId}, 'a.jpg', 'image/jpeg', 100, ${Buffer.from('a')})`;
  // Betrieb B sieht nichts
  const b = await appB`select * from app.dateien`;
  expect(b).toHaveLength(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:db -- tests/db/dateien.test.ts`
Expected: FAIL (relation "app.dateien" does not exist)

- [ ] **Step 3: Implement migration `017_protokolle_dateien.sql`**

Create `app.dateien`:
- `id uuid primary key default gen_random_uuid()`
- `betrieb_id uuid not null references app.betriebe (id) on delete cascade`
- `auftrag_id uuid not null` (FK zu app.auftraege)
- `name text not null` (Originalname, max 255 Zeichen)
- `typ text not null` (MIME-Typ: image/jpeg, image/png, application/pdf, etc.)
- `groesse integer not null check (groesse > 0 and groesse <= 10485760)` (max 10 MB)
- `inhalt bytea not null` (Datei-Inhalt)
- `beschreibung text` (optional, max 500 Zeichen)
- `angelegt timestamptz not null default now()`
- `geaendert timestamptz not null default now()`
- `unique (id, betrieb_id)`
- FK: `(auftrag_id, betrieb_id) references app.auftraege (id, betrieb_id) on delete cascade`
- RLS: nur eigene Betriebsdaten
- Trigger: `app.protokolliere()` für Änderungsprotokoll
- Rechte: `crm_app` kann SELECT, INSERT, DELETE; UPDATE nur auf beschreibung

Create `app.baustellen_protokolle`:
- `id uuid primary key default gen_random_uuid()`
- `betrieb_id uuid not null references app.betriebe (id) on delete cascade`
- `auftrag_id uuid not null` (FK zu app.auftraege)
- `typ text not null check (typ in ('abnahme', 'regiebericht', 'aufmass', 'maengelliste'))`
- `inhalt jsonb not null default '{}'` (Protokoll-Inhalt: freie Struktur je Typ)
- `unterschrift bytea` (PNG der Kundenunterschrift, max 500 KB)
- `pdf bytea` (erzeugtes PDF, wird nach Erzeugung gespeichert)
- `angelegt timestamptz not null default now()`
- `geaendert timestamptz not null default now()`
- `von_benutzer_id uuid` (wer hat das Protokoll erstellt)
- `unique (id, betrieb_id)`
- FK: `(auftrag_id, betrieb_id) references app.auftraege (id, betrieb_id)`
- FK: `(von_benutzer_id, betrieb_id) references app.benutzer (id, betrieb_id)`
- RLS: nur eigene Betriebsdaten
- Trigger: `app.protokolliere()` für Änderungsprotokoll
- Rechte: `crm_app` kann SELECT, INSERT, UPDATE (inhalt, unterschrift, pdf), DELETE

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:db -- tests/db/dateien.test.ts tests/db/baustellen-protokolle.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add db/migrations/017_protokolle_dateien.sql tests/db/dateien.test.ts tests/db/baustellen-protokolle.test.ts
git commit -m "feat(2a): Datenbank-Tabellen für Dateien und Baustellen-Protokolle"
```

---

### Task 2: Dateien-Dienst `src/lib/server/dateien.ts`

**Files:**
- Create: `src/lib/server/dateien.ts`
- Test: `tests/db/dateien.test.ts` (erweitern)

**Interfaces:**
- Consumes: `mitBetrieb`, `Kontext` aus `./db`; `ApiFehler` aus `./fehler`; `pruefeBild` aus `./bildpruefung`
- Produces: `speichereDatei(k, auftragId, name, typ, groesse, inhalt, beschreibung?) -> Datei`, `liesDatei(k, dateiId) -> Datei | null`, `loescheDatei(k, dateiId) -> void`, `dateienFuerAuftrag(k, auftragId) -> Datei[]`

```typescript
export type Datei = {
  id: string;
  auftragId: string;
  name: string;
  typ: string;
  groesse: number;
  beschreibung: string | null;
  angelegt: string;
};

const DATEI_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ERLAUBTE_TYPEN = [
  'image/jpeg', 'image/png', 'image/webp',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
];
```

- [ ] **Step 1: Write failing tests**

```typescript
it('speichert eine Datei und liest sie', async () => {
  const datei = await speichereDatei(k, auftragId, 'foto.jpg', 'image/jpeg', 4, Buffer.from('test'), 'Beschreibung');
  expect(datei.name).toBe('foto.jpg');
  const gelesen = await liesDatei(k, datei.id);
  expect(gelesen).not.toBeNull();
  expect(gelesen!.typ).toBe('image/jpeg');
});

it('lehnt zu große Dateien ab (413)', async () => {
  await expect(speichereDatei(k, auftragId, 'gross.jpg', 'image/jpeg', DATEI_MAX_BYTES + 1, Buffer.alloc(1)))
    .rejects.toThrow('Die Datei ist zu groß');
});

it('lehnt unerlaubte MIME-Typen ab (400)', async () => {
  await expect(speichereDatei(k, auftragId, 'virus.exe', 'application/octet-stream', 100, Buffer.from('test')))
    .rejects.toThrow('Dieser Dateityp ist nicht erlaubt');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:db -- tests/db/dateien.test.ts`
Expected: FAIL (speichereDatei not defined)

- [ ] **Step 3: Implement `src/lib/server/dateien.ts`**

- Prüfungen: Größe ≤ 10 MB, MIME-Typ in Erlaubnisliste, Name nicht leer, max 255 Zeichen
- `speichereDatei`: INSERT mit RLS, gibt `Datei` zurück (ohne `inhalt`)
- `liesDatei`: SELECT mit RLS, gibt `Datei` mit `inhalt` zurück (für Download)
- `loescheDatei`: DELETE mit RLS
- `dateienFuerAuftrag`: SELECT alle Dateien eines Auftrags (ohne `inhalt`, nur Metadaten)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:db -- tests/db/dateien.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/dateien.ts tests/db/dateien.test.ts
git commit -m "feat(2a): Dateien-Dienst (Upload, Download, Löschen)"
```

---

### Task 3: Baustellen-Protokoll-Dienst `src/lib/server/baustellen-protokolle.ts`

**Files:**
- Create: `src/lib/server/baustellen-protokolle.ts`
- Test: `tests/db/baustellen-protokolle.test.ts` (erweitern)

**Interfaces:**
- Consumes: `mitBetrieb`, `Kontext` aus `./db`; `ApiFehler` aus `./fehler`; `pruefeModul` aus `./tarif`
- Produces: `legeProtokollAn(k, auftragId, typ, inhalt?, vonBenutzerId?) -> Protokoll`, `aktualisiereProtokoll(k, protokollId, inhalt?) -> Protokoll`, `speichereUnterschrift(k, protokollId, unterschrift: Uint8Array) -> void`, `liesProtokoll(k, protokollId) -> Protokoll | null`, `protokolleFuerAuftrag(k, auftragId) -> Protokoll[]`

```typescript
export type ProtokollTyp = 'abnahme' | 'regiebericht' | 'aufmass' | 'maengelliste';

export type Protokoll = {
  id: string;
  auftragId: string;
  typ: ProtokollTyp;
  inhalt: Record<string, unknown>;
  unterschriftVorhanden: boolean;
  pdfVorhanden: boolean;
  angelegt: string;
  geaendert: string;
  vonBenutzerId: string | null;
};

const UNTERSCHRIFT_MAX_BYTES = 512 * 1024; // 500 KB
```

- [ ] **Step 1: Write failing tests**

```typescript
it('legt ein Protokoll an und liest es', async () => {
  const prot = await legeProtokollAn(k, auftragId, 'abnahme', { bemerkung: 'Alles fertig' }, benutzerId);
  expect(prot.typ).toBe('abnahme');
  expect(prot.inhalt).toEqual({ bemerkung: 'Alles fertig' });
  const gelesen = await liesProtokoll(k, prot.id);
  expect(gelesen).not.toBeNull();
});

it('speichert eine Unterschrift', async () => {
  const prot = await legeProtokollAn(k, auftragId, 'abnahme');
  const unterschrift = Buffer.from('PNG-DUMMY');
  await speichereUnterschrift(k, prot.id, unterschrift);
  const gelesen = await liesProtokoll(k, prot.id);
  expect(gelesen!.unterschriftVorhanden).toBe(true);
});

it('lehnt zu große Unterschriften ab (413)', async () => {
  const prot = await legeProtokollAn(k, auftragId, 'abnahme');
  await expect(speichereUnterschrift(k, prot.id, Buffer.alloc(UNTERSCHRIFT_MAX_BYTES + 1)))
    .rejects.toThrow('Die Unterschrift ist zu groß');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:db -- tests/db/baustellen-protokolle.test.ts`
Expected: FAIL (legeProtokollAn not defined)

- [ ] **Step 3: Implement `src/lib/server/baustellen-protokolle.ts`**

- `legeProtokollAn`: prüft Modul `protokolle`, INSERT mit RLS
- `aktualisiereProtokoll`: UPDATE inhalt (nur wenn noch keine Unterschrift)
- `speichereUnterschrift`: UPDATE unterschrift (PNG, max 500 KB)
- `liesProtokoll`: SELECT mit RLS, gibt Metadaten zurück (ohne bytea-Felder)
- `protokolleFuerAuftrag`: SELECT alle Protokolle eines Auftrags

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:db -- tests/db/baustellen-protokolle.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/baustellen-protokolle.ts tests/db/baustellen-protokolle.test.ts
git commit -m "feat(2a): Baustellen-Protokoll-Dienst (CRUD, Unterschrift)"
```

---

### Task 4: Unterschrift-Komponente `src/lib/components/Unterschrift.svelte`

**Files:**
- Create: `src/lib/components/Unterschrift.svelte`
- Test: E2E-Test in `tests/e2e/protokolle.spec.ts`

**Interfaces:**
- Consumes: Touch-Events, HTML5 Canvas
- Produces: `onunterschrift: (png: Uint8Array) => void` (Callback mit PNG-Daten)

- [ ] **Step 1: Write failing E2E test**

```typescript
test('Unterschrift auf dem Handy: Canvas wird gezeichnet und PNG exportiert', async ({ page }) => {
  await page.goto('/auftraege/test-id/dokumentation');
  await page.click('[data-testid="protokoll-neu"]');
  await page.click('[data-testid="unterschrift-beginnen"]');
  // Simuliere Touch-Events
  const canvas = page.locator('[data-testid="unterschrift-canvas"]');
  await canvas.dispatchEvent('pointerdown', { clientX: 100, clientY: 100 });
  await canvas.dispatchEvent('pointermove', { clientX: 150, clientY: 120 });
  await canvas.dispatchEvent('pointerup');
  await page.click('[data-testid="unterschrift-speichern"]');
  // Prüfe, dass Unterschrift gespeichert wurde
  await expect(page.locator('[data-testid="unterschrift-vorhanden"]')).toBeVisible();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/e2e/protokolle.spec.ts`
Expected: FAIL (page not found)

- [ ] **Step 3: Implement `Unterschrift.svelte`**

- Canvas-Element mit `touch-action: none` (kein Scrollen)
- Pointer-Events: `pointerdown`, `pointermove`, `pointerup`
- Zeichnet Linien auf dem Canvas (2px, schwarz, runde Kappen)
- „Löschen"-Knopf setzt Canvas zurück
- „Fertig"-Knopf exportiert Canvas als PNG (`canvas.toBlob()`)
- Responsive: Canvas füllt verfügbare Breite, Höhe 200px

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/e2e/protokolle.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/Unterschrift.svelte tests/e2e/protokolle.spec.ts
git commit -m "feat(2a): Unterschrift-Komponente (Canvas, Touch-Events)"
```

---

### Task 5: Protokoll-PDF mit pdfkit `src/lib/server/pdf/protokoll-pdf.ts`

**Files:**
- Create: `src/lib/server/pdf/protokoll-pdf.ts`
- Test: `tests/unit/protokoll-pdf.test.ts`

**Interfaces:**
- Consumes: `PDFDocument` aus `pdfkit`; Schriften aus `./schriften/`; `Profil` aus `../betriebsprofil`
- Produces: `protokollPdf(daten: ProtokollPdfDaten) -> Uint8Array`

```typescript
export type ProtokollPdfDaten = {
  profil: Profil;
  logo: { bytes: Uint8Array; typ: string } | null;
  protokoll: {
    nummer: string;
    typ: string;
    datum: string;
    auftragNummer: string;
    auftragTitel: string;
    kundeName: string;
    objektBezeichnung: string | null;
    inhalt: Record<string, unknown>;
  };
  unterschrift: Uint8Array | null; // PNG
};
```

- [ ] **Step 1: Write failing test**

```typescript
it('erzeugt ein Protokoll-PDF mit allen Feldern', async () => {
  const pdf = await protokollPdf({
    profil: testProfil,
    logo: null,
    protokoll: {
      nummer: 'P-2026-0001',
      typ: 'Abnahme',
      datum: '2026-10-17',
      auftragNummer: 'A-2026-0001',
      auftragTitel: 'Badsanierung Müller',
      kundeName: 'Müller GmbH',
      objektBezeichnung: 'Hauptstraße 1, Hamburg',
      inhalt: { bemerkung: 'Alles fertig', maengel: 'Keine' }
    },
    unterschrift: Buffer.from('PNG-DUMMY')
  });
  expect(pdf.length).toBeGreaterThan(0);
  // PDF muss mit %PDF beginnen
  expect(Buffer.from(pdf.slice(0, 4)).toString()).toBe('%PDF');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/protokoll-pdf.test.ts`
Expected: FAIL (protokollPdf not defined)

- [ ] **Step 3: Implement `protokoll-pdf.ts`**

Aufbau (A4, wie Angebots-PDF):
- Kopf: Logo, Firmenname, Kontaktdaten
- Titel: „Protokoll [Typ] [Nummer]"
- Angaben: Auftrag-Nr., Datum, Kunde, Objekt
- Inhalt: Je Typ unterschiedliche Felder (Bemerkung, Mängel, Aufmaß-Positionen, etc.)
- Unterschrift: PNG-Bild unten rechts, wenn vorhanden
- Fußzeile: Firmendaten, Seitenzahlen

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/protokoll-pdf.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/pdf/protokoll-pdf.ts tests/unit/protokoll-pdf.test.ts
git commit -m "feat(2a): Protokoll-PDF mit pdfkit (Abnahme, Regiebericht, Aufmaß, Mängelliste)"
```

---

### Task 6: API-Endpunkte und E-Mail

**Files:**
- Create: `src/routes/api/dateien/+server.ts`, `src/routes/api/dateien/[id]/+server.ts`
- Create: `src/routes/api/protokolle/+server.ts`, `src/routes/api/protokolle/[id]/+server.ts`
- Create: `src/routes/api/protokolle/[id]/unterschrift/+server.ts`
- Create: `src/routes/api/protokolle/[id]/pdf/+server.ts`
- Create: `src/routes/api/protokolle/[id]/email/+server.ts`
- Create: `src/lib/server/email.ts`
- Test: `tests/db/dateien.test.ts`, `tests/db/baustellen-protokolle.test.ts` (erweitern)

**Interfaces:**
- Consumes: `dateien.ts`, `baustellen-protokolle.ts`, `protokoll-pdf.ts`
- Produces: REST-API für Dateien und Protokolle

- [ ] **Step 1: Write failing tests**

```typescript
// Dateien API
it('POST /api/dateien lädt eine Datei hoch', async () => {
  const antwort = await app.post('/api/dateien')
    .field('auftragId', auftragId)
    .attach('datei', Buffer.from('test'), 'foto.jpg');
  expect(antwort.status).toBe(201);
  expect(antwort.body.name).toBe('foto.jpg');
});

// Protokolle API
it('POST /api/protokolle legt ein Protokoll an', async () => {
  const antwort = await app.post('/api/protokolle')
    .send({ auftragId, typ: 'abnahme', inhalt: { bemerkung: 'Fertig' } });
  expect(antwort.status).toBe(201);
});

// Unterschrift API
it('POST /api/protokolle/:id/unterschrift speichert die Unterschrift', async () => {
  const prot = await legeProtokollAn(k, auftragId, 'abnahme');
  const antwort = await app.post(`/api/protokolle/${prot.id}/unterschrift`)
    .set('content-type', 'image/png')
    .send(Buffer.from('PNG-DUMMY'));
  expect(antwort.status).toBe(200);
});

// PDF API
it('GET /api/protokolle/:id/pdf gibt das PDF zurück', async () => {
  const prot = await legeProtokollAn(k, auftragId, 'abnahme', { bemerkung: 'Test' });
  await speichereUnterschrift(k, prot.id, Buffer.from('PNG-DUMMY'));
  const antwort = await app.get(`/api/protokolle/${prot.id}/pdf`);
  expect(antwort.status).toBe(200);
  expect(antwort.headers['content-type']).toBe('application/pdf');
});

// E-Mail API
it('POST /api/protokolle/:id/email sendet die E-Mail (Platzhalter)', async () => {
  const prot = await legeProtokollAn(k, auftragId, 'abnahme');
  const antwort = await app.post(`/api/protokolle/${prot.id}/email`);
  expect(antwort.status).toBe(200);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:db -- tests/db/dateien.test.ts tests/db/baustellen-protokolle.test.ts`
Expected: FAIL (routes not found)

- [ ] **Step 3: Implement API-Endpunkte**

**Dateien:**
- `POST /api/dateien`: multipart/form-data mit `auftragId` und `datei` (max 10 MB)
- `GET /api/dateien?auftragId=...`: Liste der Dateien eines Auftrags (ohne Inhalt)
- `GET /api/dateien/[id]`: Download einer Datei (mit Inhalt)
- `DELETE /api/dateien/[id]`: Löschen

**Protokolle:**
- `POST /api/protokolle`: JSON mit `auftragId`, `typ`, `inhalt?`
- `GET /api/protokolle?auftragId=...`: Liste der Protokolle eines Auftrags
- `GET /api/protokolle/[id]`: Einzelnes Protokoll
- `PUT /api/protokolle/[id]`: Protokoll aktualisieren (inhalt)

**Unterschrift:**
- `POST /api/protokolle/[id]/unterschrift`: PNG als roher Körper (max 500 KB)

**PDF:**
- `GET /api/protokolle/[id]/pdf`: PDF erzeugen und zurückgeben (oder gespeichertes PDF)

**E-Mail:**
- `POST /api/protokolle/[id]/email`: E-Mail mit PDF an den Kunden senden

**E-Mail-Platzhalter (`src/lib/server/email.ts`):**
- `sendeProtokollEmail(k, protokollId, empfaenger: string) -> void`
- Prüft `CRM_SMTP_URL` (sonst 500 „E-Mail-Dienst nicht konfiguriert")
- Erzeugt PDF, speichert es im Protokoll, sendet E-Mail mit PDF als Anhang
- Platzhalter: Loggt nur „E-Mail gesendet an [empfaenger]" (kein echter Versand)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:db -- tests/db/dateien.test.ts tests/db/baustellen-protokolle.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/routes/api/dateien/ src/routes/api/protokolle/ src/lib/server/email.ts
git add tests/db/dateien.test.ts tests/db/baustellen-protokolle.test.ts
git commit -m "feat(2a): API-Endpunkte für Dateien, Protokolle, Unterschrift, PDF, E-Mail"
```

---

### Task 7: UI-Seite `src/routes/(app)/auftraege/[id]/dokumentation/+page.svelte`

**Files:**
- Create: `src/routes/(app)/auftraege/[id]/dokumentation/+page.svelte`
- Create: `src/routes/(app)/auftraege/[id]/dokumentation/+page.server.ts`
- Create: `src/lib/components/DateiUpload.svelte`
- Test: E2E-Test in `tests/e2e/protokolle.spec.ts` (erweitern)

**Interfaces:**
- Consumes: `DateiUpload.svelte`, `Unterschrift.svelte`, API-Endpunkte aus Task 6
- Produces: UI für Fotos, Notizen, Protokolle mit Unterschrift

- [ ] **Step 1: Write failing E2E test**

```typescript
test('Fotos hochladen und Protokoll mit Unterschrift erstellen', async ({ page }) => {
  await page.goto('/auftraege/test-id/dokumentation');
  // Foto hochladen
  await page.setInputFiles('[data-testid="foto-upload"]', 'tests/fixtures/test.jpg');
  await expect(page.locator('[data-testid="foto-0"]')).toBeVisible();
  // Protokoll erstellen
  await page.click('[data-testid="protokoll-neu"]');
  await page.selectOption('[data-testid="protokoll-typ"]', 'abnahme');
  await page.fill('[data-testid="protokoll-bemerkung"]', 'Alles fertig');
  // Unterschrift
  await page.click('[data-testid="unterschrift-beginnen"]');
  const canvas = page.locator('[data-testid="unterschrift-canvas"]');
  await canvas.dispatchEvent('pointerdown', { clientX: 100, clientY: 100 });
  await canvas.dispatchEvent('pointermove', { clientX: 150, clientY: 120 });
  await canvas.dispatchEvent('pointerup');
  await page.click('[data-testid="unterschrift-speichern"]');
  // Speichern
  await page.click('[data-testid="protokoll-speichern"]');
  await expect(page.locator('[data-testid="protokoll-gespeichert"]')).toBeVisible();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/e2e/protokolle.spec.ts`
Expected: FAIL (page not found)

- [ ] **Step 3: Implement UI-Seite**

**`+page.server.ts`:**
- Lädt Auftrag, Kunden, Objekt, Dateien, Protokolle
- Form-Aktionen: Foto hochladen, Protokoll anlegen, Unterschrift speichern, PDF erzeugen, E-Mail senden

**`DateiUpload.svelte`:**
- Datei-Auswahl (input type="file", akzeptiert Bilder/PDFs)
- Vorschau für Bilder (thumbnail)
- Hochladen-Button mit Fortschrittsanzeige
- Liste der hochgeladenen Dateien mit Löschen-Button

**`+page.svelte`:**
- Tab-Leiste: Fotos | Notizen | Protokolle
- Fotos-Tab: DateiUpload-Komponente, Galerie-Ansicht
- Notizen-Tab: Textfeld (beschreibung des Auftrags)
- Protokolle-Tab:
  - Liste der Protokolle (Typ, Datum, Status)
  - „Neues Protokoll"-Button
  - Protokoll-Formular: Typ-Auswahl, Inhalt (je Typ unterschiedlich), Unterschrift
  - „PDF erzeugen"-Button
  - „E-Mail senden"-Button

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/e2e/protokolle.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/routes/(app)/auftraege/[id]/dokumentation/
git add src/lib/components/DateiUpload.svelte
git add tests/e2e/protokolle.spec.ts
git commit -m "feat(2a): UI-Seite für Fotos, Notizen und Protokolle mit Unterschrift"
```

---

### Task 8: Sprachsteuerung – Protokoll per Sprache ausfüllen

**Files:**
- Modify: `src/lib/server/sprache/aktionen.ts` (neue Aktion `protokoll_ausfuellen`)
- Modify: `src/lib/server/sprache/aufloesen.ts` (Protokoll-Typ auflösen)
- Modify: `src/lib/server/sprache/ausfuehren.ts` (Protokoll ausführen)
- Test: `tests/db/sprache.test.ts` (erweitern), `tests/sprache/befehle.json` (erweitern)

**Interfaces:**
- Consumes: `baustellen-protokolle.ts` aus Task 3
- Produces: Neue Sprachaktion `protokoll_ausfuellen`

- [ ] **Step 1: Write failing test**

```typescript
it('Protokoll per Sprache: „Protokoll für Auftrag A-2026-0001 ausfüllen: Abnahme, alles fertig"', async () => {
  const ergebnis = await vorschlagAusText(u.bueroA, 'Protokoll für Auftrag A-2026-0001 ausfüllen: Abnahme, alles fertig');
  expect(ergebnis.karte.titel).toContain('Protokoll');
  expect(ergebnis.karte.zeilen).toContainEqual(expect.stringContaining('Abnahme'));
  // Ausführen
  const ausfuehren = await fuehreAus(u.bueroA, ergebnis.vorschlag!);
  expect(ausfuehren.meldung).toContain('gespeichert');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:db -- tests/db/sprache.test.ts`
Expected: FAIL (aktion protokoll_ausfuellen not recognized)

- [ ] **Step 3: Implement Sprachaktion**

**`aktionen.ts`:**
- Neue Aktion `protokoll_ausfuellen` mit Schema:
  ```typescript
  {
    auftrag: { nummer: string },
    typ: 'abnahme' | 'regiebericht' | 'aufmass' | 'maengelliste',
    inhalt: { bemerkung?: string, maengel?: string, positionen?: string[] }
  }
  ```

**`aufloesen.ts`:**
- Auftrag über Nummer suchen (wie bei anderen Aktionen)
- Protokoll-Typ aus dem Text erkennen („Abnahme", „Regiebericht", „Aufmaß", „Mängelliste")
- Inhalt aus dem Rest des Textes extrahieren

**`ausfuehren.ts`:**
- Ruft `legeProtokollAn` auf
- Gibt `{ meldung, link }` zurück

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:db -- tests/db/sprache.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/sprache/aktionen.ts src/lib/server/sprache/aufloesen.ts src/lib/server/sprache/ausfuehren.ts
git add tests/db/sprache.test.ts tests/sprache/befehle.json
git commit -m "feat(2a): Sprachaktion protokoll_ausfuellen (Abnahme, Regiebericht, Aufmaß, Mängelliste)"
```

---

### Task 9: Gesamtprüfung und Abnahme

**Files:**
- Modify: `docs/superpowers/plans/2026-10-17-stufe2a-protokolle.md` (dieser Plan)
- Modify: `.superpowers/sdd/2026-10-17-stufe2a/progress.md` (Fortschrittsprotokoll)

- [ ] **Step 1: Code-Review (Gesamtprüfung)**

Alle Dateien aus Tasks 1–8 prüfen:
- Sicherheit: RLS, Rechte, Magic-Bytes, Größenlimits
- Korrektheit: Transaktionen, Fehlerbehandlung, Edge Cases
- Qualität: Kommentare, Typisierung, Duplikation

- [ ] **Step 2: Tests laufen lassen**

```bash
npm run check
npm test
npm run test:db
```

Expected: 0 Errors, alle Tests grün

- [ ] **Step 3: Vorschau neu bauen**

```bash
touch /work/crm/.vorschau-neubauen
```

Warten auf Neubau, prüfen: `curl https://crm.waybuild-software.de/api/gesundheit`

- [ ] **Step 4: Abnahme-Bildschirmfotos**

Screenshots von:
- Fotos hochladen (Mobile)
- Protokoll erstellen (Mobile)
- Unterschrift auf dem Handy (Mobile)
- PDF erzeugen (Desktop)
- E-Mail senden (Desktop)

Upload in Nextcloud `KI-Assistent/CRM/`

- [ ] **Step 5: Commit**

```bash
git commit -m "docs(2a): Gesamtprüfung und Abnahme Stufe 2a"
```

---

## Sprachbefehle (Testsatz-Erweiterung)

Die folgenden Sprachbefehle werden in `tests/sprache/befehle.json` ergänzt:

| Nr. | Befehl | Erwartete Aktion |
|-----|--------|------------------|
| 51 | „Protokoll für Auftrag A-2026-0001 ausfüllen: Abnahme, alles fertig" | protokoll_ausfuellen |
| 52 | „Regiebericht für Müller schreiben: zusätzliche Fliesenarbeiten" | protokoll_ausfuellen |
| 53 | „Aufmaß für Auftrag A-2026-0002: 15 Quadratmeter Fliesen" | protokoll_ausfuellen |
| 54 | „Mängelliste für Auftrag A-2026-0001: Silikonfuge im Bad erneuern" | protokoll_ausfuellen |
| 55 | „Foto von der Baustelle hochladen" | unbekannt (kein Sprachbefehl) |