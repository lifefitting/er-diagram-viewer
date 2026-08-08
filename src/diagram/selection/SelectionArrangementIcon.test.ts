import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SelectionArrangement } from './arrangeSelection';
import { SelectionArrangementIcon } from './SelectionArrangementIcon';

const operations: SelectionArrangement[] = [
  'align-left',
  'align-horizontal-center',
  'align-right',
  'align-top',
  'align-vertical-center',
  'align-bottom',
  'distribute-horizontal',
  'distribute-vertical',
];

describe('selection arrangement icons', () => {
  it('renders a distinct decorative SVG for every arrangement operation', () => {
    const rendered = operations.map((operation) =>
      renderToStaticMarkup(createElement(SelectionArrangementIcon, { operation })),
    );

    expect(new Set(rendered).size).toBe(operations.length);
    rendered.forEach((markup, index) => {
      expect(markup).toContain('<svg');
      expect(markup).toContain('aria-hidden="true"');
      expect(markup).toContain(`data-arrangement-icon="${operations[index]}"`);
    });
  });
});
