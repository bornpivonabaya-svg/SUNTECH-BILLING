-- AlterTable
ALTER TABLE "routers" ADD COLUMN     "previousProvisionTokenHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "routers_previousProvisionTokenHash_key" ON "routers"("previousProvisionTokenHash");

