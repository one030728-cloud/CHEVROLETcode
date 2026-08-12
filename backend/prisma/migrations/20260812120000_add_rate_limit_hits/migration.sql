-- CreateTable
CREATE TABLE "RateLimitHit" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "RateLimitHit_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "RateLimitHit_windowStart_idx" ON "RateLimitHit"("windowStart");
