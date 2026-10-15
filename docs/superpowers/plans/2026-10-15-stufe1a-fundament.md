# CRM System – Stufe 1a „Fundament“ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lauffähiges, mandantenfähiges Grundgerüst des CRM: Anmeldung (inkl. 2FA), Betriebe, frei einstellbare Rollen, Tarife/Freischaltungen, Plattform-Admin (Basis), Kunden & Objekte, mobile PWA-Hülle – Testbetrieb „Bauwelt“ angelegt.

**Architecture:** SvelteKit-App (Node, adapter-node, Port 3000) mit serverseitiger API unter `/api/*` und Seiten. PostgreSQL 16 mit Row Level Security: die App verbindet sich als eingeschränkte Rolle `crm_app`, jede Anfrage läuft in einer Transaktion mit `app.betrieb_id`/`app.benutzer_id` (set_config, lokal). Plattform-Admin nutzt Rolle `crm_admin`, die nur Verwaltungsdaten sieht (SECURITY-DEFINER-Funktionen), nie Kundendaten.

**Tech Stack:** Node 22, SvelteKit 2 + Svelte 5 + TypeScript, `postgres` (porsager) 3.x, `@node-rs/argon2`, `otpauth`, Vitest, Playwright 1.48.2 (über Container `mcr.microsoft.com/playwright:v1.48.2-jammy`, Host-Netz), reines CSS (keine UI-Bibliothek).

**Spec:** `docs/spec/pflichtenheft-v1.1.html` (Kopie des Pflichtenhefts v1.1) und `docs/spec/lastenheft-v1.1.html`.

Folgepläne (nicht Teil dieses Plans): 1b Aufträge/To-dos/Plantafel, 1c Leistungskatalog/Angebote/PDF, 1d Sprachsteuerung/KI.

## Global Constraints

- Entwicklung **nur** in der Sandbox: Repo liegt auf dem Host unter `/home/can/projekte/crm-system` (Dateien dort direkt mit Read/Edit/Write bearbeiten, git auf dem Host) und ist im Container `crm-dev` als `/work/crm` eingebunden. **Alle** node/npm/Test-Befehle laufen im Container: `sudo docker exec crm-dev sh -lc 'cd /work/crm && …'` (Container-Benutzer 1001 = Host-Benutzer can). Nie `npm` direkt auf dem Host. Keine Änderungen an `/opt/nextcloud-stack`, keine Caddy-Änderungen in diesem Plan.
- DB-Host `crm-db`, Superuser `crm` (PGPASSWORD im Container-Env) **nur** für Migrationen/Tests; App-Laufzeit **nie** als `crm`.
- Jede fachliche Tabelle hat `betrieb_id uuid not null` + `ENABLE` **und** `FORCE ROW LEVEL SECURITY`.
- UI-Sprache Deutsch, knappe neutrale Beschriftungen („Kunde anlegen“, „Speichern“).
- Mobile first: kleinste Zielbreite 360 px ohne horizontales Scrollen; Touch-Ziele ≥ 44 px.
- Rechte-Prüfung immer serverseitig (Tarif-Modul **und** Rollen-Recht); die UI blendet nur zusätzlich aus.
- Daten werden nie automatisch gelöscht (Abo-Status ändert nur Zugriff).
- Commits mit Trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Umlaute/Groß-Klein in der Kundensuche: „müller“ muss „Müller“ finden, „MUELLER“ muss „Müller“ **nicht** zwingend finden – Test in Task 11.
2. Laufende Sitzung, während Betrieb gesperrt oder Benutzer deaktiviert wird: nächste Anfrage → 401 bzw. Weiterleitung zur Anmeldung – Test in Task 12.
3. Anmelde-Missbrauch: 6. Fehlversuch in 15 Min. je E-Mail → 429; unbekannte E-Mail und falsches Passwort liefern identische Antwort – Test in Task 5.
4. Einladung doppelt/abgelaufen/schon benutzt → klare Fehlermeldung, kein zweites Konto – Test in Task 9.
5. Selbst-Aussperren: Der letzte Benutzer mit Recht `einstellungen` kann dieses Recht/seine Rolle nicht verlieren – Test in Task 7.

