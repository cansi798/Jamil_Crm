#!/usr/bin/env bash
# =====================================================================================
#  Gemeinsame Hilfsfunktionen für alle Installations-Skripte (wird nur eingebunden,
#  nicht direkt aufgerufen).
# =====================================================================================

set -euo pipefail

# Ordner installation/ und der Quellcode-Ordner darüber
INSTALL_ORDNER="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
QUELL_ORDNER="$(cd "$INSTALL_ORDNER/.." && pwd)"
ENV_DATEI="$INSTALL_ORDNER/.env"

# Unbeaufsichtigter Modus (keine Rückfragen): CRM_UNBEAUFSICHTIGT=1 oder Schalter --ja
CRM_UNBEAUFSICHTIGT="${CRM_UNBEAUFSICHTIGT:-0}"
for _arg in "$@"; do
	if [ "$_arg" = "--ja" ] || [ "$_arg" = "-y" ]; then CRM_UNBEAUFSICHTIGT=1; fi
done
export CRM_UNBEAUFSICHTIGT

# ---------- Ausgabe ----------
if [ -t 1 ]; then
	FARBE_GRUEN=$'\e[32m'; FARBE_GELB=$'\e[33m'; FARBE_ROT=$'\e[31m'; FARBE_FETT=$'\e[1m'; FARBE_AUS=$'\e[0m'
else
	FARBE_GRUEN=""; FARBE_GELB=""; FARBE_ROT=""; FARBE_FETT=""; FARBE_AUS=""
fi
titel()   { printf '\n%s== %s ==%s\n\n' "$FARBE_FETT" "$*" "$FARBE_AUS"; }
info()    { printf '  %s\n' "$*"; }
ok()      { printf '  %s✔ %s%s\n' "$FARBE_GRUEN" "$*" "$FARBE_AUS"; }
warnung() { printf '  %s! %s%s\n' "$FARBE_GELB" "$*" "$FARBE_AUS" >&2; }
fehler()  { printf '\n  %s✘ %s%s\n\n' "$FARBE_ROT" "$*" "$FARBE_AUS" >&2; exit 1; }

# Ja/Nein-Frage. Im unbeaufsichtigten Modus gilt die Vorgabe (zweites Argument: j oder n).
frage_ja_nein() {
	local frage="$1" vorgabe="${2:-n}" antwort
	if [ "$CRM_UNBEAUFSICHTIGT" = "1" ]; then [ "$vorgabe" = "j" ]; return; fi
	local hinweis="[j/N]"; [ "$vorgabe" = "j" ] && hinweis="[J/n]"
	read -r -p "  $frage $hinweis " antwort || antwort=""
	antwort="${antwort:-$vorgabe}"
	case "$antwort" in j|J|ja|Ja|JA|y|Y|yes) return 0 ;; *) return 1 ;; esac
}

# Texteingabe mit Vorgabe: frage_text "Frage" "Vorgabe" → Ergebnis auf stdout
frage_text() {
	local frage="$1" vorgabe="${2:-}" antwort
	if [ "$CRM_UNBEAUFSICHTIGT" = "1" ]; then printf '%s' "$vorgabe"; return; fi
	if [ -n "$vorgabe" ]; then
		read -r -p "  $frage [$vorgabe]: " antwort || antwort=""
	else
		read -r -p "  $frage: " antwort || antwort=""
	fi
	printf '%s' "${antwort:-$vorgabe}"
}

# Schlüsselpaar für Web-Push (VAPID, P-256) als „ÖFFENTLICH PRIVAT“ (base64url). Ohne openssl: nichts – dann
# erzeugt das CRM die Schlüssel selbst und speichert sie in der Datenbank.
vapid_paar() {
	command -v openssl > /dev/null 2>&1 || return 0
	local pem oeff priv
	pem="$(openssl ecparam -name prime256v1 -genkey -noout 2> /dev/null)" || return 0
	priv="$(printf '%s\n' "$pem" | openssl ec -outform DER 2> /dev/null | tail -c +8 | head -c 32 | base64 | tr '+/' '-_' | tr -d '=\n')"
	oeff="$(printf '%s\n' "$pem" | openssl ec -pubout -outform DER 2> /dev/null | tail -c 65 | base64 | tr '+/' '-_' | tr -d '=\n')"
	[ "${#priv}" -eq 43 ] && [ "${#oeff}" -eq 87 ] && printf '%s %s' "$oeff" "$priv"
	return 0
}

# Zufälliges Passwort (nur Buchstaben und Ziffern, damit es in URLs und .env keine Probleme macht)
zufall() {
	local laenge="${1:-32}"
	LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c "$laenge" || true
}

# ---------- .env lesen und schreiben (ohne sie als Programm auszuführen) ----------

