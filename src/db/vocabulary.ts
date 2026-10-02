export type MigrationSource = {
  filename: string;
  sql: string;
};

export type VocabularyDrift = {
  constraint: string;
  missingFromDatabase: string[];
  missingFromCore: string[];
};

const CONSTRAINT = /(?:add\s+)?constraint\s+([a-z0-9_]+)\s+check\b/gi;

/**
 * Last `array[…]` of each named `check` constraint, files in the order given
 * (filename order). A later migration that redefines a constraint replaces it.
 */
export function vocabularyArrays(sources: readonly MigrationSource[]): Map<string, readonly string[]> {
  const found = new Map<string, readonly string[]>();
  for (const source of sources) {
    for (const match of source.sql.matchAll(CONSTRAINT)) {
      const name = match[1];
      if (!name || match.index === undefined) continue;
      const values = arrayLiterals(constraintBody(source.sql, match.index + match[0].length));
      if (values) found.set(name, values);
    }
  }
  return found;
}

/** Kinds in `expected` but not in the migrations, and the reverse. Order does not matter. */
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

/** SQL from just after `check` up to the next constraint definition. */
function constraintBody(sql: string, from: number): string {
  const rest = sql.slice(from);
  const next = rest.search(/\b(?:add\s+)?constraint\s+[a-z0-9_]+\s+check\b/i);
  return next === -1 ? rest : rest.slice(0, next);
}

/** Quoted strings inside the first `array[…]`, or null when this check has no array. */
function arrayLiterals(body: string): readonly string[] | null {
  const array = /array\s*\[([\s\S]*?)\]/i.exec(body);
  if (!array || array[1] === undefined) return null;
  return [...array[1].matchAll(/'((?:[^']|'')*)'/g)].map((match) => match[1]?.replaceAll("''", "'") ?? "");
}
