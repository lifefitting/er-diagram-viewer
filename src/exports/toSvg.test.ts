import { describe, expect, it } from 'vitest';
import cytoscape from 'cytoscape';
import { parseSql } from '../parser';
import { inferModules } from '../infer/inferModules';
import { PALETTE_OPTIONS } from '../infer/paletteCatalog';
import { buildElements } from '../diagram/buildGraph';
import { buildDiagramSvg } from './toSvg';

describe('palette colors in the shared SVG/PNG renderer', () => {
  it.each(PALETTE_OPTIONS)(
    'renders $id headers and independent light/dark connectors',
    ({ id }) => {
      const schema = parseSql(
        'CREATE TABLE account (id INT PRIMARY KEY); CREATE TABLE invoice (id INT PRIMARY KEY, account_id INT REFERENCES account(id));',
      );
      expect(schema.explicitForeignKeys).toHaveLength(1);
      const modules = inferModules(schema, schema.explicitForeignKeys, id);
      const display = {
        onlyPk: false,
        showType: true,
        showComment: false,
        showIndex: true,
        showLowConfidence: false,
        showGrid: false,
        showLogicalLinks: true,
        showManualLinks: true,
      };
      const { elements } = buildElements(schema, schema.explicitForeignKeys, {
        modules,
        display,
        collapsed: {},
        tableWidths: {},
        decisions: {},
      });
      const cy = cytoscape({ headless: true, elements, layout: { name: 'preset' } });
      try {
        cy.nodes().forEach((n, i) => {
          n.position({ x: 200 + i * 400, y: 200 });
        });
        cy.edges().data({ srcEndpoint: '-120px 20px', tgtEndpoint: '120px 0px' });
        const color = modules.modules.get(modules.byTable.get('invoice')!)!.color;
        for (const theme of ['light', 'dark'] as const) {
          const svg = buildDiagramSvg(cy, {
            schema,
            modules,
            display,
            fkSourceColumns: new Map(),
            theme,
          });
          expect(svg).toContain(`fill="${color.header}"`);
          expect(svg).toContain(`fill="${color.text}"`);
          const titleColors = [
            ...svg.matchAll(/<text[^>]*font-size="13"[^>]*font-weight="600"[^>]*fill="([^"]+)"/g),
          ].map((match) => match[1]);
          expect(titleColors).toHaveLength(2);
          expect(new Set(titleColors)).toEqual(new Set([id === 'pastel' ? '#1f2937' : '#ffffff']));
          expect(svg).toMatch(
            new RegExp(
              `<polyline[^>]+stroke="${theme === 'dark' ? color.headerDark : color.edgeLight}"`,
            ),
          );
          expect(svg).not.toMatch(/undefined|NaN/);
        }
      } finally {
        cy.destroy();
      }
    },
  );
});
