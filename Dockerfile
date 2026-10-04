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

# Cloud Build corre en la maquina por omision (e2-medium, 4 GB), y ahi Node se
# auto-limita a ~2 GB de heap. La revision de tipos de Next ya raspa ese techo:
# el 4-oct-2026 el build del PR #11 compilo bien y murio despues, en «Checking
# validity of types», con «JavaScript heap out of memory». Dos builds del mismo
# dia habian pasado, o sea que el pico vive justo en el limite.
#
# Esto es un TECHO, no una reserva: no aparta memoria, solo deja de matar al
# proceso antes de tiempo. Se queda por debajo de los 4 GB de la maquina para
# que no lo mate el kernel. Va SOLO en esta etapa; el runner es otra imagen y
# no lo hereda, que es lo que importa porque el contenedor de Cloud Run tiene
# su propia memoria, mucho mas chica.
ENV NODE_OPTIONS=--max-old-space-size=3072

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
