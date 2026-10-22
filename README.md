# CRM System

Mandantenfähiges CRM für Handwerksbetriebe mit deutscher Oberfläche. Mehrere Betriebe (Mandanten) teilen sich eine
Datenbank, sehen aber nie Daten der anderen. Stufe 1a ist das Fundament: Anmeldung mit Rollen und Zwei-Faktor,
Benutzer und Einladungen, Tarife und Module, Änderungsprotokoll, Kunden mit Objekten, Plattform-Verwaltung für den
Betreiber, mobile App-Hülle (PWA). Stufe 1b ergänzt Aufträge mit Statuskette (Anfrage → Angebot → Beauftragt →
In Arbeit → Abgenommen → Abgerechnet), To-dos mit Zuständigem und Fälligkeit, die Plantafel (Mitarbeiter × Tage mit
Ziehen und Ablegen, Warnungen bei Doppelbelegung, Urlaub und Krankheit), Abwesenheiten und „Meine Einsätze heute“
auf der Startseite – auch ohne Netz (Kopie auf dem Gerät). Stufe 1c bringt den Leistungskatalog (eigene Positionen
mit Einheit, Lohn und Material; Startvorlagen für Bad/Sanitär, Fliesen, Maler, Trockenbau), Angebote zum Auftrag aus
Katalog- und freien Positionen (Entwurf → Versendet → Angenommen/Abgelehnt, gekoppelt an die Auftragsstatus) und das
Angebot als PDF mit Logo und Briefkopf des Betriebs. Wer „Preise sehen“ nicht hat (Monteur), bekommt nirgends Preise.

Lastenheft und Pflichtenheft: `docs/spec/`.

## Stack

- SvelteKit 2 mit Svelte 5, TypeScript, `adapter-node` (Produktions-Build läuft mit `node build`)
- PostgreSQL 16 mit Row Level Security (RLS), Treiber `postgres`
- Passwörter mit Argon2 (`@node-rs/argon2`), Zwei-Faktor mit TOTP (`otpauth`, `qrcode`)
- PDF mit `pdfkit` und eingebetteter Schrift Noto Sans (SIL Open Font License, `src/lib/server/pdf/schriften/`)
- Tests: Vitest (Unit und Datenbank), Playwright (E2E im Browser)

## Verzeichnisse

| Pfad | Inhalt |
| --- | --- |
| `src/routes/` | Seiten und API: `(app)` (Betriebsnutzer), `admin` (Plattform), `anmelden`, `einladung`, `api/*` |
| `src/lib/server/` | Serverlogik: `db.ts` (Pools, Mandantenkontext), `auth/` (Sitzung, Passwort, TOTP, Begrenzung), `rechte.ts`, `tarif.ts`, `kunden.ts`, `auftraege.ts`, `todos.ts`, `plantafel.ts`, `katalog.ts`, `angebote.ts`, `betriebsprofil.ts`, `preisschutz.ts`, `pdf/angebot-pdf.ts`, `benutzer.ts`, `admin.ts`, `protokoll.ts`, `caldav/` (Aufgaben aufs Handy: CalDAV-Server unter `/caldav/`, VTODO-Abbildung, App-Passwörter, Abgleich-Stände) |
| `src/lib/` (ohne `server`) | Wissen ohne Serverbezug: `auftrag-status.ts` (Statuskette), `zeit.ts` (Tage/Wochen in Europe/Berlin), `geld.ts` (Cent-Rechnen, Rundung, Anzeige), `angebot-status.ts`, `katalog-werte.ts` (Gewerke, Einheiten), `heute-kopie.ts` (Offline-Kopie), `navigation.ts`, `verlauf.ts` |
| `src/lib/components/`, `src/lib/stil/` | Wiederverwendbare Svelte-Bausteine und Stil |
| `src/hooks.server.ts` | Sitzungsprüfung, Admin-Pfad, Nur-Lese-Sperre |
| `db/migrations/` | SQL-Migrationen (`001` bis `015`, dazu `003a`/`003b`; `011` Aufträge/To-dos, `012` Einsätze/Abwesenheiten, `013` Katalog/Briefkopf/Angebote, `014` Startvorlagen, `015` Statuswechsel der Angebote), werden nach Dateiname sortiert angewendet |
| `scripts/` | `migrate.ts`, `admin-anlegen.ts`, `seed-dev.ts` (mit `seed-dateien/bauwelt-logo.png`), `start-vorschau.sh`, `erzeuge-icons.ts` |
| `tests/unit`, `tests/db`, `tests/e2e` | Unit-Tests, Datenbank-Tests (je Testdatei eine frische Datenbank), Browser-Tests |
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
  Nennt eine dieser Verbindungen den Superuser `crm`, verweigert die Anwendung jeden Datenbankzugriff.
