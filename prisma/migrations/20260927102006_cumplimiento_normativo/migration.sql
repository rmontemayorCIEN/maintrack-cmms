-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "codigoFormatoOT" TEXT,
ADD COLUMN     "revisionFormatoOT" TEXT;

-- CreateTable
CREATE TABLE "NormaAdoptada" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "emisor" TEXT,
    "resumen" TEXT,
    "fueraDeAlcance" TEXT,
    "origen" TEXT NOT NULL DEFAULT 'CATALOGO',
    "versionAdoptada" INTEGER NOT NULL DEFAULT 0,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "responsableId" TEXT,
    "nota" TEXT,
    "adoptadaEl" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NormaAdoptada_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObligacionAdoptada" (
    "id" TEXT NOT NULL,
    "normaId" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "detalle" TEXT,
    "tipo" TEXT NOT NULL,
    "cadaDias" INTEGER,
    "evidencia" TEXT,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "aplica" BOOLEAN NOT NULL DEFAULT true,
    "razonNoAplica" TEXT,
    "responsableId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ObligacionAdoptada_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmarreDeCumplimiento" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "obligacionId" TEXT NOT NULL,
    "planId" TEXT,
    "vigenciaId" TEXT,
    "tablaId" TEXT,
    "rondinId" TEXT,
    "ordenId" TEXT,
    "nota" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AmarreDeCumplimiento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NormaAdoptada_organizationId_activa_idx" ON "NormaAdoptada"("organizationId", "activa");

-- CreateIndex
CREATE UNIQUE INDEX "NormaAdoptada_organizationId_clave_key" ON "NormaAdoptada"("organizationId", "clave");

-- CreateIndex
CREATE INDEX "ObligacionAdoptada_normaId_aplica_idx" ON "ObligacionAdoptada"("normaId", "aplica");

-- CreateIndex
CREATE UNIQUE INDEX "ObligacionAdoptada_normaId_clave_key" ON "ObligacionAdoptada"("normaId", "clave");

-- CreateIndex
CREATE INDEX "AmarreDeCumplimiento_obligacionId_idx" ON "AmarreDeCumplimiento"("obligacionId");

-- CreateIndex
CREATE INDEX "AmarreDeCumplimiento_organizationId_idx" ON "AmarreDeCumplimiento"("organizationId");

-- CreateIndex
CREATE INDEX "AmarreDeCumplimiento_planId_idx" ON "AmarreDeCumplimiento"("planId");

-- AddForeignKey
ALTER TABLE "NormaAdoptada" ADD CONSTRAINT "NormaAdoptada_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NormaAdoptada" ADD CONSTRAINT "NormaAdoptada_responsableId_fkey" FOREIGN KEY ("responsableId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObligacionAdoptada" ADD CONSTRAINT "ObligacionAdoptada_normaId_fkey" FOREIGN KEY ("normaId") REFERENCES "NormaAdoptada"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObligacionAdoptada" ADD CONSTRAINT "ObligacionAdoptada_responsableId_fkey" FOREIGN KEY ("responsableId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmarreDeCumplimiento" ADD CONSTRAINT "AmarreDeCumplimiento_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmarreDeCumplimiento" ADD CONSTRAINT "AmarreDeCumplimiento_obligacionId_fkey" FOREIGN KEY ("obligacionId") REFERENCES "ObligacionAdoptada"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmarreDeCumplimiento" ADD CONSTRAINT "AmarreDeCumplimiento_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MaintenancePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmarreDeCumplimiento" ADD CONSTRAINT "AmarreDeCumplimiento_vigenciaId_fkey" FOREIGN KEY ("vigenciaId") REFERENCES "Vigencia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmarreDeCumplimiento" ADD CONSTRAINT "AmarreDeCumplimiento_tablaId_fkey" FOREIGN KEY ("tablaId") REFERENCES "TablaPropia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmarreDeCumplimiento" ADD CONSTRAINT "AmarreDeCumplimiento_rondinId_fkey" FOREIGN KEY ("rondinId") REFERENCES "Rondin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmarreDeCumplimiento" ADD CONSTRAINT "AmarreDeCumplimiento_ordenId_fkey" FOREIGN KEY ("ordenId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

