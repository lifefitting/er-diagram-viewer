import { beforeEach, describe, expect, it } from 'vitest';
import { useApp } from './index';

// Guards the persistence lifecycle of the canvas camera (pan + zoom): it must
// be cleared on a new import (setSql) but survive a refresh (reparse), exactly
// like nodePositions. This is what makes a refresh restore the same on-screen
// view instead of resetting the camera.
const SQL = 'CREATE TABLE a (id BIGINT PRIMARY KEY);';

describe('viewport persistence lifecycle', () => {
  beforeEach(() => {
    // Known baseline: a fresh import nulls the viewport.
    useApp.getState().setSql(SQL);
  });

  it('setViewport stores the camera', () => {
    useApp.getState().setViewport({ x: -100, y: 50, zoom: 2 });
    expect(useApp.getState().viewport).toEqual({ x: -100, y: 50, zoom: 2 });
  });

  it('a new import (setSql) clears the viewport', () => {
    useApp.getState().setViewport({ x: 1, y: 2, zoom: 1.5 });
    useApp.getState().setSql(SQL);
    expect(useApp.getState().viewport).toBeNull();
  });

  it('a refresh (reparse) preserves the viewport', () => {
    useApp.getState().setViewport({ x: 9, y: 8, zoom: 1.25 });
    useApp.getState().reparse();
    expect(useApp.getState().viewport).toEqual({ x: 9, y: 8, zoom: 1.25 });
  });
});
