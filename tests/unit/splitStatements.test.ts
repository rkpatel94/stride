import { MIGRATIONS } from '@/database/migrations';
import { splitSqlStatements } from '@/database/splitStatements';

type NodeSqlite = {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void;
    prepare(sql: string): { all(): Record<string, unknown>[] };
    close(): void;
  };
};

describe('splitSqlStatements', () => {
  it('splits a script into trimmed statements and drops empty ones', () => {
    expect(splitSqlStatements('CREATE TABLE a (x);\n  CREATE INDEX i ON a (x) ;;  ')).toEqual([
      'CREATE TABLE a (x)',
      'CREATE INDEX i ON a (x)',
    ]);
  });

  it('keeps semicolons inside strings and quoted identifiers', () => {
    expect(splitSqlStatements(`INSERT INTO t VALUES ('a;b', 'it''s; fine'); SELECT "c;d", [e;f], \`g;h\` FROM t`)).toEqual([
      "INSERT INTO t VALUES ('a;b', 'it''s; fine')",
      'SELECT "c;d", [e;f], `g;h` FROM t',
    ]);
  });

  it('drops comments, including ones that contain semicolons', () => {
    expect(splitSqlStatements('-- first; not a statement\nSELECT 1; /* second; */ SELECT/**/2;\n-- trailing;')).toEqual([
      'SELECT 1',
      'SELECT 2',
    ]);
  });

  it('runs every migration statement by statement to the same schema as the whole script', () => {
    const sqlite = process.getBuiltinModule('node:sqlite') as unknown as NodeSqlite;
    const schema = (run: (db: InstanceType<NodeSqlite['DatabaseSync']>) => void) => {
      const db = new sqlite.DatabaseSync(':memory:');
      run(db);
      const rows = db.prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY name').all();
      db.close();
      return rows;
    };
    const whole = schema((db) => MIGRATIONS.forEach((migration) => db.exec(migration.sql)));
    const split = schema((db) =>
      MIGRATIONS.forEach((migration) => splitSqlStatements(migration.sql).forEach((statement) => db.exec(statement))),
    );
    expect(split).toEqual(whole);
    expect(whole.length).toBeGreaterThan(5);
  });
});
