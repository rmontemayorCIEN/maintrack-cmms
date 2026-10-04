-- AlterTable
--
-- Editada a mano sobre lo que genero Prisma, y por que:
-- `ADD COLUMN ... NOT NULL` sin valor por omision revienta en una tabla que
-- YA tiene renglones, y DowntimeEvent los tiene en produccion. Se agrega
-- opcional, se rellena desde el activo —que es de donde sale la empresa— y
-- solo entonces se exige obligatoria. Sin esto el despliegue se cae a la
-- mitad, con la migracion aplicada a medias.
ALTER TABLE "DowntimeEvent" ADD COLUMN "organizationId" TEXT;

UPDATE "DowntimeEvent" AS d
   SET "organizationId" = a."organizationId"
  FROM "Asset" AS a
 WHERE a."id" = d."assetId"
   AND d."organizationId" IS NULL;

-- Un paro sin activo no puede existir (la llave foranea lo impide), asi que
-- despues del relleno no puede quedar ninguno sin empresa.
ALTER TABLE "DowntimeEvent" ALTER COLUMN "organizationId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "DowntimeEvent_organizationId_startedAt_idx" ON "DowntimeEvent"("organizationId", "startedAt");

-- CreateIndex
CREATE INDEX "DowntimeEvent_assetId_startedAt_idx" ON "DowntimeEvent"("assetId", "startedAt");

-- CreateIndex
CREATE INDEX "MeterReading_meterId_readingAt_idx" ON "MeterReading"("meterId", "readingAt");

-- CreateIndex
CREATE INDEX "WorkOrder_organizationId_status_dueDate_idx" ON "WorkOrder"("organizationId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "WorkOrder_organizationId_completedAt_idx" ON "WorkOrder"("organizationId", "completedAt");

-- CreateIndex
CREATE INDEX "WorkOrder_organizationId_createdAt_idx" ON "WorkOrder"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkOrder_organizationId_maintenanceType_dueDate_idx" ON "WorkOrder"("organizationId", "maintenanceType", "dueDate");

-- CreateIndex
CREATE INDEX "WorkOrder_assetId_createdAt_idx" ON "WorkOrder"("assetId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkOrderLabor_userId_workedAt_idx" ON "WorkOrderLabor"("userId", "workedAt");

-- CreateIndex
CREATE INDEX "WorkRequest_organizationId_status_createdAt_idx" ON "WorkRequest"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "WorkRequest_organizationId_tipo_idx" ON "WorkRequest"("organizationId", "tipo");

-- CreateIndex
CREATE INDEX "StockMovement_organizationId_createdAt_idx" ON "StockMovement"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_partId_createdAt_idx" ON "StockMovement"("partId", "createdAt");

-- CreateIndex
CREATE INDEX "SensorReading_sensorId_readingAt_idx" ON "SensorReading"("sensorId", "readingAt");

-- CreateIndex
CREATE INDEX "Notification_userId_atendidaEl_createdAt_idx" ON "Notification"("userId", "atendidaEl", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "DowntimeEvent" ADD CONSTRAINT "DowntimeEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

