class PostgresRateLimitStore {
  constructor(prisma, { prefix, windowMs, cleanupProbability = 0.01 }) {
    this.prisma = prisma
    this.prefix = prefix
    this.windowMs = windowMs
    this.cleanupProbability = cleanupProbability
    this.localKeys = false
  }

  init(options) {
    this.windowMs = options.windowMs
  }

  async increment(key) {
    const now = new Date()
    const staleBefore = new Date(now.getTime() - this.windowMs)
    const storageKey = `${this.prefix}:${key}`
    const rows = await this.prisma.$queryRaw`
      INSERT INTO "RateLimitHit" ("key", "windowStart", "count")
      VALUES (${storageKey}, ${now}, 1)
      ON CONFLICT ("key") DO UPDATE
      SET
        "count" = CASE
          WHEN "RateLimitHit"."windowStart" <= ${staleBefore} THEN 1
          ELSE "RateLimitHit"."count" + 1
        END,
        "windowStart" = CASE
          WHEN "RateLimitHit"."windowStart" <= ${staleBefore} THEN ${now}
          ELSE "RateLimitHit"."windowStart"
        END
      RETURNING "count", "windowStart"
    `

    if (Math.random() < this.cleanupProbability) {
      this.cleanupExpired(now).catch(() => {})
    }

    const row = rows[0]
    return {
      totalHits: Number(row.count),
      resetTime: new Date(new Date(row.windowStart).getTime() + this.windowMs),
    }
  }

  async get(key) {
    const storageKey = `${this.prefix}:${key}`
    const rows = await this.prisma.$queryRaw`
      SELECT "count", "windowStart"
      FROM "RateLimitHit"
      WHERE "key" = ${storageKey}
    `
    const row = rows[0]
    if (!row) return undefined

    const windowStart = new Date(row.windowStart)
    if (windowStart.getTime() + this.windowMs <= Date.now()) return undefined
    return {
      totalHits: Number(row.count),
      resetTime: new Date(windowStart.getTime() + this.windowMs),
    }
  }

  async decrement(key) {
    const storageKey = `${this.prefix}:${key}`
    await this.prisma.$executeRaw`
      UPDATE "RateLimitHit"
      SET "count" = GREATEST("count" - 1, 0)
      WHERE "key" = ${storageKey}
    `
  }

  async resetKey(key) {
    const storageKey = `${this.prefix}:${key}`
    await this.prisma.$executeRaw`
      DELETE FROM "RateLimitHit" WHERE "key" = ${storageKey}
    `
  }

  async resetAll() {
    await this.prisma.$executeRaw`DELETE FROM "RateLimitHit"`
  }

  shutdown() {}

  async cleanupExpired(now) {
    const cleanupBefore = new Date(now.getTime() - Math.max(this.windowMs * 2, 60 * 1000))
    await this.prisma.$executeRaw`
      DELETE FROM "RateLimitHit"
      WHERE "windowStart" < ${cleanupBefore}
    `
  }
}

module.exports = { PostgresRateLimitStore }
