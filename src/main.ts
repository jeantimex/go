import { GoGame } from './game';
import { BoardRenderer } from './board';
import { analyzePosition, checkServerHealth, AnalysisResponse } from './analysis';
import { parseSgf, GameInfo, generateSgf } from './sgf';
import './style.css';

class App {
  private game: GoGame;
  private renderer: BoardRenderer;
  private turnIndicator!: HTMLElement;
  private stoneIcon!: HTMLElement;
  private blackCaptures!: HTMLElement;
  private whiteCaptures!: HTMLElement;
  private serverStatus!: HTMLElement;
  private analyzeBtn!: HTMLButtonElement;
  private winrateDisplay!: HTMLElement;
  private topMovesDisplay!: HTMLElement;
  private serverOnline = false;
  private gameInfo: GameInfo | null = null;

  constructor() {
    this.game = new GoGame(19);
    this.createUI();
    this.renderer = new BoardRenderer(
      document.getElementById('board') as HTMLCanvasElement,
      this.game
    );
    this.renderer.onMove = () => {
      this.updateUI();
      this.renderer.clearAnalysis();
    };
    this.renderer.render();
    this.setupBoardSizeButtons();
    this.setupFileActions();
    this.setupReplayControls();
    this.checkServer();
  }

  private async checkServer(): Promise<void> {
    this.serverOnline = await checkServerHealth();
    this.updateServerStatus();
  }

  private updateServerStatus(): void {
    if (this.serverOnline) {
      this.serverStatus.textContent = 'Online';
      this.serverStatus.className = 'status-badge online';
      this.analyzeBtn.disabled = false;
    } else {
      this.serverStatus.textContent = 'Offline';
      this.serverStatus.className = 'status-badge offline';
      this.analyzeBtn.disabled = true;
    }
  }

