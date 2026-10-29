# Testprotokoll Installationspaket

## Probelauf 20.10.2026 (Server waybuild, Ubuntu 24.04.5, Docker 29.9.0, Compose v5.6.0)

Ablauf wie auf einem neuen Server: Paket mit `paket-erstellen.sh` gebaut, Prüfsumme kontrolliert, in einem
Wegwerf-Ordner ausgepackt und **von dort** installiert. Eigener Projektname `crm-installtest`, eigene Volumes,
freie Ports (App 18300, Caddy 127.0.0.1:18080/18443, Domain `localhost` → Caddy-eigenes Zertifikat). Die laufende
Vorschau (crm-dev, crm-db, crm-stt) wurde nicht angefasst und lief durchgehend weiter.

| Prüfung | Ergebnis |
| --- | --- |
| Paket: keine `.env`, Zugangsdaten, node_modules, Bau-Reste | ✔ (8,3 MB, nur Quellcode + installation/) |
| `1-voraussetzungen-pruefen.sh` (OS, RAM, Platz, Docker, Ports) | ✔ alles grün |
| `2-installieren.sh` unbeaufsichtigt (Profile `https,sprache`) | ✔ gebaut, 41 Migrationen angewendet, Admin angelegt |
| App antwortet lokal und über Caddy/HTTPS (`/api/gesundheit`) | ✔ |
| Spracherkennung aus der App erreichbar (`http://sprache:8080/gesund`) | ✔ Modell small |
| Anmeldung Admin: Passwort → Zwei-Faktor-Einrichtung (TOTP) → Sitzung → Plattform-Verwaltung | ✔ |
| `6-sicherung-erstellen.sh` (Dump + .env + Info, sha256) | ✔ 56 KB |
| Daten geändert (2. Admin), dann `7-sicherung-wiederherstellen.sh` | ✔ zurück auf 1 Benutzer, Anmeldung geht weiter |
| `5-aktualisieren.sh <paket>` (Sicherung, rsync, fehlende .env-Variable ergänzt, Build, Migration) | ✔ |
| Aufbewahrung: alte Sicherungen gelöscht, neueste 3 behalten | ✔ |
| Umzug: frische Installation mit neuen Passwörtern + Sicherung eingespielt → alter Admin meldet sich an | ✔ |
| `9-deinstallieren.sh --ja`: Container, Volumes, Netze, Images entfernt, Sicherungen bleiben | ✔ nichts übrig |

Nicht getestet (auf diesem Server nicht möglich): echtes Let's-Encrypt-Zertifikat auf Port 80/443 (belegt vom
Nextcloud-Caddy), Docker-Installation über `get.docker.com` (Docker war schon da), Update per `git pull`.

## Probelauf 20.10.2026 (Erinnerungen, Commit a0bc608)

Neues Paket mit Migrationen 056/057 und neuer Abhängigkeit `web-push`, unbeaufsichtigt installiert (Projekt
`crm-installtest`, App-Port 18300, ohne Profile). `2-installieren.sh` hat ein VAPID-Schlüsselpaar erzeugt
(`CRM_VAPID_OEFFENTLICH`/`CRM_VAPID_PRIVAT`, von web-push akzeptiert), Migrationen liefen, `/api/gesundheit` ok,
Sicherung + Wiederherstellung ok, `9-deinstallieren.sh --ja` hat alles entfernt. Vorschau-Container unberührt.

## Probelauf 20.10.2026 (Online-Buchung, Migration 060)

Neues Paket mit Migration 060 (legt die Datenbank-Erweiterung `btree_gist` an – im Image `postgres:16-alpine`
enthalten) und den neuen Variablen `CRM_BUCHUNG_EINBETTEN`, `CRM_ADRESS_KOPF`, `CRM_ADRESS_TIEFE`, unbeaufsichtigt
installiert (Projekt `crm-installtest`, App-Port 18300, ohne Profile): alle Migrationen bis 060 angewendet, die
Variablen kommen als `ADDRESS_HEADER`/`XFF_DEPTH`/`CRM_BUCHUNG_EINBETTEN` in der App an, `/api/gesundheit` ok,
unbekannter Buchungslink → 404, Sicherung + Wiederherstellung ok, `9-deinstallieren.sh --ja` hat alles entfernt.
Vorschau-Container unberührt.

