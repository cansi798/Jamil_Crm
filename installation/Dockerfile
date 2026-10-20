# CRM-System – Bauanleitung für das Programm-Abbild (Docker-Image)
#
# Wird von docker-compose.yml benutzt (Baukontext: der Ordner ÜBER installation/, also der ganze Quellcode).
# Zwei Stufen:
#   1. „bauen“:   alle Pakete installieren und die Anwendung bauen (npm ci + npm run build)
#   2. „betrieb“: nur das Nötige für den Betrieb – gebaute Anwendung, Laufzeit-Pakete, Migrationen und die
#                 Hilfsskripte für Migration und ersten Admin (laufen mit tsx, das eine normale Abhängigkeit ist)
#
# Welche Dateien NICHT in den Baukontext kommen, steht in Dockerfile.dockerignore (gleicher Ordner).

# ---------- Stufe 1: bauen ----------
FROM node:22-bookworm-slim AS bauen
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build \
	&& npm prune --omit=dev

# ---------- Stufe 2: betrieb ----------
FROM node:22-bookworm-slim AS betrieb
WORKDIR /app
ENV NODE_ENV=production \
	NPM_CONFIG_UPDATE_NOTIFIER=false \
	HOST=0.0.0.0 \
	PORT=3000 \
	BODY_SIZE_LIMIT=6M

# curl nur für den Gesundheits-Check des Containers
RUN apt-get update \
	&& apt-get install -y --no-install-recommends curl ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

COPY --from=bauen --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=bauen --chown=node:node /app/node_modules ./node_modules
COPY --from=bauen --chown=node:node /app/build ./build
# Für Migration (scripts/migrate.ts) und ersten Admin (scripts/admin-anlegen.ts → src/lib/server/auth/passwort.ts)
COPY --from=bauen --chown=node:node /app/db ./db
COPY --from=bauen --chown=node:node /app/scripts ./scripts
COPY --from=bauen --chown=node:node /app/src/lib/server/auth/passwort.ts ./src/lib/server/auth/passwort.ts
COPY --from=bauen --chown=node:node /app/tsconfig.json ./tsconfig.json

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
	CMD curl -fs http://127.0.0.1:3000/api/gesundheit > /dev/null || exit 1
CMD ["node", "build"]
