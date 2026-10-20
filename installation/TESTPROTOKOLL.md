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
