#!/usr/bin/env bash
# =====================================================================================
#  2-installieren.sh – CRM auf diesem Server einrichten (einmalig)
# -------------------------------------------------------------------------------------
#  Fragt nach Domain, Firmenname und Admin-E-Mail, legt .env mit zufälligen Passwörtern an,
#  baut die Programme, startet alles, bringt die Datenbank auf den neuesten Stand und legt
#  den ersten Admin an. Kann gefahrlos wiederholt werden (vorhandene Passwörter bleiben).
#
#  Aufruf:  ./2-installieren.sh
#
#  Ohne Rückfragen (z. B. für Automatisierung) – Werte über Umgebungsvariablen:
#    CRM_UNBEAUFSICHTIGT=1 CRM_DOMAIN=crm.firma.de CRM_FIRMENNAME="Firma GmbH" \
#    CRM_ADMIN_EMAIL=chef@firma.de CRM_ADMIN_NAME="Vorname Nachname" ./2-installieren.sh
#  Optional außerdem: CRM_ERSTADMIN_PASSWORT (sonst zufällig), CRM_PROJEKT, COMPOSE_PROFILES,
#    CRM_ORIGIN, CRM_APP_PORT, CRM_HTTP_PORT, CRM_HTTPS_PORT, CRM_TAEGLICHE_SICHERUNG=1
# =====================================================================================
source "$(dirname "$0")/hilfe/gemeinsam.sh"
cd "$INSTALL_ORDNER"

titel "CRM installieren"

# ---------- 1. Voraussetzungen ----------
if ! "$INSTALL_ORDNER/1-voraussetzungen-pruefen.sh"; then
	frage_ja_nein "Es gibt offene Punkte (siehe oben). Trotzdem weitermachen?" "n" || fehler "Abgebrochen. Bitte die Punkte oben erledigen und erneut starten."
fi
waehle_docker

# ---------- 2. Einstellungen (.env) ----------
titel "Einstellungen"
if [ -f "$ENV_DATEI" ]; then
	ok "Es gibt schon Einstellungen (.env) – die Passwörter bleiben erhalten."
	lade_env
