# Nextcloud-Anbindung – Aufbau und Bedrohungsmodell

Entscheidung Can (Talk „CRM System“, Nachricht 2748): Das CRM bleibt eigenständig und wird optional in Nextcloud
eingebunden (Option B). Ergänzung (Nachricht 2750): **nicht** in die Nextcloud von waybuild – die Anbindung ist für
einen eigenen Server vorbereitet und nur über Umgebungsvariablen einschaltbar. Einrichtung für Betreiber:
`installation/ANLEITUNG.md`, Abschnitt „Mit Nextcloud verbinden“.

## Aufbau

| Teil | Code | Weg |
| --- | --- | --- |
| Konfiguration | `src/lib/server/nextcloud/konfig.ts` | `NEXTCLOUD_*` aus der Umgebung; ohne `NEXTCLOUD_URL` alles aus |
| Anmeldung (SSO) | `oidc.ts`, `konten.ts`, `src/routes/anmelden/nextcloud/**` | OIDC Authorization Code + PKCE (S256), state, nonce, ID-Token RS256 über JWKS; E-Mail über `userinfo` |
| Verknüpfung | Migration `070_nextcloud.sql`, `/einstellungen/nextcloud` | `app.nextcloud_konten` (RLS, Änderungsprotokoll), SECURITY-DEFINER-Funktionen nur für `crm_auth` |
| Kalender, Kontakte, Dateien | `abgleich.ts`, `dav.ts`, `formate.ts` | CalDAV/CardDAV/WebDAV, nur CRM → Nextcloud, `app.nextcloud_abgleich` (UID/Pfad + Prüfsumme) |
| Benachrichtigungen | `melden.ts`, `registriereKanal` in `erinnerungen.ts` | Talk-1:1-Nachricht vom Technik-Konto |
| Kachel | – (Nextcloud-App „Externe Seiten“) | Link, öffnet in neuem Tab |

Die Anbindung gehört zu genau **einem** Betrieb (`NEXTCLOUD_BETRIEB` oder der einzige Betrieb der Installation).
Benutzer anderer Betriebe können sich nicht über diese Nextcloud anmelden und werden nicht übertragen.

## Entscheidungen

- **2FA:** `NEXTCLOUD_2FA_VERTRAUEN=ja` nur, wenn Nextcloud die Zwei-Faktor-Anmeldung für alle CRM-Nutzer erzwingt
  (empfohlen). Dann ist die SSO-Sitzung „mit zweitem Faktor“ (`app.nextcloud_sitzung`). Sonst (Standard) läuft die
  SSO-Anmeldung durch `app.anmeldung_weiter` wie die Passwort-Anmeldung: Wer im CRM Pflicht-2FA hat, gibt danach den
  CRM-Code ein. Nextcloud meldet keinen verlässlichen `amr`/`acr`-Wert, deshalb ist das eine Betreiber-Entscheidung.
- **Keine Neuanlage:** SSO legt nie CRM-Benutzer an. Verknüpfung entweder durch einen Admin (Nextcloud-Benutzername
  = `sub`) oder bei der ersten Anmeldung über eine von Nextcloud als **bestätigt** gemeldete E-Mail, die genau ein
  aktiver Benutzer des Betriebs hat (abschaltbar: `NEXTCLOUD_PER_EMAIL_VERKNUEPFEN=nein`).
- **Plattform-Admins** nie über Nextcloud (Funktionen lehnen ab).
- **Einbetten:** Das CRM sendet `X-Frame-Options: DENY` und `frame-ancestors 'none'`; das Sitzungs-Cookie ist
  `SameSite=Lax` und wäre in einem fremden iframe ohnehin nicht dabei → Kachel öffnet in neuem Tab.
- **Benachrichtigungen über Talk statt Notifications-API:** Die Notifications-API für andere Nutzer braucht
  Admin-Rechte; eine Talk-Nachricht braucht nur ein normales Konto (geringste Rechte).
- **Geheimnisse** (Client-Secret, App-Passwort) nur in der `.env` (Modus 600). Ihre Namen enthalten bewusst weder
  `PASSWORT` noch `GEHEIMNIS`, weil `5-aktualisieren.sh` solche Variablen sonst mit Zufallswerten füllen würde – diese
  Werte kommen aus der Nextcloud. Keine Speicherung in der Datenbank (und damit nicht in DB-Dumps).