## Probelauf 20.10.2026 (Nextcloud-Anbindung, Migration 070)

Paket mit Migration 070 und den neuen `NEXTCLOUD_…`-Variablen, unbeaufsichtigt installiert (Projekt `crm-nctest`,
App-Port 18310, ohne Profile, `CRM_ORIGIN=http://localhost:18310`). **Ohne** Nextcloud-Einträge: Installation,
Migrationen, `/api/gesundheit` und Anmeldeseite unverändert (kein Nextcloud-Knopf). Danach gegen eine
**Wegwerf-Nextcloud** getestet (offizielles Abbild `nextcloud:apache`, 35.0.2, eigenes Compose-Projekt, eigenes Netz,
eigenes Volume, Port 127.0.0.1:18800; Apps `oidc`, `groupfolders`, `spreed` aus dem App-Store; Technik-Konto ohne
Admin-Rechte mit App-Passwort; Gruppenordner „CRM“; OIDC-Client wie in ANLEITUNG Schritt A3). Die Produktiv-Nextcloud
wurde nicht angefasst.

| Prüfung | Ergebnis |
| --- | --- |
| „Mit Nextcloud anmelden“ im Browser (Playwright): Nextcloud-Login → Zustimmung → zurück, ID-Token geprüft, Startseite | ✔ |
| Erste Anmeldung verknüpft über bestätigte E-Mail (`overwrite_email_verified`), ohne Bestätigung → „nicht verknüpft“ | ✔ |
| Kalender „CRM – Einsätze (Max Muster)“ beim Nutzer, nur lesend geteilt; Termin mit Kunde, Ort, Auftragsnummer | ✔ |
| Adressbuch „CRM Kunden“ für Gruppe Team mit dem Kunden (FN, ORG, ADR, EMAIL, TEL) | ✔ |
| Foto im Gruppenordner `CRM/Kunden/Bäckerei Krümel/A-2026-0001/`; versendetes Angebot als PDF daneben | ✔ |
| Erinnerung fällig → Talk-Nachricht vom Technik-Konto an die Person | ✔ |
| Sicherung + Wiederherstellung (Verknüpfung kommt zurück), `9-deinstallieren.sh --ja`, Wegwerf-Nextcloud gelöscht | ✔ |

Dabei gefunden und behoben: `getClientAddress()` warf ohne Proxy-Kopfzeile (direkter Aufruf) → jetzt wie die
Online-Buchung über `ipVon`; Nextcloud liefert die E-Mail im Code-Flow nur über `userinfo` → wird dort abgefragt
(nur wenn `sub` passt).

## Probelauf 21.10.2026 (Aufgaben aufs Handy / CalDAV, Migration 101)

Paket mit Migration 101 und den neuen Abhängigkeiten `ical.js`/`saxes`, unbeaufsichtigt installiert (Projekt
`crm-caldavtest`, App-Port 18330, Profil `https`, Caddy auf 127.0.0.1:18180/18643, Domain `localhost`).

| Prüfung | Ergebnis |
| --- | --- |
| Installation, alle Migrationen bis 101, `/api/gesundheit` über Caddy/HTTPS | ✔ |
| `PROPFIND /.well-known/caldav` über den mitgelieferten Caddy → 301 auf `/caldav/` | ✔ |
| `PROPFIND /caldav/` ohne Anmeldung → 401 (Basic), `OPTIONS` → `DAV: 1, 3, calendar-access` | ✔ |
| Mit E-Mail + App-Passwort: `current-user-principal`, `PUT` einer neuen Aufgabe → 201 | ✔ |
| Sicherung + Wiederherstellung: App-Passwort gilt danach weiter (207) | ✔ |
| `9-deinstallieren.sh --ja`: nichts übrig; Vorschau- und Nextcloud-Container unberührt | ✔ |

## Probelauf 27.10.2026 (Portal je Kunde / Bestandskunden, Migrationen 107 und 108, Commit 65f8534)

Paket unbeaufsichtigt installiert (Projekt `crm-pruefprobe`, App-Port 18350, ohne Profile): alle Migrationen bis 108
angewendet, Admin angelegt, `/api/gesundheit` ok, Sicherung + Wiederherstellung ok (CRM antwortet danach),
`9-deinstallieren.sh --ja` ohne Reste. Vorschau-Container unberührt.

