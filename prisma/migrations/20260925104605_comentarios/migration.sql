-- CreateTable
CREATE TABLE "Comentario" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "autorId" TEXT,
    "texto" TEXT NOT NULL,
    "eliminadoEl" TIMESTAMP(3),
    "editadoEl" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workOrderId" TEXT,
    "assetId" TEXT,
    "workRequestId" TEXT,
    "materialRequestId" TEXT,

    CONSTRAINT "Comentario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComentarioMencion" (
    "id" TEXT NOT NULL,
    "comentarioId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "ComentarioMencion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Comentario_organizationId_idx" ON "Comentario"("organizationId");

-- CreateIndex
CREATE INDEX "Comentario_workOrderId_idx" ON "Comentario"("workOrderId");

-- CreateIndex
CREATE INDEX "Comentario_assetId_idx" ON "Comentario"("assetId");

-- CreateIndex
CREATE INDEX "Comentario_workRequestId_idx" ON "Comentario"("workRequestId");

-- CreateIndex
CREATE INDEX "Comentario_materialRequestId_idx" ON "Comentario"("materialRequestId");

-- CreateIndex
CREATE INDEX "ComentarioMencion_userId_idx" ON "ComentarioMencion"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ComentarioMencion_comentarioId_userId_key" ON "ComentarioMencion"("comentarioId", "userId");

-- AddForeignKey
ALTER TABLE "Comentario" ADD CONSTRAINT "Comentario_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comentario" ADD CONSTRAINT "Comentario_autorId_fkey" FOREIGN KEY ("autorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comentario" ADD CONSTRAINT "Comentario_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comentario" ADD CONSTRAINT "Comentario_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comentario" ADD CONSTRAINT "Comentario_workRequestId_fkey" FOREIGN KEY ("workRequestId") REFERENCES "WorkRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comentario" ADD CONSTRAINT "Comentario_materialRequestId_fkey" FOREIGN KEY ("materialRequestId") REFERENCES "MaterialRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComentarioMencion" ADD CONSTRAINT "ComentarioMencion_comentarioId_fkey" FOREIGN KEY ("comentarioId") REFERENCES "Comentario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComentarioMencion" ADD CONSTRAINT "ComentarioMencion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