---

## File Structure

```
/work/crm
├── package.json, svelte.config.js, vite.config.ts, tsconfig.json, .env (gitignored), .env.example
├── db/migrations/001_rollen.sql … 00N_*.sql     # reines SQL, nummeriert
├── scripts/migrate.ts                            # Migrationen anwenden (als crm)
├── scripts/seed-dev.ts                           # Tarife, Betrieb Bauwelt, Chef, Plattform-Admin
├── src/hooks.server.ts                           # Sitzung → locals
├── src/lib/server/db.ts                          # Pools + mitBetrieb/mitAdmin/systemAbfrage
├── src/lib/server/auth/{passwort,sitzung,ratelimit,totp}.ts
├── src/lib/server/rechte.ts                      # RECHTE-Katalog, Vorlagen, hatRecht
├── src/lib/server/tarif.ts                       # hatModul, pruefeGrenze, darf
├── src/lib/server/fehler.ts                      # einheitliche API-Fehler
├── src/routes/api/…                              # JSON-API je Bereich
├── src/routes/(app)/…                            # Seiten für Betriebsnutzer
├── src/routes/admin/…                            # Plattform-Admin
├── src/routes/anmelden, einladung/[token]
├── src/service-worker.ts, static/manifest.webmanifest, static/icons/*
├── tests/unit/*.test.ts, tests/db/*.test.ts (echte DB crm_test), tests/e2e/*.spec.ts
└── docs/spec/*, docs/superpowers/plans/*
```

---

### Task 1: Arbeitsbereich & Grundgerüst

**Files:**
- Create: `/work/crm/*` (SvelteKit-Skeleton), `src/routes/api/gesundheit/+server.ts`, `tests/unit/gesundheit.test.ts`, `.gitignore`, `.env.example`, `docs/spec/*`

**Interfaces:**
- Produces: `npm run dev|build|test|test:db`, Endpunkt `GET /api/gesundheit` → `200 {"ok":true}`.

- [x] **Step 1:** (bereits erledigt vom Controller) Repo `/home/can/projekte/crm-system` angelegt und als `/work/crm` eingebunden; `docs/spec/*` und dieser Plan liegen schon im Repo.
- [ ] **Step 2:** Im Repo (git existiert schon): SvelteKit (TypeScript, Svelte 5) anlegen (ohne vorhandene `docs/` zu überschreiben), `@sveltejs/adapter-node`, Vitest einrichten. Vite-Server muss im Container auf `0.0.0.0:3000` lauschen (Host-Port 127.0.0.1:8300).
- [ ] **Step 3: Failing test** `tests/unit/gesundheit.test.ts`: importiert `GET` aus dem Endpunkt, erwartet Status 200 und Body `{ ok: true }`.
- [ ] **Step 4:** `npm test` → FAIL (Modul fehlt). Endpunkt implementieren. `npm test` → PASS; `npm run build` → erfolgreich.
- [ ] **Step 5: Commit** „chore: Grundgerüst SvelteKit + Vitest“.

### Task 2: Migrations-Runner & DB-Rollen

**Files:**
- Create: `scripts/migrate.ts`, `db/migrations/001_rollen.sql`, `tests/db/setup.ts`, `tests/db/rollen.test.ts`
- Modify: `package.json` (Skripte `migrate`, `test:db`)

**Interfaces:**
- Produces: `migrate(url: string): Promise<string[]>` (gibt angewendete Dateinamen zurück; Tabelle `schema_migrationen(name text primary key, angewendet timestamptz)`); Test-Helfer `frischeTestDb(): Promise<{ urlSuper, urlApp, urlAdmin }>` (legt DB `crm_test` neu an, migriert).
- Rollen: `crm_app` (LOGIN, NOSUPERUSER, NOBYPASSRLS), `crm_admin` (LOGIN, NOSUPERUSER, NOBYPASSRLS); Passwörter aus `.env` (`CRM_APP_PASSWORT`, `CRM_ADMIN_PASSWORT`, je 32 Zeichen zufällig, in Step 1 erzeugt). Schema `app`, Owner `crm`.

