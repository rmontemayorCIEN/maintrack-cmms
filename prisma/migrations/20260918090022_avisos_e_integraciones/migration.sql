-- Bloque 5: avisos, escalamiento e integraciones. Aditiva: columnas nuevas en
-- Notification (todas nulas o con valor por omision; los avisos existentes se
-- siguen leyendo igual) y tablas nuevas. No borra ni cambia ningun dato.
-- Reversion (solo si nunca se uso):
--   DROP TABLE "LimiteUso", "ClaveIdempotencia", "UsoApi", "EntregaAviso", "Webhook",
--     "CredencialApi", "Escalamiento", "ConfigAvisos", "PreferenciaAvisos";
--   DROP INDEX "Notification_userId_claveDedup_key", "Notification_organizationId_entidad_entidadId_idx";
--   ALTER TABLE "Notification" DROP COLUMN "tipo", DROP COLUMN "prioridad", DROP COLUMN "modulo",
--     DROP COLUMN "entidad", DROP COLUMN "entidadId", DROP COLUMN "requiereAccion", DROP COLUMN "atendidaEl",
--     DROP COLUMN "atendidaMotivo", DROP COLUMN "leidaEl", DROP COLUMN "porQue", DROP COLUMN "accion",
--     DROP COLUMN "claveDedup", DROP COLUMN "veces", DROP COLUMN "actualizadaEl", DROP COLUMN "eventoId";

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "accion" TEXT,
ADD COLUMN     "actualizadaEl" TIMESTAMP(3),
ADD COLUMN     "atendidaEl" TIMESTAMP(3),
ADD COLUMN     "atendidaMotivo" TEXT,
ADD COLUMN     "claveDedup" TEXT,
ADD COLUMN     "entidad" TEXT,
ADD COLUMN     "entidadId" TEXT,
ADD COLUMN     "eventoId" TEXT,
ADD COLUMN     "leidaEl" TIMESTAMP(3),
ADD COLUMN     "modulo" TEXT,
ADD COLUMN     "porQue" TEXT,
ADD COLUMN     "prioridad" TEXT NOT NULL DEFAULT 'MEDIA',
ADD COLUMN     "requiereAccion" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tipo" TEXT NOT NULL DEFAULT 'GENERAL',
ADD COLUMN     "veces" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "EntregaAviso" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "notificationId" TEXT,
    "userId" TEXT,
    "webhookId" TEXT,
    "tipo" TEXT NOT NULL,
    "eventoId" TEXT NOT NULL,
    "canal" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "programadaPara" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "intentadaEl" TIMESTAMP(3),
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "proveedor" TEXT,
    "errorCategoria" TEXT,
    "errorDetalle" TEXT,
    "proximoIntento" TIMESTAMP(3),
    "entregadaEl" TIMESTAMP(3),
    "carga" TEXT,
    "claveDedup" TEXT NOT NULL,
    "resumen" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EntregaAviso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreferenciaAvisos" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "canales" TEXT NOT NULL DEFAULT '["NAVEGADOR","CORREO"]',
    "tiposApagados" TEXT NOT NULL DEFAULT '[]',
    "resumenDiario" BOOLEAN NOT NULL DEFAULT true,
    "resumenSemanal" BOOLEAN NOT NULL DEFAULT true,
    "horaInicio" TEXT,
    "horaFin" TEXT,
    "sitios" TEXT NOT NULL DEFAULT '[]',
    "navegadorRechazado" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreferenciaAvisos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfigAvisos" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "canales" TEXT NOT NULL DEFAULT '["NAVEGADOR","CORREO","WEBHOOK"]',
    "horaInicio" TEXT NOT NULL DEFAULT '08:00',
    "horaFin" TEXT NOT NULL DEFAULT '18:00',
    "anticipacionHoras" INTEGER NOT NULL DEFAULT 24,
    "destinatariosAdmin" TEXT NOT NULL DEFAULT '[]',
    "resumenDiario" BOOLEAN NOT NULL DEFAULT true,
    "resumenSemanal" BOOLEAN NOT NULL DEFAULT true,
    "horaResumen" TEXT NOT NULL DEFAULT '07:30',
    "resumenSinPendientes" BOOLEAN NOT NULL DEFAULT false,
    "reglas" TEXT NOT NULL DEFAULT '{}',
    "remitente" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfigAvisos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Escalamiento" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "regla" TEXT NOT NULL,
    "entidad" TEXT NOT NULL,
    "entidadId" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'ACTIVO',
    "nivel" INTEGER NOT NULL DEFAULT 0,
    "recordatorios" INTEGER NOT NULL DEFAULT 0,
    "iniciadoEl" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "proximoEl" TIMESTAMP(3) NOT NULL,
    "ultimoAvisoEl" TIMESTAMP(3),
    "responsableId" TEXT,
    "detenidoEl" TIMESTAMP(3),
    "motivoDetencion" TEXT,
    "reconocidoPorId" TEXT,

    CONSTRAINT "Escalamiento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CredencialApi" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "prefijo" TEXT NOT NULL,
    "huella" TEXT NOT NULL,
    "alcances" TEXT NOT NULL DEFAULT '[]',
    "estado" TEXT NOT NULL DEFAULT 'ACTIVA',
    "expiraEl" TIMESTAMP(3),
    "ultimoUsoEl" TIMESTAMP(3),
    "usos" INTEGER NOT NULL DEFAULT 0,
    "creadaPorId" TEXT,
    "revocadaEl" TIMESTAMP(3),
    "revocadaPorId" TEXT,
    "rotadaDeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CredencialApi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsoApi" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "credencialId" TEXT,
    "metodo" TEXT NOT NULL,
    "ruta" TEXT NOT NULL,
    "estado" INTEGER NOT NULL,
    "resultado" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsoApi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Webhook" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "eventos" TEXT NOT NULL DEFAULT '[]',
    "estado" TEXT NOT NULL DEFAULT 'ACTIVO',
    "secretoCifrado" TEXT NOT NULL,
    "secretoPista" TEXT NOT NULL,
    "ultimoEnvioEl" TIMESTAMP(3),
    "ultimoResultado" TEXT,
    "fallasConsecutivas" INTEGER NOT NULL DEFAULT 0,
    "suspendidoEl" TIMESTAMP(3),
    "creadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Webhook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaveIdempotencia" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "credencialId" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "ruta" TEXT NOT NULL,
    "estado" INTEGER NOT NULL,
    "respuesta" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaveIdempotencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LimiteUso" (
    "id" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "ventana" TIMESTAMP(3) NOT NULL,
    "conteo" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LimiteUso_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EntregaAviso_claveDedup_key" ON "EntregaAviso"("claveDedup");

