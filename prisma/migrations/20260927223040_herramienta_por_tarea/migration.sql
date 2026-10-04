-- CreateTable
CREATE TABLE "PlanTaskTool" (
    "id" TEXT NOT NULL,
    "planTaskId" TEXT NOT NULL,
    "partId" TEXT,
    "assetId" TEXT,
    "kitId" TEXT,
    "cantidad" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "nota" TEXT,

    CONSTRAINT "PlanTaskTool_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanTaskTool_planTaskId_idx" ON "PlanTaskTool"("planTaskId");

-- AddForeignKey
ALTER TABLE "PlanTaskTool" ADD CONSTRAINT "PlanTaskTool_planTaskId_fkey" FOREIGN KEY ("planTaskId") REFERENCES "PlanTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanTaskTool" ADD CONSTRAINT "PlanTaskTool_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanTaskTool" ADD CONSTRAINT "PlanTaskTool_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanTaskTool" ADD CONSTRAINT "PlanTaskTool_kitId_fkey" FOREIGN KEY ("kitId") REFERENCES "KitDeHerramientas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

