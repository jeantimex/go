import { GoGame, Position } from './game';
import { AnalysisResponse } from './analysis';

export class BoardRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private game: GoGame;
  private cellSize: number = 32;
  private padding: number = 40;
  private hoverPos: Position | null = null;
  showLastMove: boolean = true;
  showOwnership: boolean = false;
  private analysis: AnalysisResponse | null = null;
  private boardCache: HTMLCanvasElement | null = null;

  private readonly starPoints19 = [
    [3, 3], [9, 3], [15, 3],
    [3, 9], [9, 9], [15, 9],
    [3, 15], [9, 15], [15, 15]
  ];

  private readonly starPoints13 = [
    [3, 3], [6, 3], [9, 3],
    [3, 6], [6, 6], [9, 6],
    [3, 9], [6, 9], [9, 9]
  ];

  private readonly starPoints9 = [
    [2, 2], [4, 2], [6, 2],
    [2, 4], [4, 4], [6, 4],
    [2, 6], [4, 6], [6, 6]
  ];

  constructor(canvas: HTMLCanvasElement, game: GoGame) {
    // Clone canvas to remove existing event listeners from previous renderers
    const newCanvas = canvas.cloneNode(true) as HTMLCanvasElement;
    if (canvas.parentNode) {
      canvas.parentNode.replaceChild(newCanvas, canvas);
    }
    
    this.canvas = newCanvas;
    this.ctx = newCanvas.getContext('2d')!;
    this.game = game;
    this.setupCanvas();
    this.setupEventListeners();
  }

  private setupCanvas(): void {
    const boardPixelSize = this.cellSize * (this.game.size - 1) + this.padding * 2;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = boardPixelSize * dpr;
    this.canvas.height = boardPixelSize * dpr;
    this.canvas.style.width = `${boardPixelSize}px`;
    this.canvas.style.height = `${boardPixelSize}px`;
    this.ctx.scale(dpr, dpr);
    this.boardCache = null;
  }

  private setupEventListeners(): void {
    this.canvas.addEventListener('click', (e) => this.handleClick(e));
    this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    this.canvas.addEventListener('mouseleave', () => {
      this.hoverPos = null;
      this.render();
    });
  }

  private getGridPosition(clientX: number, clientY: number): Position | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.round((clientX - rect.left - this.padding) / this.cellSize);
    const y = Math.round((clientY - rect.top - this.padding) / this.cellSize);
    if (this.game.isValidPosition(x, y)) {
      return { x, y };
    }
    return null;
  }

  private handleClick(e: MouseEvent): void {
    const pos = this.getGridPosition(e.clientX, e.clientY);
    if (pos) {
      if (this.game.isReplayMode) {
        this.game.exitReplayMode();
      }
      if (this.game.placeStone(pos.x, pos.y)) {
        this.render();
        this.onMove?.();
      }
    }
  }

  private handleMouseMove(e: MouseEvent): void {
    const pos = this.getGridPosition(e.clientX, e.clientY);
    if (pos?.x !== this.hoverPos?.x || pos?.y !== this.hoverPos?.y) {
      this.hoverPos = pos;
      this.render();
    }
  }

  onMove?: () => void;

  setAnalysis(analysis: AnalysisResponse | null): void {
    this.analysis = analysis;
    this.render();
  }

  clearAnalysis(): void {
    this.analysis = null;
  }

  render(): void {
    this.drawBoard();
    this.drawStones();
    if (this.showOwnership && this.analysis?.ownership) {
      this.drawOwnership();
    }
    if (this.showLastMove && this.game.lastMove) {
      this.drawLastMoveMarker(this.game.lastMove.x, this.game.lastMove.y);
    }
    if (this.analysis) {
      this.drawSuggestedMoves();
    }
    this.drawHoverStone();
  }

  private drawBoard(): void {
    const size = this.cellSize * (this.game.size - 1) + this.padding * 2;

    if (!this.boardCache) {
      this.boardCache = document.createElement('canvas');
      this.boardCache.width = size;
      this.boardCache.height = size;
      const cacheCtx = this.boardCache.getContext('2d')!;

      cacheCtx.fillStyle = '#DCB468';
      cacheCtx.fillRect(0, 0, size, size);

      this.drawWoodGrain(cacheCtx, size);
      this.drawGridLines(cacheCtx);
      this.drawStarPoints(cacheCtx);
      this.drawCoordinates(cacheCtx);
    }

    this.ctx.drawImage(this.boardCache, 0, 0);
  }

  private drawWoodGrain(ctx: CanvasRenderingContext2D, size: number): void {
    ctx.save();
    ctx.globalAlpha = 0.12;
    for (let i = 0; i < size; i += 4) {
      ctx.strokeStyle = '#B8956B';
      ctx.lineWidth = Math.random() * 1.5 + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, i + Math.random() * 2);
      let x = 0;
      while (x < size) {
        x += Math.random() * 20 + 8;
        ctx.lineTo(x, i + Math.random() * 1.5);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawGridLines(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1;

    const start = this.padding;
    const end = this.padding + (this.game.size - 1) * this.cellSize;

    for (let i = 0; i < this.game.size; i++) {
      const pos = Math.floor(this.padding + i * this.cellSize) + 0.5;

      ctx.beginPath();
      ctx.moveTo(pos, start);
      ctx.lineTo(pos, end);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(start, pos);
      ctx.lineTo(end, pos);
      ctx.stroke();
    }
  }

  private getStarPoints(): number[][] {
    if (this.game.size === 19) return this.starPoints19;
    if (this.game.size === 13) return this.starPoints13;
    if (this.game.size === 9) return this.starPoints9;
    return [];
  }

  private drawStarPoints(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#222';
    const starPoints = this.getStarPoints();

    for (const [x, y] of starPoints) {
      const px = this.padding + x * this.cellSize;
      const py = this.padding + y * this.cellSize;
      ctx.beginPath();
      ctx.arc(px, py, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawCoordinates(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#444';
    ctx.font = '600 13px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const letters = 'ABCDEFGHJKLMNOPQRST';

    for (let i = 0; i < this.game.size; i++) {
      const x = this.padding + i * this.cellSize;
      const y = this.padding + i * this.cellSize;

      ctx.fillText(letters[i], x, 14);
      ctx.fillText(letters[i], x, this.padding + (this.game.size - 1) * this.cellSize + 26);

      const num = (this.game.size - i).toString();
      ctx.fillText(num, 14, y);
      ctx.fillText(num, this.padding + (this.game.size - 1) * this.cellSize + 26, y);
    }
  }

  private drawStones(): void {
    for (let y = 0; y < this.game.size; y++) {
      for (let x = 0; x < this.game.size; x++) {
        const stone = this.game.getStone(x, y);
        if (stone) {
          this.drawStone(x, y, stone);
        }
      }
    }
  }

  private drawStone(x: number, y: number, color: 'black' | 'white'): void {
    const px = this.padding + x * this.cellSize;
    const py = this.padding + y * this.cellSize;
    const radius = this.cellSize * 0.46;

    // Draw soft shadow
    const shadowOffset = 2.5;
    const shadowGradient = this.ctx.createRadialGradient(
      px + shadowOffset,
      py + shadowOffset,
      radius * 0.5,
      px + shadowOffset,
      py + shadowOffset,
      radius * 1.15
    );
    shadowGradient.addColorStop(0, 'rgba(0, 0, 0, 0.35)');
    shadowGradient.addColorStop(0.6, 'rgba(0, 0, 0, 0.12)');
    shadowGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    this.ctx.beginPath();
    this.ctx.arc(px + shadowOffset, py + shadowOffset, radius * 1.15, 0, Math.PI * 2);
    this.ctx.fillStyle = shadowGradient;
    this.ctx.fill();

    // Draw stone
    this.ctx.beginPath();
    this.ctx.arc(px, py, radius, 0, Math.PI * 2);

    const gradient = this.ctx.createRadialGradient(
      px - radius * 0.35,
      py - radius * 0.35,
      radius * 0.05,
      px,
      py,
      radius
    );

    if (color === 'black') {
      gradient.addColorStop(0, '#4a4a4a');
      gradient.addColorStop(0.5, '#222');
      gradient.addColorStop(1, '#0a0a0a');
    } else {
      gradient.addColorStop(0, '#fff');
      gradient.addColorStop(0.5, '#f5f5f5');
      gradient.addColorStop(1, '#d8d8d8');
    }

    this.ctx.fillStyle = gradient;
    this.ctx.fill();
  }

  private drawLastMoveMarker(x: number, y: number): void {
    const px = this.padding + x * this.cellSize;
    const py = this.padding + y * this.cellSize;
    const radius = this.cellSize * 0.15;
    const stone = this.game.getStone(x, y);

    this.ctx.fillStyle = stone === 'black' ? '#fff' : '#000';
    this.ctx.beginPath();
    this.ctx.arc(px, py, radius, 0, Math.PI * 2);
    this.ctx.fill();
  }

  private drawOwnership(): void {
    if (!this.analysis?.ownership) return;

    const ownership = this.analysis.ownership;

    for (let y = 0; y < this.game.size; y++) {
      for (let x = 0; x < this.game.size; x++) {
        const idx = y * this.game.size + x;
        const value = ownership[idx];
        const certainty = Math.abs(value);

        // Skip drawing for completely undecided or neutral territories (under 10% certainty)
        if (certainty < 0.1) continue;

        const px = this.padding + x * this.cellSize;
        const py = this.padding + y * this.cellSize;
        const isBlackTerritory = value > 0;

        // Scale marker size based on certainty (linear interpolation from 0.08 to 0.24 of cell size)
        const minScale = 0.08;
        const maxScale = 0.24;
        const clampedCertainty = Math.max(0.1, Math.min(1.0, certainty));
        const scale = minScale + (maxScale - minScale) * (clampedCertainty - 0.1) / 0.9;
        const markerSize = this.cellSize * scale;

        const x1 = px - markerSize / 2;
        const y1 = py - markerSize / 2;

        this.ctx.save();
        if (isBlackTerritory) {
          // Black territory mark: Dark fill with a light semi-transparent white border to pop
          this.ctx.fillStyle = '#111';
          this.ctx.fillRect(x1, y1, markerSize, markerSize);

          this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
          this.ctx.lineWidth = 1;
          this.ctx.strokeRect(x1, y1, markerSize, markerSize);
        } else {
          // White territory mark: White fill with a dark border
          this.ctx.fillStyle = '#fff';
          this.ctx.fillRect(x1, y1, markerSize, markerSize);

          this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
          this.ctx.lineWidth = 1;
          this.ctx.strokeRect(x1, y1, markerSize, markerSize);
        }
        this.ctx.restore();
      }
    }
  }

  private drawSuggestedMoves(): void {
    if (!this.analysis?.topMoves) return;

    const topMoves = this.analysis.topMoves.slice(0, 3);
    topMoves.forEach((move, index) => {
      const pos = this.game.gtpToPos(move.move);
      if (!pos) return;
      if (this.game.getStone(pos.x, pos.y) !== null) return;

      const px = this.padding + pos.x * this.cellSize;
      const py = this.padding + pos.y * this.cellSize;
      const radius = this.cellSize * 0.35;

      const colors = ['#27ae60', '#f39c12', '#3498db'];
      this.ctx.globalAlpha = 0.85;
      this.ctx.fillStyle = colors[index];
      this.ctx.beginPath();
      this.ctx.arc(px, py, radius, 0, Math.PI * 2);
      this.ctx.fill();

      this.ctx.fillStyle = '#fff';
      this.ctx.font = `bold ${this.cellSize * 0.35}px sans-serif`;
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(`${index + 1}`, px, py);
      this.ctx.globalAlpha = 1;
    });
  }

  private drawHoverStone(): void {
    if (!this.hoverPos) return;
    if (!this.game.canPlaceStone(this.hoverPos.x, this.hoverPos.y)) return;

    const px = this.padding + this.hoverPos.x * this.cellSize;
    const py = this.padding + this.hoverPos.y * this.cellSize;
    const radius = this.cellSize * 0.45;

    this.ctx.globalAlpha = 0.5;
    this.ctx.beginPath();
    this.ctx.arc(px, py, radius, 0, Math.PI * 2);
    this.ctx.fillStyle = this.game.currentPlayer === 'black' ? '#333' : '#eee';
    this.ctx.fill();
    this.ctx.globalAlpha = 1;
  }
}