- [ ] **Step 1:** `.env` mit zufälligen Passwörtern erzeugen (nicht committen), `.env.example` mit Platzhaltern.
- [ ] **Step 2: Failing tests** `rollen.test.ts`: (a) `migrate` zweimal → zweiter Lauf liefert `[]`; (b) `select rolsuper, rolbypassrls from pg_roles where rolname in ('crm_app','crm_admin')` → alle `false`.
- [ ] **Step 3:** `npm run test:db` → FAIL. Runner (Dateien sortiert, je Datei eine Transaktion) + `001_rollen.sql` implementieren (Rollen idempotent per `DO`-Block; Passwort via `ALTER ROLE … PASSWORD` aus Runner-Parameter, nicht im SQL-File).
- [ ] **Step 4:** `npm run test:db` → PASS. **Commit** „feat(db): Migrationen und eingeschränkte DB-Rollen“.

### Task 3: Kernschema & Mandantentrennung (RLS)

**Files:**
- Create: `db/migrations/002_kern.sql`, `tests/db/rls.test.ts`

**Interfaces:**
- Tabellen (Schema `app`): `tarife(id uuid pk, schluessel text unique, name text, module text[], grenzen jsonb)`; `betriebe(id uuid pk, name text, tarif_id uuid fk, abo_status text check in ('test','aktiv','ueberfaellig','gekuendigt','gesperrt'), abo_ende date null, angelegt timestamptz)`; `rollen(id, betrieb_id, name, rechte text[], vorlage text null)`; `benutzer(id, betrieb_id null, email citext unique, name, passwort_hash, rolle_id null, aktiv bool default true, totp_geheim text null, totp_aktiv bool default false, letzte_aktivitaet timestamptz)`; `plattform_admins(benutzer_id pk fk)`; `sitzungen(token_hash bytea pk, benutzer_id, laeuft_ab timestamptz, angelegt)`.
- RLS-Policy auf `rollen`, `benutzer` (sofern `betrieb_id` gesetzt): `betrieb_id = nullif(current_setting('app.betrieb_id', true),'')::uuid` für SELECT/INSERT/UPDATE/DELETE. `betriebe`: `crm_app` darf nur die eigene Zeile lesen (`id = app.betrieb_id`), nicht ändern. `tarife`: lesbar für `crm_app`. `sitzungen`, `plattform_admins`: kein direkter Zugriff für `crm_app` (nur über Funktionen aus Task 4/5).

- [ ] **Step 1: Failing tests** `rls.test.ts` (als `crm_app`, Betriebe A und B angelegt per Superuser): `ohne Kontext → 0 Zeilen in rollen`; `Kontext A sieht nur Rollen von A`; `INSERT mit betrieb_id B im Kontext A → Fehler (RLS)`; `UPDATE einer B-Rolle im Kontext A → 0 betroffene Zeilen`; `crm_app SELECT auf sitzungen → permission denied`.
- [ ] **Step 2:** FAIL → Migration schreiben (inkl. `ENABLE/FORCE ROW LEVEL SECURITY`, GRANTs) → PASS. **Commit** „feat(db): Kernschema mit Row Level Security“.

### Task 4: DB-Zugriffsschicht

**Files:**
- Create: `src/lib/server/db.ts`, `tests/db/db.test.ts`

**Interfaces:**
- Produces:
  - `type Kontext = { betriebId: string; benutzerId: string }`
  - `mitBetrieb<T>(k: Kontext, fn: (sql: TransactionSql) => Promise<T>): Promise<T>` – Pool `crm_app`, Transaktion, setzt `app.betrieb_id`, `app.benutzer_id` lokal.
  - `mitAdmin<T>(adminId: string, fn: (sql) => Promise<T>): Promise<T>` – Pool `crm_admin`, setzt `app.admin_id`.
  - `systemAbfrage<T>(fn: (sql) => Promise<T>): Promise<T>` – Pool `crm_app` **ohne** Kontext; darf nur SECURITY-DEFINER-Funktionen aufrufen (Anmeldung, Sitzung).
