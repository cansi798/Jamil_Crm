#!/usr/bin/env bash
# =====================================================================================
#  9-deinstallieren.sh – CRM von diesem Server entfernen
# -------------------------------------------------------------------------------------
#  Erstellt zuerst eine letzte Sicherung, dann werden alle Dienste, die Datenbank und die
#  gebauten Programme entfernt. Die SICHERUNGEN und die Einstellungen (.env) bleiben im
#  Ordner liegen – damit kann man später alles wiederherstellen.
#  Fragt vorher nach einer Bestätigung (Projektname eintippen).
#
#  Aufruf:  ./9-deinstallieren.sh
#           ./9-deinstallieren.sh --ja                   (ohne Rückfrage, z. B. für Tests)
#           ./9-deinstallieren.sh --ohne-letzte-sicherung
# =====================================================================================
source "$(dirname "$0")/hilfe/gemeinsam.sh"
lade_env
waehle_docker

titel "CRM deinstallieren: $CRM_PROJEKT"
warnung "Das entfernt das CRM und die Datenbank von diesem Server. Sicherungen bleiben erhalten."
if [ "$CRM_UNBEAUFSICHTIGT" != "1" ]; then
	EINGABE="$(frage_text "Zum Bestätigen den Namen der Installation eintippen ($CRM_PROJEKT)" "")"
	[ "$EINGABE" = "$CRM_PROJEKT" ] || fehler "Abgebrochen – nichts geändert."
fi

if [[ " $* " != *" --ohne-letzte-sicherung "* ]]; then
	info "Letzte Sicherung …"
	"$INSTALL_ORDNER/6-sicherung-erstellen.sh" --ja || {
		frage_ja_nein "Letzte Sicherung fehlgeschlagen. Trotzdem deinstallieren?" "n" || fehler "Abgebrochen – nichts geändert."
	}
fi

info "Entferne Dienste, Datenbank und Programm-Abbilder …"
dc --profile https --profile sprache down -v --rmi local --remove-orphans
"${DOCKER[@]}" image rm "${CRM_PROJEKT}-app:aktuell" "${CRM_PROJEKT}-sprache:aktuell" > /dev/null 2>&1 || true
CRON_DATEI="/etc/cron.d/crm-sicherung-${CRM_PROJEKT}"
if [ -f "$CRON_DATEI" ]; then
	SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
	$SUDO rm -f "$CRON_DATEI" && info "Tägliche Sicherung abgeschaltet."
fi
ok "Deinstalliert."
info "Sicherungen liegen weiter in: $CRM_SICHERUNG_ORDNER"
info "Einstellungen (.env) liegen weiter in: $ENV_DATEI"
info "Wer alles löschen will, löscht danach den ganzen Ordner $QUELL_ORDNER."
