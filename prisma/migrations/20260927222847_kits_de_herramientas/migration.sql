-- AlterTable
ALTER TABLE "Resguardo" ADD COLUMN     "grupo" TEXT,
ADD COLUMN     "kitId" TEXT;

-- CreateTable
CREATE TABLE "KitDeHerramientas" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notas" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KitDeHerramientas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PiezaDeKit" (
    "id" TEXT NOT NULL,
    "kitId" TEXT NOT NULL,
    "partId" TEXT,
    "assetId" TEXT,
    "cantidad" DOUBLE PRECISION NOT NULL DEFAULT 1,

    CONSTRAINT "PiezaDeKit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KitDeHerramientas_organizationId_activo_idx" ON "KitDeHerramientas"("organizationId", "activo");

-- CreateIndex
CREATE UNIQUE INDEX "KitDeHerramientas_organizationId_code_key" ON "KitDeHerramientas"("organizationId", "code");

-- CreateIndex
CREATE INDEX "PiezaDeKit_kitId_idx" ON "PiezaDeKit"("kitId");

-- CreateIndex
CREATE INDEX "Resguardo_grupo_idx" ON "Resguardo"("grupo");

-- AddForeignKey
ALTER TABLE "Resguardo" ADD CONSTRAINT "Resguardo_kitId_fkey" FOREIGN KEY ("kitId") REFERENCES "KitDeHerramientas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitDeHerramientas" ADD CONSTRAINT "KitDeHerramientas_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PiezaDeKit" ADD CONSTRAINT "PiezaDeKit_kitId_fkey" FOREIGN KEY ("kitId") REFERENCES "KitDeHerramientas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PiezaDeKit" ADD CONSTRAINT "PiezaDeKit_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PiezaDeKit" ADD CONSTRAINT "PiezaDeKit_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

