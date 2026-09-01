#!/usr/bin/env bash
# Regresa el proyecto a SQLite para seguir trabajando en la laptop.
# Solo toca la linea del datasource; las migraciones de PostgreSQL se conservan.
set -euo pipefail
cd "$(dirname "$0")/.."
sed -i.bak -E 's/^([[:space:]]+provider[[:space:]]*=[[:space:]]*)"postgresql"/\1"sqlite"/' prisma/schema.prisma
rm -f prisma/schema.prisma.bak
npx prisma generate >/dev/null 2>&1
echo "✓ De vuelta en SQLite. Las migraciones de PostgreSQL se conservan."
