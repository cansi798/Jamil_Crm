#!/bin/sh
# Startet die Vorschau (Produktions-Build, `node build`) im Container crm-dev auf 0.0.0.0:3000,
# vom Host erreichbar unter http://127.0.0.1:8300. Läuft im Hintergrund weiter; Log: vorschau.log.
#
# Aufruf auf dem Host:
#   sudo docker exec crm-dev sh -lc 'cd /work/crm && sh scripts/start-vorschau.sh'
#
# Ablauf: Datenbank migrieren → bauen → alte Vorschau beenden → neu starten → auf /api/gesundheit warten.
# Entwicklungsdaten (Betrieb Bauwelt, Benutzer) legt `npm run seed:dev` an (einmalig, idempotent).
set -eu

# Nur EIN Vorschau-Start gleichzeitig: parallele Builds überschreiben sonst gegenseitig build/ (ERR_MODULE_NOT_FOUND).
# Wartet bis zu 15 Minuten auf einen laufenden Start.
if command -v flock >/dev/null 2>&1 && [ -z "${VORSCHAU_SPERRE:-}" ]; then
	export VORSCHAU_SPERRE=1
	# -o: Die Sperre hält nur flock selbst; der gestartete Server erbt sie nicht (sonst bliebe sie, solange die Vorschau läuft)
	exec flock -o -w 900 /tmp/crm-vorschau.lock sh "$0" "$@"
fi

cd "$(dirname "$0")/.."
VERZEICHNIS=$(pwd)
LOG="$VERZEICHNIS/vorschau.log"
PIDDATEI="$VERZEICHNIS/.vorschau.pid"

# .env (Passwörter der Rollen) laden, ohne bereits gesetzte Variablen zu verlieren
if [ -f .env ]; then
	set -a
	. ./.env
	set +a
fi

echo "Migriere Datenbank …"
npm run --silent migrate

echo "Baue Anwendung …"
BAULOG=$(mktemp)
if ! npm run --silent build > "$BAULOG" 2>&1; then
	tail -n 40 "$BAULOG" >&2
	rm -f "$BAULOG"
	echo "Bauen fehlgeschlagen – alte Vorschau läuft unverändert weiter." >&2
	exit 1
fi
rm -f "$BAULOG"

# Alte Vorschau beenden (zuerst über die PID-Datei, dann jeden übrigen „node build“-Prozess im Container)
if [ -f "$PIDDATEI" ]; then
	kill "$(cat "$PIDDATEI")" 2>/dev/null || true
	rm -f "$PIDDATEI"
fi
pkill -f '^node build$' 2>/dev/null || true
i=0
while pgrep -f '^node build$' > /dev/null 2>&1 && [ $i -lt 20 ]; do
	sleep 0.5
	i=$((i + 1))
done
# Wer nach 10 Sekunden noch läuft, wird hart beendet (sonst blieben alte Prozesse liegen).
pkill -9 -f '^node build$' 2>/dev/null || true

# Öffentliche Adresse für die CSRF-Prüfung: Standard lokal; hinter dem Proxy z. B.
#   VORSCHAU_ORIGIN=https://crm.waybuild-software.de sh scripts/start-vorschau.sh
ORIGIN_VORSCHAU="${VORSCHAU_ORIGIN:-http://127.0.0.1:8300}"
echo "Starte Vorschau (ORIGIN $ORIGIN_VORSCHAU) …"
# Die Anwendung läuft nie als Superuser: PGUSER/PGPASSWORD werden entfernt; die Verbindungen ergeben sich aus
# DATABASE_URL_APP/ADMIN/AUTH bzw. PGHOST/PGPORT/PGDATABASE + CRM_*_PASSWORT (siehe src/lib/server/db.ts).
# BODY_SIZE_LIMIT: 6 MB – Audio-Uploads (5 MB) + etwas Platz für JSON-Metadaten (Logo 1 MB).
# ADDRESS_HEADER/XFF_DEPTH: echte Besucher-IP hinter dem Proxy (Spam-Schutz der Online-Buchung); ohne Kopfzeile
# (direkt auf Port 8300) gilt „unbekannt“.
# exec ersetzt die Hilfs-Shell durch node – so ist die notierte PID die des Servers.
nohup setsid sh -c 'echo $$ > "$1"; exec env -u PGUSER -u PGPASSWORD \
	NODE_ENV=production HOST=0.0.0.0 PORT=3000 ORIGIN="$2" BODY_SIZE_LIMIT=6M \
	ADDRESS_HEADER=X-Forwarded-For XFF_DEPTH=1 node build' \
	vorschau "$PIDDATEI" "$ORIGIN_VORSCHAU" > "$LOG" 2>&1 < /dev/null &

i=0
until curl -fs http://127.0.0.1:3000/api/gesundheit > /dev/null 2>&1; do
	i=$((i + 1))
	if [ $i -gt 60 ]; then
		echo "Vorschau antwortet nicht – siehe $LOG" >&2
		tail -n 20 "$LOG" >&2 || true
		exit 1
	fi
	sleep 0.5
done
echo "Vorschau läuft: $ORIGIN_VORSCHAU (im Container Port 3000, vom Host http://127.0.0.1:8300; Log: vorschau.log)"
