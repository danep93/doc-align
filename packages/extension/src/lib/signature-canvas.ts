export interface Point {
  x: number;
  y: number;
}

export type Stroke = Point[];

export class StrokeRecorder {
  private strokes: Stroke[] = [];
  private currentStroke: Stroke | null = null;

  beginStroke(x: number, y: number): void {
    this.currentStroke = [{ x, y }];
  }

  addPoint(x: number, y: number): void {
    if (this.currentStroke) {
      this.currentStroke.push({ x, y });
    }
  }

  endStroke(): void {
    if (this.currentStroke && this.currentStroke.length > 0) {
      this.strokes.push(this.currentStroke);
    }
    this.currentStroke = null;
  }

  undo(): void {
    this.strokes.pop();
  }

  clear(): void {
    this.strokes = [];
    this.currentStroke = null;
  }

  isEmpty(): boolean {
    return this.strokes.length === 0;
  }

  getStrokes(): Stroke[] {
    return [...this.strokes];
  }
}

export class SignatureCanvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private recorder: StrokeRecorder;
  private isDrawing = false;
  private lineWidth = 2;
  private strokeColor = '#1a1a2e';

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.recorder = new StrokeRecorder();
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.canvas.addEventListener('pointerdown', this.onPointerDown.bind(this));
    this.canvas.addEventListener('pointermove', this.onPointerMove.bind(this));
    this.canvas.addEventListener('pointerup', this.onPointerUp.bind(this));
    this.canvas.addEventListener('pointerleave', this.onPointerUp.bind(this));
  }

  private getCanvasPoint(e: PointerEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  private onPointerDown(e: PointerEvent): void {
    this.isDrawing = true;
    const point = this.getCanvasPoint(e);
    this.recorder.beginStroke(point.x, point.y);
    this.ctx.beginPath();
    this.ctx.moveTo(point.x, point.y);
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.isDrawing) return;
    const point = this.getCanvasPoint(e);
    this.recorder.addPoint(point.x, point.y);
    this.ctx.lineTo(point.x, point.y);
    this.ctx.strokeStyle = this.strokeColor;
    this.ctx.lineWidth = this.lineWidth;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.stroke();
  }

  private onPointerUp(): void {
    if (this.isDrawing) {
      this.isDrawing = false;
      this.recorder.endStroke();
    }
  }

  undo(): void {
    this.recorder.undo();
    this.redraw();
  }

  clear(): void {
    this.recorder.clear();
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  isEmpty(): boolean {
    return this.recorder.isEmpty();
  }

  private redraw(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const stroke of this.recorder.getStrokes()) {
      if (stroke.length < 2) continue;
      this.ctx.beginPath();
      this.ctx.moveTo(stroke[0]!.x, stroke[0]!.y);
      for (let i = 1; i < stroke.length; i++) {
        this.ctx.lineTo(stroke[i]!.x, stroke[i]!.y);
      }
      this.ctx.strokeStyle = this.strokeColor;
      this.ctx.lineWidth = this.lineWidth;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.stroke();
    }
  }

  toDataURL(): string {
    return this.canvas.toDataURL('image/png');
  }

  getRecorder(): StrokeRecorder {
    return this.recorder;
  }
}
