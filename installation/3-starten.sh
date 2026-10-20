#!/usr/bin/env bash
# =====================================================================================
#  3-starten.sh – CRM starten (oder nach einer Änderung an .env neu starten)
# -------------------------------------------------------------------------------------
#  Startet alle Dienste. Fehlende Programme werden vorher gebaut, die Datenbank wird
#  automatisch auf den neuesten Stand gebracht (Dienst „migration“).
#
#  Aufruf:  ./3-starten.sh
# =====================================================================================
source "$(dirname "$0")/hilfe/gemeinsam.sh"
lade_env
waehle_docker

titel "CRM starten"
if ! "${DOCKER[@]}" image inspect "${CRM_PROJEKT}-app:aktuell" > /dev/null 2>&1; then
	info "Programm-Abbild fehlt – wird gebaut …"
	dc build
fi
dc up -d --remove-orphans || { dc logs --tail 40 migration app >&2 || true; fehler "Start fehlgeschlagen – Meldungen siehe oben."; }
warte_auf_app || fehler "Das CRM startet nicht. Details: ./8-status-und-logs.sh"
ok "Das CRM läuft: $(adresse_anzeigen)"
