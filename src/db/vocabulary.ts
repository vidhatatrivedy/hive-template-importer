export type MigrationSource = {
  filename: string;
  sql: string;
};

export type VocabularyDrift = {
  constraint: string;
  missingFromDatabase: string[];
  missingFromCore: string[];
};

/**
 * Last `array[…]` of each named `check` constraint, files in the order given
 * (filename order). A later migration that redefines a constraint replaces it.
 */
function vocabularyArrays(sources: readonly MigrationSource[]): Map<string, readonly string[]> {
  const found = new Map<string, readonly string[]>();
  for (const source of sources) {
    const checks = [...source.sql.matchAll(/(?:add\s+)?constraint\s+([a-z0-9_]+)\s+check\b/gi)];
    for (const [index, check] of checks.entries()) {
      const name = check[1];
      if (!name || check.index === undefined) continue;
      const bodyStart = check.index + check[0].length;
      const bodyEnd = checks[index + 1]?.index ?? source.sql.length;
      const values = arrayLiterals(source.sql.slice(bodyStart, bodyEnd));
      if (values) found.set(name, values);
    }
  }
  return found;
}

/** Values in `expected` but not in the migrations, and the reverse. Order does not matter. */
export function vocabularyDrift(
  sources: readonly MigrationSource[],
  expected: Readonly<Record<string, readonly string[]>>,
): VocabularyDrift[] {
  const actual = vocabularyArrays(sources);
  const drifts: VocabularyDrift[] = [];
  for (const [constraint, coreValues] of Object.entries(expected)) {
    const databaseValues = actual.get(constraint) ?? [];
    const database = new Set(databaseValues);
    const core = new Set(coreValues);
    const missingFromDatabase = coreValues.filter((value) => !database.has(value)).sort();
    const missingFromCore = databaseValues.filter((value) => !core.has(value)).sort();
    if (missingFromDatabase.length > 0 || missingFromCore.length > 0) {
      drifts.push({ constraint, missingFromDatabase, missingFromCore });
    }
  }
  return drifts;
}

/** Quoted strings inside the first `array[…]`, or null when this check has no array. */
function arrayLiterals(body: string): readonly string[] | null {
  const contents = /array\s*\[([\s\S]*?)\]/i.exec(body)?.[1];
  if (contents === undefined) return null;

  const literals: string[] = [];
  for (const match of contents.matchAll(/'((?:[^']|'')*)'/g)) {
    const literal = match[1] ?? "";
    literals.push(literal.replaceAll("''", "'"));
  }
  return literals;
}
