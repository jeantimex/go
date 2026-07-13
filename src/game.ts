export type Stone = 'black' | 'white' | null;
export type Position = { x: number; y: number };

export class GoGame {
  readonly size: number;
  board: Stone[][];
  currentPlayer: 'black' | 'white' = 'black';
  lastMove: Position | null = null;
  koPosition: Position | null = null;
  captures: { black: number; white: number } = { black: 0, white: 0 };
  moveHistory: Position[] = [];

  constructor(size: number = 19) {
    this.size = size;
    this.board = Array.from({ length: size }, () => Array(size).fill(null));
  }

  isValidPosition(x: number, y: number): boolean {
    return x >= 0 && x < this.size && y >= 0 && y < this.size;
  }

  getStone(x: number, y: number): Stone {
    if (!this.isValidPosition(x, y)) return null;
    return this.board[y][x];
  }

  private getNeighbors(x: number, y: number): Position[] {
    const neighbors: Position[] = [];
    const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const [dx, dy] of directions) {
      const nx = x + dx;
      const ny = y + dy;
      if (this.isValidPosition(nx, ny)) {
        neighbors.push({ x: nx, y: ny });
      }
    }
    return neighbors;
  }

  private getGroup(x: number, y: number): Position[] {
    const stone = this.getStone(x, y);
    if (!stone) return [];

    const group: Position[] = [];
    const visited = new Set<string>();
    const stack: Position[] = [{ x, y }];

    while (stack.length > 0) {
      const pos = stack.pop()!;
      const key = `${pos.x},${pos.y}`;
      if (visited.has(key)) continue;
      if (this.getStone(pos.x, pos.y) !== stone) continue;

      visited.add(key);
      group.push(pos);

      for (const neighbor of this.getNeighbors(pos.x, pos.y)) {
        stack.push(neighbor);
      }
    }

    return group;
  }

  private getLiberties(group: Position[]): number {
    const liberties = new Set<string>();
    for (const pos of group) {
      for (const neighbor of this.getNeighbors(pos.x, pos.y)) {
        if (this.getStone(neighbor.x, neighbor.y) === null) {
          liberties.add(`${neighbor.x},${neighbor.y}`);
        }
      }
    }
    return liberties.size;
  }

  private removeGroup(group: Position[]): void {
    for (const pos of group) {
      this.board[pos.y][pos.x] = null;
    }
  }

  canPlaceStone(x: number, y: number): boolean {
    if (!this.isValidPosition(x, y)) return false;
    if (this.getStone(x, y) !== null) return false;

    if (this.koPosition && this.koPosition.x === x && this.koPosition.y === y) {
      return false;
    }

    this.board[y][x] = this.currentPlayer;

    const opponent = this.currentPlayer === 'black' ? 'white' : 'black';
    let capturedAny = false;
    for (const neighbor of this.getNeighbors(x, y)) {
      if (this.getStone(neighbor.x, neighbor.y) === opponent) {
        const group = this.getGroup(neighbor.x, neighbor.y);
        if (this.getLiberties(group) === 0) {
          capturedAny = true;
        }
      }
    }

    const ownGroup = this.getGroup(x, y);
    const hasLiberties = this.getLiberties(ownGroup) > 0;

    this.board[y][x] = null;

    return hasLiberties || capturedAny;
  }

  placeStone(x: number, y: number): boolean {
    if (!this.canPlaceStone(x, y)) return false;

    this.board[y][x] = this.currentPlayer;

    const opponent = this.currentPlayer === 'black' ? 'white' : 'black';
    let totalCaptured = 0;
    let singleCapturePos: Position | null = null;

    for (const neighbor of this.getNeighbors(x, y)) {
      if (this.getStone(neighbor.x, neighbor.y) === opponent) {
        const group = this.getGroup(neighbor.x, neighbor.y);
        if (this.getLiberties(group) === 0) {
          totalCaptured += group.length;
          if (group.length === 1) {
            singleCapturePos = group[0];
          }
          this.removeGroup(group);
        }
      }
    }

    if (this.currentPlayer === 'black') {
      this.captures.black += totalCaptured;
    } else {
      this.captures.white += totalCaptured;
    }

    if (totalCaptured === 1 && singleCapturePos) {
      const placedGroup = this.getGroup(x, y);
      if (placedGroup.length === 1 && this.getLiberties(placedGroup) === 1) {
        this.koPosition = singleCapturePos;
      } else {
        this.koPosition = null;
      }
    } else {
      this.koPosition = null;
    }

    this.lastMove = { x, y };
    this.moveHistory.push({ x, y });
    this.currentPlayer = opponent;

    return true;
  }

  pass(): void {
    this.currentPlayer = this.currentPlayer === 'black' ? 'white' : 'black';
    this.koPosition = null;
    this.lastMove = null;
  }

  reset(): void {
    this.board = Array.from({ length: this.size }, () => Array(this.size).fill(null));
    this.currentPlayer = 'black';
    this.lastMove = null;
    this.koPosition = null;
    this.captures = { black: 0, white: 0 };
    this.moveHistory = [];
  }
}
