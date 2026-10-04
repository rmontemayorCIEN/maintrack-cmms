-- CreateTable
CREATE TABLE "Presupuesto" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "centroDeCostoId" TEXT NOT NULL,
    "anio" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "monto" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "nota" TEXT,
    "capturadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Presupuesto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Presupuesto_organizationId_anio_idx" ON "Presupuesto"("organizationId", "anio");

-- CreateIndex
CREATE UNIQUE INDEX "Presupuesto_centroDeCostoId_anio_mes_key" ON "Presupuesto"("centroDeCostoId", "anio", "mes");

-- AddForeignKey
ALTER TABLE "Presupuesto" ADD CONSTRAINT "Presupuesto_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Presupuesto" ADD CONSTRAINT "Presupuesto_centroDeCostoId_fkey" FOREIGN KEY ("centroDeCostoId") REFERENCES "CentroDeCosto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Presupuesto" ADD CONSTRAINT "Presupuesto_capturadoPorId_fkey" FOREIGN KEY ("capturadoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

