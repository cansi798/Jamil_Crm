#!/usr/bin/env bash
# =====================================================================================
#  paket-erstellen.sh – Installationspaket zum Kopieren auf einen anderen Server bauen
# -------------------------------------------------------------------------------------
#  Packt den Programm-Quellcode und diesen Ordner installation/ in EINE Datei:
#     dist-paket/crm-system-<version>.tar.gz   (+ .sha256 Prüfsumme)
#  NICHT im Paket: node_modules, Bau-Reste, Testergebnisse, .env, Zugangsdaten, Sicherungen, .git.
#
#  Aufruf:  ./paket-erstellen.sh
#  Danach:  scp dist-paket/crm-system-….tar.gz* root@neuer-server:/opt/
#           (auf dem neuen Server: tar -xzf … && cd crm-system/installation && ./CRM-Installation.sh)
# =====================================================================================
set -euo pipefail
INSTALL_ORDNER="$(cd "$(dirname "$0")" && pwd)"
QUELL_ORDNER="$(cd "$INSTALL_ORDNER/.." && pwd)"
ZIEL="$QUELL_ORDNER/dist-paket"

PAKETVERSION="$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$QUELL_ORDNER/package.json" | head -n 1)"
GITSTAND="$(git -C "$QUELL_ORDNER" rev-parse --short HEAD 2>/dev/null || echo ohne-git)"
if git -C "$QUELL_ORDNER" rev-parse --git-dir > /dev/null 2>&1 && [ -n "$(git -C "$QUELL_ORDNER" status --porcelain 2>/dev/null)" ]; then
	GITSTAND="${GITSTAND}-geaendert"
fi
VERSION="${PAKETVERSION:-0}-$(date +%Y%m%d-%H%M)-${GITSTAND}"
NAME="crm-system-${VERSION}"

echo "Erstelle Paket $NAME …"
mkdir -p "$ZIEL"
ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT
mkdir -p "$ARBEIT/crm-system"

# Dateien kopieren – alles außer Bau-Resten und Geheimnissen
tar -C "$QUELL_ORDNER" \
	--exclude='./.git' --exclude='./node_modules' --exclude='*/node_modules' \
	--exclude='./.svelte-kit' --exclude='./build' --exclude='./test-results' --exclude='./playwright-report' \
	--exclude='./dist-paket' --exclude='./.venv-tts' --exclude='./.superpowers' \
	--exclude='.env' --exclude='.env.local' --exclude='.env.production' --exclude='./.zugangsdaten*' \
	--exclude='./installation/sicherungen' --exclude='./installation/erstes-admin-passwort.txt' \
	--exclude='*.log' --exclude='./.vorschau.pid' --exclude='__pycache__' \
	-cf - . | tar -C "$ARBEIT/crm-system" -xf -

# Sicherheitsnetz: keine Geheimnis-Dateien im Paket
GEFUNDEN="$(find "$ARBEIT/crm-system" \( -name '.env' -o -name '.zugangsdaten*' -o -name 'erstes-admin-passwort.txt' \) -print)"
[ -z "$GEFUNDEN" ] || { echo "FEHLER: Geheimnis-Dateien im Paket: $GEFUNDEN" >&2; exit 1; }

echo "$VERSION" > "$ARBEIT/crm-system/VERSION"
tar -C "$ARBEIT" -czf "$ZIEL/$NAME.tar.gz" crm-system
( cd "$ZIEL" && sha256sum "$NAME.tar.gz" > "$NAME.tar.gz.sha256" )
if command -v zip > /dev/null 2>&1; then
	( cd "$ARBEIT" && zip -qr "$ZIEL/$NAME.zip" crm-system )
	( cd "$ZIEL" && sha256sum "$NAME.zip" > "$NAME.zip.sha256" )
fi

echo
echo "Fertig:"
ls -lh "$ZIEL/$NAME".* | awk '{print "  " $5 "  " $9}'
echo
echo "Auf den neuen Server kopieren, z. B.:"
echo "  scp $ZIEL/$NAME.tar.gz $ZIEL/$NAME.tar.gz.sha256 root@SERVER:/opt/"
echo "Dort:"
echo "  cd /opt && sha256sum -c $NAME.tar.gz.sha256 && tar -xzf $NAME.tar.gz"
echo "  cd crm-system/installation && ./CRM-Installation.sh"
