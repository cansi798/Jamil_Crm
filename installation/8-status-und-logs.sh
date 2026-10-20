#!/usr/bin/env bash
# =====================================================================================
#  8-status-und-logs.sh – Läuft alles? Was ist passiert?
# -------------------------------------------------------------------------------------
#  Zeigt: Zustand aller Dienste, ob das CRM antwortet, Speicherplatz, letzte Sicherungen
#  und die letzten Meldungen (Logs).
#
#  Aufruf:  ./8-status-und-logs.sh            (Übersicht + letzte 50 Meldungen)
#           ./8-status-und-logs.sh -f         (Meldungen der App live mitverfolgen, Ende mit Strg+C)
#           ./8-status-und-logs.sh caddy      (Meldungen eines bestimmten Dienstes: app, datenbank,
#                                              migration, caddy, sprache)
# =====================================================================================
source "$(dirname "$0")/hilfe/gemeinsam.sh"
lade_env
waehle_docker

if [ "${1:-}" = "-f" ]; then
	exec "${DOCKER[@]}" compose --project-directory "$INSTALL_ORDNER" -f "$INSTALL_ORDNER/docker-compose.yml" \
		--env-file "$ENV_DATEI" -p "$CRM_PROJEKT" logs -f --tail 50 app
fi
if [ -n "${1:-}" ] && [ "${1:-}" != "--ja" ]; then
	dc logs --tail 200 "$1"
	exit 0
fi

titel "Status: $CRM_PROJEKT ($(adresse_anzeigen))"
dc ps -a --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'
echo
if curl -fs "http://127.0.0.1:${CRM_APP_PORT:-3000}/api/gesundheit" > /dev/null 2>&1; then
	ok "CRM antwortet lokal (Port ${CRM_APP_PORT:-3000})."
else
	warnung "CRM antwortet lokal NICHT (Port ${CRM_APP_PORT:-3000})."
fi
if [[ ",${COMPOSE_PROFILES:-}," == *",https,"* ]]; then
	if curl -fs --max-time 10 "$(adresse_anzeigen)/api/gesundheit" > /dev/null 2>&1; then
		ok "CRM ist von außen über $(adresse_anzeigen) erreichbar (Zertifikat gültig)."
	else
		warnung "$(adresse_anzeigen) ist (noch) nicht erreichbar – DNS, Firewall (Ports 80/443) oder Zertifikat prüfen."
	fi
fi
STAND="$(dc exec -T datenbank psql -U crm -d crm -tAc 'select max(name) from schema_migrationen' 2>/dev/null || echo unbekannt)"
info "Datenbankstand: $STAND"
info "Version:        $(cat "$QUELL_ORDNER/VERSION" 2>/dev/null || git -C "$QUELL_ORDNER" log --oneline -1 2>/dev/null || echo unbekannt)"
info "Freier Platz:   $(df -h "$INSTALL_ORDNER" | awk 'NR==2 {print $4}')"
info "Letzte Sicherungen:"
ls -1t "$CRM_SICHERUNG_ORDNER"/crm-sicherung-*.tar.gz 2>/dev/null | head -n 3 | sed 's/^/    /' || true
[ -n "$(ls "$CRM_SICHERUNG_ORDNER"/crm-sicherung-*.tar.gz 2>/dev/null)" ] || warnung "Noch keine Sicherung vorhanden – ./6-sicherung-erstellen.sh"

titel "Letzte Meldungen"
dc logs --tail 50 app migration || true
