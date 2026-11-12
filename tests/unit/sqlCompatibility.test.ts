import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * The app database is Android's built-in SQLite, which is 3.9 on Android 7 (minSdk 24). This
 * catches SQL written for newer versions before it reaches a phone that cannot run it. SQL in the
 * app is written in upper case; comments describe these features in lower case.
 */
const UNSUPPORTED: [RegExp, string][] = [
  [/\bON CONFLICT\b|\bDO (?:UPDATE|NOTHING)\b/, 'UPSERT (SQLite 3.24): use INSERT OR IGNORE / OR REPLACE, or UPDATE then INSERT'],
  [/\bRETURNING\b/, 'RETURNING (SQLite 3.35)'],
  [/\bOVER\s*\(/, 'window functions (SQLite 3.25)'],
  [/\bFILTER\s*\(\s*WHERE\b/, 'aggregate FILTER (SQLite 3.30)'],
  [/\bNULLS (?:FIRST|LAST)\b/, 'NULLS FIRST/LAST (SQLite 3.30)'],
  [/\bGENERATED ALWAYS\b/, 'generated columns (SQLite 3.31)'],
  [/\bIS (?:NOT )?DISTINCT FROM\b/, 'IS DISTINCT FROM (SQLite 3.39)'],
  [/\bSTRICT\b/, 'STRICT tables (SQLite 3.37)'],
];

const srcDir = join(__dirname, '..', '..', 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'vendor' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('SQL compatibility with Android 7', () => {
  it('uses no SQL newer than SQLite 3.9', () => {
    const problems: string[] = [];
    for (const file of sourceFiles(srcDir)) {
      const source = readFileSync(file, 'utf8');
      for (const [pattern, feature] of UNSUPPORTED) {
        if (pattern.test(source)) problems.push(`${relative(srcDir, file)}: ${feature}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
