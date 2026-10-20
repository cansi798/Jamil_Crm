# CRM-System – Installation auf einem eigenen Server

Diese Anleitung erklärt Schritt für Schritt, wie das CRM auf einem neuen Server läuft.

Man braucht dafür keine Programmierkenntnisse – nur Kopieren, Einfügen und Enter.

&nbsp;

---

&nbsp;

## Kurz gesagt: 3 Schritte

&nbsp;

**1. Ordner auf den Server kopieren**

&nbsp;

**2. Einen Befehl ausführen:** `./CRM-Installation.sh` → im Menü **2** wählen

&nbsp;

**3. Im Browser die Domain öffnen und anmelden**

&nbsp;

Fertig. Die Einzelheiten stehen unten.

&nbsp;

---

&nbsp;

## Was ist „die exe“?

&nbsp;

Auf einem Linux-Server gibt es keine `.exe`-Dateien wie unter Windows.

Dort heißt das Startprogramm **`CRM-Installation.sh`**.

Es zeigt ein Menü mit allen Funktionen (installieren, starten, sichern …).

&nbsp;

Starten mit:

```
./CRM-Installation.sh
```

&nbsp;

---

&nbsp;

## Was man braucht

&nbsp;

- **Einen Server** mit Ubuntu (22.04 oder neuer) oder Debian (12 oder neuer).
  Mindestens 2 GB Arbeitsspeicher, besser 4 GB (für die Spracherkennung), 10 GB freier Platz.

&nbsp;

- **Eine Domain** (z. B. `crm.meinefirma.de`), die auf den Server zeigt.
  Beim Domain-Anbieter (z. B. all-inkl) einen **A-Eintrag** mit der IP-Adresse des Servers anlegen.

&nbsp;

- **Freie Ports 80 und 443** (in der Firewall des Servers bzw. beim Hoster freigeben).
  Darüber holt sich das CRM automatisch ein HTTPS-Zertifikat.

&nbsp;

- **Zugang zum Server** als `root` oder als Benutzer mit `sudo`.

&nbsp;

Docker muss **nicht** vorher installiert sein – das Skript bietet die Installation an.

&nbsp;

---

&nbsp;

## Schritt 1: Ordner auf den Server kopieren

&nbsp;

**Variante A – mit Paket (empfohlen):**

Auf dem Rechner, wo das CRM schon liegt:

```
cd installation
./paket-erstellen.sh
```

Das erzeugt im Ordner `dist-paket/` eine Datei wie `crm-system-0.0.1-20261020-1200-abc1234.tar.gz`.

&nbsp;

Diese Datei auf den neuen Server kopieren (Name anpassen, `SERVER` = IP oder Name des Servers):

```
scp dist-paket/crm-system-*.tar.gz* root@SERVER:/opt/
```

&nbsp;

Auf dem neuen Server auspacken:

```
cd /opt
sha256sum -c crm-system-*.tar.gz.sha256
tar -xzf crm-system-*.tar.gz
```

&nbsp;

**Variante B – mit Git:**

```
cd /opt
git clone https://github.com/cansi798/Jamil_Crm.git crm-system
```

&nbsp;

**Variante C – mit rsync** (kopiert den ganzen Ordner direkt):

```
rsync -a --exclude node_modules --exclude .env --exclude installation/sicherungen \
  ./ root@SERVER:/opt/crm-system/
```

&nbsp;

---

&nbsp;

## Schritt 2: Installieren

&nbsp;

```
cd /opt/crm-system/installation
./CRM-Installation.sh
```

&nbsp;

Im Menü zuerst **1** (Voraussetzungen prüfen), dann **2** (Installieren) wählen.

&nbsp;

Das Skript fragt:

- die **Domain** (z. B. `crm.meinefirma.de`)
- den **Firmennamen**
- die **E-Mail des ersten Admins**
- den **Namen des Admins** und ein **Passwort** (leer lassen = es wird eins erzeugt und angezeigt)

&nbsp;

Alles andere (Datenbank-Passwörter usw.) erzeugt das Skript selbst und speichert es in `installation/.env`.

&nbsp;

Beim ersten Mal dauert es **5 bis 15 Minuten** (Programme werden gebaut).

&nbsp;

---

&nbsp;

## Schritt 3: Anmelden

&nbsp;

