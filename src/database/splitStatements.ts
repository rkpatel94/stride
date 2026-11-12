/**
 * Splits an SQL script into single statements: Android's SQLite runs one statement per call.
 * Semicolons inside string literals, quoted identifiers and comments don't split. Comments are
 * dropped and empty statements skipped.
 */
export function splitSqlStatements(source: string): string[] {
  const statements: string[] = [];
  let current = '';
  const flush = () => {
    const statement = current.trim();
    if (statement) statements.push(statement);
    current = '';
  };

  let i = 0;
  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];
    if (char === '-' && next === '-') {
      // Line comment: skip to the end of the line (the line break itself is kept).
      const end = source.indexOf('\n', i);
      i = end === -1 ? source.length : end;
    } else if (char === '/' && next === '*') {
      // Block comment: replaced by a space so the tokens around it stay apart.
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
      current += ' ';
    } else if (char === "'" || char === '"' || char === '`' || char === '[') {
      // Quoted text runs to its closing quote; a doubled quote is an escaped quote.
      const close = char === '[' ? ']' : char;
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === close) {
          if (close !== ']' && source[j + 1] === close) {
            j += 2;
            continue;
          }
          break;
        }
        j += 1;
      }
      current += source.slice(i, j + 1);
      i = j + 1;
    } else if (char === ';') {
      flush();
      i += 1;
    } else {
      current += char;
      i += 1;
    }
  }
  flush();
  return statements;
}