# Liest .env und setzt die Variablen in dieser Shell (vorhandene Umgebungsvariablen gewinnen nicht – .env zählt).
lade_env() {
	[ -f "$ENV_DATEI" ] || fehler "Keine Einstellungen gefunden ($ENV_DATEI). Bitte zuerst ./2-installieren.sh ausführen."
	local zeile name wert
	while IFS= read -r zeile || [ -n "$zeile" ]; do
		case "$zeile" in ''|'#'*) continue ;; esac
		name="${zeile%%=*}"; wert="${zeile#*=}"
		[[ "$name" =~ ^[A-Z_][A-Z0-9_]*$ ]] || continue
		if [[ "$wert" == \"*\" ]]; then wert="${wert:1:${#wert}-2}"; fi
		if [[ "$wert" == \'*\' ]]; then wert="${wert:1:${#wert}-2}"; fi
		printf -v "$name" '%s' "$wert"
		export "$name"
	done < "$ENV_DATEI"
	CRM_PROJEKT="${CRM_PROJEKT:-crm}"
	CRM_SICHERUNG_ORDNER="${CRM_SICHERUNG_ORDNER:-sicherungen}"
	case "$CRM_SICHERUNG_ORDNER" in /*) ;; *) CRM_SICHERUNG_ORDNER="$INSTALL_ORDNER/$CRM_SICHERUNG_ORDNER" ;; esac
	CRM_SICHERUNG_TAGE="${CRM_SICHERUNG_TAGE:-14}"
}

# Setzt NAME=WERT in .env (ersetzt eine vorhandene Zeile oder hängt an)
setze_env() {
	local name="$1" wert="$2" tmp
	tmp="$(mktemp "$INSTALL_ORDNER/.env.XXXXXX")"
	if grep -q "^${name}=" "$ENV_DATEI" 2>/dev/null; then
		awk -v n="$name" -v w="$wert" 'BEGIN{FS=OFS="="} $1==n {print n "=" w; next} {print}' "$ENV_DATEI" > "$tmp"
	else
		cat "$ENV_DATEI" > "$tmp"; printf '%s=%s\n' "$name" "$wert" >> "$tmp"
	fi
	chmod 600 "$tmp"; mv "$tmp" "$ENV_DATEI"
}

# ---------- Docker ----------

# Docker direkt, sonst mit sudo
DOCKER=(docker)
waehle_docker() {
	if docker info > /dev/null 2>&1; then DOCKER=(docker)
	elif command -v sudo > /dev/null 2>&1 && sudo -n docker info > /dev/null 2>&1; then DOCKER=(sudo -n docker)
	elif command -v sudo > /dev/null 2>&1 && command -v docker > /dev/null 2>&1; then
		info "Docker braucht Administrator-Rechte – bitte ggf. das Passwort eingeben."
		sudo docker info > /dev/null 2>&1 || fehler "Docker läuft nicht oder ist nicht erreichbar. Bitte ./1-voraussetzungen-pruefen.sh ausführen."
		DOCKER=(sudo docker)
	else
		fehler "Docker ist nicht installiert oder läuft nicht. Bitte ./1-voraussetzungen-pruefen.sh ausführen."
	fi
	"${DOCKER[@]}" compose version > /dev/null 2>&1 || fehler "„docker compose“ fehlt. Bitte ./1-voraussetzungen-pruefen.sh ausführen."
}

# docker compose mit den Einstellungen dieser Installation
dc() {
	"${DOCKER[@]}" compose --project-directory "$INSTALL_ORDNER" -f "$INSTALL_ORDNER/docker-compose.yml" \
		--env-file "$ENV_DATEI" -p "$CRM_PROJEKT" "$@"
}

# Wartet, bis die App antwortet (über ihren lokalen Port)
warte_auf_app() {
	local versuche="${1:-90}" i=0
	local adresse="http://127.0.0.1:${CRM_APP_PORT:-3000}/api/gesundheit"
	[ "${CRM_APP_BIND:-127.0.0.1}" != "0.0.0.0" ] && adresse="http://${CRM_APP_BIND:-127.0.0.1}:${CRM_APP_PORT:-3000}/api/gesundheit"
	info "Warte, bis das CRM antwortet …"
	until curl -fs "$adresse" > /dev/null 2>&1; do
		i=$((i + 1))
		if [ "$i" -ge "$versuche" ]; then
			warnung "Das CRM antwortet nicht. Letzte Meldungen:"
			dc logs --tail 30 app migration >&2 || true
			return 1
		fi
		sleep 2
	done
	ok "Das CRM antwortet ($adresse)."
}

# Öffentliche Adresse für die Anzeige
adresse_anzeigen() {
	printf '%s' "${CRM_ORIGIN:-https://${CRM_DOMAIN:-}}"
}
