import { describe, it, expect } from 'vitest';
import { canonicalFkKey, splitQualified, applyIndexFlags } from './utils';
import type { ForeignKey, Table } from './types';

function blankTable(name: string): Table {
  return { name, columns: [], primaryKey: [], indexes: [] };
}

describe('canonicalFkKey', () => {
  it('is case-insensitive', () => {
    const a: ForeignKey = {
      fromTable: 'Users',
      fromColumns: ['Id'],
      toTable: 'Orders',
      toColumns: ['User_Id'],
      source: 'explicit',
    };
    const b: ForeignKey = {
      fromTable: 'users',
      fromColumns: ['id'],
      toTable: 'orders',
      toColumns: ['user_id'],
      source: 'explicit',
    };
    expect(canonicalFkKey(a)).toEqual(canonicalFkKey(b));
  });

  it('preserves direction (from -> to)', () => {
    const fk: ForeignKey = {
      fromTable: 'orders',
      fromColumns: ['user_id'],
      toTable: 'users',
      toColumns: ['id'],
      source: 'explicit',
    };
    expect(canonicalFkKey(fk)).toBe('orders.user_id->users.id');
  });

  it('handles composite columns', () => {
    const fk: ForeignKey = {
      fromTable: 'a',
      fromColumns: ['x', 'y'],
      toTable: 'b',
      toColumns: ['p', 'q'],
      source: 'explicit',
    };
    expect(canonicalFkKey(fk)).toBe('a.x,y->b.p,q');
  });
});

describe('splitQualified', () => {
  it('returns only name when there is no schema', () => {
    expect(splitQualified('users')).toEqual({ name: 'users' });
  });

  it('splits schema.name', () => {
    expect(splitQualified('public.users')).toEqual({ schema: 'public', name: 'users' });
  });

  it('unquotes identifiers', () => {
    expect(splitQualified('`public`.`users`')).toEqual({ schema: 'public', name: 'users' });
    expect(splitQualified('"public"."users"')).toEqual({ schema: 'public', name: 'users' });
  });
});

describe('applyIndexFlags', () => {
  it('marks single-column unique indexes as both hasIndex and isUnique', () => {
    const t: Table = {
      ...blankTable('t'),
      columns: [
        {
          name: 'email',
          rawType: 'varchar',
          normalizedType: 'string',
          nullable: false,
          isPrimaryKey: false,
          isUnique: false,
          hasIndex: false,
          isAutoIncrement: false,
        },
      ],
      indexes: [{ columns: ['email'], unique: true }],
    };
    applyIndexFlags(t);
    expect(t.columns[0].hasIndex).toBe(true);
    expect(t.columns[0].isUnique).toBe(true);
  });

  it('does not promote composite indexes onto column flags', () => {
    const t: Table = {
      ...blankTable('t'),
      columns: [
        {
          name: 'a',
          rawType: 'int',
          normalizedType: 'int',
          nullable: false,
          isPrimaryKey: false,
          isUnique: false,
          hasIndex: false,
          isAutoIncrement: false,
        },
      ],
      indexes: [{ columns: ['a', 'b'], unique: true }],
    };
    applyIndexFlags(t);
    expect(t.columns[0].hasIndex).toBe(false);
    expect(t.columns[0].isUnique).toBe(false);
  });
});
