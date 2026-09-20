-- CreateTable
CREATE TABLE "ProcesoProgramado" (
    "clave" TEXT NOT NULL,
    "organizationId" TEXT,
    "corriendoDesde" TIMESTAMP(3),
    "expiraEl" TIMESTAMP(3),
    "ultimoInicio" TIMESTAMP(3),
    "ultimoFin" TIMESTAMP(3),
    "ultimoOk" BOOLEAN,
    "ultimoResumen" TEXT,
    "ultimoError" TEXT,
    "fallasSeguidas" INTEGER NOT NULL DEFAULT 0,
    "corridas" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProcesoProgramado_pkey" PRIMARY KEY ("clave")
);

-- CreateIndex
CREATE INDEX "ProcesoProgramado_ultimoFin_idx" ON "ProcesoProgramado"("ultimoFin");

-- CreateIndex
CREATE INDEX "ProcesoProgramado_organizationId_idx" ON "ProcesoProgramado"("organizationId");

