import { GoGame } from './game';
import { BoardRenderer } from './board';
import { analyzePosition, checkServerHealth, AnalysisResponse } from './analysis';
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
          <div class="turn-indicator">
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