## Probelauf 28.10.2026 (Kundenliste, Unteraufgaben, Portal ab Status – Migrationen 109 und 110, Commit 02d9bc7)

Paket unbeaufsichtigt installiert (Projekt `crm-pruefprobe`, App-Port 18350, ohne Profile): alle Migrationen bis 110
angewendet, Admin angelegt, `/api/gesundheit` ok, Sicherung + Wiederherstellung ok, `9-deinstallieren.sh --ja` ohne
Reste. Vorher beide Migrationen auf einer Kopie der Vorschau-Datenbank geprüft (zweiter Lauf: „Keine neuen Migrationen“).

## Probelauf 29.10.2026 (Untergruppen Beauftragt/In Arbeit, Online-Buchung im Portal-Design – Migration 111, Commit 6070d07)

Paket unbeaufsichtigt installiert (Projekt `crm-pruefprobe`, App-Port 18350, ohne Profile): alle Migrationen bis 111
angewendet, Admin angelegt, `/api/gesundheit` ok, Sicherung + Wiederherstellung ok (CRM antwortet danach),
`9-deinstallieren.sh --ja` ohne Reste. Vorher Migration 111 auf einer Kopie der Vorschau-Datenbank geprüft (zweiter Lauf:
„Keine neuen Migrationen“, Arbeitsstand setzbar), Kopie danach gelöscht. Vorschau-Container unberührt.

## Prüfung 29.10.2026 (Ablauf je Auftragsquelle – Migration 112, Commit 199895f)

Migration 112 auf einer Kopie der Vorschau-Datenbank geprüft: angewendet, zweiter Lauf „Keine neuen Migrationen“, alle
Quellen danach mit leerem `uebersprungen` (= bisheriges Verhalten); Kopie gelöscht. Paket gebaut. Die unbeaufsichtigte
Probe-Installation brach beim Anlegen der Docker-Netze ab („all predefined address pools have been fully subnetted“ – auf
diesem Server sind alle Docker-Adressbereiche belegt); Reste (Volume) entfernt, laufende Container nicht angefasst.
Probelauf nachholen, sobald Netze frei sind (oder auf einem anderen Server).

## Prüfung 29.10.2026 (Partner als Auftragsquelle – Migration 113)

Migration 113 auf einer Kopie der Vorschau-Datenbank geprüft: angewendet, zweiter Lauf „Keine neuen Migrationen“, Quellen
unverändert (dort noch keine Partner); Kopie gelöscht. Probe-Installation weiterhin nicht möglich (Docker-Adressbereiche auf
diesem Server belegt, siehe oben) – nachholen, sobald Netze frei sind.

## Prüfung 29.10.2026 (Benachrichtigungen – Migration 114)

Migration 114 auf einer Kopie der Vorschau-Datenbank geprüft: angewendet, zweiter Lauf „Keine neuen Migrationen“, keine
Nachrichten beim Einspielen (die Trigger greifen erst bei neuen Änderungen); Kopie gelöscht. Probe-Installation weiterhin
nicht möglich (Docker-Adressbereiche belegt) – nachholen, sobald Netze frei sind.

## So wiederholen (für Entwickler)

```sh
installation/paket-erstellen.sh
mkdir /tmp/probe && tar -xzf dist-paket/crm-system-*.tar.gz -C /tmp/probe && cd /tmp/probe/crm-system/installation
CRM_UNBEAUFSICHTIGT=1 CRM_PROJEKT=crm-installtest CRM_DOMAIN=localhost CRM_ORIGIN=https://localhost:18443 \
  CRM_FIRMENNAME="Testbau GmbH" CRM_ADMIN_EMAIL=admin@installtest.de CRM_ADMIN_NAME="Test Admin" \
  CRM_ERSTADMIN_PASSWORT=InstallTest-Passwort-2026 COMPOSE_PROFILES=https,sprache CRM_APP_PORT=18300 \
  CRM_HTTP_PORT=127.0.0.1:18080 CRM_HTTPS_PORT=127.0.0.1:18443 ./2-installieren.sh
curl -sk https://localhost:18443/api/gesundheit
./6-sicherung-erstellen.sh && ./7-sicherung-wiederherstellen.sh --ja --neueste
./9-deinstallieren.sh --ja && rm -rf /tmp/probe
```
