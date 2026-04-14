import { Router, Request, Response } from 'express'
import { getConfig } from '../config'
import { prisma } from '../db/client'

export const syncRouter = Router()

interface FbMessage {
  id: string
  message?: string
  from: { id: string; name?: string; email?: string }
  created_time: string
  attachments?: {
    data: Array<{
      type: string
      payload?: { url?: string }
      image_data?: { url?: string }
      video_data?: { url?: string }
      file_url?: string
    }>
  }
}

interface FbConversationRaw {
  id: string
  participants: { data: Array<{ id: string; name?: string; email?: string }> }
  messages?: { data: FbMessage[]; paging?: { next?: string } }
}

interface GraphResponse {
  data: FbConversationRaw[]
  paging?: { cursors?: { after?: string }; next?: string }
}

async function fetchAllMessages(
  conversationId: string,
  accessToken: string
): Promise<FbMessage[]> {
  const allMessages: FbMessage[] = []
  let url = `https://graph.facebook.com/v19.0/${conversationId}/messages?fields=id,message,from,created_time,attachments&limit=100&access_token=${accessToken}`

  while (url) {
    const res = await fetch(url)
    const data = (await res.json()) as { data: FbMessage[]; paging?: { next?: string } }
    if (!data.data) break
    allMessages.push(...data.data)
    url = data.paging?.next ?? ''
  }

  return allMessages
}

syncRouter.post('/facebook-conversations', async (req: Request, res: Response) => {
  const secret = req.headers['x-api-secret']
  if (secret !== getConfig().REPLY_API_SECRET) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const { accessToken, pageId } = req.body as { accessToken?: string; pageId?: string }
  if (!accessToken || !pageId) {
    res.status(400).json({ error: 'accessToken and pageId are required' })
    return
  }

  let totalConversations = 0
  let syncedConversations = 0
  let syncedMessages = 0

  try {
    let url = `https://graph.facebook.com/v19.0/me/conversations?fields=id,participants&limit=100&access_token=${accessToken}`

    while (url) {
      const graphRes = await fetch(url)
      const graphData = (await graphRes.json()) as GraphResponse

      if (!graphData.data) {
        console.error('[sync] Graph API error:', graphData)
        break
      }

      totalConversations += graphData.data.length

      for (const conv of graphData.data) {
        try {
          // Find the customer (non-page participant)
          const customer = conv.participants.data.find((p) => p.id !== pageId)
          if (!customer) continue

          const customerPsid = customer.id
          const threadId = customerPsid

          // Fetch all messages for this conversation
          const messages = await fetchAllMessages(conv.id, accessToken)
          if (!messages.length) continue

          // Sort messages by time ascending
          messages.sort(
            (a, b) => new Date(a.created_time).getTime() - new Date(b.created_time).getTime()
          )

          const lastMsg = messages[messages.length - 1]
          const lastMessageText = lastMsg.message ?? '[attachment]'
          const lastMessageAt = new Date(lastMsg.created_time)

          // Upsert conversation
          await prisma.fbConversation.upsert({
            where: { threadId },
            create: {
              threadId,
              pageId,
              customerPsid,
              customerName: customer.name ?? null,
              lastMessage: lastMessageText,
              lastMessageAt,
              unreadCount: 0,
              isReplied: false,
            },
            update: {
              customerName: customer.name ?? undefined,
              lastMessage: lastMessageText,
              lastMessageAt,
            },
          })

          const conversation = await prisma.fbConversation.findUnique({
            where: { threadId },
          })

          if (!conversation) continue

          // Upsert each message
          for (const msg of messages) {
            const isFromPage = msg.from.id === pageId
            const text = msg.message ?? '[attachment]'

            let attachmentUrl: string | null = null
            if (msg.attachments?.data?.length) {
              const att = msg.attachments.data[0]
              attachmentUrl =
                att.payload?.url ??
                att.image_data?.url ??
                att.video_data?.url ??
                att.file_url ??
                null
            }

            await prisma.fbMessage.upsert({
              where: { fbMessageId: msg.id },
              create: {
                fbMessageId: msg.id,
                conversationId: conversation.id,
                senderId: msg.from.id,
                senderType: isFromPage ? 'PAGE' : 'CUSTOMER',
                text,
                attachmentUrl,
                timestamp: new Date(msg.created_time),
              },
              update: {},
            })

            syncedMessages++
          }

          syncedConversations++
        } catch (err) {
          console.error('[sync] error processing conversation', conv.id, err)
        }
      }

      url = graphData.paging?.next ?? ''
    }

    console.log(
      `[sync] done — conversations: ${syncedConversations}/${totalConversations}, messages: ${syncedMessages}`
    )
    res.json({
      ok: true,
      synced: syncedConversations,
      total: totalConversations,
      messages: syncedMessages,
    })
  } catch (err) {
    console.error('[sync] fatal error', err)
    res.status(500).json({ error: 'Sync failed', details: String(err) })
  }
})
