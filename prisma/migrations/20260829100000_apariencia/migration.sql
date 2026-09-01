-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "colorAcento" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "densidadUi" TEXT NOT NULL DEFAULT 'COMODA',
ADD COLUMN     "escalaUi" TEXT NOT NULL DEFAULT 'NORMAL';

