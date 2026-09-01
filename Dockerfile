# ---------- Dependencias ----------
FROM node:22-slim AS deps
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json* ./
COPY prisma ./prisma

# La imagen SIEMPRE corre contra PostgreSQL, sin importar como quedo el esquema
# en la maquina del desarrollador (en local se usa SQLite). Forzarlo aqui elimina
# toda una clase de fallo: desplegar sin acordarse de cambiar el proveedor.
RUN sed -i 's/^  provider = "sqlite"/  provider = "postgresql"/' prisma/schema.prisma \
 && grep -q '^  provider = "postgresql"' prisma/schema.prisma \
 && test -f prisma/migrations/00000000000000_init/migration.sql \
 && grep -q 'TIMESTAMP(3)' prisma/migrations/00000000000000_init/migration.sql \
 || (echo "ERROR: el esquema no quedo en PostgreSQL o falta la migracion inicial de PostgreSQL." \
     && echo "       Ejecute ./scripts/use-postgres.sh y vuelva a desplegar." && exit 1)

RUN npm ci

# ---------- Compilacion ----------
FROM node:22-slim AS builder
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN sed -i 's/^  provider = "sqlite"/  provider = "postgresql"/' prisma/schema.prisma \
 && npx prisma generate && npm run build

# ---------- Ejecucion ----------
FROM node:22-slim AS runner
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8080

RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs

# public/ debe existir en el repositorio: Git no versiona carpetas vacias y el
# COPY fallaria al construir desde GitHub. Por eso contiene robots.txt.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
# El motor de consulta de Prisma no siempre lo arrastra el rastreo de Next,
# asi que se copia explicitamente junto con el cliente generado.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma/client ./node_modules/@prisma/client

USER nextjs
EXPOSE 8080
CMD ["node", "server.js"]