- [ ] **Step 1: Failing tests:** `mitBetrieb setzt Kontext` (`select current_setting('app.betrieb_id')` = A); `Kontext leckt nicht zwischen Transaktionen` (nach mitBetrieb(A) liefert systemAbfrage `current_setting('app.betrieb_id', true)` leer/null); `Fehler in fn → Rollback`.
- [ ] **Step 2:** FAIL → implementieren → PASS. **Commit** „feat: DB-Zugriff mit Mandantenkontext“.

### Task 5: Anmeldung, Sitzungen, Begrenzung

**Files:**
- Create: `db/migrations/003_auth.sql` (Funktionen), `src/lib/server/auth/passwort.ts`, `sitzung.ts`, `ratelimit.ts`, `src/hooks.server.ts`, `src/routes/anmelden/+page.svelte`, `+page.server.ts`, `src/routes/api/abmelden/+server.ts`, `tests/db/auth.test.ts`, `tests/unit/ratelimit.test.ts`

**Interfaces:**
- SQL (SECURITY DEFINER, owner `crm`, EXECUTE nur für `crm_app`): `app.anmeldung_finden(p_email citext) returns table(id, betrieb_id, passwort_hash, aktiv, totp_aktiv)`, `app.sitzung_anlegen(p_benutzer uuid, p_hash bytea, p_ablauf timestamptz)`, `app.sitzung_pruefen(p_hash bytea) returns table(benutzer_id, betrieb_id, ist_admin bool, rolle_rechte text[], betrieb_status text)` (liefert nichts, wenn Benutzer inaktiv, Sitzung abgelaufen **oder Betrieb gesperrt**; verlängert `laeuft_ab` gleitend auf +30 Tage und setzt `letzte_aktivitaet`), `app.sitzung_loeschen(p_hash bytea)`.
- TS: `hashePasswort(p: string): Promise<string>`, `pruefePasswort(hash: string, p: string): Promise<boolean>` (Argon2id, Standardparameter von @node-rs/argon2); `neueSitzung(benutzerId): Promise<string>` (32 Byte Zufall, base64url; gespeichert wird SHA-256); Cookie `crm_sitzung` (httpOnly, Secure, SameSite=Lax, Path=/, 30 Tage); `type Nutzer = { id: string; betriebId: string | null; istAdmin: boolean; rechte: string[]; betriebStatus: string | null }`, `locals.nutzer: Nutzer | null` (Typ in `src/app.d.ts`).
- Begrenzung: `pruefeVersuch(schluessel: string, jetzt?: number): { erlaubt: boolean }` – max. 5 Fehlversuche je E-Mail in 15 Min. (im Speicher), Erfolg setzt zurück.
- Antwort bei falscher E-Mail **und** falschem Passwort identisch: „E-Mail oder Passwort ist falsch.“ (bei unbekannter E-Mail trotzdem einen Dummy-Hash prüfen).

- [ ] **Step 1: Failing tests:** `richtiges Passwort → Sitzung + Cookie`; `falsches Passwort und unbekannte E-Mail → gleiche Meldung`; `6. Fehlversuch → 429`; `abgelaufene Sitzung → locals.nutzer null`; `abmelden löscht Sitzung`.
- [ ] **Step 2:** FAIL → implementieren (Anmeldeseite: E-Mail, Passwort, Button „Anmelden“) → PASS. **Commit** „feat(auth): Anmeldung, Sitzungen, Schutz vor Durchprobieren“.

### Task 6: Zwei-Faktor-Anmeldung (TOTP)

**Files:**
- Create: `src/lib/server/auth/totp.ts`, `src/routes/anmelden/zweiter-faktor/*`, `src/routes/(app)/konto/zwei-faktor/*`, `tests/unit/totp.test.ts`, `tests/db/zweifaktor.test.ts`

