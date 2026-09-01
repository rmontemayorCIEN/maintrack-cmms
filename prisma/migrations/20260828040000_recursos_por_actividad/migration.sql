-- AlterTable
ALTER TABLE "WorkOrder" ADD COLUMN     "serviceCost" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "WorkOrderService" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "serviceId" TEXT,
    "supplierId" TEXT,
    "descripcion" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "folioProveedor" TEXT,
    "nota" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkOrderService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Specialty" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hourlyRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Specialty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalService" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'servicio',
    "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanTaskLabor" (
    "id" TEXT NOT NULL,
    "planTaskId" TEXT NOT NULL,
    "specialtyId" TEXT NOT NULL,
    "personas" INTEGER NOT NULL DEFAULT 1,
    "hours" DOUBLE PRECISION NOT NULL DEFAULT 1,

    CONSTRAINT "PlanTaskLabor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanTaskPart" (
    "id" TEXT NOT NULL,
    "planTaskId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,

    CONSTRAINT "PlanTaskPart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanTaskService" (
    "id" TEXT NOT NULL,
    "planTaskId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "nota" TEXT,

    CONSTRAINT "PlanTaskService_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkOrderService_workOrderId_idx" ON "WorkOrderService"("workOrderId");

-- CreateIndex
CREATE INDEX "Specialty_organizationId_idx" ON "Specialty"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Specialty_organizationId_code_key" ON "Specialty"("organizationId", "code");

-- CreateIndex
CREATE INDEX "ExternalService_organizationId_idx" ON "ExternalService"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalService_organizationId_code_key" ON "ExternalService"("organizationId", "code");

-- CreateIndex
CREATE INDEX "PlanTaskLabor_planTaskId_idx" ON "PlanTaskLabor"("planTaskId");

-- CreateIndex
CREATE INDEX "PlanTaskPart_planTaskId_idx" ON "PlanTaskPart"("planTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanTaskPart_planTaskId_partId_key" ON "PlanTaskPart"("planTaskId", "partId");

-- CreateIndex
CREATE INDEX "PlanTaskService_planTaskId_idx" ON "PlanTaskService"("planTaskId");

-- AddForeignKey
ALTER TABLE "WorkOrderService" ADD CONSTRAINT "WorkOrderService_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderService" ADD CONSTRAINT "WorkOrderService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "ExternalService"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderService" ADD CONSTRAINT "WorkOrderService_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Specialty" ADD CONSTRAINT "Specialty_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalService" ADD CONSTRAINT "ExternalService_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalService" ADD CONSTRAINT "ExternalService_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanTaskLabor" ADD CONSTRAINT "PlanTaskLabor_planTaskId_fkey" FOREIGN KEY ("planTaskId") REFERENCES "PlanTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanTaskLabor" ADD CONSTRAINT "PlanTaskLabor_specialtyId_fkey" FOREIGN KEY ("specialtyId") REFERENCES "Specialty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanTaskPart" ADD CONSTRAINT "PlanTaskPart_planTaskId_fkey" FOREIGN KEY ("planTaskId") REFERENCES "PlanTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanTaskPart" ADD CONSTRAINT "PlanTaskPart_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanTaskService" ADD CONSTRAINT "PlanTaskService_planTaskId_fkey" FOREIGN KEY ("planTaskId") REFERENCES "PlanTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanTaskService" ADD CONSTRAINT "PlanTaskService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "ExternalService"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Las refacciones dejan de colgar del plan y pasan a colgar de una actividad.
--
-- Antes el plan entero declaraba "estas refacciones"; ahora cada actividad
-- declara las suyas, junto con la mano de obra y los servicios externos. Para
-- no perder lo ya capturado, cada refaccion de plan se muda a la primera
-- actividad de ese plan; si el plan no tiene ninguna, se le crea una.
-- ---------------------------------------------------------------------------

INSERT INTO "PlanTask" ("id", "planId", "position", "title", "taskType", "required")
SELECT gen_random_uuid()::text, p."planId", 0, 'Refacciones del plan', 'REPLACE', true
FROM (SELECT DISTINCT "planId" FROM "PlanPart") p
WHERE NOT EXISTS (SELECT 1 FROM "PlanTask" t WHERE t."planId" = p."planId");

INSERT INTO "PlanTaskPart" ("id", "planTaskId", "partId", "quantity")
SELECT gen_random_uuid()::text, t."id", pp."partId", pp."quantity"
FROM "PlanPart" pp
JOIN LATERAL (
  SELECT "id" FROM "PlanTask" WHERE "planId" = pp."planId" ORDER BY "position" ASC, "id" ASC LIMIT 1
) t ON TRUE
ON CONFLICT ("planTaskId", "partId") DO NOTHING;

-- DropForeignKey
ALTER TABLE "PlanPart" DROP CONSTRAINT "PlanPart_planId_fkey";

-- DropForeignKey
ALTER TABLE "PlanPart" DROP CONSTRAINT "PlanPart_partId_fkey";

-- DropTable
DROP TABLE "PlanPart";