- `PGUSER`, `PGPASSWORD`: Superuser nur für Migrationen, `admin:anlegen`, Seed und Tests, nie für die laufende
  Anwendung.
- `ORIGIN`: öffentliche Adresse der Anwendung (SvelteKit prüft damit Formular-Anfragen), z. B.
  `https://crm.beispiel.de`; Vorschau: `http://127.0.0.1:8300`.
- `NODE_ENV`: `production` im Betrieb. Dann schreibt der Seed nie Daten.
- `HOST`, `PORT`: Adresse des Node-Servers (Vorschau: `0.0.0.0` und `3000`).
- `NEXTCLOUD_*` (optional): Anbindung an eine Nextcloud (Anmeldung, Kalender, Kontakte, Dateien, Talk). Ohne
  `NEXTCLOUD_URL` ist sie aus. Aufbau und Bedrohungsmodell: `docs/nextcloud-anbindung.md`; Einrichtung:
  `installation/ANLEITUNG.md`, Abschnitt „Mit Nextcloud verbinden“.

**Wer liest `.env`?** Nur die Skripte: `npm run migrate`, `seed:dev`, `admin:anlegen`, die Datenbank-Tests und
`start-vorschau.sh`. Die gebaute Anwendung (`node build`, `src/lib/server/db.ts`) liest **keine** `.env`-Datei,
sondern nur die Umgebung des Prozesses. Start in Produktion daher z. B.:

```sh
node --env-file=/pfad/zu/app.env build        # Node ≥ 20.6; mit Node 22 geprüft
```

oder als systemd-Dienst mit `EnvironmentFile=/pfad/zu/app.env` und `ExecStart=/usr/bin/node build`. Die Datei für
die Anwendung sollte `PGUSER`/`PGPASSWORD` (Superuser) **nicht** enthalten – die braucht nur `npm run migrate`
bzw. `admin:anlegen`. (`start-vorschau.sh` entfernt sie deshalb vor dem Start.)

**Was passiert, wenn etwas fehlt?**

- Fehlen Datenbank-Variablen, startet die Anwendung trotzdem (die Pools werden erst beim ersten Zugriff geöffnet).
  Die erste Anfrage, die die Datenbank braucht (Anmeldung, jede Seite mit Sitzungs-Cookie), endet mit **500**; im
  Log steht `Umgebungsvariable … fehlt`. `/api/gesundheit` antwortet weiter mit 200 – er prüft die Datenbank nicht.
- Fehlt `ORIGIN`, nimmt `adapter-node` als Adresse `https://` plus den `Host`-Header der Anfrage. Über
  `http://` (z. B. Vorschau) werden dann alle Formulare mit 403 abgewiesen; hinter einem Proxy hängt die
  CSRF-Prüfung vom weitergereichten `Host` ab. **In Produktion `ORIGIN` immer setzen** (öffentliche https-Adresse).

## Migrationen

`npm run migrate` wendet alle noch nicht angewendeten Dateien aus `db/migrations/` an (je Datei eine Transaktion,
Advisory Lock gegen parallele Läufe, Buchführung in einer eigenen Tabelle). Er läuft als Superuser und setzt die
Passwörter der Rollen aus den `CRM_*_PASSWORT`-Variablen; in den SQL-Dateien stehen nie Passwörter. Ein zweiter Lauf
tut nichts.

- `tsx` ist eine normale Abhängigkeit (nicht nur für Entwicklung): `npm run migrate` und `npm run admin:anlegen`
  gehören zum Ausrollen und laufen auch nach `npm ci --omit=dev`.
