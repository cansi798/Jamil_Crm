#!/usr/bin/env bash
# =====================================================================================
#  7-sicherung-wiederherstellen.sh – Sicherung zurückspielen
# -------------------------------------------------------------------------------------
#  Ersetzt die komplette Datenbank durch den Stand aus einer Sicherung. Vorher wird
#  automatisch eine Sicherung des JETZIGEN Stands erstellt (falls man es sich anders überlegt).
#  Die Passwörter dieses Servers (.env) bleiben unverändert – so kann man eine Sicherung
#  auch auf einem NEUEN Server einspielen (dort vorher ./2-installieren.sh ausführen).
#
#  Aufruf:  ./7-sicherung-wiederherstellen.sh                 (zeigt die Sicherungen zur Auswahl)
#           ./7-sicherung-wiederherstellen.sh <datei.tar.gz>  (bestimmte Sicherung)
#           ./7-sicherung-wiederherstellen.sh --neueste --ja  (ohne Rückfrage die neueste)
# =====================================================================================
source "$(dirname "$0")/hilfe/gemeinsam.sh"
lade_env
waehle_docker

titel "Sicherung wiederherstellen"

DATEI=""
for a in "$@"; do
	case "$a" in
		--ja|-y) ;;
		--neueste) DATEI="$(ls -1t "$CRM_SICHERUNG_ORDNER"/crm-sicherung-*.tar.gz 2>/dev/null | head -n 1)" ;;
		*) DATEI="$a" ;;
	esac
done

if [ -z "$DATEI" ]; then
	mapfile -t LISTE < <(ls -1t "$CRM_SICHERUNG_ORDNER"/crm-sicherung-*.tar.gz 2>/dev/null)
	[ "${#LISTE[@]}" -gt 0 ] || fehler "Keine Sicherungen in $CRM_SICHERUNG_ORDNER gefunden."
	[ "$CRM_UNBEAUFSICHTIGT" = "1" ] && fehler "Bitte die Datei angeben oder --neueste verwenden."
	info "Vorhandene Sicherungen (neueste zuerst):"
	for i in "${!LISTE[@]}"; do
		printf '    %2d) %s  (%s)\n' "$((i + 1))" "$(basename "${LISTE[$i]}")" "$(du -h "${LISTE[$i]}" | cut -f1)"
	done
	NR="$(frage_text "Nummer der Sicherung" "1")"
	[[ "$NR" =~ ^[0-9]+$ ]] && [ "$NR" -ge 1 ] && [ "$NR" -le "${#LISTE[@]}" ] || fehler "Ungültige Auswahl."
	DATEI="${LISTE[$((NR - 1))]}"
fi
[ -f "$DATEI" ] || fehler "Datei nicht gefunden: $DATEI"
DATEI="$(cd "$(dirname "$DATEI")" && pwd)/$(basename "$DATEI")"

# Prüfsumme kontrollieren (falls vorhanden)
if [ -f "$DATEI.sha256" ]; then
	( cd "$(dirname "$DATEI")" && sha256sum -c --quiet "$(basename "$DATEI").sha256" ) \
		|| fehler "Prüfsumme stimmt nicht – die Sicherung ist beschädigt oder verändert."
	ok "Prüfsumme in Ordnung."
fi

ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT
tar -xzf "$DATEI" -C "$ARBEIT" datenbank.dump info.txt 2>/dev/null || tar -xzf "$DATEI" -C "$ARBEIT"
[ -s "$ARBEIT/datenbank.dump" ] || fehler "In der Sicherung fehlt datenbank.dump."
if [ -f "$ARBEIT/info.txt" ]; then head -n 6 "$ARBEIT/info.txt" | sed 's/^/    /'; fi

echo
warnung "ACHTUNG: Alle jetzigen Daten im CRM werden durch diese Sicherung ersetzt!"
if [ "$CRM_UNBEAUFSICHTIGT" != "1" ]; then
	BESTAETIGUNG="$(frage_text "Zum Bestätigen WIEDERHERSTELLEN eintippen" "")"
	[ "$BESTAETIGUNG" = "WIEDERHERSTELLEN" ] || fehler "Abgebrochen – nichts geändert."
fi

# Sicherheitskopie des jetzigen Stands (nur wenn es schon eine Datenbank gibt)
info "Erstelle zuerst eine Sicherung des jetzigen Stands …"
"$INSTALL_ORDNER/6-sicherung-erstellen.sh" --ja > /dev/null && ok "Jetziger Stand gesichert." \
	|| warnung "Sicherung des jetzigen Stands nicht möglich (z. B. leere Datenbank) – fahre fort."

info "Halte das CRM an …"
dc stop app > /dev/null 2>&1 || true
dc up -d --wait datenbank

info "Spiele die Datenbank zurück …"
dc exec -T datenbank dropdb -U crm --if-exists --force crm
dc exec -T datenbank createdb -U crm -O crm -E UTF8 -T template0 crm
if ! dc exec -T datenbank pg_restore -U crm -d crm --exit-on-error < "$ARBEIT/datenbank.dump"; then
	fehler "Zurückspielen fehlgeschlagen. Die Sicherung des vorherigen Stands liegt in $CRM_SICHERUNG_ORDNER."
fi
ok "Datenbank zurückgespielt."

info "Starte das CRM (bringt die Datenbank ggf. auf den neuesten Programmstand) …"
dc up -d --remove-orphans || { dc logs --tail 40 migration >&2 || true; fehler "Start nach dem Zurückspielen fehlgeschlagen."; }
warte_auf_app || fehler "Das CRM startet nicht. Details: ./8-status-und-logs.sh"
ok "Wiederherstellung abgeschlossen: $(adresse_anzeigen)"
