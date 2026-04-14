import express from 'express'
import { replyRouter } from './routes/reply.router'
import { webhookRouter } from './routes/webhook.router'
import { syncRouter } from './routes/sync.router'

export function createApp() {
  const app = express()

  // ⚠️ raw body ONLY for FB webhook
  app.use(
    '/webhook/facebook',
    express.raw({ type: 'application/json', limit: '2mb' })
  )

  // normal json for rest
  app.use(express.json({ limit: '1mb' }))

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'minsah-realtime',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    })
  })

  app.use('/webhook', webhookRouter)
  app.use('/reply', replyRouter)
  app.use('/sync', syncRouter) // ✅ THIS LINE IS MUST

  app.use((_req, res) => {
    res.sendStatus(404)
  })

  return app
}