- Migration `009` setzt für `crm_app`, `crm_admin` und `crm_auth` `statement_timeout = 30s` und
  `idle_in_transaction_session_timeout = 60s` (clusterweite Rolleneinstellung, gilt für neue Verbindungen; nach dem
  Ausrollen die Anwendung neu starten). Der Superuser bleibt ohne Limit.

## Entwicklungsdaten (Seed)

`npm run seed:dev` legt den Betrieb „Bauwelt“ (Tarif `test`) mit den Benutzern `chef@bauwelt.test`,
`buero@bauwelt.test`, `monteur@bauwelt.test`, den Plattform-Admin `admin@crm.test` und 5 Beispielkunden mit Umlauten
an, dazu 6 Beispielaufträge (je Status einer, `A-<Jahr>-0001` bis `0006`), To-dos und Einsätze in dieser und der
nächsten Woche – mit einer Doppelbelegung (Monteur am Mittwoch), einem Urlaub (Chef Freitag bis Montag) und Einsätzen
„heute“ für den Monteur. Er ist idempotent (mehrfaches Ausführen erzeugt keine Duplikate); die Beispiel-Einsätze
wandern bei einem späteren Lauf auf die dann aktuellen Tage. `npx tsx scripts/testzugaenge.ts` legt die persönlichen
Test-Zugänge an (`can.chef`, `jamil.monteur`, …) und gibt den Monteur-Zugängen Einsätze für heute und morgen.
Stufe 1c: Briefkopf „Bauwelt Handwerk GmbH“ (nur Angaben aus dem öffentlichen Impressum der Bauwelt-Website;
Steuernummer, USt-IdNr. und Bank bleiben leer) mit Bauwelt-Logo, die Startvorlagen Bad/Sanitär und Fliesen mit
Beispielpreisen (in der Beschreibung als „(Beispielpreis)“ gekennzeichnet) und zwei Angebote: ein versendetes zum
„Ladenumbau Trockenbau“, ein Entwurf zu „Fliesen Küche“. Vorhandene Briefköpfe, Preise und Angebote bleiben unberührt.

- Nur für die Sandbox: Abbruch bei `NODE_ENV=production` und gegen jede Datenbank außer `crm`. Eine andere
  Datenbank muss ausdrücklich genannt werden: `npm run seed:dev -- --erlaube-db=<name>`.
- Passwörter sind zufällig und stehen nur in `.zugangsdaten-dev` (gitignored, Modus 600), nie in der Ausgabe.
  Dort steht auch das TOTP-Geheimnis des Admins; der Chef richtet Zwei-Faktor bei der ersten Anmeldung selbst ein.

## Erster Plattform-Admin (echte Umgebungen)

Ohne Entwicklungsdaten gibt es nach der Migration keinen Benutzer. Den ersten Plattform-Admin legt
`npm run admin:anlegen` an – wie die Migrationen als Superuser (`PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE`,
`PGPASSWORD` aus der Umgebung bzw. `.env`):

```sh
npm run admin:anlegen -- --email admin@beispiel.de --name "Vorname Nachname"
```

- Das Passwort (mindestens 10, höchstens 1024 Zeichen) fragt das Skript verdeckt im Terminal ab, zweimal zur
  Kontrolle. Es wird nie als Argument angenommen (stünde sonst in Shell-Historie und Prozessliste) und nie
  ausgegeben; gespeichert wird nur der Argon2id-Hash.
- Für Automatisierung: Passwort über die Standardeingabe und `--passwort-stdin`, z. B.
  `printf '%s\n' "$ADMIN_PASSWORT" | npm run admin:anlegen -- --email … --name … --passwort-stdin`.
- Benutzer (ohne Betrieb) und Eintrag in `plattform_admins` entstehen in einer Transaktion. Gibt es die E-Mail schon,
  bricht das Skript mit Meldung und Exit-Code 1 ab und ändert nichts.
