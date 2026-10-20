# CRM-System – Kurzbefehle (gleiche Funktionen wie CRM-Installation.sh)
# Aufruf im Ordner installation/:  make installieren   |  make sicherung   |  make hilfe
.PHONY: hilfe pruefen installieren starten stoppen aktualisieren sicherung wiederherstellen status logs deinstallieren paket

hilfe:
	@echo "make pruefen          – Voraussetzungen prüfen"
	@echo "make installieren     – einmalig installieren"
	@echo "make starten          – starten"
	@echo "make stoppen          – anhalten"
	@echo "make aktualisieren    – Update (mit Sicherung vorher)"
	@echo "make sicherung        – Sicherung erstellen"
	@echo "make wiederherstellen – Sicherung zurückspielen"
	@echo "make status           – Status anzeigen"
	@echo "make logs             – Meldungen live verfolgen"
	@echo "make deinstallieren   – entfernen (Sicherungen bleiben)"
	@echo "make paket            – Paket für einen anderen Server bauen"

pruefen:          ; ./1-voraussetzungen-pruefen.sh
installieren:     ; ./2-installieren.sh
starten:          ; ./3-starten.sh
stoppen:          ; ./4-stoppen.sh
aktualisieren:    ; ./5-aktualisieren.sh
sicherung:        ; ./6-sicherung-erstellen.sh
wiederherstellen: ; ./7-sicherung-wiederherstellen.sh
status:           ; ./8-status-und-logs.sh
logs:             ; ./8-status-und-logs.sh -f
deinstallieren:   ; ./9-deinstallieren.sh
paket:            ; ./paket-erstellen.sh