**Interfaces:**
- `neuesTotpGeheimnis(email): { geheimnis: string; uri: string }` (otpauth, SHA1, 6 Ziffern, 30 s, Aussteller „CRM System“); `pruefeTotp(geheimnis, code): boolean` (Fenster ±1).
- **Pflicht** für Plattform-Admins und für Benutzer, deren Rolle das Recht `einstellungen` hat: ohne aktive 2FA werden sie nach dem Passwort auf `/konto/zwei-faktor` (Einrichtung mit QR-Code) gezwungen; mit aktiver 2FA folgt `/anmelden/zweiter-faktor`. Zwischenzustand als kurzlebige Vor-Sitzung (5 Min.), erst nach Code die volle Sitzung.
- [ ] **Step 1: Failing tests:** `gültiger Code → true`, `Code von vor 2 Fenstern → false`; `Chef ohne 2FA erhält nach Passwort nur Vor-Sitzung und Weiterleitung zur Einrichtung`; `Monteur ohne 2FA → volle Sitzung`.
- [ ] **Step 2:** FAIL → implementieren → PASS. **Commit** „feat(auth): Zwei-Faktor-Anmeldung für Chef und Admin“.

### Task 7: Rechte & Rollen

**Files:**
- Create: `src/lib/server/rechte.ts`, `src/routes/api/rollen/+server.ts`, `src/routes/api/rollen/[id]/+server.ts`, `src/routes/(app)/einstellungen/rollen/*`, `src/lib/server/fehler.ts`, `tests/unit/rechte.test.ts`, `tests/db/rollen-api.test.ts`

**Interfaces:**
- `RECHTE` (const, Schlüssel → deutsches Label): `kunden.lesen`, `kunden.bearbeiten`, `auftraege.lesen`, `auftraege.alle_lesen`, `auftraege.bearbeiten`, `plantafel.bearbeiten`, `angebote.bearbeiten`, `preise.sehen`, `katalog.bearbeiten`, `benutzer.verwalten`, `einstellungen`.
- `VORLAGEN`: `chef` = alle; `buero` = alle außer `einstellungen`, `benutzer.verwalten`; `monteur` = `kunden.lesen`, `auftraege.lesen`.
- `hatRecht(nutzer: Nutzer, recht: Recht): boolean`; `pruefeRecht(locals, recht): void` wirft `ApiFehler(403, 'Keine Berechtigung')`; `ApiFehler(status, meldung)` + `alsAntwort(e)` in `fehler.ts`.
- API: `GET/POST /api/rollen`, `PUT/DELETE /api/rollen/[id]` (Recht `einstellungen`). Unbekannte Rechte-Schlüssel → 400. Rolle in Benutzung löschen → 409.
- Schutzregel: Eine Änderung, nach der im Betrieb kein aktiver Benutzer mehr eine Rolle mit `einstellungen` hätte, → 409 „Mindestens ein Benutzer muss die Einstellungen verwalten können.“
- [ ] **Step 1: Failing tests:** `Vorlage monteur hat kein preise.sehen`; `Monteur ruft PUT /api/rollen/x → 403`; `unbekanntes Recht → 400`; `Chef entzieht letzter Chef-Rolle 'einstellungen' → 409`.
- [ ] **Step 2:** FAIL → implementieren (Seite: Rollenliste, Rolle bearbeiten mit Checkbox je Recht, deutsch beschriftet) → PASS. **Commit** „feat: frei einstellbare Rollen mit Vorlagen“.

### Task 8: Tarife & Freischaltungen

**Files:**
- Create: `src/lib/server/tarif.ts`, `db/migrations/004_tarife_seed.sql`, `src/lib/components/TarifHinweis.svelte`, `tests/db/tarif.test.ts`

