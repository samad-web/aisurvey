# syntax=docker/dockerfile:1.7
#
# Standalone Vite SPA for the LexDraft practitioner study. Two stages:
# Node-22 to compile, nginx:alpine to serve. The runner image carries no
# Node toolchain - just hashed static assets and an SPA-aware nginx conf.
#
#   docker build -t lexdraft-survey:local .

# --- Stage 1: build -------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Manifests first for layer caching.
COPY package.json package-lock.json* ./
RUN npm ci || npm install

# Source.
COPY . .

# Empty default means the SPA calls /api on its own origin (reverse proxy
# fronts both UI + API on the same host). Override at build for split-origin.
ARG VITE_API_URL=""
ENV VITE_API_URL=${VITE_API_URL}

RUN npm run build

# --- Stage 2: runner ------------------------------------------------------
FROM nginx:1.27-alpine AS runner

COPY nginx.conf /etc/nginx/conf.d/default.conf
RUN rm -rf /usr/share/nginx/html/*
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --spider -q http://localhost/ || exit 1