  private createUI(): void {
    const app = document.getElementById('app')!;
    app.innerHTML = `
      <h1>Go Game</h1>
      <div class="game-container">
        <canvas id="board"></canvas>
        <div class="sidebar">
          <div class="board-size-selector">
            <button data-size="9">9x9</button>
            <button data-size="13">13x13</button>
            <button data-size="19" class="active">19x19</button>
          </div>

          <div class="game-info" id="game-info" style="display: none;">
            <div class="player-info">
              <div class="player black-player">
                <div class="stone-icon black"></div>
                <div class="player-details">
                  <span class="player-name" id="black-name">Black</span>
                  <span class="player-rank" id="black-rank"></span>
                </div>
              </div>
              <div class="player white-player">
                <div class="stone-icon white"></div>
                <div class="player-details">
                  <span class="player-name" id="white-name">White</span>
                  <span class="player-rank" id="white-rank"></span>
                </div>
              </div>
            </div>
            <div class="game-details">
              <div class="detail-row" id="result-row" style="display: none;">
                <span class="detail-label">Result</span>
                <span class="detail-value" id="game-result"></span>
              </div>
              <div class="detail-row" id="date-row" style="display: none;">
                <span class="detail-label">Date</span>
                <span class="detail-value" id="game-date"></span>
              </div>
              <div class="detail-row" id="event-row" style="display: none;">
                <span class="detail-label">Event</span>
                <span class="detail-value" id="game-event"></span>
              </div>
            </div>
          </div>

          <div class="replay-controls" id="replay-controls" style="display: none;">
            <div class="move-counter">
              Move <span id="current-move">0</span> / <span id="total-moves">0</span>
            </div>
            <div class="replay-slider-container">
              <input type="range" id="move-slider" min="0" max="0" value="0" class="move-slider" />
            </div>
            <div class="replay-buttons">
              <button id="first-btn" title="First">⏮</button>
              <button id="prev-btn" title="Previous">◀</button>
              <button id="next-btn" title="Next">▶</button>
              <button id="last-btn" title="Last">⏭</button>
            </div>
            <button class="btn-exit-replay" id="exit-replay-btn">Exit Replay</button>
          </div>

          <div class="turn-indicator" id="turn-indicator">
            <div class="stone-icon black"></div>
            <span>Black's turn</span>
          </div>
          <div class="captures">
            <h3>Captures</h3>
            <div class="capture-row">
              <div class="stone-icon black"></div>
              <span id="black-captures">0</span>
            </div>
            <div class="capture-row">
              <div class="stone-icon white"></div>
              <span id="white-captures">0</span>
            </div>
          </div>
          <div class="buttons">
            <button class="btn-pass" id="pass-btn">Pass</button>
            <button class="btn-reset" id="reset-btn">Reset</button>
          </div>

          <div class="load-section">
            <h3>SGF Files</h3>
            <div class="sgf-actions">
              <label class="btn-load" for="sgf-input">
                Load SGF File
                <input type="file" id="sgf-input" accept=".sgf" style="display: none;" />
              </label>
              <button class="btn-save-sgf" id="save-sgf-btn">Save SGF File</button>
            </div>
          </div>

          <div class="analysis-section">
            <div class="analysis-header">
              <h3>Analysis</h3>
              <span id="server-status" class="status-badge offline">Offline</span>
            </div>
            <button class="btn-analyze" id="analyze-btn" disabled>Analyze Position</button>
            <div class="analysis-results" id="analysis-results" style="display: none;">
              <div class="winrate-bar" id="winrate-bar">
                <span class="winrate-black" id="winrate-black">B 50%</span>
                <span class="winrate-white" id="winrate-white">W 50%</span>
              </div>
              <div class="top-moves" id="top-moves"></div>
            </div>
          </div>

          <div class="settings">
            <h3>Settings</h3>
            <label class="toggle-setting">
              <span>Show last move</span>
              <input type="checkbox" id="show-last-move" checked />
              <div class="toggle-switch"></div>
            </label>
            <label class="toggle-setting">
              <span>Show territory</span>
              <input type="checkbox" id="show-ownership" />
              <div class="toggle-switch"></div>
            </label>
          </div>
        </div>
      </div>
    `;

    this.turnIndicator = document.querySelector('.turn-indicator span')!;
    this.stoneIcon = document.querySelector('.turn-indicator .stone-icon')!;
    this.blackCaptures = document.getElementById('black-captures')!;
    this.whiteCaptures = document.getElementById('white-captures')!;
    this.serverStatus = document.getElementById('server-status')!;
    this.analyzeBtn = document.getElementById('analyze-btn') as HTMLButtonElement;
    this.winrateDisplay = document.getElementById('analysis-results')!;
    this.topMovesDisplay = document.getElementById('top-moves')!;

    document.getElementById('pass-btn')!.addEventListener('click', () => {
      this.game.pass();
      this.updateUI();
    });

    document.getElementById('reset-btn')!.addEventListener('click', () => {
      this.game.reset();
      this.renderer.clearAnalysis();
      this.renderer.render();
      this.updateUI();
      this.hideAnalysis();
    });

    document.getElementById('show-last-move')!.addEventListener('change', (e) => {
      this.renderer.showLastMove = (e.target as HTMLInputElement).checked;
      this.renderer.render();
    });

    document.getElementById('show-ownership')!.addEventListener('change', (e) => {
      this.renderer.showOwnership = (e.target as HTMLInputElement).checked;
      this.renderer.render();
    });

    this.analyzeBtn.addEventListener('click', () => this.analyze());
  }

