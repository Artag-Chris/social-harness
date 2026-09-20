# syntax=docker/dockerfile:1
# social-harness API — mismo patrón multi-stage que atiende/cv-harness.
FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache curl openssl
COPY package*.json ./

FROM base AS development
# NODE_ENV puede venir "production" del host; forzamos development para que
# npm install traiga devDependencies (nest, prisma CLI, ts-node).
ENV NODE_ENV=development
RUN npm install
COPY . .
RUN npx prisma generate
EXPOSE 3200
# En cada boot: asegura la base (+ extensión pgvector) + migraciones + seed
# idempotente + hot-reload. No requiere aprovisionamiento manual en el server.
CMD ["sh", "-c", "npx ts-node prisma/ensure-database.ts && npx prisma migrate deploy && npx ts-node prisma/seed.ts && npm run start:dev"]

FROM base AS builder
ENV NODE_ENV=development
RUN npm install
COPY . .
RUN npx prisma generate && npm run build

FROM base AS production
RUN npm install --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY prisma ./prisma
ENV NODE_ENV=production
EXPOSE 3200
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD curl -f http://localhost:$${PORT:-3200}/api/health || exit 1
USER node
CMD ["node", "dist/main"]
