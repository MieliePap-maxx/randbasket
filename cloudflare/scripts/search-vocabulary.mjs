const excludedTokens = new Set(["kg", "g", "ml", "l", "ct", "pk", "pack"]);

export function cleanVocabularyText(value) {
  return String(value || "")
    .replace(/(?<=\d)(?=[a-zA-Z])/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function addVocabularyText(vocabulary, ...values) {
  for (const value of values.flat(Infinity)) {
    for (const token of cleanVocabularyText(value).split(" ")) {
      if (!token
        || token.length < 4
        || /\d/.test(token)
        || excludedTokens.has(token)) continue;
      vocabulary.set(token, (vocabulary.get(token) || 0) + 1);
    }
  }
  return vocabulary;
}

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function vocabularySqlStatements(vocabulary, { replace = false } = {}) {
  const statements = replace ? ["DELETE FROM search_vocabulary;"] : [];
  for (const [term, usageCount] of [...vocabulary.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const values = [sql(term), sql(term[0]), term.length, usageCount].join(", ");
    statements.push(replace
      ? `INSERT OR REPLACE INTO search_vocabulary (term, first_character, term_length, usage_count) VALUES (${values});`
      : `INSERT INTO search_vocabulary (term, first_character, term_length, usage_count) VALUES (${values}) ON CONFLICT(term) DO UPDATE SET usage_count = search_vocabulary.usage_count + excluded.usage_count, first_character = excluded.first_character, term_length = excluded.term_length;`);
  }
  return statements;
}
