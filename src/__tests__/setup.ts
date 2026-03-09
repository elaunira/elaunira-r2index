import { env } from 'cloudflare:test';

const migrationModules = import.meta.glob<string>(
  '../../migrations/*.sql',
  { query: '?raw', import: 'default', eager: true }
);

function parseSqlStatements(sql: string): string[] {
  const stripped = sql.replace(/--.*$/gm, '');
  return stripped
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function setupDatabase() {
  // Sort migration files by name to apply in order
  const sortedEntries = Object.entries(migrationModules).sort(([a], [b]) =>
    a.localeCompare(b)
  );

  for (const [, sql] of sortedEntries) {
    const statements = parseSqlStatements(sql);
    if (statements.length > 0) {
      await env.D1.batch(statements.map((s) => env.D1.prepare(s)));
    }
  }
}
