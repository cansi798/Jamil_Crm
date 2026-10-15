# CRM System

Mandantenfähiges CRM für Handwerksbetriebe mit deutscher Oberfläche. Mehrere Betriebe (Mandanten) teilen sich eine
Datenbank, sehen aber nie Daten der anderen. Stufe 1a ist das Fundament: Anmeldung mit Rollen und Zwei-Faktor,
Benutzer und Einladungen, Tarife und Module, Änderungsprotokoll, Kunden mit Objekten, Plattform-Verwaltung für den
Betreiber, mobile App-Hülle (PWA).

Lastenheft und Pflichtenheft: `docs/spec/`.

## Stack

- SvelteKit 2 mit Svelte 5, TypeScript, `adapter-node` (Produktions-Build läuft mit `node build`)
- PostgreSQL 16 mit Row Level Security (RLS), Treiber `postgres`
- Passwörter mit Argon2 (`@node-rs/argon2`), Zwei-Faktor mit TOTP (`otpauth`, `qrcode`)
- Tests: Vitest (Unit und Datenbank), Playwright (E2E im Browser)

## Verzeichnisse

| Pfad | Inhalt |
| --- | --- |
| `src/routes/` | Seiten und API: `(app)` (Betriebsnutzer), `admin` (Plattform), `anmelden`, `einladung`, `api/*` |
| `src/lib/server/` | Serverlogik: `db.ts` (Pools, Mandantenkontext), `auth/` (Sitzung, Passwort, TOTP, Begrenzung), `rechte.ts`, `tarif.ts`, `kunden.ts`, `benutzer.ts`, `admin.ts`, `protokoll.ts` |
| `src/lib/components/`, `src/lib/stil/` | Wiederverwendbare Svelte-Bausteine und Stil |
| `src/hooks.server.ts` | Sitzungsprüfung, Admin-Pfad, Nur-Lese-Sperre |
| `db/migrations/` | SQL-Migrationen (`001` bis `008`, dazu `003a`/`003b`), werden nach Dateiname sortiert angewendet |
| `scripts/` | `migrate.ts`, `seed-dev.ts`, `start-vorschau.sh`, `erzeuge-icons.ts` |
| `tests/unit`, `tests/db`, `tests/e2e` | Unit-Tests, Datenbank-Tests (je Test eine frische Datenbank), Browser-Tests |
| `static/` | Manifest, Symbole der PWA |

## Entwicklung in der Sandbox

Alle Node-Befehle laufen im Container `crm-dev` (Node 22), nie auf dem Host. Das Repo liegt dort unter `/work/crm`.
Die Datenbank läuft im Container `crm-db` und ist nur aus `crm-dev` erreichbar.

```sh
sudo docker exec crm-dev sh -lc 'cd /work/crm && npm test'            # Unit-Tests
sudo docker exec crm-dev sh -lc 'cd /work/crm && npm run test:db'     # Datenbank-Tests
sudo docker exec crm-dev sh -lc 'cd /work/crm && npm run check'       # Typ- und Svelte-Prüfung
sudo docker exec crm-dev sh -lc 'cd /work/crm && npm run build'       # Produktions-Build
sudo docker exec crm-dev sh -lc 'cd /work/crm && npm run migrate'     # Migrationen anwenden
sudo docker exec crm-dev sh -lc 'cd /work/crm && npm run seed:dev'    # Entwicklungsdaten (siehe unten)
sudo docker exec crm-dev sh -lc 'cd /work/crm && sh scripts/start-vorschau.sh'   # Vorschau starten
```

Vorschau: `start-vorschau.sh` migriert, baut, beendet eine alte Vorschau und startet `node build` im Hintergrund
(Port 3000 im Container, vom Host aus `http://127.0.0.1:8300`, Log `vorschau.log`). Prüfen:
`curl -s 127.0.0.1:8300/api/gesundheit` liefert `{"ok":true}`.

## Umgebungsvariablen

Werte gehören in `.env` (nicht committen, Vorlage: `.env.example`) oder in die Umgebung des Prozesses.

- Datenbank: entweder `DATABASE_URL_APP`, `DATABASE_URL_ADMIN`, `DATABASE_URL_AUTH` oder `PGHOST`, `PGPORT`,
  `PGDATABASE` zusammen mit `CRM_APP_PASSWORT`, `CRM_ADMIN_PASSWORT`, `CRM_AUTH_PASSWORT`.
  Die Anwendung verweigert den Start, wenn eine dieser Verbindungen den Superuser `crm` nennt.
