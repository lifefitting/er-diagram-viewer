import { describe, expect, it } from 'vitest';
import { derivePipeline, parseAndMergeSql } from './pipeline';

const SQL = `
CREATE TABLE users (id BIGINT PRIMARY KEY);
CREATE TABLE orders (
  id BIGINT PRIMARY KEY,
  user_id BIGINT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);`;

describe('pipeline staging', () => {
  it('reuses the immutable parse/merge stage for identical SQL', () => {
    const first = parseAndMergeSql(SQL);
    const second = parseAndMergeSql(SQL);
    expect(second).toBe(first);
    expect(derivePipeline(first, 'professional').schema).toBe(first);
  });
});
