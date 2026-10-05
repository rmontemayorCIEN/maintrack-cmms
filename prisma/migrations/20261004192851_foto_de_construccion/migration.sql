-- CreateTable
CREATE TABLE "FotoDeConstruccion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "semana" TEXT NOT NULL,
    "planes" INTEGER NOT NULL,
    "listos" INTEGER NOT NULL,
    "enForma" INTEGER NOT NULL,
    "esqueleto" INTEGER NOT NULL,
    "sugeridos" INTEGER NOT NULL,
    "meta" INTEGER NOT NULL,
    "equiposTotal" INTEGER NOT NULL,
    "equiposCubiertos" INTEGER NOT NULL,
    "tomadaEl" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FotoDeConstruccion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FotoDeConstruccion_organizationId_idx" ON "FotoDeConstruccion"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "FotoDeConstruccion_organizationId_semana_key" ON "FotoDeConstruccion"("organizationId", "semana");

-- AddForeignKey
ALTER TABLE "FotoDeConstruccion" ADD CONSTRAINT "FotoDeConstruccion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

