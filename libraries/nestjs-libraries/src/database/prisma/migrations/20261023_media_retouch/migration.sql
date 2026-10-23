-- Photo retouch (Plan/photo-retouch.md): a retouched photo is a new Media row
-- that remembers the adjustments it was made with, its untouched source and
-- the level picked. Additive, no backfill.
ALTER TABLE "Media"
  ADD COLUMN "retouchSpec" JSONB,
  ADD COLUMN "retouchSourceId" TEXT,
  ADD COLUMN "retouchLevel" TEXT;