-- CreateIndex
CREATE INDEX "EntregaAviso_organizationId_createdAt_idx" ON "EntregaAviso"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "EntregaAviso_estado_programadaPara_idx" ON "EntregaAviso"("estado", "programadaPara");

-- CreateIndex
CREATE UNIQUE INDEX "PreferenciaAvisos_userId_key" ON "PreferenciaAvisos"("userId");

-- CreateIndex
CREATE INDEX "PreferenciaAvisos_organizationId_idx" ON "PreferenciaAvisos"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ConfigAvisos_organizationId_key" ON "ConfigAvisos"("organizationId");

-- CreateIndex
CREATE INDEX "Escalamiento_estado_proximoEl_idx" ON "Escalamiento"("estado", "proximoEl");

-- CreateIndex
CREATE UNIQUE INDEX "Escalamiento_organizationId_regla_entidadId_key" ON "Escalamiento"("organizationId", "regla", "entidadId");

-- CreateIndex
CREATE UNIQUE INDEX "CredencialApi_prefijo_key" ON "CredencialApi"("prefijo");

-- CreateIndex
CREATE UNIQUE INDEX "CredencialApi_huella_key" ON "CredencialApi"("huella");

-- CreateIndex
CREATE INDEX "CredencialApi_organizationId_idx" ON "CredencialApi"("organizationId");

-- CreateIndex
CREATE INDEX "UsoApi_organizationId_createdAt_idx" ON "UsoApi"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "UsoApi_credencialId_createdAt_idx" ON "UsoApi"("credencialId", "createdAt");

-- CreateIndex
CREATE INDEX "Webhook_organizationId_idx" ON "Webhook"("organizationId");

-- CreateIndex
CREATE INDEX "ClaveIdempotencia_createdAt_idx" ON "ClaveIdempotencia"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClaveIdempotencia_credencialId_clave_key" ON "ClaveIdempotencia"("credencialId", "clave");

-- CreateIndex
CREATE INDEX "LimiteUso_ventana_idx" ON "LimiteUso"("ventana");

-- CreateIndex
CREATE UNIQUE INDEX "LimiteUso_clave_ventana_key" ON "LimiteUso"("clave", "ventana");

-- CreateIndex
CREATE INDEX "Notification_organizationId_entidad_entidadId_idx" ON "Notification"("organizationId", "entidad", "entidadId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_claveDedup_key" ON "Notification"("userId", "claveDedup");

-- AddForeignKey
ALTER TABLE "EntregaAviso" ADD CONSTRAINT "EntregaAviso_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntregaAviso" ADD CONSTRAINT "EntregaAviso_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntregaAviso" ADD CONSTRAINT "EntregaAviso_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "Webhook"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreferenciaAvisos" ADD CONSTRAINT "PreferenciaAvisos_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfigAvisos" ADD CONSTRAINT "ConfigAvisos_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Escalamiento" ADD CONSTRAINT "Escalamiento_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CredencialApi" ADD CONSTRAINT "CredencialApi_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsoApi" ADD CONSTRAINT "UsoApi_credencialId_fkey" FOREIGN KEY ("credencialId") REFERENCES "CredencialApi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Webhook" ADD CONSTRAINT "Webhook_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaveIdempotencia" ADD CONSTRAINT "ClaveIdempotencia_credencialId_fkey" FOREIGN KEY ("credencialId") REFERENCES "CredencialApi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

