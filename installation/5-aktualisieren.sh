#!/usr/bin/env bash
# =====================================================================================
#  5-aktualisieren.sh – CRM auf eine neue Version bringen
# -------------------------------------------------------------------------------------
#  Ablauf: 1. Sicherung erstellen  2. neue Programmdateien holen  3. neu bauen
#          4. neu starten (die Datenbank wird dabei automatisch auf den neuen Stand gebracht)
#
#  Woher kommt die neue Version?
#    ./5-aktualisieren.sh                          → aus Git („git pull“), wenn der Ordner ein Git-Klon ist
#    ./5-aktualisieren.sh crm-system-X.tar.gz      → aus einem neuen Paket (von paket-erstellen.sh)
#    ./5-aktualisieren.sh --nur-neu-bauen          → Dateien unverändert, nur neu bauen und starten
#
#  Einstellungen (.env), Sicherungen und Daten bleiben immer erhalten. Neue Einstellungen aus
#  .env.beispiel werden automatisch in .env ergänzt (neue Passwörter zufällig erzeugt).
# =====================================================================================
source "$(dirname "$0")/hilfe/gemeinsam.sh"
lade_env
waehle_docker

titel "CRM aktualisieren"

PAKET=""; NUR_BAUEN=0
for a in "$@"; do
	case "$a" in
		--ja|-y) ;;
		--nur-neu-bauen) NUR_BAUEN=1 ;;
		*) PAKET="$a" ;;
	esac
done

# ---------- 1. Sicherung ----------
info "Schritt 1: Sicherung vor dem Update …"
"$INSTALL_ORDNER/6-sicherung-erstellen.sh" --ja || fehler "Sicherung fehlgeschlagen – Update abgebrochen, nichts geändert."

# ---------- 2. Neue Dateien ----------
if [ "$NUR_BAUEN" = "1" ]; then
	info "Schritt 2: Dateien bleiben unverändert (--nur-neu-bauen)."
elif [ -n "$PAKET" ]; then
	[ -f "$PAKET" ] || fehler "Paket nicht gefunden: $PAKET"
	PAKET="$(cd "$(dirname "$PAKET")" && pwd)/$(basename "$PAKET")"
	info "Schritt 2: Neue Version aus Paket $(basename "$PAKET") …"
	if [ -f "$PAKET.sha256" ]; then
		( cd "$(dirname "$PAKET")" && sha256sum -c --quiet "$(basename "$PAKET").sha256" ) \
			|| fehler "Prüfsumme des Pakets stimmt nicht – Paket beschädigt. Nichts geändert."
		ok "Prüfsumme in Ordnung."
	fi
	ENTPACKT="$(mktemp -d)"
	trap 'rm -rf "$ENTPACKT"' EXIT
	case "$PAKET" in
		*.zip) command -v unzip > /dev/null || fehler "unzip fehlt (sudo apt-get install -y unzip)."; unzip -q "$PAKET" -d "$ENTPACKT" ;;
		*) tar -xzf "$PAKET" -C "$ENTPACKT" ;;
	esac
	NEU="$(dirname "$(find "$ENTPACKT" -maxdepth 3 -path '*/installation/docker-compose.yml' | head -n 1)")"
	[ -n "$NEU" ] && [ "$NEU" != "." ] || fehler "Im Paket fehlt der Ordner installation/ – falsches Paket?"
	NEU="$(dirname "$NEU")"
	SICHERUNG_REL="${CRM_SICHERUNG_ORDNER#"$QUELL_ORDNER"/}"
	AUSNAHMEN=(--exclude "/installation/.env" --exclude "/installation/sicherungen/" --exclude "/installation/erstes-admin-passwort.txt"
		--exclude "/.git/" --exclude "/dist-paket/" --exclude "/$SICHERUNG_REL/")
	if command -v rsync > /dev/null 2>&1; then
		rsync -a --delete "${AUSNAHMEN[@]}" "$NEU/" "$QUELL_ORDNER/"
	else
		warnung "rsync fehlt – kopiere ohne Aufräumen alter Dateien."
		cp -a "$NEU/." "$QUELL_ORDNER/"
	fi
	ok "Neue Dateien übernommen ($(cat "$QUELL_ORDNER/VERSION" 2>/dev/null || echo 'Version unbekannt'))."
elif git -C "$QUELL_ORDNER" rev-parse --is-inside-work-tree > /dev/null 2>&1; then
	info "Schritt 2: Neue Version aus Git holen …"
	git -C "$QUELL_ORDNER" pull --ff-only || fehler "git pull fehlgeschlagen (lokale Änderungen?). Sicherung liegt in $CRM_SICHERUNG_ORDNER."
	ok "Stand jetzt: $(git -C "$QUELL_ORDNER" log --oneline -1)"
else
	fehler "Woher soll die neue Version kommen? Paket angeben: ./5-aktualisieren.sh crm-system-….tar.gz"
fi

# ---------- Neue Einstellungen ergänzen ----------
while IFS= read -r zeile; do
	name="${zeile%%=*}"; wert="${zeile#*=}"
	[[ "$name" =~ ^[A-Z_][A-Z0-9_]*$ ]] || continue
	grep -q "^${name}=" "$ENV_DATEI" && continue
	if [ -z "$wert" ] && [[ "$name" =~ (PASSWORT|GEHEIMNIS) ]]; then wert="$(zufall 32)"; fi
	setze_env "$name" "$wert"
	warnung "Neue Einstellung ergänzt: $name (bitte in .env prüfen)"
done < <(grep -E '^[A-Z_][A-Z0-9_]*=' "$INSTALL_ORDNER/.env.beispiel")
lade_env

# ---------- 3. Bauen ----------
info "Schritt 3: Neu bauen (dauert einige Minuten) …"
dc build --pull
ok "Gebaut."

# ---------- 4. Neu starten ----------
info "Schritt 4: Neu starten und Datenbank aktualisieren …"
dc up -d --remove-orphans || { dc logs --tail 40 migration app >&2 || true; fehler "Start fehlgeschlagen. Zurück zum alten Stand: Dateien zurückholen und ./7-sicherung-wiederherstellen.sh"; }
info "Migration: $(dc logs --no-log-prefix migration 2>/dev/null | tail -n 1)"
warte_auf_app || fehler "Das CRM startet nicht. Details: ./8-status-und-logs.sh"
"${DOCKER[@]}" image prune -f > /dev/null 2>&1 || true
ok "Update fertig: $(adresse_anzeigen)"
