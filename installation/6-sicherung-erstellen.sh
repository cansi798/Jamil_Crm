#!/usr/bin/env bash
# =====================================================================================
#  6-sicherung-erstellen.sh – Sicherung (Backup) des CRM erstellen
# -------------------------------------------------------------------------------------
#  Sichert die komplette Datenbank (alle Kunden, Aufträge, Angebote – auch Fotos und PDFs,
#  die liegen in der Datenbank) und eine Kopie der Einstellungen (.env) in EINE Datei:
#     sicherungen/crm-sicherung-JJJJ-MM-TT_HHMMSS.tar.gz   (+ .sha256 Prüfsumme)
#  Alte Sicherungen werden nach CRM_SICHERUNG_TAGE Tagen gelöscht (die neuesten 3 bleiben immer).
#  Das CRM läuft währenddessen weiter.
#
#  Aufruf:  ./6-sicherung-erstellen.sh
#           ./6-sicherung-erstellen.sh --taeglich-einrichten   (jede Nacht 3:15 Uhr automatisch)
#           ./6-sicherung-erstellen.sh --taeglich-entfernen
#
#  Wichtig: Sicherungen enthalten alle Daten und Passwörter – zusätzlich auf einen ANDEREN
#  Rechner kopieren (z. B. per scp) und sicher aufbewahren.
# =====================================================================================
source "$(dirname "$0")/hilfe/gemeinsam.sh"
lade_env

CRON_DATEI="/etc/cron.d/crm-sicherung-${CRM_PROJEKT}"
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"

if [ "${1:-}" = "--taeglich-einrichten" ]; then
	titel "Tägliche Sicherung einrichten"
	printf '# CRM %s: tägliche Sicherung (angelegt von 6-sicherung-erstellen.sh)\nSHELL=/bin/bash\n15 3 * * * root %q --ja >> /var/log/crm-sicherung-%s.log 2>&1\n' \
		"$CRM_PROJEKT" "$INSTALL_ORDNER/6-sicherung-erstellen.sh" "$CRM_PROJEKT" | $SUDO tee "$CRON_DATEI" > /dev/null
	$SUDO chmod 644 "$CRON_DATEI"
	ok "Eingerichtet: jede Nacht um 3:15 Uhr. Protokoll: /var/log/crm-sicherung-${CRM_PROJEKT}.log"
	exit 0
fi
if [ "${1:-}" = "--taeglich-entfernen" ]; then
	$SUDO rm -f "$CRON_DATEI"
	ok "Tägliche Sicherung abgeschaltet."
	exit 0
fi

waehle_docker
titel "Sicherung erstellen"

# Datenbank muss laufen (die App nicht)
if [ -z "$(dc ps --status running -q datenbank 2>/dev/null)" ]; then
	info "Datenbank läuft nicht – starte sie kurz …"
	dc up -d --wait datenbank
fi

mkdir -p "$CRM_SICHERUNG_ORDNER"
chmod 700 "$CRM_SICHERUNG_ORDNER"
STEMPEL="$(date +%Y-%m-%d_%H%M%S)"
NAME="crm-sicherung-${STEMPEL}"
ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT
umask 077

info "Sichere Datenbank …"
dc exec -T datenbank pg_dump -U crm -d crm --format=custom --compress=6 > "$ARBEIT/datenbank.dump" \
	|| fehler "Datenbank-Sicherung fehlgeschlagen."
[ -s "$ARBEIT/datenbank.dump" ] || fehler "Datenbank-Sicherung ist leer."
# Prüfen, ob die Datei lesbar ist (Inhaltsverzeichnis lesen)
dc exec -T datenbank pg_restore --list < "$ARBEIT/datenbank.dump" > /dev/null \
	|| fehler "Die Sicherung ist beschädigt (pg_restore kann sie nicht lesen)."

cp "$ENV_DATEI" "$ARBEIT/einstellungen.env"
STAND="$(dc exec -T datenbank psql -U crm -d crm -tAc 'select max(name) from schema_migrationen' 2>/dev/null || echo unbekannt)"
VERSION="$(cat "$QUELL_ORDNER/VERSION" 2>/dev/null || git -C "$QUELL_ORDNER" describe --always --dirty 2>/dev/null || echo unbekannt)"
{
	echo "CRM-Sicherung"
	echo "Erstellt:        $(date '+%d.%m.%Y %H:%M:%S')"
	echo "Server:          $(hostname)"
	echo "Installation:    $CRM_PROJEKT ($(adresse_anzeigen))"
	echo "Programmversion: $VERSION"
	echo "Datenbankstand:  $STAND"
	echo
	echo "Inhalt: datenbank.dump (pg_dump, Format custom), einstellungen.env (Passwörter!)"
	echo "Wiederherstellen: ./7-sicherung-wiederherstellen.sh <diese Datei>"
} > "$ARBEIT/info.txt"

tar -czf "$CRM_SICHERUNG_ORDNER/$NAME.tar.gz" -C "$ARBEIT" datenbank.dump einstellungen.env info.txt
( cd "$CRM_SICHERUNG_ORDNER" && sha256sum "$NAME.tar.gz" > "$NAME.tar.gz.sha256" )
chmod 600 "$CRM_SICHERUNG_ORDNER/$NAME.tar.gz" "$CRM_SICHERUNG_ORDNER/$NAME.tar.gz.sha256"
GROESSE="$(du -h "$CRM_SICHERUNG_ORDNER/$NAME.tar.gz" | cut -f1)"
ok "Sicherung erstellt: $CRM_SICHERUNG_ORDNER/$NAME.tar.gz ($GROESSE)"

# ---------- Alte Sicherungen aufräumen ----------
GELOESCHT=0
i=0
while IFS= read -r datei; do
	i=$((i + 1))
	[ "$i" -le 3 ] && continue   # die neuesten 3 immer behalten
	if [ -n "$(find "$datei" -mtime +"$CRM_SICHERUNG_TAGE" 2>/dev/null)" ]; then
		rm -f "$datei" "$datei.sha256"
		GELOESCHT=$((GELOESCHT + 1))
	fi
done < <(ls -1t "$CRM_SICHERUNG_ORDNER"/crm-sicherung-*.tar.gz 2>/dev/null)
[ "$GELOESCHT" -gt 0 ] && info "$GELOESCHT alte Sicherung(en) gelöscht (älter als $CRM_SICHERUNG_TAGE Tage)."
info "Vorhandene Sicherungen: $(ls -1 "$CRM_SICHERUNG_ORDNER"/crm-sicherung-*.tar.gz 2>/dev/null | wc -l)"
info "Tipp: Sicherungen zusätzlich auf einen anderen Rechner kopieren."
