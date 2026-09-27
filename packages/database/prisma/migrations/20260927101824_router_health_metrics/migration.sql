-- AlterTable
ALTER TABLE "routers" ADD COLUMN     "activeUsers" INTEGER,
ADD COLUMN     "diskFreeBytes" BIGINT,
ADD COLUMN     "diskTotalBytes" BIGINT,
ADD COLUMN     "temperatureC" DOUBLE PRECISION,
ADD COLUMN     "voltageV" DOUBLE PRECISION;

