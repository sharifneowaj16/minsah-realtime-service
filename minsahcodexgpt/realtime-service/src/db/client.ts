import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client'

declare global {
  // eslint-disable-next-line no-var
  var __realtimePrisma: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL ?? '',
  })

  return new PrismaClient({ adapter })
}

const prisma = global.__realtimePrisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') {
  global.__realtimePrisma = prisma
}

export { prisma }
