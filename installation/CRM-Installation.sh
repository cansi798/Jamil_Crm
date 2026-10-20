#!/usr/bin/env bash
# =====================================================================================
#  CRM-Installation.sh – DAS Startprogramm („die exe“) für das CRM auf einem Linux-Server
# -------------------------------------------------------------------------------------
#  Zeigt ein Menü und ruft die nummerierten Skripte in diesem Ordner auf.
#  Aufruf:  ./CRM-Installation.sh            (Menü)
#           ./CRM-Installation.sh 2          (direkt Punkt 2, ohne Menü)
# =====================================================================================
ORDNER="$(cd "$(dirname "$0")" && pwd)"
cd "$ORDNER" || exit 1

SKRIPTE=(
	""
	"1-voraussetzungen-pruefen.sh"
	"2-installieren.sh"
	"3-starten.sh"
	"4-stoppen.sh"
	"5-aktualisieren.sh"
	"6-sicherung-erstellen.sh"
	"7-sicherung-wiederherstellen.sh"
	"8-status-und-logs.sh"
	"9-deinstallieren.sh"
	"paket-erstellen.sh"
)

menue() {
	clear 2>/dev/null || true
	cat <<'TEXT'

   ============================================
     CRM-System – Installation und Betrieb
   ============================================

     1  Voraussetzungen prüfen
     2  Installieren (einmalig)
     3  Starten
     4  Anhalten
     5  Aktualisieren (mit Sicherung vorher)
     6  Sicherung erstellen
     7  Sicherung wiederherstellen
     8  Status und Meldungen anzeigen
     9  Deinstallieren
    10  Paket zum Kopieren auf einen anderen Server erstellen

     0  Beenden

TEXT
}

ausfuehren() {
	local nr="$1"; shift
	if [[ "$nr" =~ ^[0-9]+$ ]] && [ "$nr" -ge 1 ] && [ "$nr" -lt "${#SKRIPTE[@]}" ]; then
		"$ORDNER/${SKRIPTE[$nr]}" "$@"
		return $?
	fi
	echo "  Unbekannte Auswahl: $nr"
	return 1
}

if [ $# -gt 0 ]; then
	ausfuehren "$@"
	exit $?
fi

while true; do
	menue
	read -r -p "   Auswahl (0–10): " WAHL || exit 0
	[ "$WAHL" = "0" ] || [ -z "$WAHL" ] && exit 0
	ausfuehren "$WAHL"
	echo
	read -r -p "   Weiter mit Enter … " _ || exit 0
done
