FROM node:24.19.0-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build && npm run build:worker

# Runtime: Next standalone server, non-root.
FROM node:24.19.0-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]

# One-shot migrator: runs as the db owner role, separate from the app.
FROM node:24.19.0-alpine AS migrator
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY migrate.mjs ./
COPY drizzle ./drizzle
USER node
CMD ["node", "migrate.mjs"]

# Bot worker: BullMQ consumer bundled with esbuild; app role only (RLS applies).
FROM node:24.19.0-alpine AS worker
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/dist/worker.mjs ./dist/worker.mjs
USER node
CMD ["node", "dist/worker.mjs"]