**Interfaces:**
- `MODULE`: `kunden`, `auftraege`, `plantafel`, `katalog`, `angebote`, `ki_angebote`, `sprache`, `zeiterfassung`, `protokolle`, `kundenportal`, `lexware`, `nextcloud`.
- Seed: `test` (alle Module, `{"benutzer": 50, "ki_pro_monat": 2000}`), `basis` (`kunden, auftraege, plantafel, katalog, angebote`; `{"benutzer": 3, "ki_pro_monat": 0}`), `profi` (+ `ki_angebote, sprache, zeiterfassung, protokolle`; `{"benutzer": 10, "ki_pro_monat": 300}`), `premium` (alle; `{"benutzer": 30, "ki_pro_monat": 1500}`) – Namen/Werte sind Platzhalter (Can legt fest, Pflichtenheft 9.3).
- `hatModul(betriebId, modul): Promise<boolean>`; `pruefeModul(locals, modul)` wirft `ApiFehler(402, 'Im aktuellen Tarif nicht enthalten', { tarifMit: string[] })`; `pruefeGrenze(betriebId, 'benutzer'): Promise<void>` wirft `ApiFehler(409, 'Benutzergrenze des Tarifs erreicht')`; `darf(locals, modul, recht)` = beide Prüfungen.
- Nur Lesezugriff (schreibende Anfragen → 403 „Nur Lesezugriff“): Status `ueberfaellig`, wenn `abo_ende + 14 Tage < heute` (Schonfrist), sowie Status `gekuendigt`, wenn `abo_ende < heute`. `gesperrt` → keine Sitzung (Task 5).
- [ ] **Step 1: Failing tests:** `Betrieb mit basis → pruefeModul('sprache') wirft 402 mit tarifMit ['profi','premium','test']`; `Benutzergrenze 3 erreicht → 409`; `gekuendigt mit abgelaufenem abo_ende → Schreibanfrage 403, Leseanfrage 200` (Kunden-Endpunkte kommen erst in Task 11 – hier gegen einen Test-Endpunkt oder die Rollen-API prüfen).
- [ ] **Step 2:** FAIL → implementieren (`TarifHinweis` zeigt „Im Tarif Profi enthalten“) → PASS. **Commit** „feat: Tarife und Modul-Freischaltungen“.

### Task 9: Benutzer & Einladungen

**Files:**
- Create: `db/migrations/005_einladungen.sql`, `src/routes/api/benutzer/*`, `src/routes/api/einladungen/*`, `src/routes/einladung/[token]/*`, `src/routes/(app)/einstellungen/benutzer/*`, `tests/db/einladungen.test.ts`

**Interfaces:**
- Tabelle `einladungen(id, betrieb_id, email citext, rolle_id, token_hash bytea unique, laeuft_ab, angenommen timestamptz null)` mit RLS; Annahme über `app.einladung_annehmen(p_hash bytea, p_name text, p_passwort_hash text) returns uuid` (SECURITY DEFINER).
- `POST /api/einladungen {email, rolleId}` (Recht `benutzer.verwalten`, `pruefeGrenze('benutzer')`) → `{ link }` (Gültigkeit 7 Tage; E-Mail-Versand folgt später – Link wird angezeigt zum Teilen).
- `PATCH /api/benutzer/[id] {rolleId?, aktiv?}`; Deaktivieren beendet alle Sitzungen des Benutzers.
- Fehler: E-Mail existiert bereits → 409 „Diese E-Mail ist bereits registriert.“; Token abgelaufen/benutzt/unbekannt → Seite „Diese Einladung ist nicht mehr gültig.“
- [ ] **Step 1: Failing tests:** `Einladung annehmen legt Benutzer mit Rolle an`; `zweite Annahme desselben Tokens → ungültig, kein zweites Konto`; `abgelaufen → ungültig`; `bekannte E-Mail einladen → 409`; `deaktivierter Benutzer: bestehende Sitzung ungültig`.
- [ ] **Step 2:** FAIL → implementieren → PASS. **Commit** „feat: Benutzerverwaltung und Einladungen“.

### Task 10: Änderungsprotokoll

