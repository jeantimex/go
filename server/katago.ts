import { spawn, ChildProcess } from 'child_process';
import * as readline from 'readline';

export interface AnalysisResult {
  id: string;
  turnNumber: number;
  moveInfos: MoveInfo[];
  rootInfo: RootInfo;
  ownership?: number[];
}

export interface MoveInfo {
  move: string;
  visits: number;
  winrate: number;
  scoreLead: number;
  order: number;
}

export interface RootInfo {
  winrate: number;
  scoreLead: number;
  visits: number;
}

export class KataGoEngine {
  private process: ChildProcess | null = null;
  private rl: readline.Interface | null = null;
  private pendingRequests: Map<string, (result: AnalysisResult) => void> = new Map();
  private ready: Promise<void>;
  private resolveReady!: () => void;

  constructor() {
    this.ready = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
  }

  async start(): Promise<void> {
    const modelPath = '/opt/homebrew/share/katago/kata1-b18c384nbt-s9996604416-d4316597426.bin.gz';
    const configPath = '/opt/homebrew/share/katago/configs/analysis_example.cfg';

    this.process = spawn('katago', [
      'analysis',
      '-model', modelPath,
      '-config', configPath,
    ]);

    this.rl = readline.createInterface({
      input: this.process.stdout!,
      terminal: false,
    });

    this.rl.on('line', (line) => {
      this.handleOutput(line);
    });

    this.process.stderr?.on('data', (data) => {
      const msg = data.toString();
      if (msg.includes('Started')) {
        this.resolveReady();
      }
    });

    this.process.on('error', (err) => {
      console.error('KataGo process error:', err);
    });

    this.process.on('close', (code) => {
      console.log('KataGo process closed with code:', code);
    });

    await this.ready;
    console.log('KataGo engine ready');
  }

  private handleOutput(line: string): void {
    try {
      const result = JSON.parse(line) as AnalysisResult;
      const callback = this.pendingRequests.get(result.id);
      if (callback) {
        callback(result);
        this.pendingRequests.delete(result.id);
      }
    } catch {
      // Ignore non-JSON output
    }
  }

  async analyze(
    id: string,
    boardSize: number,
    moves: Array<[string, string]>,
    komi: number = 6.5,
    maxVisits: number = 100
  ): Promise<AnalysisResult> {
    await this.ready;

    return new Promise((resolve) => {
      this.pendingRequests.set(id, resolve);

      const query = {
        id,
        moves,
        rules: 'chinese',
        komi,
        boardXSize: boardSize,
        boardYSize: boardSize,
        maxVisits,
        includeOwnership: true,
        analyzeTurns: [moves.length],
      };

      this.process?.stdin?.write(JSON.stringify(query) + '\n');
    });
  }

  stop(): void {
    if (this.process) {
      this.process.stdin?.write('{"id":"quit","action":"terminate"}\n');
      this.process.kill();
      this.process = null;
    }
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }
}
