-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "registrosPropios" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "TablaPropia" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "icono" TEXT,
    "permiso" TEXT NOT NULL DEFAULT 'workorder:execute',
    "rolesVer" TEXT NOT NULL DEFAULT 'OWNER,ADMIN,SUPERVISOR,TECHNICIAN,VIEWER',
    "plantilla" TEXT,
    "consecutivo" INTEGER NOT NULL DEFAULT 0,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "creadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TablaPropia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampoPropio" (
    "id" TEXT NOT NULL,
    "tablaId" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "etiqueta" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "descripcion" TEXT,
    "requerido" BOOLEAN NOT NULL DEFAULT false,
    "opciones" TEXT,
    "enLista" BOOLEAN NOT NULL DEFAULT true,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampoPropio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RenglonPropio" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tablaId" TEXT NOT NULL,
    "folio" INTEGER NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RenglonPropio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValorPropio" (
    "id" TEXT NOT NULL,
    "renglonId" TEXT NOT NULL,
    "campoId" TEXT NOT NULL,
    "texto" TEXT,
    "numero" DOUBLE PRECISION,
    "fecha" TIMESTAMP(3),
    "booleano" BOOLEAN,
    "refId" TEXT,

    CONSTRAINT "ValorPropio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TablaPropia_organizationId_activa_idx" ON "TablaPropia"("organizationId", "activa");

-- CreateIndex
CREATE UNIQUE INDEX "TablaPropia_organizationId_clave_key" ON "TablaPropia"("organizationId", "clave");

-- CreateIndex
CREATE INDEX "CampoPropio_tablaId_activo_idx" ON "CampoPropio"("tablaId", "activo");

-- CreateIndex
CREATE UNIQUE INDEX "CampoPropio_tablaId_clave_key" ON "CampoPropio"("tablaId", "clave");

-- CreateIndex
CREATE INDEX "RenglonPropio_organizationId_tablaId_activo_idx" ON "RenglonPropio"("organizationId", "tablaId", "activo");

-- CreateIndex
CREATE UNIQUE INDEX "RenglonPropio_tablaId_folio_key" ON "RenglonPropio"("tablaId", "folio");

-- CreateIndex
CREATE INDEX "ValorPropio_campoId_refId_idx" ON "ValorPropio"("campoId", "refId");

-- CreateIndex
CREATE INDEX "ValorPropio_campoId_numero_idx" ON "ValorPropio"("campoId", "numero");

-- CreateIndex
CREATE INDEX "ValorPropio_campoId_fecha_idx" ON "ValorPropio"("campoId", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "ValorPropio_renglonId_campoId_key" ON "ValorPropio"("renglonId", "campoId");

-- AddForeignKey
ALTER TABLE "TablaPropia" ADD CONSTRAINT "TablaPropia_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TablaPropia" ADD CONSTRAINT "TablaPropia_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampoPropio" ADD CONSTRAINT "CampoPropio_tablaId_fkey" FOREIGN KEY ("tablaId") REFERENCES "TablaPropia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenglonPropio" ADD CONSTRAINT "RenglonPropio_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenglonPropio" ADD CONSTRAINT "RenglonPropio_tablaId_fkey" FOREIGN KEY ("tablaId") REFERENCES "TablaPropia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenglonPropio" ADD CONSTRAINT "RenglonPropio_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValorPropio" ADD CONSTRAINT "ValorPropio_renglonId_fkey" FOREIGN KEY ("renglonId") REFERENCES "RenglonPropio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValorPropio" ADD CONSTRAINT "ValorPropio_campoId_fkey" FOREIGN KEY ("campoId") REFERENCES "CampoPropio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

