// Read-only check: do the TypeORM entities match the live database?
//   npm run build && node scripts/check-schema.mjs
// Compares every entity column with information_schema.columns and every
// ManyToOne relation with the real FOREIGN KEY constraints.
import ds from '../dist/database/data-source.js';

await ds.initialize();
const cols = await ds.query(`SELECT table_name, column_name, is_nullable, udt_name FROM information_schema.columns WHERE table_schema = 'public'`);
const fks = await ds.query(`
  SELECT tc.table_name, kcu.column_name, ccu.table_name AS ref_table
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
  JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
  WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`);

const problems = [];
let columnCount = 0;
let relationCount = 0;
for (const meta of ds.entityMetadatas) {
  const table = meta.tableName;
  const dbCols = cols.filter((c) => c.table_name === table);
  if (!dbCols.length) { problems.push(`missing table ${table}`); continue; }
  for (const c of meta.columns) {
    columnCount++;
    const db = dbCols.find((d) => d.column_name === c.databaseName);
    if (!db) { problems.push(`${table}.${c.databaseName}: column missing in database`); continue; }
    const dbNullable = db.is_nullable === 'YES';
    if (!c.isPrimary && dbNullable !== c.isNullable) problems.push(`${table}.${c.databaseName}: nullable entity=${c.isNullable} db=${dbNullable}`);
    if (c.type === 'enum' && db.udt_name !== c.enumName) problems.push(`${table}.${c.databaseName}: enum entity=${c.enumName} db=${db.udt_name}`);
  }
  for (const d of dbCols) {
    if (!meta.columns.some((c) => c.databaseName === d.column_name)) problems.push(`${table}.${d.column_name}: in database but not in entity`);
  }
  for (const r of meta.manyToOneRelations) {
    relationCount++;
    const col = r.joinColumns[0].databaseName;
    const ref = r.inverseEntityMetadata.tableName;
    if (!fks.some((f) => f.table_name === table && f.column_name === col && f.ref_table === ref)) {
      problems.push(`${table}.${col} -> ${ref}: no matching FOREIGN KEY in database`);
    }
  }
}
// every DB foreign key should be mapped as a relation
for (const f of fks) {
  const meta = ds.entityMetadatas.find((m) => m.tableName === f.table_name);
  if (meta && !meta.manyToOneRelations.some((r) => r.joinColumns[0].databaseName === f.column_name)) {
    problems.push(`${f.table_name}.${f.column_name} -> ${f.ref_table}: FOREIGN KEY not mapped as a relation`);
  }
}
console.log(`entities: ${ds.entityMetadatas.length}, columns: ${columnCount}, relations: ${relationCount}, db foreign keys: ${fks.length}`);
console.log(problems.length ? `PROBLEMS (${problems.length}):\n - ${problems.join('\n - ')}` : 'OK – entities match the database');
await ds.destroy();
