export interface GameInfo {
  blackPlayer: string;
  whitePlayer: string;
  blackRank: string;
  whiteRank: string;
  date: string;
  result: string;
  komi: number;
  boardSize: number;
  event: string;
  round: string;
}

export interface SgfMove {
  color: 'black' | 'white';
  x: number;
  y: number;
}

export interface ParsedSgf {
  info: GameInfo;
  moves: SgfMove[];
}

export function parseSgf(sgfContent: string): ParsedSgf {
  const info: GameInfo = {
    blackPlayer: 'Black',
    whitePlayer: 'White',
    blackRank: '',
    whiteRank: '',
    date: '',
    result: '',
    komi: 6.5,
    boardSize: 19,
    event: '',
    round: '',
  };

  const moves: SgfMove[] = [];

  const getProp = (prop: string): string => {
    const regex = new RegExp(`${prop}\\[([^\\]]*)\\]`);
    const match = sgfContent.match(regex);
    return match ? match[1] : '';
  };

  info.blackPlayer = getProp('PB') || 'Black';
  info.whitePlayer = getProp('PW') || 'White';
  info.blackRank = getProp('BR');
  info.whiteRank = getProp('WR');
  info.date = getProp('DT');
  info.result = getProp('RE');
  info.event = getProp('EV');
  info.round = getProp('RO');

  const komiStr = getProp('KM');
  if (komiStr) {
    info.komi = parseFloat(komiStr);
  }

  const sizeStr = getProp('SZ');
  if (sizeStr) {
    info.boardSize = parseInt(sizeStr, 10);
  }

  const moveRegex = /;([BW])\[([a-s]{2})\]/gi;
  let match;

  while ((match = moveRegex.exec(sgfContent)) !== null) {
    const color = match[1].toUpperCase() === 'B' ? 'black' : 'white';
    const coords = match[2].toLowerCase();

    if (coords.length === 2) {
      const x = coords.charCodeAt(0) - 'a'.charCodeAt(0);
      const y = coords.charCodeAt(1) - 'a'.charCodeAt(0);

      if (x >= 0 && x < info.boardSize && y >= 0 && y < info.boardSize) {
        moves.push({ color, x, y });
      }
    }
  }

  return { info, moves };
}
