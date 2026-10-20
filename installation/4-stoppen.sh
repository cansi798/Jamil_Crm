#!/usr/bin/env bash
# =====================================================================================
#  4-stoppen.sh – CRM anhalten
# -------------------------------------------------------------------------------------
#  Hält alle Dienste an. Daten und Einstellungen bleiben vollständig erhalten.
#  Wieder starten mit ./3-starten.sh
#
#  Aufruf:  ./4-stoppen.sh
# =====================================================================================
source "$(dirname "$0")/hilfe/gemeinsam.sh"
lade_env
waehle_docker

titel "CRM anhalten"
dc down
ok "Das CRM ist angehalten. Daten bleiben erhalten. Starten mit ./3-starten.sh"
