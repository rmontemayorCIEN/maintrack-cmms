-- CreateTable
CREATE TABLE "Observador" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entidad" TEXT NOT NULL,
    "entidadId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Observador_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Compromiso" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "responsableId" TEXT,
    "creadoPorId" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'ABIERTO',
    "paraCuando" TIMESTAMP(3),
    "cerradoEl" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entidad" TEXT NOT NULL,
    "entidadId" TEXT NOT NULL,

    CONSTRAINT "Compromiso_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Observador_organizationId_entidad_entidadId_idx" ON "Observador"("organizationId", "entidad", "entidadId");

-- CreateIndex
CREATE UNIQUE INDEX "Observador_userId_entidad_entidadId_key" ON "Observador"("userId", "entidad", "entidadId");

-- CreateIndex
CREATE INDEX "Compromiso_organizationId_entidad_entidadId_idx" ON "Compromiso"("organizationId", "entidad", "entidadId");

-- CreateIndex
CREATE INDEX "Compromiso_organizationId_estado_idx" ON "Compromiso"("organizationId", "estado");

-- CreateIndex
CREATE INDEX "Compromiso_responsableId_estado_idx" ON "Compromiso"("responsableId", "estado");

-- AddForeignKey
ALTER TABLE "Observador" ADD CONSTRAINT "Observador_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Observador" ADD CONSTRAINT "Observador_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Compromiso" ADD CONSTRAINT "Compromiso_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Compromiso" ADD CONSTRAINT "Compromiso_responsableId_fkey" FOREIGN KEY ("responsableId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Compromiso" ADD CONSTRAINT "Compromiso_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

