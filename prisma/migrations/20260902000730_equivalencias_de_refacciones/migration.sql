-- CreateTable
CREATE TABLE "EquivalenciaRefaccion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "partAId" TEXT NOT NULL,
    "partBId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'EQUIVALENTE',
    "nota" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EquivalenciaRefaccion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EquivalenciaRefaccion_organizationId_idx" ON "EquivalenciaRefaccion"("organizationId");

-- CreateIndex
CREATE INDEX "EquivalenciaRefaccion_partBId_idx" ON "EquivalenciaRefaccion"("partBId");

-- CreateIndex
CREATE UNIQUE INDEX "EquivalenciaRefaccion_partAId_partBId_key" ON "EquivalenciaRefaccion"("partAId", "partBId");

-- AddForeignKey
ALTER TABLE "EquivalenciaRefaccion" ADD CONSTRAINT "EquivalenciaRefaccion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquivalenciaRefaccion" ADD CONSTRAINT "EquivalenciaRefaccion_partAId_fkey" FOREIGN KEY ("partAId") REFERENCES "Part"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquivalenciaRefaccion" ADD CONSTRAINT "EquivalenciaRefaccion_partBId_fkey" FOREIGN KEY ("partBId") REFERENCES "Part"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquivalenciaRefaccion" ADD CONSTRAINT "EquivalenciaRefaccion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

