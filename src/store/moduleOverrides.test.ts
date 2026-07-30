import { describe, expect, it } from 'vitest';
import { nodeId } from '../diagram/nodeId';
import { useApp } from './index';

const SQL = [
  'CREATE TABLE users (id BIGINT PRIMARY KEY);',
  'CREATE TABLE user_profile (id BIGINT PRIMARY KEY, user_id BIGINT);',
  'CREATE TABLE orders (id BIGINT PRIMARY KEY);',
  'CREATE TABLE order_items (id BIGINT PRIMARY KEY, order_id BIGINT, FOREIGN KEY (order_id) REFERENCES orders(id));',
].join('\n');

describe('manual module assignments', () => {
  it('applies a batch assignment after inference and survives reparse/palette changes', () => {
    useApp.getState().setSql(SQL);
    const automatic = useApp.getState().modules;
    const userModule = automatic.byTable.get('users');
    const orderModule = automatic.byTable.get('orders');
    expect(userModule).toBeTruthy();
    expect(orderModule).toBeTruthy();
    expect(userModule).not.toBe(orderModule);

    const selected = [nodeId('users'), nodeId('user_profile')];
    useApp.getState().assignTablesToModule(selected, orderModule!);
    expect(useApp.getState().moduleOverrides).toEqual({
      [nodeId('users')]: orderModule,
      [nodeId('user_profile')]: orderModule,
    });
    expect(useApp.getState().modules.byTable.get('users')).toBe(orderModule);
    expect(useApp.getState().modules.byTable.get('user_profile')).toBe(orderModule);

    useApp.getState().setPalette('vibrant');
    expect(useApp.getState().modules.byTable.get('users')).toBe(orderModule);
    useApp.getState().reparse();
    expect(useApp.getState().modules.byTable.get('user_profile')).toBe(orderModule);

    useApp.getState().assignTablesToModule(selected, null);
    expect(useApp.getState().moduleOverrides).toEqual({});
    expect(useApp.getState().modules.byTable.get('users')).toBe(userModule);
    expect(useApp.getState().modules.byTable.get('user_profile')).toBe(userModule);
  });

  it('clears assignments for a newly imported SQL schema', () => {
    useApp.getState().setSql(SQL);
    const orderModule = useApp.getState().modules.byTable.get('orders')!;
    useApp.getState().assignTablesToModule([nodeId('users')], orderModule);
    expect(Object.keys(useApp.getState().moduleOverrides)).toHaveLength(1);

    useApp.getState().setSql('CREATE TABLE fresh_table (id INT PRIMARY KEY);');
    expect(useApp.getState().moduleOverrides).toEqual({});
  });
});