## Bedrohungsmodell

| Bedrohung | Gegenmaßnahme |
| --- | --- |
| Login-CSRF / untergeschobener Code | `state` (32 Byte Zufall) im httpOnly-, Secure-, SameSite=Lax-Cookie mit Pfad `/anmelden/nextcloud`, 10 Min., Vergleich in konstanter Zeit, Cookie wird beim Rückruf gelöscht |
| Abgefangener Code | PKCE S256; Client-Secret (client_secret_basic); Code nur einmal gültig (Nextcloud) |
| Token-Ersetzung / Replay | `nonce` im ID-Token, `aud` = Client-ID, `azp` bei mehreren Empfängern, `exp`/`iat` mit 2 Min. Spiel |
| Gefälschtes ID-Token | nur RS256 (kein `none`/HS256), Schlüssel nur aus dem JWKS der konfigurierten Nextcloud, `kid`-Wechsel → einmal neu laden |
| Mix-up / fremder Aussteller | `issuer` der Discovery muss `NEXTCLOUD_URL` sein; alle Endpunkte müssen darunter liegen; `iss`-Parameter im Rückruf wird geprüft |
| Fremde E-Mail übernimmt Konto | E-Mail-Verknüpfung nur mit `email_verified=true`, nur wenn genau ein Benutzer des Betriebs passt und dieser noch nicht verknüpft ist; `userinfo` nur mit gleichem `sub` |
| Admin eines anderen Betriebs verknüpft | Verknüpfen nur im Betrieb der Anbindung, RLS auf `nextcloud_konten`, Recht „Benutzer verwalten“, Änderungsprotokoll |
| Durchprobieren | Begrenzung 20 Starts/Rückrufe je IP in 15 Min.; normale Anmeldung behält ihre eigene Begrenzung |
| SSRF über Konfiguration/Antworten | Anfragen nur an `NEXTCLOUD_INTERN_URL`/`NEXTCLOUD_URL`, keine Weiterleitungen, Zeitlimit, Antwort ≤ 5 MB; Pfade aus Daten werden je Teil kodiert, `..` unmöglich |
| Injektion in Kalender/Kontakte/XML | iCal/vCard-Texte maskiert und gefaltet, Steuerzeichen entfernt; XML-Werte maskiert; Datei-/Ordnernamen bereinigt |
| Technik-Konto kompromittiert | kein Admin; schreibt nur eigene Kalender/Adressbücher (lesend geteilt) und den Ordner `CRM`; App-Passwort jederzeit in Nextcloud widerrufbar |
| Geheimnisse in Logs | Fehlermeldungen nennen nur Methode, Pfad ohne Abfrageteil und Status; nie Kopfzeilen, Codes, Tokens oder Antworttexte; Rückruf-Fehler als feste Hinweise |
| Datenabfluss an Nextcloud-Nutzer | Kalender nur an die Person selbst; Adressbuch nur an die eingestellte Gruppe; Dateien nur im Gruppenordner; Monteure ohne „Preise sehen“ sehen Angebote nur, wenn der Ordner für sie freigegeben ist – Ordnerrechte in Nextcloud entsprechend setzen |
| Nextcloud nicht erreichbar | Passwort-Anmeldung bleibt; Abgleich wiederholt beim nächsten Lauf; Fehler eines Teils halten die anderen nicht auf |

## Grenzen / offen

- Nur CRM → Nextcloud. Änderungen in Nextcloud werden beim nächsten Abgleich überschrieben.
- Verknüpfung gelöst: Einträge werden entfernt, der leere geteilte Kalender bleibt (Freigabe wird nicht entzogen).
- Alte Baustellen-Protokolle (Stufe 2a, `app.baustellen_protokolle.pdf`) werden nicht übertragen, nur die neuen
  Formular-Protokolle (abgeschlossen, PDF in `app.dateien`).
- Back-Channel-Logout (Abmelden in Nextcloud beendet die CRM-Sitzung) ist nicht umgesetzt.
