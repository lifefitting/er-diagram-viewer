import { describe, expect, it } from 'vitest';
import type { Column, Schema, Table } from '../../parser/types';
import { nodeId } from '../buildGraph';
import { deriveSearchSelection } from './deriveSelection';

function column(name: string, comment?: string): Column {
  return {
    name,
    comment,
    rawType: 'VARCHAR(255)',
    normalizedType: 'string',
    nullable: true,
    isPrimaryKey: false,
    isUnique: false,
    hasIndex: false,
    isAutoIncrement: false,
  };
}

function table(name: string, columns: Column[], comment?: string): Table {
  return { name, columns, comment, primaryKey: [], indexes: [] };
}

const schema: Schema = {
  tables: [
    table('customer_accounts', [column('id'), column('email_address', 'primary contact')]),
    table('email_jobs', [column('id'), column('account_id')], 'outbound delivery'),
  ],
  explicitForeignKeys: [],
  warnings: [],
};

describe('search scope', () => {
  it('searches only table names in table scope', () => {
    expect(deriveSearchSelection(schema, [], 'email', 'table')?.matches).toEqual(
      new Set([nodeId('email_jobs')]),
    );
    expect(deriveSearchSelection(schema, [], 'account_id', 'table')?.matches).toEqual(new Set());
  });

  it('searches only field names in field scope', () => {
    expect(deriveSearchSelection(schema, [], 'account', 'field')?.matches).toEqual(
      new Set([nodeId('email_jobs')]),
    );
    expect(deriveSearchSelection(schema, [], 'email_jobs', 'field')?.matches).toEqual(new Set());
  });

  it('keeps the previous broad name/comment behavior in all scope', () => {
    expect(deriveSearchSelection(schema, [], 'primary contact', 'all')?.matches).toEqual(
      new Set([nodeId('customer_accounts')]),
    );
    expect(deriveSearchSelection(schema, [], 'outbound', 'all')?.matches).toEqual(
      new Set([nodeId('email_jobs')]),
    );
  });
});
