ALTER TABLE "DesignImageCandidate"
ADD COLUMN "legacyIdentityHash" TEXT;

UPDATE "DesignImageCandidate"
SET
  "legacyIdentityHash" = COALESCE("legacyIdentityHash", "fingerprint"),
  "fingerprint" = NULL
WHERE
  "fingerprint" IS NOT NULL
  AND "fingerprint" !~ '^dhash64:v1:[0-9a-fA-F]{16}$';