**Files:**
- Create: `db/migrations/006_protokoll.sql`, `src/routes/api/protokoll/+server.ts`, `tests/db/protokoll.test.ts`

**Interfaces:**
- Tabelle `aenderungen(id bigserial, betrieb_id, benutzer_id, tabelle text, datensatz_id uuid, aktion text check in ('angelegt','geaendert','geloescht'), vorher jsonb, nachher jsonb, zeit timestamptz default now(), quelle text default 'oberflaeche')` mit RLS (nur SELECT/INSERT für `crm_app`, kein UPDATE/DELETE).
- Generischer Trigger `app.protokolliere()` (AFTER INSERT/UPDATE/DELETE) auf `rollen`, `benutzer` (ohne `passwort_hash`, `totp_geheim` in den JSON-Daten), später allen Fachtabellen; `quelle` aus `current_setting('app.quelle', true)` (Sprachsteuerung setzt später `'sprache'`).
- `GET /api/protokoll?tabelle=&datensatz=` (Recht `einstellungen` oder Leserecht der Tabelle).
- [ ] **Step 1: Failing tests:** `Rolle ändern erzeugt Eintrag mit vorher/nachher und benutzer_id`; `passwort_hash taucht nie im Protokoll auf`; `crm_app kann aenderungen nicht löschen`.
- [ ] **Step 2:** FAIL → implementieren → PASS. **Commit** „feat: Änderungsprotokoll“.

### Task 11: Kunden & Objekte

**Files:**
- Create: `db/migrations/007_kunden.sql`, `src/routes/api/kunden/*`, `src/routes/api/kunden/[id]/objekte/*`, `src/routes/(app)/kunden/*` (Liste mit Suche, Detail, Formular), `tests/db/kunden.test.ts`

**Interfaces:**
- Tabellen: `kunden(id, betrieb_id, art text check in ('privat','firma'), firma text null, anrede text null, vorname text null, nachname text null, email citext null, telefon text null, strasse, plz, ort, notiz, angelegt, geaendert)`; `objekte(id, betrieb_id, kunde_id fk, bezeichnung, strasse, plz, ort, notiz)` – RLS + Protokoll-Trigger. Pflicht: bei `privat` Nachname, bei `firma` Firmenname.
- `GET /api/kunden?suche=` – Suche über `firma, vorname, nachname, ort, telefon, email` mit `ILIKE` auf `lower()`-Basis (Umlaute bleiben erhalten); max. 50 Treffer, sortiert nach Name.
- Rechte: lesen `kunden.lesen` + Modul `kunden`; schreiben `kunden.bearbeiten`. Detailseite zeigt Objekte und den Verlauf aus `aenderungen`.
- [ ] **Step 1: Failing tests:** `Privatkunde ohne Nachname → 400`; `Suche 'müller' findet 'Müller'`; `Suche nach Telefon-Teilstring findet Kunden`; `Monteur GET 200, POST 403`; `Kunde aus Betrieb B im Kontext A → 404`.
- [ ] **Step 2:** FAIL → implementieren (mobile Liste mit Suchfeld oben, großer „+ Kunde“-Knopf) → PASS. **Commit** „feat: Kunden und Objekte“.

### Task 12: Plattform-Admin (Basis)

**Files:**
- Create: `db/migrations/008_admin.sql`, `src/routes/admin/+layout.server.ts`, `src/routes/admin/+page.svelte` (Übersicht), `src/routes/admin/betriebe/[id]/*`, `src/routes/api/admin/*`, `tests/db/admin.test.ts`

