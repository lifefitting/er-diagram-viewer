import { describe, it, expect } from 'vitest';
import { matchClosingParen, splitStatements, splitTopLevel, stripComments } from './tokenize';

describe('splitStatements', () => {
  it('does not split inside string literals containing ;', () => {
    const stmts = splitStatements("INSERT INTO t VALUES ('a;b'); SELECT 1;");
    expect(stmts).toHaveLength(2);
    expect(stmts[0].text).toContain("'a;b'");
  });

  it('handles SQL-standard doubled-quote escape (\'\')', () => {
    const stmts = splitStatements("INSERT INTO t VALUES ('O''Brien;'); SELECT 1;");
    expect(stmts).toHaveLength(2);
    expect(stmts[0].text).toContain("'O''Brien;'");
  });

  it('handles MySQL backslash escape (\\\')', () => {
    const stmts = splitStatements("INSERT INTO t VALUES ('a\\';b'); SELECT 1;");
    expect(stmts).toHaveLength(2);
  });

  it('treats double backslashes correctly (\\\\ inside a literal closes via the next quote)', () => {
    // 'a\\' should close immediately after the second backslash since the
    // first backslash escapes the second, leaving the apostrophe as the
    // unescaped closer.
    const stmts = splitStatements("INSERT INTO t VALUES ('a\\\\'); SELECT 1;");
    expect(stmts).toHaveLength(2);
  });
});

describe('stripComments', () => {
  it('removes line comments but keeps the newline', () => {
    const out = stripComments('SELECT 1 -- a comment\n FROM t');
    expect(out).not.toContain('comment');
    expect(out).toContain('SELECT 1');
    expect(out).toContain('FROM t');
  });

  it('removes block comments', () => {
    const out = stripComments('SELECT /* skip */ 1');
    expect(out).not.toContain('skip');
    expect(out).toContain('SELECT');
    expect(out).toContain('1');
  });

  it('does not strip comment-like sequences inside string literals', () => {
    const out = stripComments("SELECT 'a -- not a comment'");
    expect(out).toContain('-- not a comment');
  });
});

describe('splitTopLevel', () => {
  it('splits on commas at depth 0 only', () => {
    expect(splitTopLevel('a, b, c')).toEqual(['a', 'b', 'c']);
    expect(splitTopLevel('a, foo(1, 2), b')).toEqual(['a', 'foo(1, 2)', 'b']);
  });

  it('does not split inside string literals', () => {
    expect(splitTopLevel("a, 'x, y', b")).toEqual(['a', "'x, y'", 'b']);
  });

  it('handles SQL doubled-quote escape inside literals', () => {
    expect(splitTopLevel("a, 'O''Brien, Inc.', b")).toEqual(['a', "'O''Brien, Inc.'", 'b']);
  });
});

describe('matchClosingParen', () => {
  it('finds the matching close paren', () => {
    const s = '(a (b) c)';
    expect(matchClosingParen(s, 0)).toBe(s.length - 1);
  });

  it('ignores parens inside string literals', () => {
    const s = "( 'a (b' )";
    expect(matchClosingParen(s, 0)).toBe(s.length - 1);
  });
});