- Zwei-Faktor: Bei der ersten Anmeldung landet der Admin nach dem Passwort zwingend auf der Einrichtung
  (`/konto/zwei-faktor`, QR-Code für die Authenticator-App); erst mit gültigem Code entsteht eine Sitzung.

## Tests

- `npm test`: Unit-Tests (`tests/unit`).
- `npm run test:db`: Datenbank-Tests (`tests/db`) gegen frisch angelegte Datenbanken, laufen nacheinander. Sie prüfen
  vor allem RLS, Rollenrechte, SECURITY-DEFINER-Funktionen, Protokoll-Trigger und die Idempotenz des Seeds.
- E2E (Playwright, Browser stecken im Image): laufen standardmäßig gegen einen EIGENEN Testserver mit eigener
  Datenbank (`scripts/start-testserver.sh`, `http://127.0.0.1:8310`; Aufruf und Container siehe Kopf des Skripts) –
  nicht gegen die Vorschau. Specs, die Buchungen, Kundenportal-Links oder Testkunden anlegen (`buchung`, `kundenportal`,
  `portal-passwort`, `terminart`), überspringen sich gegen die Vorschau (`crm.waybuild-software.de` bzw. Port 8300)
  von selbst (`tests/e2e/ziel.ts`); erzwingen nur mit `CRM_E2E_VORSCHAU=1`. Lesende Tests gegen die Vorschau:
  `BASE_URL=http://127.0.0.1:8300`. Schreibende Specs räumen in `afterAll` (auch nach Fehlern) über
  `/api/testmodus/aufraeumen` alles weg, was ihr Lauf angelegt hat (nur im Testmodus erreichbar, nur „E2E …“-Daten
  mit der Kennung des Laufs). Vom Host aus:

  ```sh
  sudo docker run --rm --network host -v <pfad-zum-repo>:/w -w /w \
    mcr.microsoft.com/playwright:v1.48.2-jammy bash -lc 'npx -y playwright@1.48.2 test'
  ```

  Die Tests laufen mit einem Arbeiter in zwei Projekten (mobil 390 px, Desktop 1280 px). Sie schreiben in die
  **Entwicklungsdatenbank** der Vorschau: Sie legen Testkunden an (und löschen sie am Ende wieder – bricht ein Test
  vorher ab, bleiben sie liegen; die Einträge im Änderungsprotokoll bleiben immer), melden sich an und richten ggf.
  Zwei-Faktor ein. Nie gegen eine Produktionsumgebung laufen lassen.
- Läuft die Vorschau im Testmodus (`CRM_TESTMODUS=1`), melden sich die E2E-Tests über „Mit E-Mail und Passwort
  anmelden“ an (gleicher Weg wie ohne Testmodus). `tests/e2e/plantafel.spec.ts` legt einen eigenen Auftrag mit
  Einsätzen drei Wochen voraus an und löscht ihn am Ende wieder. Der Offline-Test braucht
  `PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1` (setzt `playwright.config.ts` selbst): Nur so erreicht die
  Netzsperre von Playwright auch den Service Worker.
- Bildschirmfotos für die Abnahme: dieselbe Zeile mit `BILDSCHIRMFOTOS=/w/<ordner> npx -y playwright@1.48.2 test bildschirmfotos`. Die erste Seite eines Angebots-PDFs zeichnet dabei pdf.js (von cdnjs, Netz nötig).
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
10. Fachliche Sichtbarkeit: Mit nur „Eigene Aufträge ansehen“ (`auftraege.lesen`) sieht ein Benutzer nur Aufträge,
    in denen er einen Einsatz oder ein ihm zugewiesenes To-do hat; fremde Aufträge, To-dos und ihr Verlauf sind ein
    404. Die Plantafel braucht `plantafel.bearbeiten` oder `auftraege.alle_lesen`.
11. Offline: Der Service Worker speichert nur die App-Hülle und die statische Seite `/offline`, nie Seiten mit Daten
    oder die API. „Meine Einsätze heute“ liegt als Kopie im `localStorage` des Geräts (nur heute gültig, ohne Preise,
    beim Abmelden gelöscht); die Offline-Seite zeigt sie an.
