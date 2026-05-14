# =============================================================================
# audit-hub Dockerfile — multi-stage build
# Stage 1: deps      (install production dependencies)
# Stage 2: builder   (compile TypeScript)
# Stage 3: runner    (lean production image)
# =============================================================================

# ── Stage 1: deps ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

# OpenSSL is required by Prisma's query engine
RUN apk add --no-cache openssl

COPY package*.json ./
RUN npm ci --omit=dev

# ── Stage 2: builder ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache openssl

COPY package*.json tsconfig.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY src ./src
RUN npm run build

# ── Stage 3: runner ───────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

RUN apk add --no-cache openssl && \
    addgroup -S appgroup && \
    adduser  -S appuser -G appgroup

COPY --from=deps    /app/node_modules ./node_modules
COPY --from=builder /app/dist         ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY package.json ./
COPY prisma ./prisma

USER appuser

EXPOSE 3003

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3003/health/live || exit 1

CMD ["node", "dist/index.js"]