- `PGUSER`, `PGPASSWORD`: Superuser nur für Migrationen, Seed und Tests, nie für die laufende Anwendung.
- `ORIGIN`: öffentliche Adresse der Anwendung (SvelteKit prüft damit Formular-Anfragen), z. B. `http://127.0.0.1:8300`.
- `NODE_ENV`: `production` im Betrieb. Dann schreibt der Seed nie Daten.
- `HOST`, `PORT`: Adresse des Node-Servers (Vorschau: `0.0.0.0` und `3000`).

## Migrationen

`npm run migrate` wendet alle noch nicht angewendeten Dateien aus `db/migrations/` an (je Datei eine Transaktion,
Advisory Lock gegen parallele Läufe, Buchführung in einer eigenen Tabelle). Er läuft als Superuser und setzt die
Passwörter der Rollen aus den `CRM_*_PASSWORT`-Variablen; in den SQL-Dateien stehen nie Passwörter. Ein zweiter Lauf
tut nichts.

## Entwicklungsdaten (Seed)

`npm run seed:dev` legt den Betrieb „Bauwelt“ (Tarif `test`) mit den Benutzern `chef@bauwelt.test`,
`buero@bauwelt.test`, `monteur@bauwelt.test`, den Plattform-Admin `admin@crm.test` und 5 Beispielkunden mit Umlauten
an. Er ist idempotent (mehrfaches Ausführen erzeugt keine Duplikate).

- Nur für die Sandbox: Abbruch bei `NODE_ENV=production` und gegen jede Datenbank außer `crm`. Eine andere
  Datenbank muss ausdrücklich genannt werden: `npm run seed:dev -- --erlaube-db=<name>`.
- Passwörter sind zufällig und stehen nur in `.zugangsdaten-dev` (gitignored, Modus 600), nie in der Ausgabe.
  Dort steht auch das TOTP-Geheimnis des Admins; der Chef richtet Zwei-Faktor bei der ersten Anmeldung selbst ein.

## Tests

- `npm test`: Unit-Tests (`tests/unit`).
- `npm run test:db`: Datenbank-Tests (`tests/db`) gegen frisch angelegte Datenbanken, laufen nacheinander. Sie prüfen
  vor allem RLS, Rollenrechte, SECURITY-DEFINER-Funktionen, Protokoll-Trigger und die Idempotenz des Seeds.
- E2E (Playwright, Browser stecken im Image): braucht die laufende Vorschau mit Seed-Daten und `.zugangsdaten-dev`.
  Vom Host aus:

  ```sh
  sudo docker run --rm --network host -v /home/can/projekte/crm-system:/w -w /w \
    mcr.microsoft.com/playwright:v1.48.2-jammy bash -lc 'npx -y playwright@1.48.2 test'
  ```

  Die Tests laufen mit einem Arbeiter in zwei Projekten (mobil 390 px, Desktop 1280 px) und legen Testkunden in der
  Entwicklungsdatenbank an.
- Bildschirmfotos für die Abnahme: dieselbe Zeile mit `BILDSCHIRMFOTOS=/w/<ordner> npx -y playwright@1.48.2 test bildschirmfotos`.
- Vor einem Abschluss alles zusammen: `npm test`, `npm run test:db`, `npm run check`, `npm run build`, E2E.

## Sicherheitsmodell

1. Drei Datenbankrollen, die Anwendung nutzt nie den Superuser: `crm_app` (fachliche Abfragen), `crm_admin`
   (Plattform-Verwaltung), `crm_auth` (nur EXECUTE auf die Anmelde-Funktionen, keine Tabellenrechte).
2. Jede Mandantentabelle hat RLS mit `ENABLE` und `FORCE` und die Spalte `betrieb_id`; Fremdschlüssel sind
   mandantengebunden (`(id, betrieb_id)`).
3. Der Mandantenkontext steht in `set_config(..., true)` und gilt nur innerhalb einer Transaktion (`mitBetrieb`).
4. SECURITY-DEFINER-Funktionen gehören dem Superuser, setzen `search_path = app, pg_temp`, filtern explizit nach
   Betrieb bzw. Benutzer und haben `EXECUTE` nur für die jeweils nötige Rolle (`revoke … from public`).
5. Sitzungen werden als Hash gespeichert (Cookie `HttpOnly` und `Secure`); Anmeldeversuche sind je E-Mail begrenzt (im Arbeitsspeicher, nach Neustart zurückgesetzt).
6. Zwei-Faktor (TOTP) ist Pflicht für Plattform-Admins und für jede Rolle mit dem Recht `einstellungen`; alle 2FA-
   und Admin-Operationen laufen über SECURITY-DEFINER-Funktionen, die die Sitzung in der Datenbank prüfen.
