FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts vitest.config.ts ./
COPY src ./src
RUN npm test && npm run build

FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends gosu tzdata \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
    PORT=7373 \
    HOST=0.0.0.0 \
    CONFIG_DIR=/config \
    WEB_ROOT=/app/dist/web \
    PUID=1000 \
    PGID=1000 \
    TZ=America/New_York

COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

VOLUME ["/config"]
EXPOSE 7373
ENTRYPOINT ["/entrypoint.sh"]
