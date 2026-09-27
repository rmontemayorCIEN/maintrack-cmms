-- CreateTable
CREATE TABLE "ClienteOAuth" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "redirectUris" TEXT NOT NULL DEFAULT '[]',
    "metodoAuth" TEXT NOT NULL DEFAULT 'none',
    "huellaSecreto" TEXT,
    "ultimoUsoEl" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClienteOAuth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodigoOAuth" (
    "id" TEXT NOT NULL,
    "huella" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "recurso" TEXT NOT NULL,
    "expiraEl" TIMESTAMP(3) NOT NULL,
    "usadoEl" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CodigoOAuth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenOAuth" (
    "id" TEXT NOT NULL,
    "huella" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "recurso" TEXT NOT NULL,
    "familia" TEXT NOT NULL,
    "autorizadoEl" TIMESTAMP(3) NOT NULL,
    "expiraEl" TIMESTAMP(3) NOT NULL,
    "revocadoEl" TIMESTAMP(3),
    "usadoEl" TIMESTAMP(3),
    "ultimoUsoEl" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenOAuth_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClienteOAuth_clientId_key" ON "ClienteOAuth"("clientId");

-- CreateIndex
CREATE INDEX "ClienteOAuth_createdAt_idx" ON "ClienteOAuth"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CodigoOAuth_huella_key" ON "CodigoOAuth"("huella");

-- CreateIndex
CREATE UNIQUE INDEX "TokenOAuth_huella_key" ON "TokenOAuth"("huella");

-- CreateIndex
CREATE INDEX "TokenOAuth_familia_idx" ON "TokenOAuth"("familia");

-- CreateIndex
CREATE INDEX "TokenOAuth_userId_idx" ON "TokenOAuth"("userId");

-- AddForeignKey
ALTER TABLE "CodigoOAuth" ADD CONSTRAINT "CodigoOAuth_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "ClienteOAuth"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodigoOAuth" ADD CONSTRAINT "CodigoOAuth_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenOAuth" ADD CONSTRAINT "TokenOAuth_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "ClienteOAuth"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenOAuth" ADD CONSTRAINT "TokenOAuth_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

