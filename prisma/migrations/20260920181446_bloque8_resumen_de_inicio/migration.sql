-- CreateTable
CREATE TABLE "ResumenInicio" (
    "organizationId" TEXT NOT NULL,
    "calculadoEl" TIMESTAMP(3) NOT NULL,
    "datos" TEXT NOT NULL,

    CONSTRAINT "ResumenInicio_pkey" PRIMARY KEY ("organizationId")
);

-- AddForeignKey
ALTER TABLE "ResumenInicio" ADD CONSTRAINT "ResumenInicio_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