  private setupFileActions(): void {
    const fileInput = document.getElementById('sgf-input') as HTMLInputElement;
    fileInput.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const content = await file.text();
      this.loadSgf(content);
      fileInput.value = '';
    });

    const saveBtn = document.getElementById('save-sgf-btn') as HTMLButtonElement;
    saveBtn.addEventListener('click', () => {
      this.saveSgf();
    });
  }

  private saveSgf(): void {
    const moves = this.game.moveHistory.map((pos, idx) => ({
      color: this.game.moveColors[idx],
      x: pos.x,
      y: pos.y
    }));

    const sgfContent = generateSgf(this.gameInfo, moves);
    const blob = new Blob([sgfContent], { type: 'application/x-go-sgf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    
    const dateStr = this.gameInfo?.date || new Date().toISOString().slice(0, 10);
    const black = this.gameInfo?.blackPlayer || 'Black';
    const white = this.gameInfo?.whitePlayer || 'White';
    a.download = `${black}_vs_${white}_${dateStr}.sgf`;
    
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  private loadSgf(content: string): void {
    const parsed = parseSgf(content);
    this.gameInfo = parsed.info;

    if (parsed.info.boardSize !== this.game.size) {
      this.game = new GoGame(parsed.info.boardSize);
      this.renderer = new BoardRenderer(
        document.getElementById('board') as HTMLCanvasElement,
        this.game
      );
      this.renderer.onMove = () => {
        this.updateUI();
        this.renderer.clearAnalysis();
      };

      const buttons = document.querySelectorAll('.board-size-selector button');
      buttons.forEach((btn) => {
        const size = parseInt((btn as HTMLElement).dataset.size!, 10);
        btn.classList.toggle('active', size === parsed.info.boardSize);
      });
    }

    this.game.loadGame(parsed.moves);
    this.showGameInfo();
    this.showReplayControls();
    this.updateReplayUI();
    this.renderer.render();
  }

  private showGameInfo(): void {
    if (!this.gameInfo) return;

    const infoEl = document.getElementById('game-info')!;
    infoEl.style.display = 'block';

    document.getElementById('black-name')!.textContent = this.gameInfo.blackPlayer;
    document.getElementById('white-name')!.textContent = this.gameInfo.whitePlayer;
    document.getElementById('black-rank')!.textContent = this.gameInfo.blackRank;
    document.getElementById('white-rank')!.textContent = this.gameInfo.whiteRank;

    const resultRow = document.getElementById('result-row')!;
    if (this.gameInfo.result) {
      resultRow.style.display = 'flex';
      document.getElementById('game-result')!.textContent = this.gameInfo.result;
    } else {
      resultRow.style.display = 'none';
    }

    const dateRow = document.getElementById('date-row')!;
    if (this.gameInfo.date) {
      dateRow.style.display = 'flex';
      document.getElementById('game-date')!.textContent = this.gameInfo.date;
    } else {
      dateRow.style.display = 'none';
    }

    const eventRow = document.getElementById('event-row')!;
    if (this.gameInfo.event) {
      eventRow.style.display = 'flex';
      document.getElementById('game-event')!.textContent = this.gameInfo.event;
    } else {
      eventRow.style.display = 'none';
    }
  }

  private showReplayControls(): void {
    document.getElementById('replay-controls')!.style.display = 'block';
    document.getElementById('turn-indicator')!.style.display = 'none';
    document.querySelector('.buttons')!.setAttribute('style', 'display: none');

    const slider = document.getElementById('move-slider') as HTMLInputElement;
    slider.max = this.game.getTotalMoves().toString();
    slider.value = '0';

    document.getElementById('total-moves')!.textContent = this.game.getTotalMoves().toString();
  }

  private hideReplayControls(): void {
    document.getElementById('replay-controls')!.style.display = 'none';
    document.getElementById('game-info')!.style.display = 'none';
    document.getElementById('turn-indicator')!.style.display = 'flex';
    document.querySelector('.buttons')!.removeAttribute('style');
  }

  private setupReplayControls(): void {
    document.getElementById('first-btn')!.addEventListener('click', () => {
      this.game.firstMove();
      this.updateReplayUI();
      this.renderer.render();
    });

    document.getElementById('prev-btn')!.addEventListener('click', () => {
      this.game.prevMove();
      this.updateReplayUI();
      this.renderer.render();
    });

    document.getElementById('next-btn')!.addEventListener('click', () => {
      this.game.nextMove();
      this.updateReplayUI();
      this.renderer.render();
    });

    document.getElementById('last-btn')!.addEventListener('click', () => {
      this.game.lastMoveReplay();
      this.updateReplayUI();
      this.renderer.render();
    });

    document.getElementById('exit-replay-btn')!.addEventListener('click', () => {
      this.game.exitReplayMode();
      this.gameInfo = null;
      this.hideReplayControls();
      this.renderer.render();
      this.updateUI();
    });

    const slider = document.getElementById('move-slider') as HTMLInputElement;
    slider.addEventListener('input', () => {
      const moveNum = parseInt(slider.value, 10);
      this.game.goToMove(moveNum);
      this.updateReplayUI();
      this.renderer.render();
    });

    document.addEventListener('keydown', (e) => {
      if (!this.game.isReplayMode) return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        this.game.prevMove();
        this.updateReplayUI();
        this.renderer.render();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        this.game.nextMove();
        this.updateReplayUI();
        this.renderer.render();
      } else if (e.key === 'Home') {
        e.preventDefault();
        this.game.firstMove();
        this.updateReplayUI();
        this.renderer.render();
      } else if (e.key === 'End') {
        e.preventDefault();
        this.game.lastMoveReplay();
        this.updateReplayUI();
        this.renderer.render();
      }
    });
  }

  private updateReplayUI(): void {
    const currentMove = this.game.getCurrentMoveNumber();
    document.getElementById('current-move')!.textContent = currentMove.toString();
    (document.getElementById('move-slider') as HTMLInputElement).value = currentMove.toString();
    this.blackCaptures.textContent = this.game.captures.black.toString();
    this.whiteCaptures.textContent = this.game.captures.white.toString();
  }

  private async analyze(): Promise<void> {
    if (!this.serverOnline) return;

    this.analyzeBtn.disabled = true;
    this.analyzeBtn.textContent = 'Analyzing...';

    try {
      const moves = this.game.getKataGoMoves();
      const result = await analyzePosition(this.game.size, moves);
      this.showAnalysis(result);
      this.renderer.setAnalysis(result);
    } catch (error) {
      console.error('Analysis failed:', error);
      this.serverOnline = false;
      this.updateServerStatus();
    } finally {
      this.analyzeBtn.disabled = false;
      this.analyzeBtn.textContent = 'Analyze Position';
    }
  }

  private showAnalysis(result: AnalysisResponse): void {
    this.winrateDisplay.style.display = 'block';

    const blackWinrate = result.winrate * 100;
    const whiteWinrate = 100 - blackWinrate;
    const winrateBar = document.getElementById('winrate-bar')!;
    const winrateBlack = document.getElementById('winrate-black')!;
    const winrateWhite = document.getElementById('winrate-white')!;

    winrateBar.style.background = `linear-gradient(90deg, #222 ${blackWinrate}%, #eee ${blackWinrate}%)`;
    winrateBlack.textContent = `B ${blackWinrate.toFixed(1)}%`;
    winrateWhite.textContent = `W ${whiteWinrate.toFixed(1)}%`;

    this.topMovesDisplay.innerHTML = result.topMoves
      .slice(0, 3)
      .map((move, i) => {
        const colors = ['#27ae60', '#f39c12', '#3498db'];
        return `
          <div class="move-suggestion">
            <span class="move-rank" style="background: ${colors[i]}">${i + 1}</span>
            <span class="move-coord">${move.move}</span>
            <span class="move-winrate">${(move.winrate * 100).toFixed(1)}%</span>
          </div>
        `;
      })
      .join('');
  }

  private hideAnalysis(): void {
    this.winrateDisplay.style.display = 'none';
  }

  private setupBoardSizeButtons(): void {
    const buttons = document.querySelectorAll('.board-size-selector button');
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        if (this.game.isReplayMode) return;
        const size = parseInt((btn as HTMLElement).dataset.size!, 10);
        buttons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.changeBoardSize(size);
      });
    });
  }

  private changeBoardSize(size: number): void {
    this.game = new GoGame(size);
    this.renderer = new BoardRenderer(
      document.getElementById('board') as HTMLCanvasElement,
      this.game
    );
    this.renderer.onMove = () => {
      this.updateUI();
      this.renderer.clearAnalysis();
    };
    this.renderer.render();
    this.updateUI();
    this.hideAnalysis();
  }

  private updateUI(): void {
    const player = this.game.currentPlayer;
    this.turnIndicator.textContent = `${player.charAt(0).toUpperCase() + player.slice(1)}'s turn`;
    this.stoneIcon.className = `stone-icon ${player}`;
    this.blackCaptures.textContent = this.game.captures.black.toString();
    this.whiteCaptures.textContent = this.game.captures.white.toString();
  }
}

new App();
