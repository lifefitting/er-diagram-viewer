export interface Statement {
  text: string;
  startLine: number;
  endLine: number;
}

/**
 * Inside `'...'` (or `"..."` / `` `...` ``), decide whether the quote char at
 * position `i` actually closes the literal. Returns either:
 *   - { close: true, next }  — consume up to `next` and exit the literal
 *   - { close: false, next } — the quote is escaped; consume up to `next` and
 *                              stay inside
 *
 * Handles two escape conventions:
 *   1. SQL-standard doubled quote: `''` inside a single-quoted literal is one
 *      literal apostrophe. Same for `""` inside `"..."`.
 *   2. MySQL backslash escapes: `\'`, `\"`, `\\` etc. We treat a preceding
 *      backslash as escaping only if it is *not itself* escaped (i.e. count
 *      consecutive backslashes — odd means the closer is escaped).
 *
 * Backticks have no escape sequence in MySQL and don't pass through this
 * helper; callers handle them with a plain equality check.
 */
function isEscapedClose(text: string, i: number, quote: string): boolean {
  // Doubled-quote (SQL standard) — peek ahead.
  if (text[i + 1] === quote) return true;
  // Backslash escape (MySQL / SQLite) — count preceding backslashes.
  let bs = 0;
  for (let k = i - 1; k >= 0 && text[k] === '\\'; k--) bs++;
  return bs % 2 === 1;
}

/**
 * Advance past a string literal starting at `i` (which must point at the
 * opening quote `'` or `"`). Returns the index of the closing quote (or
 * `text.length` if the literal is unterminated). The caller is expected to
 * include character at `i` in its accumulator before calling.
 */
function scanStringLiteral(text: string, i: number, quote: '\'' | '"'): number {
  let j = i + 1;
  while (j < text.length) {
    if (text[j] === quote) {
      if (isEscapedClose(text, j, quote)) {
        // Skip the doubled quote (two chars) — or the single escaped char if
        // it was a `\'` backslash escape (one char). Detect which.
        if (text[j + 1] === quote) {
          j += 2;
          continue;
        }
        j += 1;
        continue;
      }
      return j;
    }
    j++;
  }
  return text.length;
}

/**
 * Split a SQL script into top-level statements separated by `;`.
 * Skips content inside string literals, identifier quotes, line/block comments.
 */
export function splitStatements(sql: string): Statement[] {
  const stmts: Statement[] = [];
  let buf = '';
  let line = 1;
  let startLine = 1;

  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    const next = sql[i + 1];

    if (c === '\n') line++;

    if (c === '-' && next === '-') {
      // Line comment to end-of-line (preserved verbatim so line counts stay
      // accurate; `stripComments` removes them before structural parsing).
      while (i < sql.length && sql[i] !== '\n') {
        buf += sql[i];
        i++;
      }
      if (i < sql.length) {
        buf += sql[i]; // newline
        line++;
      }
      continue;
    }
    if (c === '/' && next === '*') {
      buf += c;
      buf += next;
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) {
        if (sql[i] === '\n') line++;
        buf += sql[i];
        i++;
      }
      if (i < sql.length) {
        buf += sql[i];
        buf += sql[i + 1];
        i++;
      }
      continue;
    }
    if (c === "'" || c === '"') {
      const end = scanStringLiteral(sql, i, c);
      buf += sql.slice(i, end + 1);
      // Count newlines inside the literal so line numbers stay correct.
      for (let k = i; k <= end && k < sql.length; k++) if (sql[k] === '\n') line++;
      i = end;
      continue;
    }
    if (c === '`') {
      buf += c;
      i++;
      while (i < sql.length && sql[i] !== '`') {
        if (sql[i] === '\n') line++;
        buf += sql[i];
        i++;
      }
      if (i < sql.length) buf += sql[i];
      continue;
    }
    if (c === ';') {
      const text = buf.trim();
      if (text) stmts.push({ text, startLine, endLine: line });
      buf = '';
      startLine = line;
      continue;
    }
    buf += c;
  }

  const trailing = buf.trim();
  if (trailing) stmts.push({ text: trailing, startLine, endLine: line });
  return stmts;
}

/** Strip inline comments inside a statement body (preserving structure). */
export function stripComments(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (c === '-' && n === '-') {
      while (i < text.length && text[i] !== '\n') i++;
      if (i < text.length) out += text[i]; // keep newline
      continue;
    }
    if (c === '/' && n === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++; // land on '/' so loop's i++ lands past it
      continue;
    }
    if (c === "'" || c === '"') {
      const end = scanStringLiteral(text, i, c);
      out += text.slice(i, end + 1);
      i = end;
      continue;
    }
    if (c === '`') {
      out += c;
      i++;
      while (i < text.length && text[i] !== '`') {
        out += text[i];
        i++;
      }
      if (i < text.length) out += text[i];
      continue;
    }
    out += c;
  }
  return out;
}

/** Strip an identifier's quoting (backticks, double quotes, or square brackets). */
export function unquoteIdent(s: string): string {
  const t = s.trim();
  if (!t) return t;
  if (
    (t.startsWith('`') && t.endsWith('`')) ||
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith('[') && t.endsWith(']'))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

/**
 * Split a comma-separated list, respecting parens and quoted strings.
 * Used to split column definitions inside CREATE TABLE (...).
 */
export function splitTopLevel(input: string, sep = ','): string[] {
  const out: string[] = [];
  let buf = '';
  let depth = 0;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === "'" || c === '"') {
      const end = scanStringLiteral(input, i, c);
      buf += input.slice(i, end + 1);
      i = end;
      continue;
    }
    if (c === '`') {
      buf += c;
      i++;
      while (i < input.length && input[i] !== '`') {
        buf += input[i];
        i++;
      }
      if (i < input.length) buf += input[i];
      continue;
    }
    if (c === '(') {
      depth++;
      buf += c;
      continue;
    }
    if (c === ')') {
      depth--;
      buf += c;
      continue;
    }
    if (c === sep && depth === 0) {
      out.push(buf);
      buf = '';
      continue;
    }
    buf += c;
  }
  if (buf.trim().length > 0) out.push(buf);
  return out.map((s) => s.trim()).filter(Boolean);
}

/**
 * Find the matching `)` for an `(` at `openIdx`. Skips parens inside string
 * literals and backtick-quoted identifiers. Returns -1 if unmatched.
 */
export function matchClosingParen(s: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i];
    if (c === "'" || c === '"') {
      i = scanStringLiteral(s, i, c);
      continue;
    }
    if (c === '`') {
      i++;
      while (i < s.length && s[i] !== '`') i++;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