12. Preisschutz: Ohne „Preise sehen“ (`preise.sehen`) liefert keine API und keine Seite Preisfelder (`lohnCent`,
    `materialCent`, `einzelpreisCent`, Summen) – die Felder fehlen, nicht `null`; Angebote und PDF verlangen
    `angebote.bearbeiten` UND `preise.sehen` (sonst 403), im Änderungsprotokoll fehlen die Preisspalten.
    Geprüft in `tests/db/preisschutz.test.ts` (rekursiv mit `enthaeltPreisfeld`). Angebote folgen der Auftrags-
    Sichtbarkeit: Wer nur eigene Aufträge sieht, sieht nur deren Angebote (sonst 404); den Auftragsstatus koppelt ein
    Angebot nur mit „Aufträge bearbeiten“ mit.
13. Die Anwendung versendet keine E-Mails: Einladungslinks werden in der Oberfläche angezeigt und weitergegeben.
14. Sicherheits-Kopfzeilen: Seiten tragen eine Content-Security-Policy (`kit.csp` in `svelte.config.js`, Modus
    `auto`): nur eigene Quellen, Skripte nur mit Nonce (kein `unsafe-inline`/`eval`), `frame-ancestors 'none'`,
    Bilder zusätzlich `data:` (QR-Code). Einzige Inline-Ausnahme sind Stil-Attribute (`style-src-attr
    'unsafe-inline'`), weil SvelteKits Ansager für Seitenwechsel und die Hülle in `app.html` sie benutzen.
    Jede Antwort bekommt in `hooks.server.ts` außerdem `X-Content-Type-Options: nosniff`,
    `Referrer-Policy: same-origin` (Einladungsseite strenger: `no-referrer`), `X-Frame-Options: DENY` und eine
    `Permissions-Policy`, die Kamera, Mikrofon, Standort, Bezahlen und USB abschaltet. Statische Dateien
    (`/_app/…`, Symbole) liefert `adapter-node` ohne diese Kopfzeilen aus. HSTS gehört in den Reverse-Proxy (nicht gesetzt).

15. Online-Buchung (öffentlich, ohne Anmeldung): `/buchen/<Token>` und `/buchung/<Verwaltungs-Token>`. Ein Token wird
    nur über SECURITY-DEFINER-Funktionen für `crm_auth` in Betrieb/Link bzw. Buchung aufgelöst
    (`app.buchung_link_aufloesen`, `app.buchung_verwaltung_aufloesen`); alles Weitere läuft als `crm_app` mit RLS im
    Kontext genau dieses Betriebs, ohne Benutzer (`mitBetriebOeffentlich`, Protokoll-Quelle `online-buchung`). Nach
    außen gehen nur Betrieb (Name, Kontakt, Logo, Farbe), Terminart und freie Anfangszeiten – Mitarbeiter höchstens mit
    Vornamen. Vom Verwaltungs-Token steht nur der SHA-256 in der Datenbank. Doppelbuchung: Sperre je Betrieb
    (`pg_advisory_xact_lock`) plus Ausschluss-Bedingung (`btree_gist`) auf `app.buchungen`. Spam-Schutz:
    Begrenzung je IP/Link (im Speicher; hinter einem Proxy `ADDRESS_HEADER`/`XFF_DEPTH` setzen), Honigtopf-Feld,
    signierter Zeitstempel (mindestens 3 s). Einbetten nur auf den Domains aus Einstellungen → Online-Buchung bzw.
    `CRM_BUCHUNG_EINBETTEN` (CSP `frame-ancestors` je Seite, `X-Frame-Options` entfällt dort). Recht `buchung.verwalten`.
    Terminarten (Migration 106, Jamil msg 3074): Die früheren „Dienste“ (Tabelle `app.buchung_dienste`) sind die EINE
    Liste der Terminarten je Betrieb (Einstellungen → Terminarten); Einsätze können eine haben (`einsaetze.terminart_id`),
    öffentlich buchbar sind nur Terminarten mit „online buchbar“ (auch in `app.buchung_link_aufloesen` geprüft).