**Interfaces:**
- SQL (SECURITY DEFINER, EXECUTE nur `crm_admin`): `app.admin_betriebe()` → `id, name, tarif, abo_status, abo_ende, benutzer_anzahl, letzte_aktivitaet`; `app.admin_betrieb_aendern(p_id uuid, p_tarif text null, p_status text null, p_abo_ende date null)`; `app.admin_betrieb_anlegen(p_name text, p_tarif text, p_chef_email citext, p_chef_name text) returns text` (gibt Einladungslink-Token zurück, legt Rollen aus Vorlagen an). Jede Admin-Funktion schreibt in `admin_protokoll(id, admin_id, aktion, details jsonb, zeit)`.
- `crm_admin` erhält **keine** Rechte auf `kunden`, `objekte`, `aenderungen`, `benutzer.passwort_hash`.
- Zugriff `/admin` nur mit `locals.nutzer.istAdmin` und aktiver 2FA, sonst 404.
- [ ] **Step 1: Failing tests:** `Übersicht listet beide Betriebe mit Benutzeranzahl`; `crm_admin SELECT auf kunden → permission denied`; `Betrieb sperren → laufende Sitzung eines Benutzers dort ungültig`; `Nicht-Admin GET /admin → 404`; `Tarifwechsel erzeugt admin_protokoll-Eintrag`.
- [ ] **Step 2:** FAIL → implementieren → PASS. **Commit** „feat: Plattform-Admin Basis“.

### Task 13: App-Hülle, Startseite & PWA

**Files:**
- Create: `src/routes/(app)/+layout.svelte` (Navigation), `src/routes/(app)/+page.svelte` (Start), `src/lib/styles/basis.css`, `static/manifest.webmanifest`, `static/icons/icon-192.png`, `icon-512.png`, `src/service-worker.ts`, `tests/e2e/smoke.spec.ts`, `playwright.config.ts`

**Interfaces:**
- Navigation: unter 900 px Leiste unten (Start, Kunden, Plantafel*, Mehr), ab 900 px Seitenleiste; Einträge nur, wenn Modul + Recht vorhanden (*Plantafel als „bald verfügbar“ bis Plan 1b).
- Manifest: `name` „CRM System“, `display` „standalone“, `start_url` „/“, Farben neutral (Primär #05346B).
- Service Worker: App-Hülle + statische Dateien cachen; API nie cachen.
- E2E (Playwright-Container, `--network host`, `baseURL http://127.0.0.1:8300`, Viewport 390×844 und 1280×800).
- [ ] **Step 1: Failing E2E** `smoke.spec.ts`: Anmelden als Seed-Büro-Benutzer → Kunde „Müller“ anlegen → in Liste suchen „müller“ → sichtbar; auf 360 px Breite gilt `document.documentElement.scrollWidth <= 360`; `manifest.webmanifest` liefert 200 mit `display: standalone`.
- [ ] **Step 2:** FAIL → implementieren → PASS. **Commit** „feat: mobile App-Hülle und PWA“.

### Task 14: Entwicklungsdaten & Vorschau

**Files:**
- Create: `scripts/seed-dev.ts`, `scripts/start-vorschau.sh`, `README.md` (Start, Tests, Struktur – deutsch, kurz)

**Interfaces:**
- Seed (idempotent): Tarife (Task 8), Betrieb „Bauwelt“ (Tarif `test`, Status `test`), Benutzer `chef@bauwelt.test` (Rolle Chef), `buero@bauwelt.test` (Büro), `monteur@bauwelt.test` (Monteur), Plattform-Admin `admin@crm.test`; Passwörter zufällig, nur in `/work/crm/.zugangsdaten-dev` (gitignored, 600); 5 Beispielkunden mit Umlauten.
- `start-vorschau.sh`: `npm run build && node build` im Hintergrund (`nohup`, Log `/work/crm/vorschau.log`), Port 3000 → Host 127.0.0.1:8300.
- [ ] **Step 1:** Seed zweimal ausführen → keine Duplikate (Zählabfrage gleich).
- [ ] **Step 2:** Vorschau starten; `curl -s 127.0.0.1:8300/api/gesundheit` → `{"ok":true}`; komplette Testsuite (`npm test`, `npm run test:db`, E2E) grün.
- [ ] **Step 3:** Screenshots (Anmeldung, Kundenliste mobil, Admin-Übersicht) für Jamil erzeugen. **Commit** „chore: Entwicklungsdaten und Vorschau“.