7. Rechte pro Rolle (`rechte.ts`) und Tarif-Module/-Grenzen (`tarif.ts`) werden serverseitig geprüft; Nur-Lese-
   Betriebe können nichts schreiben (zentrale Sperre in `hooks.server.ts`).
8. JSON-Schnittstellen verlangen `Content-Type: application/json` (CSRF-Härtung), Formulare prüfen `ORIGIN`.
9. Das Änderungsprotokoll (`app.aenderungen`) wird nur von einem Trigger geschrieben; die Anwendung darf es lesen,
   nie beschreiben. Geheime Spalten sind ausgeschlossen.
10. Die Anwendung versendet keine E-Mails: Einladungslinks werden in der Oberfläche angezeigt und weitergegeben.

## Betriebshinweise / Deploy

- **Alle Variablen sind Pflicht.** Jede Umgebung braucht `CRM_APP_PASSWORT`, `CRM_ADMIN_PASSWORT` und
  `CRM_AUTH_PASSWORT` (bzw. `DATABASE_URL_APP`/`_ADMIN`/`_AUTH`) sowie `ORIGIN`; fehlt eine, startet die Anwendung
  nicht. Die URLs dürfen nie den Superuser `crm` nennen.
- **Frische Datenbank.** Die Migrationen `001`, `003`, `003a`, `005` und `006` wurden vor der ersten Auslieferung
  direkt geändert. Bestehende Entwicklungs-Datenbanken aus früheren Ständen müssen neu angelegt und neu migriert
  werden (Daten gehen dabei verloren). Neue Umgebungen sind nicht betroffen.
- **Abmeldung beim Ausrollen.** Die Sicherheitshärtung für den Zwei-Faktor-Login (`sitzungen.mit_zweitem_faktor`,
  Ruling R13) meldet beim ersten Ausrollen alle bestehenden Sitzungen von Chefs und Admins einmalig ab. Das ist
  gewollt; sie melden sich neu an.
- **pgcrypto im Schema `public`.** Migration `008` legt `pgcrypto` (und `007` `unaccent`) mit `with schema public`
  an. Der Funktionsaufruf muss das Schema `public` auflösen können; die Funktionen dürfen nicht in ein anderes Schema
  wandern.
- **Der Migrationsbenutzer `crm` bleibt Superuser oder BYPASSRLS.** Der Protokoll-Trigger und die SECURITY-DEFINER-
  Funktionen gehören `crm` und schreiben an der RLS vorbei. Wird `crm` zu einer normalen Rolle, schlagen
  Protokoll, Anmeldung und Admin-Funktionen fehl.
- **UTF-8-Datenbank.** Die Kundensuche nutzt `lower()` der Datenbank (Umlaute, `ß`). Datenbank und Locale müssen
  UTF-8 sein (z. B. `de_DE.UTF-8` oder `C.UTF-8`); bei einer `C`- oder `SQL_ASCII`-Datenbank findet „müller“ nicht
  „Müller“. Sortierung ist davon unabhängig (`unaccent`).
- **HTTPS.** Das Sitzungs-Cookie ist immer `Secure`: Die Anwendung funktioniert nur über HTTPS oder über
  `localhost`/`127.0.0.1` (Vorschau). Hinter einem Reverse-Proxy muss `ORIGIN` die öffentliche https-Adresse sein.
- **Seed gehört nicht in die Produktion.** `seed:dev` bricht bei `NODE_ENV=production` ab; Produktionsdaten
  (Betriebe, Tarife) legt der Plattform-Admin über die Verwaltung an. Migration `004` liefert die Tarife.
- **Sandbox-Container: Zombie-Prozesse.** `crm-dev` startet mit `sleep infinity` als PID 1 ohne Reaper, beendete
  Prozesse (z. B. nach Vorschau-Neustarts) bleiben als `<defunct>` liegen. Harmlos, aber unschön. Empfehlung für die
  Compose-Datei in `/opt/crm-sandbox`: bei `crm-dev` `init: true` ergänzen (wirkt beim nächsten Neustart der
  Sandbox; Daten bleiben erhalten). Dieses Repo ändert die Sandbox nicht.
- **Vorschau-Neustart.** `start-vorschau.sh` beendet über die PID-Datei und zusätzlich jeden Prozess `node build`
  im Container; läuft dort noch ein anderer Dienst mit diesem Befehl, wird er mit beendet.
