-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "terminoConjunto" TEXT,
ADD COLUMN     "terminoConjuntoPlural" TEXT;

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "independiente" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Conjunto" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "descripcion" TEXT,
    "responsableId" TEXT,
    "origen" TEXT NOT NULL DEFAULT 'MANUAL',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conjunto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConjuntoAsset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conjuntoId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "planoX" INTEGER,
    "planoY" INTEGER,
    "planoAncho" INTEGER NOT NULL DEFAULT 3,
    "planoAlto" INTEGER NOT NULL DEFAULT 2,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConjuntoAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Conjunto_organizationId_idx" ON "Conjunto"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Conjunto_organizationId_code_key" ON "Conjunto"("organizationId", "code");

-- CreateIndex
CREATE INDEX "ConjuntoAsset_organizationId_idx" ON "ConjuntoAsset"("organizationId");

-- CreateIndex
CREATE INDEX "ConjuntoAsset_assetId_idx" ON "ConjuntoAsset"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "ConjuntoAsset_conjuntoId_assetId_key" ON "ConjuntoAsset"("conjuntoId", "assetId");

-- AddForeignKey
ALTER TABLE "Conjunto" ADD CONSTRAINT "Conjunto_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conjunto" ADD CONSTRAINT "Conjunto_responsableId_fkey" FOREIGN KEY ("responsableId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConjuntoAsset" ADD CONSTRAINT "ConjuntoAsset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConjuntoAsset" ADD CONSTRAINT "ConjuntoAsset_conjuntoId_fkey" FOREIGN KEY ("conjuntoId") REFERENCES "Conjunto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConjuntoAsset" ADD CONSTRAINT "ConjuntoAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

