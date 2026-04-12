import { Prisma } from '../../prisma/generated/prisma/client'
import { prisma } from './client'

export interface SaveIncomingMessageInput {
  fbMessageId: string
  pageId: string
  customerPsid: string
  customerName?: string
  text: string
  timestamp: Date
}

export interface SaveOutgoingMessageInput {
  fbMessageId: string
  pageId: string
  customerPsid: string
  text: string
  timestamp: Date
}

export async function upsertConversationAndSaveMessage(
  input: SaveIncomingMessageInput
): Promise<{ conversationId: string; messageId: string; isNew: boolean }> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const existingConversation = await tx.fbConversation.findUnique({
      where: { threadId: input.customerPsid },
      select: { id: true },
    })

    const existingMessage = await tx.fbMessage.findUnique({
      where: { fbMessageId: input.fbMessageId },
      select: { id: true },
    })

    const conversation = await tx.fbConversation.upsert({
      where: { threadId: input.customerPsid },
      update: {
        lastMessage: input.text,
        lastMessageAt: input.timestamp,
        unreadCount: existingMessage ? undefined : { increment: 1 },
        isReplied: false,
        ...(input.customerName ? { customerName: input.customerName } : {}),
      },
      create: {
        threadId: input.customerPsid,
        pageId: input.pageId,
        customerPsid: input.customerPsid,
        customerName: input.customerName ?? null,
        lastMessage: input.text,
        lastMessageAt: input.timestamp,
        unreadCount: existingMessage ? 0 : 1,
        isReplied: false,
      },
    })

    if (existingMessage) {
      return {
        conversationId: conversation.id,
        messageId: existingMessage.id,
        isNew: false,
      }
    }

    const message = await tx.fbMessage.create({
      data: {
        fbMessageId: input.fbMessageId,
        conversationId: conversation.id,
        senderId: input.customerPsid,
        senderType: 'CUSTOMER',
        text: input.text,
        timestamp: input.timestamp,
      },
    })

    return {
      conversationId: conversation.id,
      messageId: message.id,
      isNew: !existingConversation,
    }
  })
}

export async function saveOutgoingMessage(
  input: SaveOutgoingMessageInput,
  agentSenderId: string
): Promise<{ conversationId: string; messageId: string }> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const conversation = await tx.fbConversation.upsert({
      where: { threadId: input.customerPsid },
      update: {
        lastMessage: input.text,
        lastMessageAt: input.timestamp,
        isReplied: true,
      },
      create: {
        threadId: input.customerPsid,
        pageId: input.pageId,
        customerPsid: input.customerPsid,
        lastMessage: input.text,
        lastMessageAt: input.timestamp,
        unreadCount: 0,
        isReplied: true,
      },
    })

    const message = await tx.fbMessage.create({
      data: {
        fbMessageId: input.fbMessageId,
        conversationId: conversation.id,
        senderId: agentSenderId,
        senderType: 'PAGE',
        text: input.text,
        timestamp: input.timestamp,
      },
    })

    return {
      conversationId: conversation.id,
      messageId: message.id,
    }
  })
}

export async function markConversationRead(input: {
  conversationId?: string
  threadId?: string
}): Promise<{ conversationId: string; threadId: string } | null> {
  const conversation = input.conversationId
    ? await prisma.fbConversation.findUnique({
        where: { id: input.conversationId },
        select: { id: true, threadId: true },
      })
    : input.threadId
      ? await prisma.fbConversation.findUnique({
          where: { threadId: input.threadId },
          select: { id: true, threadId: true },
        })
      : null

  if (!conversation) {
    return null
  }

  await prisma.fbConversation.update({
    where: { id: conversation.id },
    data: { unreadCount: 0 },
  })

  return {
    conversationId: conversation.id,
    threadId: conversation.threadId,
  }
}
