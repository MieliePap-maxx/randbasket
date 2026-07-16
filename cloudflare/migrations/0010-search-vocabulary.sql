CREATE TABLE IF NOT EXISTS search_vocabulary (
  term TEXT PRIMARY KEY,
  first_character TEXT NOT NULL,
  term_length INTEGER NOT NULL,
  usage_count INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_search_vocabulary_lookup
  ON search_vocabulary(first_character, term_length);

-- Seed the vocabulary from the catalogue already held in D1. Future catalogue
-- imports maintain these counts incrementally.
WITH RECURSIVE
source(text) AS (
  SELECT TRIM(search_text) || ' '
  FROM catalogue_products
  WHERE search_text IS NOT NULL AND search_text <> ''
  UNION ALL
  SELECT TRIM(LOWER(
    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
      COALESCE(product_name, '') || ' ' || COALESCE(brand, ''),
      '&', ' and '), '-', ' '), '/', ' '), ',', ' '), '.', ' ')
  )) || ' '
  FROM catalogue_offers
),
words(rest, term) AS (
  SELECT text, '' FROM source
  UNION ALL
  SELECT
    LTRIM(SUBSTR(rest, INSTR(rest, ' ') + 1)),
    TRIM(SUBSTR(rest, 1, INSTR(rest, ' ') - 1))
  FROM words
  WHERE rest <> '' AND INSTR(rest, ' ') > 0
),
counts(term, usage_count) AS (
  SELECT term, COUNT(*)
  FROM words
  WHERE LENGTH(term) >= 4
    AND term NOT GLOB '*[0-9]*'
    AND term NOT IN ('pack')
  GROUP BY term
)
INSERT INTO search_vocabulary (term, first_character, term_length, usage_count)
SELECT term, SUBSTR(term, 1, 1), LENGTH(term), usage_count
FROM counts
WHERE 1 = 1
ON CONFLICT(term) DO UPDATE SET
  first_character = excluded.first_character,
  term_length = excluded.term_length,
  usage_count = excluded.usage_count;
