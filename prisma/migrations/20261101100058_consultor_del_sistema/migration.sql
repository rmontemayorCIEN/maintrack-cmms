-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "consultorActivo" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ConsultorEstado" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pasoActual" TEXT,
    "resumen" TEXT NOT NULL DEFAULT '',
    "ultimaVez" TIMESTAMP(3),
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsultorEstado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsultorNota" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "apagadaEn" TIMESTAMP(3),

    CONSTRAINT "ConsultorNota_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsultorMensaje" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "de" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "clase" TEXT,
    "enlace" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsultorMensaje_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConsultorEstado_organizationId_userId_key" ON "ConsultorEstado"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "ConsultorNota_organizationId_activa_idx" ON "ConsultorNota"("organizationId", "activa");

-- CreateIndex
CREATE INDEX "ConsultorMensaje_organizationId_userId_creadoEn_idx" ON "ConsultorMensaje"("organizationId", "userId", "creadoEn");

-- CreateIndex
CREATE INDEX "ConsultorMensaje_creadoEn_idx" ON "ConsultorMensaje"("creadoEn");

-- AddForeignKey
ALTER TABLE "ConsultorEstado" ADD CONSTRAINT "ConsultorEstado_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultorNota" ADD CONSTRAINT "ConsultorNota_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultorMensaje" ADD CONSTRAINT "ConsultorMensaje_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