1. Im Browser `https://crm.meinefirma.de` öffnen.

2. Mit der Admin-E-Mail und dem Passwort anmelden.

3. Die **Zwei-Faktor-Anmeldung** einrichten (QR-Code mit einer Authenticator-App scannen, z. B. Google Authenticator). Das ist Pflicht.

4. In der **Verwaltung** den Betrieb (die Firma) anlegen und den Chef per E-Mail einladen.

&nbsp;

---

&nbsp;

## Alle Funktionen im Überblick

&nbsp;

| Menü | Skript | Was es tut |
| --- | --- | --- |
| 1 | `1-voraussetzungen-pruefen.sh` | prüft den Server, installiert auf Wunsch Docker |
| 2 | `2-installieren.sh` | richtet alles ein (einmalig) |
| 3 | `3-starten.sh` | startet das CRM |
| 4 | `4-stoppen.sh` | hält das CRM an (Daten bleiben) |
| 5 | `5-aktualisieren.sh` | Update auf eine neue Version (macht vorher eine Sicherung) |
| 6 | `6-sicherung-erstellen.sh` | erstellt eine Sicherung |
| 7 | `7-sicherung-wiederherstellen.sh` | spielt eine Sicherung zurück |
| 8 | `8-status-und-logs.sh` | zeigt, ob alles läuft, und die letzten Meldungen |
| 9 | `9-deinstallieren.sh` | entfernt das CRM (Sicherungen bleiben) |
| 10 | `paket-erstellen.sh` | baut ein Paket für einen anderen Server |

&nbsp;

Jedes Skript kann man auch direkt starten, z. B. `./6-sicherung-erstellen.sh`.

Wer `make` kennt: `make installieren`, `make sicherung`, `make status` usw. (Liste: `make hilfe`;
ggf. vorher `sudo apt-get install -y make`).

&nbsp;

---

&nbsp;

## Update (neue Version einspielen)

&nbsp;

**Mit Git** (wenn der Ordner per `git clone` kam):

```
./5-aktualisieren.sh
```

&nbsp;

**Mit neuem Paket:** Paket auf den Server kopieren, dann:

```
./5-aktualisieren.sh /opt/crm-system-NEUE-VERSION.tar.gz
```

&nbsp;

Das Skript macht **immer zuerst eine Sicherung**, holt dann die neue Version, baut neu und startet neu.

Die Datenbank wird dabei automatisch auf den neuen Stand gebracht.

Einstellungen (`.env`) und Sicherungen bleiben erhalten.

&nbsp;

---

&nbsp;

## Sicherung (Backup)

&nbsp;

```
./6-sicherung-erstellen.sh
```

&nbsp;

Die Sicherung landet in `installation/sicherungen/` als eine Datei, z. B. `crm-sicherung-2026-10-20_031500.tar.gz`.

Sie enthält **alle Daten** (auch Fotos und PDFs) und eine Kopie der Einstellungen.

&nbsp;

**Jede Nacht automatisch sichern** (3:15 Uhr):

```
./6-sicherung-erstellen.sh --taeglich-einrichten
```

&nbsp;

Alte Sicherungen werden nach 14 Tagen gelöscht (einstellbar in `.env`: `CRM_SICHERUNG_TAGE`). Die neuesten 3 bleiben immer.

&nbsp;

**Wichtig:** Sicherungen regelmäßig **auf einen anderen Rechner** kopieren – wenn der Server kaputtgeht, sind sonst auch die Sicherungen weg:

```
scp root@SERVER:/opt/crm-system/installation/sicherungen/crm-sicherung-*.tar.gz* ./
```

&nbsp;

Die Sicherungen enthalten Passwörter und alle Kundendaten – **sicher aufbewahren**.

&nbsp;

---

&nbsp;

## Sicherung zurückspielen (Wiederherstellen)

&nbsp;

```
./7-sicherung-wiederherstellen.sh
```

&nbsp;

Das Skript zeigt alle Sicherungen, man wählt eine Nummer und bestätigt mit `WIEDERHERSTELLEN`.

Vorher sichert es automatisch den jetzigen Stand.

&nbsp;

**Umzug auf einen neuen Server:**

1. Auf dem neuen Server installieren (Schritte 1 und 2).
2. Die Sicherungsdatei nach `installation/sicherungen/` kopieren.
3. `./7-sicherung-wiederherstellen.sh` ausführen.

