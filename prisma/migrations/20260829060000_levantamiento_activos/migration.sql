-- CreateTable
CREATE TABLE "AssetIntake" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdById" TEXT,
    "descripcion" TEXT NOT NULL,
    "tipo" TEXT,
    "entrevista" TEXT NOT NULL DEFAULT '[]',
    "estado" TEXT NOT NULL DEFAULT 'BORRADOR',
    "notaIa" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aplicadoEl" TIMESTAMP(3),

    CONSTRAINT "AssetIntake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetDraft" (
    "id" TEXT NOT NULL,
    "intakeId" TEXT NOT NULL,
    "sistema" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "categoria" TEXT,
    "criticidad" TEXT NOT NULL DEFAULT 'C',
    "ubicacion" TEXT,
    "cantidad" INTEGER NOT NULL DEFAULT 1,
    "porQue" TEXT,
    "fabricante" TEXT,
    "modelo" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "codigoCreado" TEXT,

    CONSTRAINT "AssetDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssetIntake_organizationId_idx" ON "AssetIntake"("organizationId");

-- CreateIndex
CREATE INDEX "AssetDraft_intakeId_idx" ON "AssetDraft"("intakeId");

-- AddForeignKey
ALTER TABLE "AssetIntake" ADD CONSTRAINT "AssetIntake_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetIntake" ADD CONSTRAINT "AssetIntake_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetDraft" ADD CONSTRAINT "AssetDraft_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "AssetIntake"("id") ON DELETE CASCADE ON UPDATE CASCADE;