16. Zeiterfassung (Modul `zeiterfassung`, Migration 080): `zeiterfassung.nutzen` (eigene Zeiten und Material) und
    `zeiterfassung.alle_sehen` (alle sehen, korrigieren, freigeben); jede Zeit gehört zu einem Auftrag. Je Person läuft höchstens
    ein Abschnitt (eindeutiger Teilindex), Abschnitte einer Person überschneiden sich nie (Ausschluss-Bedingung).
    Nachträge, Korrekturen und Löschungen verlangen einen Grund und stehen mit alt/neu im Änderungsprotokoll (Verlauf
    des Auftrags). Nach der Freigabe ändert nur noch Chef/Büro. Kilometer: OSRM über `CRM_ROUTEN_URL` (nur zwei
    Koordinaten), sonst Luftlinie × `CRM_ROUTEN_FAKTOR` (Standard 1,3) – kein GPS, kein Standort. Lieferschein-Fotos
    gehen nur als Bild an die KI (keine Kundendaten); Materialpreise nur mit „Preise sehen“ und nie im Protokoll.
17. Kundenportal (Modul `kundenportal`, Migration 082): `/portal/<Token>` ohne Anmeldung. Token = 32 Zufallsbytes,
    gespeichert nur als SHA-256; aufgelöst nur über `app.portal_link_aufloesen` (SECURITY DEFINER, `crm_auth`), danach
    `crm_app` mit RLS im Betrieb (`alsOeffentlich`, Protokoll-Quelle `kundenportal`) und nur für den Auftrag des Links.
    Widerrufbar, optional mit Ablauf. Nach außen nur Freigegebenes (Status, Termine, Vornamen, Angebote/Dateien,
    Auftragsbestätigungen). Begrenzung je IP, Sperre bei vielen falschen Tokens, `noindex`, `no-referrer`, CSP der App;
    Dokumente mit `sandbox`-CSP. Annahme ohne Unterschrift (Bestätigungsschritt + AGB-Häkchen); Nachweis in
    `app.angebot_entscheidungen` mit Zeit, Token-Hash und IP-HMAC (nie die IP). Kundenaktionen im Verlauf.
18. Ereignis `angebotAngenommen` (`src/lib/server/ereignisse.ts`): jede Annahme (Portal, Büro, Sprache) erzeugt die
    Auftragsbestätigung (PDF, AB-JJJJ-NNNN; abschaltbar je Betrieb und Auftrag) – Versand über `MailVersand`, sonst
    „bereit zum Versand“ mit Aufgabe und Glocke. Weitere Anbindungen (z. B. Lexware) hängen sich mit `abonniere` an.
19. Foto-Aufmaß: in Migration 083 eingeführt, mit Migration 086 samt Lerndaten wieder entfernt (Jamil msg 2904).
20. Kennzahlen (Migration 087, `src/lib/kennzahlen.ts` + `src/lib/server/kennzahlen.ts`): Fakten aus der Datenbank in
    der Sicht des Nutzers, gerechnet in reinen Funktionen; Statuszeitpunkte aus `app.aenderungen`; ersetzte Angebote
    zählen nicht; Beträge nur mit „Preise sehen“; fehlende Grundlage → „Daten fehlen: …“ statt 0.
21. Links am Auftrag (Migration 088, `app.auftrag_links`): nur http/https (App und CHECK in der Datenbank), keine
    Zugangsdaten in der Adresse, Ausgabe mit `rel="noopener noreferrer"`; sichtbar wie der Auftrag, ändern mit
    „Aufträge bearbeiten“, „im Kundenportal“ nur mit `kundenportal.verwalten` (Standard aus, ohne Notiz).
22. Aufmaß-Vorlagen (Migration 093, Art `aufmass` der Formular-Vorlagen): Maß-, Flächen-, Umfang-, Volumen-, Abzug-,
    Stück- und Formelfelder; Formeln mit eigenem Parser (`src/lib/aufmass-formel.ts`, kein eval, Grenzen für Länge und
    Tiefe); wiederholbare Abschnitte (Räume) werden vor jeder Prüfung aufgeklappt (`expandiere`), berechnete Werte setzt
    nur der Server (`berechne`); Katalog-Verknüpfung → „Angebot aus Aufmaß“ (`src/lib/server/aufmass.ts`, Rechte wie Angebote).
