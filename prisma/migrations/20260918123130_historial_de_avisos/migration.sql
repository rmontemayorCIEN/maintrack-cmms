-- CreateTable
CREATE TABLE "HistorialAviso" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "entidadId" TEXT,
    "cambio" TEXT NOT NULL,
    "condicionAnterior" TEXT,
    "condicionActual" TEXT,
    "evento" TEXT,
    "actorId" TEXT,
    "origen" TEXT NOT NULL,
    "motivo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistorialAviso_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HistorialAviso_notificationId_idx" ON "HistorialAviso"("notificationId");

-- CreateIndex
CREATE INDEX "HistorialAviso_organizationId_entidadId_idx" ON "HistorialAviso"("organizationId", "entidadId");

-- AddForeignKey
ALTER TABLE "HistorialAviso" ADD CONSTRAINT "HistorialAviso_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistorialAviso" ADD CONSTRAINT "HistorialAviso_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

