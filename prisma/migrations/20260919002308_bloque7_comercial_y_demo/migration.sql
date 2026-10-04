-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "demoRestauradaAt" TIMESTAMP(3),
ADD COLUMN     "demoRestaurandoDesde" TIMESTAMP(3),
ADD COLUMN     "esDemo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "origenAlta" TEXT,
ADD COLUMN     "spSequence" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "terminosAceptadosAt" TIMESTAMP(3),
ADD COLUMN     "terminosAceptadosPor" TEXT,
ADD COLUMN     "terminosVersion" TEXT;

-- CreateTable
CREATE TABLE "Prospecto" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'DEMO',
    "nombre" TEXT NOT NULL,
    "empresa" TEXT NOT NULL,
    "correo" TEXT NOT NULL,
    "telefono" TEXT,
    "tipoInstalacion" TEXT,
    "rangoActivos" TEXT,
    "problema" TEXT,
    "planInteres" TEXT,
    "origen" TEXT NOT NULL DEFAULT 'SITIO',
    "estado" TEXT NOT NULL DEFAULT 'NUEVA',
    "demoRealizadaAt" TIMESTAMP(3),
    "resultado" TEXT,
    "motivoPerdida" TEXT,
    "notas" TEXT,
    "avisoPrivacidad" TEXT NOT NULL,
    "huella" TEXT NOT NULL,
    "organizationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Prospecto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SolicitudSoporte" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "userId" TEXT,
    "asunto" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "severidad" TEXT NOT NULL DEFAULT 'MEDIA',
    "pantalla" TEXT,
    "datosTecnicos" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'RECIBIDA',
    "respuesta" TEXT,
    "primeraRespuestaAt" TIMESTAMP(3),
    "respondidaPorId" TEXT,
    "cerradaAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SolicitudSoporte_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Prospecto_huella_key" ON "Prospecto"("huella");

-- CreateIndex
CREATE INDEX "Prospecto_estado_idx" ON "Prospecto"("estado");

-- CreateIndex
CREATE INDEX "Prospecto_createdAt_idx" ON "Prospecto"("createdAt");

-- CreateIndex
CREATE INDEX "SolicitudSoporte_organizationId_idx" ON "SolicitudSoporte"("organizationId");

-- CreateIndex
CREATE INDEX "SolicitudSoporte_estado_idx" ON "SolicitudSoporte"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "SolicitudSoporte_organizationId_folio_key" ON "SolicitudSoporte"("organizationId", "folio");

-- AddForeignKey
ALTER TABLE "SolicitudSoporte" ADD CONSTRAINT "SolicitudSoporte_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SolicitudSoporte" ADD CONSTRAINT "SolicitudSoporte_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

