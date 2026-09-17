-- Resultado guardado de «Revisar la semana» (no volver a cobrar una revision que no llego).
-- Aditiva: tabla nueva, no toca datos existentes.
-- Reversion: DROP TABLE "RevisionAgenda";

-- CreateTable
CREATE TABLE "RevisionAgenda" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "semana" TEXT NOT NULL,
    "huella" TEXT NOT NULL,
    "contenido" TEXT NOT NULL,
    "costoUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reutilizaciones" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevisionAgenda_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RevisionAgenda_organizationId_semana_huella_idx" ON "RevisionAgenda"("organizationId", "semana", "huella");

-- AddForeignKey
ALTER TABLE "RevisionAgenda" ADD CONSTRAINT "RevisionAgenda_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

