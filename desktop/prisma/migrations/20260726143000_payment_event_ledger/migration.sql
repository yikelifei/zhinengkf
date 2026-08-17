CREATE TABLE "PaymentEvent" (
  "id" TEXT NOT NULL,
  "quoteDraftId" TEXT NOT NULL,
  "orderDraftId" TEXT,
  "customerId" TEXT NOT NULL,
  "conversationId" TEXT,
  "wechatAccountId" TEXT,
  "paymentStatus" "PaymentStatus" NOT NULL,
  "amountCny" DECIMAL(12,2),
  "method" TEXT,
  "proofReference" TEXT,
  "reviewer" TEXT,
  "note" TEXT,
  "source" TEXT NOT NULL DEFAULT 'manual_payment_proof',
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentEvent_idempotencyKey_key"
ON "PaymentEvent"("idempotencyKey");

CREATE INDEX "PaymentEvent_quoteDraftId_createdAt_idx"
ON "PaymentEvent"("quoteDraftId", "createdAt");

CREATE INDEX "PaymentEvent_orderDraftId_createdAt_idx"
ON "PaymentEvent"("orderDraftId", "createdAt");

CREATE INDEX "PaymentEvent_customerId_createdAt_idx"
ON "PaymentEvent"("customerId", "createdAt");

ALTER TABLE "PaymentEvent"
ADD CONSTRAINT "PaymentEvent_quoteDraftId_fkey"
FOREIGN KEY ("quoteDraftId") REFERENCES "QuoteDraft"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentEvent"
ADD CONSTRAINT "PaymentEvent_orderDraftId_fkey"
FOREIGN KEY ("orderDraftId") REFERENCES "OrderDraft"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
