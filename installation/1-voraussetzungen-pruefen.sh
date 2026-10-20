#!/usr/bin/env bash
# =====================================================================================
#  1-voraussetzungen-pruefen.sh – Ist der Server bereit für das CRM?
# -------------------------------------------------------------------------------------
#  Prüft: Betriebssystem, Arbeitsspeicher, freien Speicherplatz, Docker + Docker Compose,
#  freie Ports (80/443 bzw. App-Port). Fehlt Docker auf Debian/Ubuntu, bietet das Skript
#  an, es zu installieren (fragt vorher).
#
#  Aufruf:  ./1-voraussetzungen-pruefen.sh          (fragt bei Bedarf nach)
#           ./1-voraussetzungen-pruefen.sh --ja     (installiert Docker ohne Rückfrage)
#  Ergebnis: Exit-Code 0 = alles bereit, 1 = etwas fehlt (steht in der Ausgabe).
# =====================================================================================
source "$(dirname "$0")/hilfe/gemeinsam.sh"

PROBLEME=0
problem() { warnung "$*"; PROBLEME=$((PROBLEME + 1)); }

titel "Voraussetzungen prüfen"

# ---------- Betriebssystem ----------
OS_ID="unbekannt"; OS_NAME="unbekannt"
if [ -r /etc/os-release ]; then
	# shellcheck disable=SC1091
	OS_ID="$(. /etc/os-release && echo "${ID:-unbekannt}")"
	OS_NAME="$(. /etc/os-release && echo "${PRETTY_NAME:-unbekannt}")"
fi
case "$OS_ID" in
	ubuntu|debian) ok "Betriebssystem: $OS_NAME" ;;
	*) warnung "Betriebssystem: $OS_NAME – getestet ist nur Ubuntu/Debian. Es kann trotzdem funktionieren." ;;
esac
ARCH="$(uname -m)"
case "$ARCH" in
	x86_64|aarch64|arm64) ok "Prozessor-Architektur: $ARCH" ;;
	*) problem "Prozessor-Architektur $ARCH wird nicht unterstützt (nötig: x86_64 oder arm64)." ;;
esac

# ---------- Arbeitsspeicher und Platz ----------
RAM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)
if [ "$RAM_MB" -ge 3800 ]; then ok "Arbeitsspeicher: ${RAM_MB} MB (reicht auch für die Spracherkennung)"
elif [ "$RAM_MB" -ge 1800 ]; then warnung "Arbeitsspeicher: ${RAM_MB} MB – reicht für das CRM, für die Spracherkennung (Profil „sprache“) werden 4 GB empfohlen."
else problem "Arbeitsspeicher: ${RAM_MB} MB – zu wenig (mindestens 2 GB, empfohlen 4 GB)."
fi
FREI_GB=$(df -Pk "$INSTALL_ORDNER" | awk 'NR==2 {print int($4/1024/1024)}')
if [ "$FREI_GB" -ge 10 ]; then ok "Freier Speicherplatz: ${FREI_GB} GB"
else problem "Freier Speicherplatz: ${FREI_GB} GB – mindestens 10 GB nötig (Programm, Datenbank, Sicherungen)."
fi

# ---------- Hilfsprogramme ----------
for p in curl tar awk; do
	if command -v "$p" > /dev/null 2>&1; then ok "Programm vorhanden: $p"
	else problem "Programm fehlt: $p (Debian/Ubuntu: sudo apt-get install -y $p)"
	fi
done

# ---------- Docker ----------
docker_bereit() {
	{ docker info > /dev/null 2>&1 && docker compose version > /dev/null 2>&1; } ||
		{ command -v sudo > /dev/null 2>&1 && sudo -n docker info > /dev/null 2>&1 && sudo -n docker compose version > /dev/null 2>&1; }
}
if docker_bereit; then
	ok "Docker und Docker Compose sind installiert und laufen."
elif command -v docker > /dev/null 2>&1; then
	warnung "Docker ist installiert, aber nicht erreichbar (läuft der Dienst? fehlen Rechte?)."
	info "Tipp: sudo systemctl enable --now docker   und dieses Skript mit sudo erneut starten."
	PROBLEME=$((PROBLEME + 1))
else
	warnung "Docker ist nicht installiert."
	if [ "$OS_ID" = "ubuntu" ] || [ "$OS_ID" = "debian" ]; then
		if frage_ja_nein "Docker jetzt installieren (offizielles Installationsskript von docker.com)?" "j"; then
			SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
			info "Lade das Installationsskript von https://get.docker.com …"
			curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
			$SUDO sh /tmp/get-docker.sh
			rm -f /tmp/get-docker.sh
			$SUDO systemctl enable --now docker > /dev/null 2>&1 || true
			if docker_bereit || $SUDO docker info > /dev/null 2>&1; then ok "Docker wurde installiert."
			else problem "Docker-Installation hat nicht geklappt – siehe Meldungen oben."
			fi
		else
			problem "Ohne Docker geht es nicht. Anleitung: https://docs.docker.com/engine/install/"
		fi
	else
		problem "Bitte Docker installieren: https://docs.docker.com/engine/install/"
	fi
fi

# ---------- Ports ----------
port_belegt() {
	if command -v ss > /dev/null 2>&1; then ss -Hltn "sport = :$1" 2>/dev/null | grep -q .
	else (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
	fi
}
HTTP_PORT="${CRM_HTTP_PORT:-80}"; HTTPS_PORT="${CRM_HTTPS_PORT:-443}"; APP_PORT="${CRM_APP_PORT:-3000}"
PROFILE="${COMPOSE_PROFILES-https,sprache}"
if [ -f "$ENV_DATEI" ]; then
	lade_env
	HTTP_PORT="${CRM_HTTP_PORT:-80}"; HTTPS_PORT="${CRM_HTTPS_PORT:-443}"; APP_PORT="${CRM_APP_PORT:-3000}"
	PROFILE="${COMPOSE_PROFILES:-}"
fi
# Läuft diese Installation schon, belegt sie ihre Ports selbst – dann ist das kein Problem.
LAEUFT=0
if [ -f "$ENV_DATEI" ] && docker_bereit; then
	waehle_docker
	[ -n "$(dc ps -q app 2>/dev/null)" ] && LAEUFT=1
fi
pruefe_port() {
	local port="${1##*:}" zweck="$2"   # „127.0.0.1:8080“ → 8080
	if [ "$LAEUFT" = "1" ]; then ok "Port $port ($zweck) – gehört zur laufenden Installation"; return; fi
	if port_belegt "$port"; then problem "Port $port ($zweck) ist schon belegt. Anderes Programm beenden oder Port in .env ändern."
	else ok "Port $port ($zweck) ist frei."
	fi
}
if [[ ",$PROFILE," == *",https,"* ]]; then
	pruefe_port "$HTTP_PORT" "HTTP für Zertifikat"
	pruefe_port "$HTTPS_PORT" "HTTPS"
fi
pruefe_port "$APP_PORT" "CRM-App lokal"

# ---------- Ergebnis ----------
echo
if [ "$PROBLEME" -eq 0 ]; then
	ok "Alles bereit. Weiter mit:  ./2-installieren.sh"
	exit 0
else
	printf '  %s%d Punkt(e) müssen noch erledigt werden (siehe oben).%s\n\n' "$FARBE_ROT" "$PROBLEME" "$FARBE_AUS"
	exit 1
fi
