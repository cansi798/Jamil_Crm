#!/bin/sh
# Eigener Testserver für die Browser-Tests (E2E) – mit EIGENER Datenbank, damit Testdaten nie in der Vorschau landen
# (Jamil msgs 3075/3076: „E2E Besichtigung …“-Reste in der Vorschau). Die Vorschau (scripts/start-vorschau.sh,
# Datenbank „crm“) bleibt unberührt.
#
# Aufruf in einem EIGENEN Container mit eigenem Checkout (nicht in crm-dev, sonst kämen sich Build-Ordner und
# Server in die Quere), z. B.:
#   sudo docker run -d --name crm-e2e --network crm-sandbox_crm-aussen -p 127.0.0.1:8310:3000 \
#     -e PGHOST=crm-db -e PGUSER=crm -e PGPASSWORD=… -e PGDATABASE=crm_e2e \
#     -v /pfad/zum/checkout:/work/crm -w /work/crm node:22-bookworm sleep infinity
#   sudo docker exec crm-e2e sh -lc 'npm ci && sh scripts/start-testserver.sh'
# Danach laufen die Browser-Tests ohne weitere Angabe gegen http://127.0.0.1:8310 (playwright.config.ts).
#
# Ablauf: Datenbank anlegen (falls nötig) → migrieren → Beispieldaten + Test-Zugänge → bauen → alten Testserver
# beenden → neu starten (Testmodus an) → auf /api/gesundheit warten.
set -eu

cd "$(dirname "$0")/.."
VERZEICHNIS=$(pwd)
LOG="$VERZEICHNIS/testserver.log"
PIDDATEI="$VERZEICHNIS/.testserver.pid"

if [ -f .env ]; then
	set -a
	. ./.env
	set +a
fi

DB="${TESTSERVER_DB:-${PGDATABASE:-}}"
if [ -z "$DB" ] || [ "$DB" = "crm" ]; then
	echo "Abbruch: Der Testserver braucht eine eigene Datenbank (TESTSERVER_DB bzw. PGDATABASE, nicht „crm“ – das ist die Vorschau)." >&2
	exit 1
fi
export PGDATABASE="$DB"
PORT_INTERN="${TESTSERVER_PORT:-3000}"
ORIGIN_TEST="${TESTSERVER_ORIGIN:-http://127.0.0.1:8310}"

echo "Datenbank „$DB“ anlegen (falls nötig) …"
node --input-type=module -e "
import postgres from 'postgres';
const sql = postgres({ database: 'postgres', max: 1, onnotice: () => {} });
const [d] = await sql\`select 1 from pg_database where datname = \${process.env.PGDATABASE}\`;
if (!d) await sql.unsafe('create database ' + process.env.PGDATABASE.replace(/[^a-z0-9_]/g, ''));
await sql.end();
"

echo "Migriere …"
npm run --silent migrate
echo "Beispieldaten und Test-Zugänge …"
npm run --silent seed:dev -- --erlaube-db="$DB" > /dev/null
npx tsx scripts/testzugaenge.ts --erlaube-db="$DB" > /dev/null

echo "Baue Anwendung …"
BAULOG=$(mktemp)
if ! npm run --silent build > "$BAULOG" 2>&1; then
	tail -n 40 "$BAULOG" >&2
	rm -f "$BAULOG"
	echo "Bauen fehlgeschlagen." >&2
	exit 1
fi
rm -f "$BAULOG"

# Alten Testserver beenden – nur über die eigene PID-Datei (nie fremde „node build“-Prozesse)
if [ -f "$PIDDATEI" ]; then
	kill "$(cat "$PIDDATEI")" 2>/dev/null || true
	rm -f "$PIDDATEI"
	sleep 1
fi

echo "Starte Testserver (ORIGIN $ORIGIN_TEST, Datenbank $DB, Testmodus an) …"
nohup setsid sh -c 'echo $$ > "$1"; exec env -u PGUSER -u PGPASSWORD \
	NODE_ENV=production HOST=0.0.0.0 PORT="$2" ORIGIN="$3" BODY_SIZE_LIMIT=6M CRM_TESTMODUS=1 node build' \
	testserver "$PIDDATEI" "$PORT_INTERN" "$ORIGIN_TEST" > "$LOG" 2>&1 < /dev/null &

i=0
until curl -fs "http://127.0.0.1:$PORT_INTERN/api/gesundheit" > /dev/null 2>&1; do
	i=$((i + 1))
	if [ $i -gt 60 ]; then
		echo "Testserver antwortet nicht – siehe $LOG" >&2
		tail -n 20 "$LOG" >&2 || true
		exit 1
	fi
	sleep 0.5
done
echo "Testserver läuft: $ORIGIN_TEST (Log: testserver.log)"
