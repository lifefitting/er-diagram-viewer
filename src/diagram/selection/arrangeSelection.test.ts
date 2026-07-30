import { describe, expect, it } from 'vitest';
import { arrangeSelection, type ArrangeBox } from './arrangeSelection';

const boxes: ArrangeBox[] = [
  { id: 'a', x: 50, y: 50, width: 20, height: 20 },
  { id: 'b', x: 140, y: 160, width: 40, height: 40 },
  { id: 'c', x: 190, y: 230, width: 60, height: 60 },
];

describe('arrange selected tables', () => {
  it('aligns left, center and right using the selection outer bounds', () => {
    expect(arrangeSelection(boxes, 'align-left')).toEqual({
      a: { x: 50, y: 50 },
      b: { x: 60, y: 160 },
      c: { x: 70, y: 230 },
    });
    expect(arrangeSelection(boxes, 'align-horizontal-center')).toEqual({
      a: { x: 130, y: 50 },
      b: { x: 130, y: 160 },
      c: { x: 130, y: 230 },
    });
    expect(arrangeSelection(boxes, 'align-right')).toEqual({
      a: { x: 210, y: 50 },
      b: { x: 200, y: 160 },
      c: { x: 190, y: 230 },
    });
  });

  it('aligns top, center and bottom using the selection outer bounds', () => {
    expect(arrangeSelection(boxes, 'align-top')).toEqual({
      a: { x: 50, y: 50 },
      b: { x: 140, y: 60 },
      c: { x: 190, y: 70 },
    });
    expect(arrangeSelection(boxes, 'align-vertical-center')).toEqual({
      a: { x: 50, y: 150 },
      b: { x: 140, y: 150 },
      c: { x: 190, y: 150 },
    });
    expect(arrangeSelection(boxes, 'align-bottom')).toEqual({
      a: { x: 50, y: 250 },
      b: { x: 140, y: 240 },
      c: { x: 190, y: 230 },
    });
  });

  it('distributes visible horizontal and vertical gaps while preserving outer objects', () => {
    expect(arrangeSelection(boxes, 'distribute-horizontal')).toEqual({
      a: { x: 50, y: 50 },
      b: { x: 110, y: 160 },
      c: { x: 190, y: 230 },
    });
    expect(arrangeSelection(boxes, 'distribute-vertical')).toEqual({
      a: { x: 50, y: 50 },
      b: { x: 140, y: 130 },
      c: { x: 190, y: 230 },
    });
  });

  it('leaves two objects unchanged for distribution', () => {
    expect(arrangeSelection(boxes.slice(0, 2), 'distribute-horizontal')).toEqual({
      a: { x: 50, y: 50 },
      b: { x: 140, y: 160 },
    });
  });
});
