# syntax=docker/dockerfile:1.7
#
# Survey API - Express + Postgres. Two stages: Node-22 to build TypeScript,
# Node-22 slim to run the compiled output.
#
#   docker build -t lexdraft-survey-api:local -f server/Dockerfile .
# (build context = the server directory)

# --- Stage 1: build -------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci || npm install

COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations

RUN npm run build

# Drop dev deps for the runner image.
RUN npm prune --omit=dev

# --- Stage 2: runner ------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist         ./dist
COPY --from=build /app/migrations   ./migrations
COPY --from=build /app/package.json ./package.json

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget --spider -q http://localhost:4000/api/health || exit 1

CMD ["node", "dist/index.js"]
