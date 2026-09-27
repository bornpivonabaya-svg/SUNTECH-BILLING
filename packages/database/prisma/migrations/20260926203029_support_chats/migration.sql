-- CreateEnum
CREATE TYPE "SupportChatChannel" AS ENUM ('APP', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "SupportChatStatus" AS ENUM ('OPEN', 'HANDED_OVER', 'CLOSED');

-- CreateTable
CREATE TABLE "support_chats" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "channel" "SupportChatChannel" NOT NULL,
    "status" "SupportChatStatus" NOT NULL DEFAULT 'OPEN',
    "ticketId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_chats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_chat_messages" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "support_chats_ticketId_key" ON "support_chats"("ticketId");

-- CreateIndex
CREATE INDEX "support_chats_customerId_status_updatedAt_idx" ON "support_chats"("customerId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "support_chat_messages_chatId_createdAt_idx" ON "support_chat_messages"("chatId", "createdAt");

-- AddForeignKey
ALTER TABLE "support_chats" ADD CONSTRAINT "support_chats_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_chats" ADD CONSTRAINT "support_chats_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_chats" ADD CONSTRAINT "support_chats_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_chat_messages" ADD CONSTRAINT "support_chat_messages_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "support_chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

