import { GoGame, Position } from './game';

export class BoardRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private game: GoGame;
  private cellSize: number = 30;
  private padding: number = 40;
  private hoverPos: Position | null = null;
  showLastMove: boolean = true;

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
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
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
    if (pos && this.game.placeStone(pos.x, pos.y)) {
      this.render();
      this.onMove?.();
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

  render(): void {
    this.drawBoard();
    this.drawStones();
    this.drawHoverStone();
  }

  private drawBoard(): void {
    const size = this.cellSize * (this.game.size - 1) + this.padding * 2;

    this.ctx.fillStyle = '#DEB887';
    this.ctx.fillRect(0, 0, size, size);

    this.drawWoodGrain(size);
    this.drawGridLines();
    this.drawStarPoints();
    this.drawCoordinates();
  }

  private drawWoodGrain(size: number): void {
    this.ctx.save();
    this.ctx.globalAlpha = 0.1;
    for (let i = 0; i < size; i += 8) {
      this.ctx.strokeStyle = '#8B4513';
      this.ctx.lineWidth = Math.random() * 2 + 0.5;
      this.ctx.beginPath();
      this.ctx.moveTo(0, i + Math.random() * 4);
      let x = 0;
      while (x < size) {
        x += Math.random() * 20 + 10;
        this.ctx.lineTo(x, i + Math.random() * 4);
      }
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  private drawGridLines(): void {
    this.ctx.strokeStyle = '#333';
    this.ctx.lineWidth = 1;

    for (let i = 0; i < this.game.size; i++) {
      const pos = this.padding + i * this.cellSize;
      const end = this.padding + (this.game.size - 1) * this.cellSize;

      this.ctx.beginPath();
      this.ctx.moveTo(pos, this.padding);
      this.ctx.lineTo(pos, end);
      this.ctx.stroke();

      this.ctx.beginPath();
      this.ctx.moveTo(this.padding, pos);
      this.ctx.lineTo(end, pos);
      this.ctx.stroke();
    }
  }

  private getStarPoints(): number[][] {
    if (this.game.size === 19) return this.starPoints19;
    if (this.game.size === 13) return this.starPoints13;
    if (this.game.size === 9) return this.starPoints9;
    return [];
  }

  private drawStarPoints(): void {
    this.ctx.fillStyle = '#333';
    const starPoints = this.getStarPoints();

    for (const [x, y] of starPoints) {
      const px = this.padding + x * this.cellSize;
      const py = this.padding + y * this.cellSize;
      this.ctx.beginPath();
      this.ctx.arc(px, py, 4, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }

  private drawCoordinates(): void {
    this.ctx.fillStyle = '#333';
    this.ctx.font = '12px sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';

    const letters = 'ABCDEFGHJKLMNOPQRST';

    for (let i = 0; i < this.game.size; i++) {
      const x = this.padding + i * this.cellSize;
      const y = this.padding + i * this.cellSize;

      this.ctx.fillText(letters[i], x, 15);
      this.ctx.fillText(letters[i], x, this.padding + (this.game.size - 1) * this.cellSize + 25);

      const num = (this.game.size - i).toString();
      this.ctx.fillText(num, 15, y);
      this.ctx.fillText(num, this.padding + (this.game.size - 1) * this.cellSize + 25, y);
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

    if (this.showLastMove && this.game.lastMove) {
      this.drawLastMoveMarker(this.game.lastMove.x, this.game.lastMove.y);
    }
  }

  private drawStone(x: number, y: number, color: 'black' | 'white'): void {
    const px = this.padding + x * this.cellSize;
    const py = this.padding + y * this.cellSize;
    const radius = this.cellSize * 0.45;

    // Draw soft shadow
    const shadowOffset = 3;
    const shadowGradient = this.ctx.createRadialGradient(
      px + shadowOffset,
      py + shadowOffset,
      radius * 0.5,
      px + shadowOffset,
      py + shadowOffset,
      radius * 1.2
    );
    shadowGradient.addColorStop(0, 'rgba(0, 0, 0, 0.4)');
    shadowGradient.addColorStop(0.6, 'rgba(0, 0, 0, 0.15)');
    shadowGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    this.ctx.beginPath();
    this.ctx.arc(px + shadowOffset, py + shadowOffset, radius * 1.2, 0, Math.PI * 2);
    this.ctx.fillStyle = shadowGradient;
    this.ctx.fill();

    // Draw stone
    this.ctx.beginPath();
    this.ctx.arc(px, py, radius, 0, Math.PI * 2);

    const gradient = this.ctx.createRadialGradient(
      px - radius * 0.3,
      py - radius * 0.3,
      radius * 0.1,
      px,
      py,
      radius
    );

    if (color === 'black') {
      gradient.addColorStop(0, '#555');
      gradient.addColorStop(1, '#111');
    } else {
      gradient.addColorStop(0, '#fff');
      gradient.addColorStop(1, '#ddd');
    }

    this.ctx.fillStyle = gradient;
    this.ctx.fill();
  }

  private drawLastMoveMarker(x: number, y: number): void {
    const px = this.padding + x * this.cellSize;
    const py = this.padding + y * this.cellSize;
    const size = this.cellSize * 0.25;
    const stone = this.game.getStone(x, y);

    this.ctx.strokeStyle = stone === 'black' ? '#fff' : '#000';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(px, py - size);
    this.ctx.lineTo(px + size * 0.866, py + size * 0.5);
    this.ctx.lineTo(px - size * 0.866, py + size * 0.5);
    this.ctx.closePath();
    this.ctx.stroke();
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
