-- CreateTable
CREATE TABLE "PlanRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestedById" TEXT,
    "planActual" TEXT NOT NULL,
    "planSolicitado" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "nota" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "PlanRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanRequest_organizationId_idx" ON "PlanRequest"("organizationId");

-- CreateIndex
CREATE INDEX "PlanRequest_status_idx" ON "PlanRequest"("status");

-- AddForeignKey
ALTER TABLE "PlanRequest" ADD CONSTRAINT "PlanRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanRequest" ADD CONSTRAINT "PlanRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