&nbsp;

---

&nbsp;

## Wenn etwas nicht klappt

&nbsp;

**Zuerst immer:**

```
./8-status-und-logs.sh
```

Das zeigt, welcher Teil nicht läuft, und die letzten Meldungen.

&nbsp;

**„Port 80/443 ist schon belegt“**

Auf dem Server läuft schon ein Webserver (z. B. Apache, Nginx oder ein anderer Caddy).
Entweder diesen beenden – oder in `.env` bei `COMPOSE_PROFILES` das Wort `https` entfernen und im vorhandenen
Webserver eine Weiterleitung auf `http://127.0.0.1:3000` einrichten.

&nbsp;

**Die Seite ist nicht erreichbar / kein Zertifikat**

- Zeigt die Domain auf den Server? Prüfen mit `ping crm.meinefirma.de` (muss die Server-IP zeigen).
- Sind die Ports 80 und 443 in der Firewall offen? (`sudo ufw allow 80,443/tcp` bei Ubuntu mit ufw)
- Meldungen von Caddy ansehen: `./8-status-und-logs.sh caddy`

&nbsp;

**Anmelden geht nicht, Formulare melden „Forbidden“**

In `.env` muss `CRM_ORIGIN` genau die Adresse im Browser sein (mit `https://`, ohne `/` am Ende).
Nach einer Änderung: `./3-starten.sh`

&nbsp;

**Spracherkennung antwortet nicht**

Sie braucht ca. 2 GB Arbeitsspeicher. Prüfen: `./8-status-und-logs.sh sprache`.
Abschalten: in `.env` bei `COMPOSE_PROFILES` das Wort `sprache` entfernen, dann `./3-starten.sh`.

&nbsp;

**Update ist schiefgegangen**

Die Sicherung von direkt vor dem Update liegt in `installation/sicherungen/`.
Alte Version wieder einspielen (altes Paket mit `./5-aktualisieren.sh altes-paket.tar.gz`), dann
`./7-sicherung-wiederherstellen.sh`.

&nbsp;

**Admin-Passwort vergessen**

Einen zweiten Admin anlegen:

```
./2-installieren.sh
```

(ändert nichts an den vorhandenen Daten; mit einer neuen E-Mail-Adresse wird ein neuer Admin angelegt.)

&nbsp;

---

&nbsp;

## Einstellungen (`installation/.env`)

&nbsp;

Alle Einstellungen stehen in `installation/.env` (Vorlage mit Erklärungen: `.env.beispiel`).

Nach jeder Änderung: `./3-starten.sh`

&nbsp;

Wichtige Einträge:

- `CRM_DOMAIN`, `CRM_ORIGIN` – Adresse des CRM
- `COMPOSE_PROFILES` – `https` (eigenes Zertifikat), `sprache` (Spracherkennung)
- `CRM_KI_ANBIETER`, `CRM_MISTRAL_KEY` – KI-Funktionen (optional)
- `CRM_SMTP_URL` – E-Mail-Versand (optional)
- `KARTE_KACHEL_URL`, `KARTE_KONTAKT`, `KARTE_ATTRIBUTION` – Kartendienst der Auftragskarte. Standard ist
  OpenStreetMap (für kleine Betriebe gedacht); bei vielen Nutzern einen eigenen Kachel-Server oder einen Anbieter
  mit Schlüssel eintragen (Beispiel in `.env.beispiel`).
- `CRM_SICHERUNG_TAGE` – wie lange Sicherungen aufbewahrt werden

&nbsp;

Die `.env` enthält Passwörter: **nie weitergeben, nie ins Git hochladen.**

&nbsp;

---

&nbsp;

## Mehrere CRM-Installationen auf einem Server

&nbsp;

Geht, wenn jede Installation einen eigenen Ordner, einen eigenen Namen (`CRM_PROJEKT`) und eigene Ports hat.

Ports 80/443 kann nur eine davon belegen – die anderen brauchen dann einen gemeinsamen Webserver davor.

&nbsp;

---

&nbsp;

## Für Entwickler

&nbsp;

Regeln für Weiterentwicklung (damit dieser Ordner immer funktioniert): siehe `CLAUDE.md` im Hauptordner,
Abschnitt „Installationspaket“.
