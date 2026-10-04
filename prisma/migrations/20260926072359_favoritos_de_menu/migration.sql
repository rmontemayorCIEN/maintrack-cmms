-- CreateTable
CREATE TABLE "PantallaFavorita" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ruta" TEXT NOT NULL,
    "posicion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PantallaFavorita_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PantallaFavorita_userId_posicion_idx" ON "PantallaFavorita"("userId", "posicion");

-- CreateIndex
CREATE UNIQUE INDEX "PantallaFavorita_userId_ruta_key" ON "PantallaFavorita"("userId", "ruta");

-- AddForeignKey
ALTER TABLE "PantallaFavorita" ADD CONSTRAINT "PantallaFavorita_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PantallaFavorita" ADD CONSTRAINT "PantallaFavorita_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

