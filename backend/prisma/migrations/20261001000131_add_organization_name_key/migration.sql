-- Organization names become unique case-insensitively (like usernames).
-- The displayed `name` is never changed by this migration: a separate
-- lower-case key carries the uniqueness.
--
-- Safe for existing data: every row gets its key from its own name; if two
-- existing organizations already share a name, the OLDEST keeps the plain key
-- and each later one gets the key plus its own id, so the unique index can be
-- created without rewriting or deleting anything. Those organizations keep
-- working; they simply cannot block each other.

-- AddColumn (nullable while it is backfilled)
ALTER TABLE "organizations" ADD COLUMN "name_key" TEXT;

-- Backfill: the SQL equivalent of organizationNameKey() in
-- src/utils/organizationName.ts —
--   name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
--
-- * normalize(.., NFKC) folds compatibility forms (full-width letters,
--   no-break and ideographic spaces, ligatures) exactly as the application
--   does. It needs PostgreSQL 13+ and a UTF8 database.
-- * Every run of whitespace becomes one space, then the ends are trimmed.
--   Collapsing first makes btrim's "spaces only" enough to drop leading and
--   trailing tabs and newlines too. The whitespace class is spelled out code
--   point by code point instead of using \s, because \s follows the database
--   locale while JavaScript's \s is fixed: tab to carriage return
--   (U+0009-U+000D), space, and the four characters JavaScript treats as
--   whitespace that NFKC does not already turn into a plain space.
-- * Lower-casing uses ICU's root collation when the server has it: that is
--   the same Unicode algorithm as JavaScript's toLowerCase, including the
--   context-sensitive cases (Greek final sigma, Turkish dotted capital I).
--   Plain lower() follows the database locale instead and is only the
--   fallback for a server built without ICU, so that the migration can never
--   fail for want of a collation (ADR-051 lists what differs in that case).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_collation WHERE collname = 'und-x-icu' AND collprovider = 'i'
  ) THEN
    EXECUTE $backfill$
      UPDATE "organizations"
      SET "name_key" = lower(
        btrim(
          regexp_replace(normalize("name", NFKC), '[\u0009-\u000D    ﻿]+', ' ', 'g'),
          ' '
        ) COLLATE "und-x-icu"
      )
    $backfill$;
  ELSE
    UPDATE "organizations"
    SET "name_key" = lower(
      btrim(
        regexp_replace(normalize("name", NFKC), '[\u0009-\u000D    ﻿]+', ' ', 'g'),
        ' '
      )
    );
  END IF;
END
$$;

-- Resolve pre-existing duplicates without touching any displayed name. The
-- suffix is the organization's whole id, which is unique, so two duplicates
-- can never receive the same key.
UPDATE "organizations" o
SET "name_key" = o."name_key" || ' #' || o."id"
FROM (
  SELECT "id",
         row_number() OVER (PARTITION BY "name_key" ORDER BY "created_at", "id") AS rn
  FROM "organizations"
) ranked
WHERE ranked."id" = o."id" AND ranked.rn > 1;

ALTER TABLE "organizations" ALTER COLUMN "name_key" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "organizations_name_key_key" ON "organizations"("name_key");
