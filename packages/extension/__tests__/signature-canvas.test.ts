import { describe, it, expect } from 'vitest';
import { StrokeRecorder } from '../src/lib/signature-canvas';

describe('StrokeRecorder', () => {
  it('starts with empty strokes', () => {
    const recorder = new StrokeRecorder();
    expect(recorder.getStrokes()).toEqual([]);
    expect(recorder.isEmpty()).toBe(true);
  });

  it('records a stroke', () => {
    const recorder = new StrokeRecorder();
    recorder.beginStroke(10, 20);
    recorder.addPoint(15, 25);
    recorder.addPoint(20, 30);
    recorder.endStroke();
    expect(recorder.getStrokes()).toHaveLength(1);
    expect(recorder.getStrokes()[0]).toEqual([
      { x: 10, y: 20 },
      { x: 15, y: 25 },
      { x: 20, y: 30 },
    ]);
    expect(recorder.isEmpty()).toBe(false);
  });

  it('undoes last stroke', () => {
    const recorder = new StrokeRecorder();
    recorder.beginStroke(10, 20);
    recorder.addPoint(15, 25);
    recorder.endStroke();
    recorder.beginStroke(30, 40);
    recorder.addPoint(35, 45);
    recorder.endStroke();
    expect(recorder.getStrokes()).toHaveLength(2);
    recorder.undo();
    expect(recorder.getStrokes()).toHaveLength(1);
  });

  it('clears all strokes', () => {
    const recorder = new StrokeRecorder();
    recorder.beginStroke(10, 20);
    recorder.endStroke();
    recorder.clear();
    expect(recorder.isEmpty()).toBe(true);
  });
});