else
	# Werte aus der Umgebung (unbeaufsichtigt) oder per Frage
	DOMAIN="$(frage_text "Unter welcher Domain soll das CRM laufen? (z. B. crm.firma.de)" "${CRM_DOMAIN:-}")"
	[ -n "$DOMAIN" ] || fehler "Ohne Domain geht es nicht (CRM_DOMAIN)."
	DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN%%/*}"
	FIRMA="$(frage_text "Name der Firma" "${CRM_FIRMENNAME:-}")"
	FIRMA="${FIRMA//\"/}"
	[ -n "$FIRMA" ] || FIRMA="Meine Firma"
	PROJEKT="${CRM_PROJEKT:-crm}"
	[[ "$PROJEKT" =~ ^[a-z0-9][a-z0-9-]*$ ]] || fehler "CRM_PROJEKT darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten."

	PROFILE_VORGABE="https,sprache"
	if [ -z "${COMPOSE_PROFILES+x}" ]; then
		RAM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)
		[ "$RAM_MB" -lt 3800 ] && PROFILE_VORGABE="https"
		if [ "$CRM_UNBEAUFSICHTIGT" != "1" ]; then
			frage_ja_nein "Soll das CRM selbst das HTTPS-Zertifikat holen (Ports 80/443)? Nein nur, wenn schon ein Webserver davorsteht." "j" \
				&& P1="https" || P1=""
			frage_ja_nein "Spracherkennung auf diesem Server einrichten (braucht ca. 2 GB Arbeitsspeicher)?" \
				"$( [[ $PROFILE_VORGABE == *sprache* ]] && echo j || echo n )" && P2="sprache" || P2=""
			PROFILE_VORGABE="$(printf '%s,%s' "$P1" "$P2" | sed 's/^,//; s/,$//')"
		fi
		PROFILE_WAHL="$PROFILE_VORGABE"
	else
		PROFILE_WAHL="$COMPOSE_PROFILES"
	fi

	ORIGIN_WAHL="${CRM_ORIGIN:-https://$DOMAIN}"
	EMAIL_ZERT="${CRM_ZERTIFIKAT_EMAIL:-${CRM_ADMIN_EMAIL:-}}"
	if [ -z "$EMAIL_ZERT" ]; then
		EMAIL_ZERT="$(frage_text "E-Mail des ersten Admins (auch für das HTTPS-Zertifikat)" "")"
		CRM_ADMIN_EMAIL="$EMAIL_ZERT"
	fi
	[ -n "$EMAIL_ZERT" ] || fehler "Ohne E-Mail geht es nicht (CRM_ADMIN_EMAIL)."

	info "Lege Einstellungen mit zufälligen Passwörtern an …"
	umask 077
	sed -e "s|^CRM_PROJEKT=.*|CRM_PROJEKT=$PROJEKT|" \
		-e "s|^CRM_FIRMENNAME=.*|CRM_FIRMENNAME=\"$FIRMA\"|" \
		-e "s|^CRM_DOMAIN=.*|CRM_DOMAIN=$DOMAIN|" \
		-e "s|^CRM_ORIGIN=.*|CRM_ORIGIN=$ORIGIN_WAHL|" \
		-e "s|^CRM_ZERTIFIKAT_EMAIL=.*|CRM_ZERTIFIKAT_EMAIL=$EMAIL_ZERT|" \
		-e "s|^COMPOSE_PROFILES=.*|COMPOSE_PROFILES=$PROFILE_WAHL|" \
		-e "s|^CRM_HTTP_PORT=.*|CRM_HTTP_PORT=${CRM_HTTP_PORT:-80}|" \
		-e "s|^CRM_HTTPS_PORT=.*|CRM_HTTPS_PORT=${CRM_HTTPS_PORT:-443}|" \
		-e "s|^CRM_APP_PORT=.*|CRM_APP_PORT=${CRM_APP_PORT:-3000}|" \
		-e "s|^CRM_DB_PASSWORT=.*|CRM_DB_PASSWORT=$(zufall 32)|" \
		-e "s|^CRM_APP_PASSWORT=.*|CRM_APP_PASSWORT=$(zufall 32)|" \
		-e "s|^CRM_ADMIN_PASSWORT=.*|CRM_ADMIN_PASSWORT=$(zufall 32)|" \
		-e "s|^CRM_AUTH_PASSWORT=.*|CRM_AUTH_PASSWORT=$(zufall 32)|" \
		-e "s|^CRM_VORSCHLAG_GEHEIMNIS=.*|CRM_VORSCHLAG_GEHEIMNIS=$(zufall 48)|" \
		"$INSTALL_ORDNER/.env.beispiel" > "$ENV_DATEI"
	chmod 600 "$ENV_DATEI"
	umask 022
	ok "Einstellungen gespeichert in $ENV_DATEI (nur für den Besitzer lesbar)."
	lade_env
fi
info "Firma:    ${CRM_FIRMENNAME:-}"
info "Adresse:  $(adresse_anzeigen)"
info "Dienste:  ${COMPOSE_PROFILES:-(nur CRM, ohne HTTPS und Spracherkennung)}"

# ---------- 3. Bauen und starten ----------
titel "Programme bauen (beim ersten Mal 5–15 Minuten)"
dc build
ok "Gebaut."

titel "Starten und Datenbank vorbereiten"
dc up -d --remove-orphans || { dc logs --tail 40 migration app >&2 || true; fehler "Start fehlgeschlagen – Meldungen siehe oben."; }
info "Migration: $(dc logs --no-log-prefix migration 2>/dev/null | tail -n 1)"
warte_auf_app || fehler "Das CRM startet nicht – Meldungen siehe oben (oder ./8-status-und-logs.sh)."

# ---------- 4. Erster Admin ----------
titel "Ersten Admin anlegen"
ADMIN_EMAIL="${CRM_ADMIN_EMAIL:-}"
[ -n "$ADMIN_EMAIL" ] || ADMIN_EMAIL="$(frage_text "E-Mail des ersten Admins" "${CRM_ZERTIFIKAT_EMAIL:-}")"
[ -n "$ADMIN_EMAIL" ] || fehler "Ohne Admin-E-Mail geht es nicht (CRM_ADMIN_EMAIL)."
ADMIN_NAME="${CRM_ADMIN_NAME:-}"
[ -n "$ADMIN_NAME" ] || ADMIN_NAME="$(frage_text "Vor- und Nachname des Admins" "Administrator")"
[ -n "$ADMIN_NAME" ] || ADMIN_NAME="Administrator"

ADMIN_PW="${CRM_ERSTADMIN_PASSWORT:-}"
PW_ERZEUGT=0
if [ -z "$ADMIN_PW" ] && [ "$CRM_UNBEAUFSICHTIGT" != "1" ] && [ -t 0 ]; then
	read -r -s -p "  Passwort für den Admin (mind. 10 Zeichen; leer lassen = zufällig erzeugen): " ADMIN_PW; echo
	if [ -n "$ADMIN_PW" ]; then
		read -r -s -p "  Passwort wiederholen: " PW2; echo
		[ "$ADMIN_PW" = "$PW2" ] || fehler "Die beiden Passwörter stimmen nicht überein. Bitte ./2-installieren.sh erneut starten."
	fi
fi
if [ -z "$ADMIN_PW" ]; then ADMIN_PW="$(zufall 20)"; PW_ERZEUGT=1; fi

set +e
AUSGABE="$(printf '%s\n' "$ADMIN_PW" | dc run --rm -T --no-deps migration \
	node_modules/.bin/tsx scripts/admin-anlegen.ts --email "$ADMIN_EMAIL" --name "$ADMIN_NAME" --passwort-stdin 2>&1)"
RC=$?
set -e
if [ $RC -eq 0 ]; then
	ok "Admin $ADMIN_EMAIL angelegt."
	if [ "$PW_ERZEUGT" = "1" ]; then
		umask 077
		printf 'CRM %s\nAdmin: %s\nErstes Passwort: %s\n(Datei nach dem ersten Anmelden löschen.)\n' \
			"$(adresse_anzeigen)" "$ADMIN_EMAIL" "$ADMIN_PW" > "$INSTALL_ORDNER/erstes-admin-passwort.txt"
		umask 022
		warnung "Erstes Admin-Passwort (bitte notieren!): $ADMIN_PW"
		info "Es steht auch in $INSTALL_ORDNER/erstes-admin-passwort.txt – nach dem ersten Anmelden löschen."
	fi
elif printf '%s' "$AUSGABE" | grep -q "existiert bereits"; then
	ok "Admin $ADMIN_EMAIL gibt es schon – nichts geändert."
else
	printf '%s\n' "$AUSGABE" >&2
	fehler "Admin konnte nicht angelegt werden (Meldung oben)."
fi
unset ADMIN_PW PW2

# ---------- 5. Tägliche Sicherung ----------
if frage_ja_nein "Jede Nacht um 3:15 Uhr automatisch eine Sicherung erstellen?" "$( [ "${CRM_TAEGLICHE_SICHERUNG:-0}" = 1 ] && echo j || echo n )"; then
	"$INSTALL_ORDNER/6-sicherung-erstellen.sh" --taeglich-einrichten || warnung "Tägliche Sicherung konnte nicht eingerichtet werden."
fi

# ---------- Fertig ----------
titel "Fertig"
ok "Das CRM läuft: $(adresse_anzeigen)"
info ""
info "Nächste Schritte:"
info "  1. Im Browser $(adresse_anzeigen) öffnen und mit $ADMIN_EMAIL anmelden."
info "  2. Zwei-Faktor-Anmeldung mit einer Authenticator-App einrichten (Pflicht beim ersten Anmelden)."
info "  3. In der Verwaltung den Betrieb „${CRM_FIRMENNAME:-}“ anlegen und den Chef einladen."
if [[ ",${COMPOSE_PROFILES:-}," == *",https,"* ]]; then
	info ""
	info "Das HTTPS-Zertifikat holt Caddy automatisch, sobald die Domain ${CRM_DOMAIN} auf diesen Server zeigt."
fi
echo
