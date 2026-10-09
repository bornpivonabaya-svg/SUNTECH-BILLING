-- AlterTable
ALTER TABLE "platform_settlement_settings" ALTER COLUMN "settlementFrequency" SET DEFAULT 'INSTANT';

-- AlterTable
ALTER TABLE "routers" ADD COLUMN     "hotspotPorts" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "lanPort" TEXT;