23. Partner (Migration 094, `src/lib/server/partner.ts`, Recht `partner.verwalten`): Auftraggeber/Subunternehmer/
    Lieferanten mit Kontakten, Konditionen, Portal-Link (nur http/https, keine Zugangsdaten) und Nachweisen (Datei in der
    Datenbank, Typ an den ersten Bytes geprüft; 30 Tage vor Ablauf Aufgabe + Erinnerung). Auftraggeber per Trigger aus
    der Auftragsquelle; Fremdleistungen gehen in die Nachkalkulation; Beträge nur mit „Preise sehen“.
24. Sprachsteuerung (Migration 099, Recht `sprache.nutzen` „Sprachsteuerung nutzen“): zusätzlich zum Tarif-Modul
    `sprache`. Ohne das Recht kein Mikrofon-Knopf und 403 in `pruefeSprachZugang` (Aufnahme, getippter Befehl,
    Ausführen inkl. mehrerer Schritte), bevor die KI etwas sieht; die Rechte je Aktion gelten danach wie bisher.
    Standard: Chef und Büro ja, Monteur und eigene Rollen nein (in „Einstellungen → Rollen“ änderbar).
25. Kundenportal mit Passwort (Migration 103, `src/lib/server/portal-zugang.ts`, Jamil msgs 3035–3037): Vor dem Portal
    die Passwort-Seite (Standard PLZ des Kunden, eigenes Passwort als Argon2id in `app.portal_passwoerter`); Cookie
    `kp_sitzung` nur für /portal/<Token> (httpOnly, secure, SameSite=Strict, 30 Tage), gebunden an Link und
    Passwort-Stand – Widerruf/neues Passwort beenden es. `hooks.server.ts` lässt ohne Cookie nur die Seite (zeigt die
    Abfrage) und /anmelden durch. Sperre: 5 Fehlversuche je Link/15 Min., 30 je IP; Fehlversuche im Zugriffsprotokoll
    (`portal_ereignisse`, ohne Passwort). Neue Links zusätzlich AES-256-GCM-verschlüsselt (`CRM_PORTAL_GEHEIMNIS`) →
    „Kundenportal öffnen“/„Link kopieren“ auf der Kundenseite; gesucht wird weiter nur über den SHA-256-Hash.
26. Dokumente & Notizen im Auftrag (Migration 106, `src/lib/server/auftrag-unterlagen.ts`, Jamil msg 3070): inline wie die
    Links (AddPanel), Speicher wie die Dokumentation (`app.dateien` in der Datenbank, 10 MB, Dateianfang geprüft), wer
    hochgeladen hat (`von_benutzer_id`); „Im Kundenportal“ je Eintrag über `portal_dokumente` (Art `datei`/`notiz`,
    Standard aus, Baustein `ui/PortalSchalter.svelte` auch für Links). Das Portal zeigt nur ausdrücklich Freigegebenes.

## Installation auf einem eigenen Server

Der Ordner `installation/` enthält alles, um das CRM auf einem frischen Ubuntu/Debian-Server zu betreiben
(Docker Compose: PostgreSQL, App, Migration, optional Spracherkennung und Caddy mit automatischem HTTPS).
Einstieg: `installation/CRM-Installation.sh` (Menü), Anleitung: `installation/ANLEITUNG.md`, Probelauf:
`installation/TESTPROTOKOLL.md`. Regeln für neue Funktionen (Variablen, Dienste, Migrationen): `CLAUDE.md`.

## Betriebshinweise / Deploy

- **Variablen setzen, `.env` wird von `node build` nicht gelesen.** Jede Umgebung braucht `CRM_APP_PASSWORT`,
  `CRM_ADMIN_PASSWORT` und `CRM_AUTH_PASSWORT` (bzw. `DATABASE_URL_APP`/`_ADMIN`/`_AUTH`) sowie `ORIGIN` in der
  Umgebung des Prozesses (siehe „Umgebungsvariablen“: `node --env-file=… build` oder systemd `EnvironmentFile`).
  Fehlende Datenbank-Variablen fallen erst bei der ersten Anfrage auf (500), ein fehlendes `ORIGIN` als abgewiesene
  Formulare bzw. als vom `Host`-Header abhängige CSRF-Prüfung. Die URLs dürfen nie den Superuser `crm` nennen (dann
  verweigert die Anwendung jeden Datenbankzugriff).
