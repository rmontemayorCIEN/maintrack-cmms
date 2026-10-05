-- CreateTable
CREATE TABLE "GrupoDeEquipo" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "movidoPorId" TEXT,
    "movidoEl" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrupoDeEquipo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GrupoDeEquipo_assetId_key" ON "GrupoDeEquipo"("assetId");

-- CreateIndex
CREATE INDEX "GrupoDeEquipo_organizationId_idx" ON "GrupoDeEquipo"("organizationId");

-- AddForeignKey
ALTER TABLE "GrupoDeEquipo" ADD CONSTRAINT "GrupoDeEquipo_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrupoDeEquipo" ADD CONSTRAINT "GrupoDeEquipo_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

