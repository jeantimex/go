import { GoGame } from './game';
import { BoardRenderer } from './board';
import './style.css';

class App {
  private game: GoGame;
  private renderer: BoardRenderer;
  private turnIndicator!: HTMLElement;
  private stoneIcon!: HTMLElement;
  private blackCaptures!: HTMLElement;
  private whiteCaptures!: HTMLElement;

  constructor() {
    this.game = new GoGame(19);
    this.createUI();
    this.renderer = new BoardRenderer(
      document.getElementById('board') as HTMLCanvasElement,
      this.game
    );
    this.renderer.onMove = () => this.updateUI();
    this.renderer.render();
    this.setupBoardSizeButtons();
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
          <div class="settings">
            <h3>Settings</h3>
            <label class="toggle-setting">
              <span>Show last move</span>
              <input type="checkbox" id="show-last-move" checked />
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

    document.getElementById('pass-btn')!.addEventListener('click', () => {
      this.game.pass();
      this.updateUI();
    });

    document.getElementById('reset-btn')!.addEventListener('click', () => {
      this.game.reset();
      this.renderer.render();
      this.updateUI();
    });

    document.getElementById('show-last-move')!.addEventListener('change', (e) => {
      this.renderer.showLastMove = (e.target as HTMLInputElement).checked;
      this.renderer.render();
    });
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
    this.renderer.onMove = () => this.updateUI();
    this.renderer.render();
    this.updateUI();
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