- **Erster Admin.** Nach der Migration gibt es keinen Benutzer: `npm run admin:anlegen` (siehe oben).
- **Logo-Upload und Anfragegröße.** `adapter-node` nimmt standardmäßig nur 512 kB je Anfrage an; Logos dürfen 1 MB
  groß sein. `BODY_SIZE_LIMIT=2M` setzen (macht `start-vorschau.sh`). Achtung: Die Grenze gilt für **alle**
  Endpunkte gleich (adapter-node kann sie nicht je Route setzen). Die JSON-Endpunkte begrenzen deshalb selbst auf
  1 MB (`leseJson`, sonst 413); hochgeladene Logos werden vollständig geprüft (`bildpruefung.ts`).
- **Schriften fürs PDF.** Die Noto-Sans-Dateien sind beim Bauen in das Server-Bundle eingebettet (Vite
  `?url&inline`); die gebaute Anwendung braucht keine Dateien neben `build/` und läuft aus jedem Arbeitsverzeichnis.
  Beim Start prüft `hooks.server.ts` (`init`) die Schriften und bricht ab, wenn sie fehlen oder beschädigt sind.
- **Frische Datenbank.** Die Migrationen `001`, `002`, `003`, `003a` und `006` wurden vor der ersten Auslieferung
  direkt geändert (`005` nicht). Bestehende Entwicklungs-Datenbanken aus früheren Ständen müssen neu angelegt und neu
  migriert werden (Daten gehen dabei verloren); `npm run migrate` erkennt geänderte Dateien nicht. Neue Umgebungen
  sind nicht betroffen.
- **Abmeldung beim Ausrollen.** Die Sicherheitshärtung für den Zwei-Faktor-Login (`sitzungen.mit_zweitem_faktor`,
  Ruling R13) meldet beim ersten Ausrollen alle bestehenden Sitzungen von Chefs und Admins einmalig ab. Das ist
  gewollt; sie melden sich neu an.
- **pgcrypto im Schema `public`.** Migration `008` legt `pgcrypto` (und `007` `unaccent`) mit
  `create extension if not exists … with schema public` an und ruft `public.gen_random_bytes` auf. Ist `pgcrypto` in
  der Ziel-Datenbank schon in einem anderen Schema installiert (z. B. `extensions`), tut `create extension` nichts,
  die Migration läuft trotzdem durch – aber „Betrieb anlegen“ in der Plattform-Verwaltung
  (`app.admin_betrieb_anlegen`) scheitert dann mit „function public.gen_random_bytes(integer) does not exist“.
  Ebenso brechen Kundenlisten ab, wenn `unaccent` nicht in `public` liegt (`public.unaccent` in `kunden.ts`).
  Abhilfe vor der Migration: `alter extension pgcrypto set schema public;` bzw. `alter extension unaccent set schema
  public;`. Die Funktionen sind für `PUBLIC` ausführbar (Standard bei Extensions).
- **Zwei-Faktor-Geheimnisse im Klartext (bekannte Einschränkung).** `app.benutzer.totp_geheim` steht unverschlüsselt
  in der Datenbank (nur über SECURITY-DEFINER-Funktionen erreichbar, nie im Protokoll). Wer die Datenbank oder ein
  Backup liest, kann Codes erzeugen – Backups entsprechend schützen. Verschlüsselung ist für eine spätere Härtung
  vorgesehen.
- **Rollen-Passwörter und Server-Log.** `npm run migrate` setzt die Passwörter mit `ALTER ROLE … PASSWORD '…'`. Ist
  in PostgreSQL `log_statement` (`ddl`/`all`) oder `log_min_duration_statement = 0` aktiv, landet das Passwort im
  Klartext im Server-Log. Statement-Logging während der Migration abschalten (oder das Log danach bereinigen).
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
