import { GoGame, GameMove } from './game';
import { BoardRenderer, LastMoveMarkerType } from './board';
import {
  analyzeGameWinrates,
  analyzePosition,
  checkServerHealth,
  AnalysisResponse,
} from './analysis';
import { parseSgf, GameInfo, generateSgf } from './sgf';
import { WinrateChart } from './winrate-chart';
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
  private selectedRules: 'japanese' | 'chinese' = 'japanese';
  private latestAnalysis: AnalysisResponse | null = null;
  private winrateChart: WinrateChart;
  private chartGeneration = 0;
  private backfilledGeneration = -1;
  private liveAnalysisTimer: number | null = null;
  private liveAnalysisRequest = 0;
  private preserveLiveChartMove: number | null = null;
  private replayAnalysisTimer: number | null = null;
  private replayAnalysisRequest = 0;
  private replayAnalysisCache = new Map<number, AnalysisResponse>();
  private aiRequest = 0;
  private aiThinking = false;

  constructor() {
    this.game = new GoGame(19);
    this.createUI();
    this.winrateChart = new WinrateChart(
      document.getElementById('winrate-chart')!,
      moveNumber => this.showMoveFromWinrateChart(moveNumber)
    );
    this.setupWinrateChartControls();
    this.renderer = new BoardRenderer(
      document.getElementById('board') as HTMLCanvasElement,
      this.game
    );
    this.renderer.showOwnership = (
      document.getElementById('show-ownership') as HTMLInputElement
    ).checked;
    this.setupPanelSplitter();
    this.renderer.onMove = () => {
      this.preserveLiveChartMove = null;
      this.updateUI();
      this.renderer.clearAnalysis();
      this.renderer.render();
      this.hideAnalysis();
      if (!this.game.isReplayMode) {
        this.hideReplayControls();
      }
      this.scheduleLiveWinrateAnalysis();
      this.scheduleAiMove();
    };
    this.renderer.render();
    this.setupBoardSizeButtons();
    this.setupFileActions();
    this.setupReplayControls();
    this.checkServer();
    this.setupTabs();
    this.setupRulesToggle();
    this.setupSceneSettings();
    this.updateAiControls();
  }

  private async checkServer(): Promise<void> {
    this.serverOnline = await checkServerHealth();
    this.updateServerStatus();
    if (this.serverOnline) this.scheduleLiveWinrateAnalysis();
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
    const aiToggle = document.getElementById('play-against-ai') as HTMLInputElement | null;
    if (aiToggle) aiToggle.disabled = !this.serverOnline;
    this.updateAiControls();
  }

  private createUI(): void {
    const app = document.getElementById('app')!;
    app.innerHTML = `
      <div class="game-container">
        <header class="app-header">
          <div class="app-brand">
            <span class="brand-mark">碁</span>
          </div>
          <nav class="app-menu" aria-label="Application menu">
            <div class="menu-group">
              <button class="menu-trigger" type="button" aria-expanded="false">Game</button>
              <div class="menu-panel" id="game-menu" role="menu"></div>
            </div>
            <div class="menu-group">
              <button class="menu-trigger" type="button" aria-expanded="false">Analysis</button>
              <div class="menu-panel" id="analysis-menu" role="menu"></div>
            </div>
            <div class="header-game-actions" id="header-game-actions"></div>
            <div class="header-analysis-actions" id="header-analysis-actions"></div>
          </nav>
          <button class="icon-button theme-toggle" id="theme-toggle" type="button" aria-label="Switch to light theme" title="Switch to light theme">
            <span class="theme-icon theme-icon-sun" aria-hidden="true">☀</span>
            <span class="theme-icon theme-icon-moon" aria-hidden="true">☾</span>
          </button>
        </header>
        <div class="board-section">
          <canvas id="board"></canvas>
        </div>
        <div
          class="panel-splitter"
          id="panel-splitter"
          role="separator"
          aria-label="Resize game board and controls"
          aria-orientation="vertical"
          aria-valuemin="300"
          aria-valuenow="370"
          tabindex="0"
        ></div>
        <div class="sidebar" id="sidebar">
          <nav class="inspector-tabs" aria-label="Inspector panels">
            <button
              class="inspector-tab active"
              type="button"
              data-tab="analysis"
              aria-label="Show game analysis"
              aria-pressed="true"
              title="Game Analysis"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 19V5M4 19h16M7 15l4-4 3 2 5-7" />
                <circle cx="7" cy="15" r="1" />
                <circle cx="11" cy="11" r="1" />
                <circle cx="14" cy="13" r="1" />
                <circle cx="19" cy="6" r="1" />
              </svg>
            </button>
            <button
              class="inspector-tab"
              type="button"
              data-tab="scene"
              aria-label="Show lighting controls"
              aria-pressed="false"
              title="Lighting"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="3.5" />
                <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
              </svg>
            </button>
          </nav>
          <div class="tab-content active" id="tab-game">
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
                <div class="detail-row" id="rules-row" style="display: none;">
                  <span class="detail-label">Rules</span>
                  <span class="detail-value" id="game-rules"></span>
                </div>
                <div class="detail-row" id="komi-row" style="display: none;">
                  <span class="detail-label">Komi</span>
                  <span class="detail-value" id="game-komi"></span>
                </div>
              </div>
            </div>

            <div class="replay-controls" id="replay-controls" style="display: none;">
              <div class="move-counter" style="text-align: center; margin-bottom: 8px; font-weight: 600; color: #aaa;">
                Move <span id="current-move">0</span> / <span id="total-moves">0</span>
              </div>
              <div class="replay-slider-container">
                <input type="range" id="move-slider" min="0" max="0" value="0" style="width: 100%; margin-bottom: 10px;" />
              </div>
              <div class="replay-buttons">
                <button id="first-btn" title="First Move">&lt;&lt;</button>
                <button id="prev-btn" title="Previous Move">&lt;</button>
                <button id="next-btn" title="Next Move">&gt;</button>
                <button id="last-btn" title="Last Move">&gt;&gt;</button>
              </div>
              <button class="btn-exit-replay" id="exit-replay-btn" style="margin-top: 10px; width: 100%;">Play From Here</button>
            </div>

            <div class="turn-indicator" id="turn-indicator">
              <div class="stone-icon black"></div>
              <span>Black to play</span>
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
              <button class="btn-undo" id="undo-btn" disabled>Undo</button>
              <button class="btn-pass" id="pass-btn">Pass</button>
              <button class="btn-reset" id="reset-btn">Reset</button>
            </div>

            <div class="ai-settings" id="ai-settings">
              <label class="toggle-setting">
                <span>Play against AI</span>
                <input type="checkbox" id="play-against-ai" checked />
                <div class="toggle-switch"></div>
              </label>
              <label class="select-setting">
                <span>AI color</span>
                <select id="ai-color">
                  <option value="white" selected>White</option>
                  <option value="black">Black</option>
                </select>
              </label>
              <label class="select-setting">
                <span>AI strength</span>
                <select id="ai-strength">
                  <option value="casual">Casual</option>
                  <option value="strong" selected>Strong</option>
                  <option value="maximum">Maximum</option>
                </select>
              </label>
              <div class="ai-status" id="ai-status">AI off</div>
            </div>

            <div class="settings">
              <label class="select-setting">
                <span>Last move marker</span>
                <select id="last-move-marker">
                  <option value="none">None</option>
                  <option value="circle">Circle</option>
                  <option value="triangle">Triangle</option>
                  <option value="number">Move Number</option>
                </select>
              </label>
            </div>
            
            <div class="review-section" style="margin-top: 10px;">
              <button class="btn-review" id="review-btn" disabled>Review Game</button>
            </div>

            <div class="load-section" style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #444;">
              <h3>SGF Files</h3>
              <div class="sgf-actions" style="margin-top: 8px;">
                <label class="btn-load" for="sgf-input">
                  Load SGF File
                  <input type="file" id="sgf-input" accept=".sgf" style="display: none;" />
                </label>
                <button class="btn-save-sgf" id="save-sgf-btn">Save SGF File</button>
              </div>
            </div>
          </div>

          <div class="tab-content active" id="tab-analysis">
            <div class="panel-title">Game Analysis</div>
            <div class="analysis-controls">
              <button class="btn-pass" id="analyze-btn">Start Analyze</button>
              <div class="server-status">
                <span>KataGo:</span>
                <span class="status-badge offline" id="server-status">Offline</span>
              </div>
            </div>

            <div class="winrate-chart-section">
              <div class="winrate-chart-header">
                <span>Win Rate by Move</span>
                <span id="winrate-chart-status"></span>
              </div>
              <div class="winrate-series-controls">
                <label class="winrate-series-toggle">
                  <input type="checkbox" id="show-black-winrate" checked />
                  <span class="winrate-swatch black"></span>
                  Black
                </label>
                <label class="winrate-series-toggle">
                  <input type="checkbox" id="show-white-winrate" checked />
                  <span class="winrate-swatch white"></span>
                  White
                </label>
              </div>
              <div id="winrate-chart" class="winrate-chart"></div>
              <button class="winrate-play-from-here" id="winrate-play-from-here" style="display: none;">
                Play from move <span id="winrate-branch-move">0</span>
              </button>
            </div>

            <div class="analysis-results" id="analysis-results" style="display: none;">
              <div class="winrate-bar" id="winrate-bar">
                <span class="winrate-black" id="winrate-black">B 50.0%</span>
                <span class="winrate-white" id="winrate-white">W 50.0%</span>
              </div>

              <div class="territory-estimates" id="territory-estimates">
                <div class="estimates-body">
                  <div class="estimate-row">
                    <span class="est-label">Black Score</span>
                    <span class="est-value" id="est-black-val">0.0</span>
                  </div>
                  <div class="estimate-row">
                    <span class="est-label">White Score</span>
                    <span class="est-value" id="est-white-val">0.0</span>
                  </div>
                  <div class="estimate-row result-row">
                    <span class="est-label">Estimated Lead</span>
                    <span class="est-value" id="est-result-val">0.0</span>
                  </div>
                  <div class="estimate-details" id="est-details-text"></div>
                </div>
              </div>
            </div>

            <div class="best-moves-section" id="best-moves-section">
              <div class="best-moves-header">Best Moves</div>
              <div class="top-moves" id="top-moves"></div>
            </div>

            <div class="rules-toggle-container" style="display: flex; justify-content: space-between; align-items: center; margin-top: 12px; padding-top: 12px; border-top: 1px solid #333;">
              <span style="font-size: 11px; color: #888; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Scoring Rules</span>
              <div class="rules-toggle">
                <button class="rules-tab-btn active" id="btn-rules-japanese">Japanese</button>
                <button class="rules-tab-btn" id="btn-rules-chinese">Chinese</button>
              </div>
            </div>

            <div class="settings" style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #444;">
              <h3>Analysis Settings</h3>
              <label class="toggle-setting">
                <span>Live game analysis</span>
                <input type="checkbox" id="live-game-analysis" checked />
                <div class="toggle-switch"></div>
              </label>
              <label class="toggle-setting">
                <span>Best moves</span>
                <input type="checkbox" id="show-best-moves" checked />
                <div class="toggle-switch"></div>
              </label>
              <label class="toggle-setting">
                <span>Show territory</span>
                <input type="checkbox" id="show-ownership" checked />
                <div class="toggle-switch"></div>
              </label>
            </div>
          </div>

          <div class="tab-content" id="tab-scene">
            <div class="panel-title">Lighting</div>
            <div class="scene-settings">
              <div class="setting-group">
                <h3>Ambient Light</h3>
                <div class="slider-row">
                  <label for="ambient-intensity">Intensity</label>
                  <input type="range" id="ambient-intensity" min="0" max="2" step="0.05" value="1.0" />
                  <span id="ambient-intensity-val">1.00</span>
                </div>
              </div>

              <div class="setting-group">
                <h3>Key Light (Warm)</h3>
                <div class="slider-row">
                  <label for="key-intensity">Intensity</label>
                  <input type="range" id="key-intensity" min="0" max="3" step="0.05" value="2.0" />
                  <span id="key-intensity-val">2.00</span>
                </div>
                <div class="slider-row">
                  <label for="key-color">Color</label>
                  <input type="color" id="key-color" value="#fff7e6" />
                </div>
              </div>

              <div class="setting-group">
                <h3>Fill Light (Cool)</h3>
                <div class="slider-row">
                  <label for="fill-intensity">Intensity</label>
                  <input type="range" id="fill-intensity" min="0" max="2" step="0.05" value="0.45" />
                  <span id="fill-intensity-val">0.45</span>
                </div>
              </div>

              <div class="setting-group">
                <h3>Point Light (Bowl Accent)</h3>
                <div class="slider-row">
                  <label for="point-intensity">Intensity</label>
                  <input type="range" id="point-intensity" min="0" max="2" step="0.05" value="0.8" />
                  <span id="point-intensity-val">0.80</span>
                </div>
              </div>

              <div class="setting-group">
                <div class="checkbox-row">
                  <input type="checkbox" id="enable-shadows" checked />
                  <label for="enable-shadows">Enable 3D Shadows</label>
                </div>
              </div>

              <div class="setting-group">
                <h3>Collision Debug Meshes</h3>
                <div class="checkbox-row">
                  <input type="checkbox" id="show-lid-collision-mesh" />
                  <label for="show-lid-collision-mesh">Show Lid Mesh</label>
                </div>
                <div class="checkbox-row" style="margin-top: 8px;">
                  <input type="checkbox" id="show-stone-collision-mesh" />
                  <label for="show-stone-collision-mesh">Show Stone Meshes</label>
                </div>
              </div>

              <div class="setting-group shadow-params" id="shadow-params-section">
                <h3>Shadow Settings</h3>
                <div class="slider-row">
                  <label for="shadow-resolution">Resolution</label>
                  <select id="shadow-resolution" style="flex: 2; background: #333; color: #fff; border: 1px solid #444; border-radius: 4px; padding: 4px; font-size: 11px;">
                    <option value="256">256 (Ultra-Soft)</option>
                    <option value="512">512 (Very Soft)</option>
                    <option value="1024" selected>1024 (Medium)</option>
                    <option value="2048">2048 (Crisp)</option>
                  </select>
                </div>
                <div class="slider-row" style="margin-top: 8px;">
                  <label for="shadow-radius">Blur (Radius)</label>
                  <input type="range" id="shadow-radius" min="1" max="16" step="0.5" value="3" />
                  <span id="shadow-radius-val">3.0</span>
                </div>
                <div class="slider-row" style="margin-top: 8px;">
                  <label for="shadow-opacity">Floor Opacity</label>
                  <input type="range" id="shadow-opacity" min="0" max="0.5" step="0.01" value="0.15" />
                  <span id="shadow-opacity-val">0.15</span>
                </div>
                <div class="slider-row" style="margin-top: 8px;">
                  <label for="shadow-bias">Bias</label>
                  <input type="range" id="shadow-bias" min="-0.005" max="0.005" step="0.0001" value="-0.0001" />
                  <span id="shadow-bias-val">-0.0001</span>
                </div>
                <div class="slider-row" style="margin-top: 8px;">
                  <label for="shadow-normal-bias">Normal Bias</label>
                  <input type="range" id="shadow-normal-bias" min="0" max="0.1" step="0.002" value="0.02" />
                  <span id="shadow-normal-bias-val">0.02</span>
                </div>
              </div>

              <button id="reset-lights-btn" class="btn-pass" style="margin-top: 10px; width: 100%;">Reset Lights</button>
            </div>
          </div>
        </div>
        <footer class="action-dock">
          <button
            class="timeline-collapse-toggle"
            id="timeline-collapse-toggle"
            type="button"
            aria-label="Collapse game timeline"
            aria-expanded="true"
            title="Collapse game timeline"
          >⌄</button>
          <div class="move-strip">
            <button class="strip-arrow" id="dock-prev" title="Previous move">‹</button>
            <div class="move-timeline" id="move-timeline" aria-label="Move timeline"></div>
            <div class="timeline-scrubber">
              <span id="timeline-current-move">0</span>
              <input
                type="range"
                id="timeline-jump-slider"
                min="0"
                max="0"
                value="0"
                aria-label="Jump to move"
              />
              <span id="timeline-total-moves">0</span>
            </div>
            <button class="strip-arrow" id="dock-next" title="Next move">›</button>
          </div>
          <div class="dock-section dock-actions">
            <div class="panel-title">Quick Actions</div>
            <div class="quick-action-grid" id="quick-action-grid"></div>
          </div>
        </footer>
      </div>
    `;

    document.getElementById('quick-action-grid')!.appendChild(document.querySelector('.review-section')!);
    document.querySelector('.analysis-controls')!.insertAdjacentElement(
      'afterend',
      document.querySelector('.captures')!
    );
    document.querySelector('.analysis-controls')!.insertAdjacentElement(
      'beforebegin',
      document.getElementById('turn-indicator')!
    );
    document.getElementById('quick-action-grid')!.insertAdjacentHTML('beforeend', `
      <button class="quick-action" id="new-game-btn">＋ <span>New Game</span></button>
      <button class="quick-action" id="export-board-btn">▣ <span>Export Board Image</span></button>
    `);
    const gameMenu = document.getElementById('game-menu')!;
    const analysisMenu = document.getElementById('analysis-menu')!;
    const gameControls = document.createElement('div');
    gameControls.className = 'game-menu-controls';
    gameControls.appendChild(document.getElementById('replay-controls')!);
    gameControls.appendChild(document.getElementById('game-info')!);
    document.getElementById('header-game-actions')!.appendChild(document.querySelector('.buttons')!);
    const headerAnalysisActions = document.getElementById('header-analysis-actions')!;
    headerAnalysisActions.appendChild(document.getElementById('turn-indicator')!);
    document.querySelector('.app-brand')!.appendChild(document.querySelector('.server-status')!);

    const aiToggleInput = document.getElementById('play-against-ai') as HTMLInputElement;
    const aiToggleRow = aiToggleInput.closest('.toggle-setting')!;
    aiToggleRow.insertAdjacentElement('beforebegin', aiToggleInput);
    aiToggleRow.remove();
    const aiSettings = document.getElementById('ai-settings')!;
    const markerSettings = document.querySelector('#tab-game > .settings')!;
    aiSettings.classList.add('game-setting-sources');
    markerSettings.classList.add('game-setting-sources');
    gameControls.appendChild(aiSettings);
    gameControls.appendChild(markerSettings);
    gameMenu.appendChild(gameControls);

    const createSecondaryMenu = (
      label: string,
      getValue: () => string,
      options: Array<{ label: string; value: string }>,
      onSelect: (value: string) => void,
      ownerMenu: HTMLElement = gameMenu
    ): HTMLElement => {
      const secondaryMenu = document.createElement('div');
      secondaryMenu.className = 'secondary-menu';
      secondaryMenu.innerHTML = `
        <button class="secondary-trigger" type="button" aria-expanded="false">
          <span>${label}</span><span class="secondary-value"></span><i></i>
        </button>
        <div class="secondary-panel" role="menu">
          ${options.map(option => `
            <button class="secondary-option" type="button" data-value="${option.value}" role="menuitemradio">
              ${option.label}
            </button>
          `).join('')}
        </div>
      `;

      const trigger = secondaryMenu.querySelector<HTMLButtonElement>('.secondary-trigger')!;
      const valueLabel = secondaryMenu.querySelector<HTMLElement>('.secondary-value')!;
      const sync = (): void => {
        const value = getValue();
        const selected = options.find(option => option.value === value);
        valueLabel.textContent = selected?.label ?? '';
        secondaryMenu.querySelectorAll<HTMLButtonElement>('.secondary-option').forEach(option => {
          const active = option.dataset.value === value;
          option.classList.toggle('active', active);
          option.setAttribute('aria-checked', String(active));
        });
      };

      trigger.addEventListener('click', () => {
        const opening = !secondaryMenu.classList.contains('open');
        ownerMenu.querySelectorAll('.secondary-menu.open').forEach(menu => {
          menu.classList.remove('open');
          menu.querySelector('.secondary-trigger')?.setAttribute('aria-expanded', 'false');
        });
        secondaryMenu.classList.toggle('open', opening);
        trigger.setAttribute('aria-expanded', String(opening));
      });
      secondaryMenu.querySelectorAll<HTMLButtonElement>('.secondary-option').forEach(option => {
        option.addEventListener('click', () => {
          onSelect(option.dataset.value!);
          sync();
        });
      });
      sync();
      return secondaryMenu;
    };

    const aiColorSelect = document.getElementById('ai-color') as HTMLSelectElement;
    const aiStrengthSelect = document.getElementById('ai-strength') as HTMLSelectElement;
    const markerSelect = document.getElementById('last-move-marker') as HTMLSelectElement;
    gameMenu.appendChild(createSecondaryMenu(
      'New Game',
      () => aiToggleInput.checked ? 'ai' : 'human',
      [
        { label: 'Play as AI', value: 'ai' },
        { label: 'Play as Human', value: 'human' },
      ],
      value => {
        aiToggleInput.checked = value === 'ai';
        aiToggleInput.dispatchEvent(new Event('change'));
        (document.getElementById('reset-btn') as HTMLButtonElement).click();
      }
    ));
    gameMenu.appendChild(createSecondaryMenu(
      'AI Color',
      () => aiColorSelect.value,
      [
        { label: 'White', value: 'white' },
        { label: 'Black', value: 'black' },
      ],
      value => {
        aiColorSelect.value = value;
        aiColorSelect.dispatchEvent(new Event('change'));
      }
    ));
    gameMenu.appendChild(createSecondaryMenu(
      'AI Strength',
      () => aiStrengthSelect.value,
      [
        { label: 'Casual', value: 'casual' },
        { label: 'Strong', value: 'strong' },
        { label: 'Maximum', value: 'maximum' },
      ],
      value => {
        aiStrengthSelect.value = value;
        aiStrengthSelect.dispatchEvent(new Event('change'));
      }
    ));
    gameMenu.appendChild(createSecondaryMenu(
      'Last Move Marker',
      () => markerSelect.value,
      [
        { label: 'None', value: 'none' },
        { label: 'Circle', value: 'circle' },
        { label: 'Triangle', value: 'triangle' },
        { label: 'Move Number', value: 'number' },
      ],
      value => {
        markerSelect.value = value;
        markerSelect.dispatchEvent(new Event('change'));
      }
    ));
    gameMenu.appendChild(document.getElementById('review-btn')!);
    const fileActionsSeparator = document.createElement('div');
    fileActionsSeparator.className = 'menu-separator';
    fileActionsSeparator.setAttribute('role', 'separator');
    gameMenu.appendChild(fileActionsSeparator);
    gameMenu.appendChild(document.querySelector('.btn-load')!);
    gameMenu.appendChild(document.getElementById('save-sgf-btn')!);
    gameMenu.appendChild(document.getElementById('export-board-btn')!);
    document.getElementById('new-game-btn')!.remove();

    const rulesSource = document.querySelector('.rules-toggle-container')!;
    const analysisSettingsSource = document.querySelector('#tab-analysis > .settings')!;
    const analysisSettingSources = document.createElement('div');
    analysisSettingSources.className = 'analysis-setting-sources';
    analysisSettingSources.appendChild(rulesSource);
    analysisSettingSources.appendChild(analysisSettingsSource);
    analysisMenu.appendChild(analysisSettingSources);

    const liveAnalysisInput = document.getElementById('live-game-analysis') as HTMLInputElement;
    const bestMovesInput = document.getElementById('show-best-moves') as HTMLInputElement;
    const ownershipInput = document.getElementById('show-ownership') as HTMLInputElement;
    const onOffOptions = [
      { label: 'On', value: 'on' },
      { label: 'Off', value: 'off' },
    ];
    analysisMenu.appendChild(createSecondaryMenu(
      'Scoring Rules',
      () => this.selectedRules,
      [
        { label: 'Japanese', value: 'japanese' },
        { label: 'Chinese', value: 'chinese' },
      ],
      value => {
        document.getElementById(value === 'japanese' ? 'btn-rules-japanese' : 'btn-rules-chinese')!.click();
      },
      analysisMenu
    ));
    analysisMenu.appendChild(createSecondaryMenu(
      'Live Game Analysis',
      () => liveAnalysisInput.checked ? 'on' : 'off',
      onOffOptions,
      value => {
        liveAnalysisInput.checked = value === 'on';
        liveAnalysisInput.dispatchEvent(new Event('change'));
      },
      analysisMenu
    ));
    analysisMenu.appendChild(createSecondaryMenu(
      'Best Moves',
      () => bestMovesInput.checked ? 'on' : 'off',
      onOffOptions,
      value => {
        bestMovesInput.checked = value === 'on';
        bestMovesInput.dispatchEvent(new Event('change'));
      },
      analysisMenu
    ));
    analysisMenu.appendChild(createSecondaryMenu(
      'Show Territory',
      () => ownershipInput.checked ? 'on' : 'off',
      onOffOptions,
      value => {
        ownershipInput.checked = value === 'on';
        ownershipInput.dispatchEvent(new Event('change'));
      },
      analysisMenu
    ));
    const analyzeSeparator = document.createElement('div');
    analyzeSeparator.className = 'menu-separator';
    analyzeSeparator.setAttribute('role', 'separator');
    analysisMenu.appendChild(analyzeSeparator);
    analysisMenu.appendChild(document.getElementById('analyze-btn')!);
    document.querySelector('.analysis-controls')!.remove();
    document.querySelector('.load-section')!.remove();
    document.querySelector('.dock-actions')!.remove();
    document.getElementById('tab-game')!.remove();

    const closeMenus = (): void => {
      document.querySelectorAll('.menu-group.open').forEach(group => {
        group.classList.remove('open');
        group.querySelector('.menu-trigger')?.setAttribute('aria-expanded', 'false');
      });
      document.querySelectorAll('.secondary-menu.open').forEach(menu => {
        menu.classList.remove('open');
        menu.querySelector('.secondary-trigger')?.setAttribute('aria-expanded', 'false');
      });
    };
    document.querySelectorAll<HTMLButtonElement>('.menu-trigger').forEach(trigger => {
      trigger.addEventListener('click', event => {
        event.stopPropagation();
        const group = trigger.parentElement!;
        const opening = !group.classList.contains('open');
        closeMenus();
        group.classList.toggle('open', opening);
        trigger.setAttribute('aria-expanded', String(opening));
      });
    });
    document.querySelectorAll('.menu-panel').forEach(panel => {
      panel.addEventListener('click', event => {
        event.stopPropagation();
        const target = event.target as HTMLElement;
        if (target.closest('.btn-load, .btn-save-sgf, .btn-review, .secondary-option, #analyze-btn, #export-board-btn')) {
          closeMenus();
        }
      });
    });
    document.addEventListener('click', closeMenus);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeMenus();
    });

    const themeToggle = document.getElementById('theme-toggle') as HTMLButtonElement;
    const setTheme = (theme: 'dark' | 'light'): void => {
      const isLight = theme === 'light';
      document.body.classList.toggle('light-theme', isLight);
      themeToggle.setAttribute('aria-pressed', String(isLight));
      themeToggle.setAttribute('aria-label', `Switch to ${isLight ? 'dark' : 'light'} theme`);
      themeToggle.title = `Switch to ${isLight ? 'dark' : 'light'} theme`;
      localStorage.setItem('katago-theme', theme);
    };
    const savedTheme = localStorage.getItem('katago-theme');
    const initialTheme = savedTheme === 'light' || savedTheme === 'dark'
      ? savedTheme
      : window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    setTheme(initialTheme);
    themeToggle.addEventListener('click', () => {
      setTheme(document.body.classList.contains('light-theme') ? 'dark' : 'light');
    });

    const container = document.querySelector('.game-container')!;
    const timelineToggle = document.getElementById('timeline-collapse-toggle') as HTMLButtonElement;
    const setTimelineCollapsed = (collapsed: boolean): void => {
      container.classList.toggle('timeline-collapsed', collapsed);
      timelineToggle.textContent = collapsed ? '⌃' : '⌄';
      timelineToggle.setAttribute('aria-expanded', String(!collapsed));
      timelineToggle.setAttribute(
        'aria-label',
        collapsed ? 'Expand game timeline' : 'Collapse game timeline'
      );
      timelineToggle.title = collapsed ? 'Expand game timeline' : 'Collapse game timeline';
      localStorage.setItem('katago-timeline-collapsed', String(collapsed));
      window.setTimeout(() => this.renderer?.resizeToContainer(), 220);
    };
    setTimelineCollapsed(localStorage.getItem('katago-timeline-collapsed') === 'true');
    timelineToggle.addEventListener('click', () => {
      setTimelineCollapsed(!container.classList.contains('timeline-collapsed'));
    });

    this.turnIndicator = document.querySelector('.turn-indicator span')!;
    this.stoneIcon = document.querySelector('.turn-indicator .stone-icon')!;
    this.blackCaptures = document.getElementById('black-captures')!;
    this.whiteCaptures = document.getElementById('white-captures')!;
    this.serverStatus = document.getElementById('server-status')!;
    this.analyzeBtn = document.getElementById('analyze-btn') as HTMLButtonElement;
    this.winrateDisplay = document.getElementById('analysis-results')!;
    this.topMovesDisplay = document.getElementById('top-moves')!;

    document.getElementById('pass-btn')!.addEventListener('click', () => {
      this.preserveLiveChartMove = null;
      this.game.pass();
      this.renderer.clearAnalysis();
      this.renderer.render();
      this.updateUI();
      this.hideAnalysis();
      this.scheduleLiveWinrateAnalysis();
      this.scheduleAiMove();
    });

    document.getElementById('undo-btn')!.addEventListener('click', () => {
      this.undoLastMove();
    });

    document.getElementById('play-against-ai')!.addEventListener('change', () => {
      this.aiRequest++;
      this.aiThinking = false;
      this.updateAiControls();
      this.scheduleAiMove();
    });

    document.getElementById('ai-color')!.addEventListener('change', () => {
      this.aiRequest++;
      this.aiThinking = false;
      this.updateAiControls();
      this.scheduleAiMove();
    });

    document.getElementById('ai-strength')!.addEventListener('change', () => {
      this.aiRequest++;
      this.aiThinking = false;
      this.updateAiControls();
      this.scheduleAiMove();
    });

    document.getElementById('reset-btn')!.addEventListener('click', () => {
      this.aiRequest++;
      this.aiThinking = false;
      this.game.reset();
      this.renderer.clearAnalysis();
      this.renderer.render();
      this.updateUI();
      this.hideAnalysis();
      this.resetWinrateHistory();
      this.updateAiControls();
      this.scheduleAiMove();
    });

    document.getElementById('last-move-marker')!.addEventListener('change', (e) => {
      this.renderer.lastMoveMarkerType = (e.target as HTMLSelectElement).value as LastMoveMarkerType;
      this.renderer.render();
    });

    document.getElementById('show-ownership')!.addEventListener('change', (e) => {
      this.renderer.showOwnership = (e.target as HTMLInputElement).checked;
      this.renderer.render();
      if (this.game.isReplayMode) {
        this.scheduleReplayPositionAnalysis();
      } else {
        this.scheduleLiveWinrateAnalysis();
      }
    });

    document.getElementById('live-game-analysis')!.addEventListener('change', (event) => {
      if (!(event.target as HTMLInputElement).checked && !this.game.isReplayMode) {
        this.renderer.clearAnalysis();
        this.renderer.render();
        this.hideAnalysis();
      }
      this.scheduleLiveWinrateAnalysis();
    });

    document.getElementById('show-best-moves')!.addEventListener('change', () => {
      const liveAnalysisEnabled = (document.getElementById('live-game-analysis') as HTMLInputElement).checked;
      const currentAnalysis = this.latestAnalysis;
      this.renderer.clearAnalysis();
      this.renderer.render();
      this.hideAnalysis();

      if (this.game.isReplayMode) {
        this.scheduleReplayPositionAnalysis();
      } else if (liveAnalysisEnabled) {
        this.scheduleLiveWinrateAnalysis();
      } else if (currentAnalysis) {
        this.applyPositionAnalysis(currentAnalysis, this.game.moveHistory.length, 'manual');
      }
    });

    this.analyzeBtn.addEventListener('click', () => this.analyze());

    document.getElementById('dock-prev')!.addEventListener('click', () => {
      if (this.game.isReplayMode) {
        this.game.prevMove();
        this.finishReplayNavigation();
      } else {
        this.undoLastMove();
      }
    });
    document.getElementById('dock-next')!.addEventListener('click', () => {
      if (this.game.isReplayMode) {
        this.game.nextMove();
        this.finishReplayNavigation();
      }
    });
    document.getElementById('timeline-jump-slider')!.addEventListener('input', event => {
      const moveNumber = Number((event.target as HTMLInputElement).value);
      if (!this.game.isReplayMode && this.game.moveHistory.length > 0) {
        this.enterReplayForCurrentGame();
      }
      if (!this.game.isReplayMode) return;
      this.game.goToMove(moveNumber);
      this.finishReplayNavigation();
    });
    document.getElementById('export-board-btn')!.addEventListener('click', () => this.exportBoardImage());
    this.updateMoveTimeline();
  }

  private updateMoveTimeline(): void {
    const timeline = document.getElementById('move-timeline');
    if (!timeline) return;

    const moves = this.game.getTimelineMoves();
    const activeMove = this.game.isReplayMode
      ? this.game.getCurrentMoveNumber()
      : moves.length;
    const jumpSlider = document.getElementById('timeline-jump-slider') as HTMLInputElement;
    jumpSlider.max = moves.length.toString();
    jumpSlider.value = activeMove.toString();
    jumpSlider.disabled = moves.length === 0;
    document.getElementById('timeline-current-move')!.textContent = activeMove.toString();
    document.getElementById('timeline-total-moves')!.textContent = moves.length.toString();

    if (moves.length === 0) {
      timeline.innerHTML = '<div class="move-timeline-empty">Play a move to begin the timeline</div>';
      return;
    }

    const visibleCount = Math.min(10, moves.length);
    const preferredStart = activeMove - Math.ceil(visibleCount / 2);
    const start = Math.max(0, Math.min(preferredStart, moves.length - visibleCount));
    const visibleMoves = moves.slice(start, start + visibleCount);

    timeline.innerHTML = visibleMoves.map((move, index) => {
      const moveNumber = start + index + 1;
      const coordinate = this.game.positionToGtp(move.x, move.y);
      return `
        <button class="timeline-move${moveNumber === activeMove ? ' active' : ''}" data-move="${moveNumber}" title="Go to move ${moveNumber}">
          <span class="timeline-number">${moveNumber}</span>
          <span class="timeline-detail">
            <i class="timeline-stone ${move.color}"></i>
            <strong>${coordinate}</strong>
          </span>
        </button>
      `;
    }).join('');

    timeline.querySelectorAll<HTMLButtonElement>('.timeline-move').forEach(button => {
      button.addEventListener('click', () => {
        const moveNumber = Number(button.dataset.move);
        if (!this.game.isReplayMode) this.enterReplayForCurrentGame();
        if (!this.game.isReplayMode) return;
        this.game.goToMove(moveNumber);
        this.finishReplayNavigation();
      });
    });
  }

  private exportBoardImage(): void {
    const canvas = document.getElementById('board') as HTMLCanvasElement;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `katago-board-${new Date().toISOString().slice(0, 10)}.png`;
      link.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
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
    this.resetWinrateHistory();
    this.gameInfo = parsed.info;

    if (parsed.info.boardSize !== this.game.size) {
      this.game = new GoGame(parsed.info.boardSize);
      this.renderer.updateGame(this.game);

      const buttons = document.querySelectorAll('.board-size-selector button');
      buttons.forEach((btn) => {
        const size = parseInt((btn as HTMLElement).dataset.size!, 10);
        btn.classList.toggle('active', size === parsed.info.boardSize);
      });
    }

    this.game.loadGame(parsed.moves);
    this.game.lastMoveReplay();
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
    document.getElementById('ai-settings')!.style.display = 'none';

    const slider = document.getElementById('move-slider') as HTMLInputElement;
    slider.max = this.game.getTotalMoves().toString();
    slider.value = '0';

    document.getElementById('total-moves')!.textContent = this.game.getTotalMoves().toString();
    document.getElementById('winrate-play-from-here')!.style.display = 'block';
  }

  private hideReplayControls(): void {
    document.getElementById('replay-controls')!.style.display = 'none';
    document.getElementById('game-info')!.style.display = 'none';
    document.getElementById('turn-indicator')!.style.display = 'flex';
    document.querySelector('.buttons')!.removeAttribute('style');
    document.getElementById('ai-settings')!.style.display = 'flex';
    document.getElementById('winrate-play-from-here')!.style.display = 'none';
  }

  private setupReplayControls(): void {
    document.getElementById('review-btn')!.addEventListener('click', () => {
      this.enterReplayForCurrentGame();
    });

    document.getElementById('first-btn')!.addEventListener('click', () => {
      this.game.firstMove();
      this.finishReplayNavigation();
    });

    document.getElementById('prev-btn')!.addEventListener('click', () => {
      this.game.prevMove();
      this.finishReplayNavigation();
    });

    document.getElementById('next-btn')!.addEventListener('click', () => {
      this.game.nextMove();
      this.finishReplayNavigation();
    });

    document.getElementById('last-btn')!.addEventListener('click', () => {
      this.game.lastMoveReplay();
      this.finishReplayNavigation();
    });

    document.getElementById('exit-replay-btn')!.addEventListener('click', () => {
      this.playFromReplayPosition();
    });

    document.getElementById('winrate-play-from-here')!.addEventListener('click', () => {
      this.playFromReplayPosition();
    });

    const slider = document.getElementById('move-slider') as HTMLInputElement;
    slider.addEventListener('input', () => {
      const moveNum = parseInt(slider.value, 10);
      this.game.goToMove(moveNum);
      this.finishReplayNavigation();
    });

    document.addEventListener('keydown', (e) => {
      if (!this.game.isReplayMode && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        this.undoLastMove();
        return;
      }
      if (!this.game.isReplayMode) return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        this.game.prevMove();
        this.finishReplayNavigation();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        this.game.nextMove();
        this.finishReplayNavigation();
      } else if (e.key === 'Home') {
        e.preventDefault();
        this.game.firstMove();
        this.finishReplayNavigation();
      } else if (e.key === 'End') {
        e.preventDefault();
        this.game.lastMoveReplay();
        this.finishReplayNavigation();
      }
    });
  }

  private finishReplayNavigation(): void {
    this.replayAnalysisRequest++;
    this.renderer.clearAnalysis();
    this.hideAnalysis();
    this.updateReplayUI();
    this.renderer.render();
    this.scheduleReplayPositionAnalysis();
  }

  private updateReplayUI(): void {
    const currentMove = this.game.getCurrentMoveNumber();
    document.getElementById('current-move')!.textContent = currentMove.toString();
    (document.getElementById('move-slider') as HTMLInputElement).value = currentMove.toString();
    this.blackCaptures.textContent = this.game.captures.black.toString();
    this.whiteCaptures.textContent = this.game.captures.white.toString();
    document.getElementById('winrate-branch-move')!.textContent = currentMove.toString();
    this.updateMoveTimeline();
  }

  private playFromReplayPosition(): void {
    if (!this.game.isReplayMode) return;

    const branchMove = this.game.getCurrentMoveNumber();
    this.game.exitReplayMode();
    this.pruneAnalysisAfter(branchMove);
    this.preserveLiveChartMove = branchMove;
    this.renderer.clearAnalysis();
    this.hideAnalysis();
    this.hideReplayControls();
    this.renderer.render();
    this.updateUI();
    this.scheduleLiveWinrateAnalysis();
    this.scheduleAiMove();
  }

  private undoLastMove(): void {
    this.aiRequest++;
    this.aiThinking = false;
    if (!this.game.undoLastMove()) {
      this.updateAiControls();
      return;
    }

    // If the last completed turn ended with an AI response, also take back
    // the human move so the user can choose a different continuation.
    while (this.isAiEnabled() && this.game.currentPlayer === this.getAiColor() && this.game.canUndo()) {
      this.game.undoLastMove();
    }

    const moveNumber = this.game.moveHistory.length;
    this.pruneAnalysisAfter(moveNumber);
    this.preserveLiveChartMove = moveNumber;
    this.renderer.clearAnalysis();
    this.hideAnalysis();
    this.renderer.render();
    this.updateUI();
    this.scheduleLiveWinrateAnalysis();
    this.scheduleAiMove();
  }

  private isAiEnabled(): boolean {
    return this.serverOnline
      && (document.getElementById('play-against-ai') as HTMLInputElement).checked;
  }

  private getAiColor(): 'black' | 'white' {
    return (document.getElementById('ai-color') as HTMLSelectElement).value as 'black' | 'white';
  }

  private isAiTurn(): boolean {
    return this.isAiEnabled()
      && !this.game.isReplayMode
      && this.game.currentPlayer === this.getAiColor();
  }

  private updateAiControls(): void {
    const aiToggle = document.getElementById('play-against-ai') as HTMLInputElement | null;
    if (!aiToggle || !this.renderer) return;

    const enabled = this.isAiEnabled();
    const aiTurn = this.isAiTurn();
    const colorSelect = document.getElementById('ai-color') as HTMLSelectElement;
    const strengthSelect = document.getElementById('ai-strength') as HTMLSelectElement;
    const status = document.getElementById('ai-status')!;
    const passButton = document.getElementById('pass-btn') as HTMLButtonElement;

    colorSelect.disabled = !enabled || this.aiThinking;
    strengthSelect.disabled = !enabled || this.aiThinking;
    passButton.disabled = aiTurn || this.aiThinking || this.game.isReplayMode;
    this.renderer.setMoveInputEnabled(!aiTurn && !this.aiThinking && !this.game.isReplayMode);

    if (!enabled) {
      status.textContent = this.serverOnline ? 'AI off' : 'KataGo offline';
    } else if (this.aiThinking) {
      status.textContent = `${this.getAiColor() === 'black' ? 'Black' : 'White'} AI thinking…`;
    } else {
      status.textContent = `AI plays ${this.getAiColor()}`;
    }
  }

  private scheduleAiMove(): void {
    const request = ++this.aiRequest;
    this.updateAiControls();
    if (!this.isAiTurn() || this.aiThinking) return;

    this.aiThinking = true;
    this.updateAiControls();
    void this.makeAiMove(request);
  }

  private async makeAiMove(request: number): Promise<void> {
    const moves = this.game.getKataGoMoves();
    const moveNumber = moves.length;
    const strength = (document.getElementById('ai-strength') as HTMLSelectElement).value;
    const settings = strength === 'maximum'
      ? { visits: 600, candidates: 1 }
      : strength === 'casual'
        ? { visits: 30, candidates: 3 }
        : { visits: 200, candidates: 1 };

    let failed = false;
    try {
      const result = await this.requestPositionAnalysis(moves, settings.visits, false);
      const stillCurrent = request === this.aiRequest
        && this.isAiTurn()
        && moveNumber === this.game.moveHistory.length;
      if (!stillCurrent) return;

      // The AI search already evaluated the position after the human move, so
      // retain that stronger result even if the separate live request is
      // invalidated when the AI responds quickly.
      this.winrateChart.upsert({
        moveNumber,
        winrate: result.winrate,
        scoreLead: result.scoreLead,
        visits: result.visits,
      });

      const candidates = result.topMoves.slice(0, settings.candidates);
      const selected = settings.candidates === 1
        ? candidates[0]
        : candidates[Math.min(candidates.length - 1, Math.floor(Math.random() * candidates.length))];
      if (!selected) throw new Error('KataGo returned no legal move');

      const position = this.game.gtpToPos(selected.move);
      const moved = position
        ? this.game.placeStone(position.x, position.y)
        : selected.move.toLowerCase() === 'pass' && (this.game.pass(), true);
      if (!moved) throw new Error(`KataGo returned an invalid move: ${selected.move}`);

      this.preserveLiveChartMove = null;
      this.renderer.clearAnalysis();
      this.hideAnalysis();
      this.renderer.render();
      this.updateUI();
      this.scheduleLiveWinrateAnalysis();
    } catch (error) {
      failed = true;
      console.error('AI move failed:', error);
    } finally {
      if (request === this.aiRequest) {
        this.aiThinking = false;
        this.updateAiControls();
        if (failed) document.getElementById('ai-status')!.textContent = 'AI move failed';
      }
    }
  }

  private async analyze(): Promise<void> {
    if (!this.serverOnline) return;

    this.analyzeBtn.disabled = true;
    this.analyzeBtn.textContent = 'Analyzing...';

    try {
      const moves = this.game.getKataGoMoves();
      const result = await this.requestPositionAnalysis(moves, 200, true);

      try {
        this.applyPositionAnalysis(result, moves.length, 'manual');
        void this.backfillWinrateHistory();
      } catch (error) {
        // A presentation bug must not be reported as a KataGo outage.
        console.error('Failed to display analysis:', error);
      }
    } catch (error) {
      console.error('Analysis request failed:', error);
      this.serverOnline = false;
      this.updateServerStatus();
    } finally {
      this.analyzeBtn.disabled = false;
      this.analyzeBtn.textContent = 'Start Analyze';
    }
  }

  private scheduleLiveWinrateAnalysis(): void {
    const request = ++this.liveAnalysisRequest;
    if (this.liveAnalysisTimer !== null) {
      window.clearTimeout(this.liveAnalysisTimer);
      this.liveAnalysisTimer = null;
    }

    const liveAnalysisEnabled = (document.getElementById('live-game-analysis') as HTMLInputElement).checked;
    if (!liveAnalysisEnabled || !this.serverOnline || this.game.isReplayMode) return;
    if (this.backfilledGeneration !== this.chartGeneration) {
      void this.backfillWinrateHistory();
    }

    // Avoid starting work for accidental double-clicks or a rapid sequence of
    // replay/navigation changes. Human play still feels immediate at 120ms.
    this.liveAnalysisTimer = window.setTimeout(() => {
      this.liveAnalysisTimer = null;
      void this.updateLiveAnalysis(request);
    }, 120);
  }

  private setupWinrateChartControls(): void {
    const blackToggle = document.getElementById('show-black-winrate') as HTMLInputElement;
    const whiteToggle = document.getElementById('show-white-winrate') as HTMLInputElement;
    const updateVisibility = (): void => {
      this.winrateChart.setSeriesVisibility(blackToggle.checked, whiteToggle.checked);
    };
    blackToggle.addEventListener('change', updateVisibility);
    whiteToggle.addEventListener('change', updateVisibility);
  }

  private showMoveFromWinrateChart(moveNumber: number): void {
    if (this.game.getTotalMoves() === 0 && !this.game.isReplayMode) {
      this.enterReplayForCurrentGame();
    }
    if (!this.game.isReplayMode) return;

    this.game.goToMove(moveNumber);
    this.finishReplayNavigation();
  }

  private scheduleReplayPositionAnalysis(): void {
    const request = ++this.replayAnalysisRequest;
    if (this.replayAnalysisTimer !== null) {
      window.clearTimeout(this.replayAnalysisTimer);
      this.replayAnalysisTimer = null;
    }

    const ownershipEnabled = (document.getElementById('show-ownership') as HTMLInputElement).checked;
    const bestMovesEnabled = (document.getElementById('show-best-moves') as HTMLInputElement).checked;
    if ((!ownershipEnabled && !bestMovesEnabled) || !this.game.isReplayMode || !this.serverOnline) return;

    const moveNumber = this.game.getCurrentMoveNumber();
    const cached = this.replayAnalysisCache.get(moveNumber);
    if (cached && (!ownershipEnabled || cached.ownership)) {
      this.applyPositionAnalysis(cached, moveNumber, 'replay');
      return;
    }

    const generation = this.chartGeneration;
    const boardSize = this.game.size;
    const moves = this.game.getKataGoMoves();
    const komi = this.gameInfo?.komi ?? 6.5;

    this.replayAnalysisTimer = window.setTimeout(async () => {
      this.replayAnalysisTimer = null;
      try {
        const result = await this.requestPositionAnalysis(moves, 40, ownershipEnabled, boardSize, komi);
        if (generation === this.chartGeneration) {
          this.replayAnalysisCache.set(moveNumber, result);
        }

        const stillCurrent = request === this.replayAnalysisRequest
          && generation === this.chartGeneration
          && this.game.isReplayMode
          && this.game.getCurrentMoveNumber() === moveNumber
          && ((document.getElementById('show-ownership') as HTMLInputElement).checked
            || (document.getElementById('show-best-moves') as HTMLInputElement).checked);
        if (stillCurrent) this.applyPositionAnalysis(result, moveNumber, 'replay');
      } catch (error) {
        console.error('Replay position analysis failed:', error);
      }
    }, 100);
  }

  private async updateLiveAnalysis(request: number): Promise<void> {
    const generation = this.chartGeneration;
    const moves = this.game.getKataGoMoves();
    const moveNumber = moves.length;
    const includeOwnership = (document.getElementById('show-ownership') as HTMLInputElement).checked;
    const status = document.getElementById('winrate-chart-status')!;
    status.textContent = 'Updating…';

    try {
      // Forty visits keeps live play responsive. Ownership is requested only
      // when its overlay is enabled.
      const result = await this.requestPositionAnalysis(moves, 40, includeOwnership);
      const stillCurrent = request === this.liveAnalysisRequest
        && generation === this.chartGeneration
        && !this.game.isReplayMode
        && moveNumber === this.game.moveHistory.length
        && (document.getElementById('live-game-analysis') as HTMLInputElement).checked;
      if (!stillCurrent) return;

      const preserveChartPoint = this.preserveLiveChartMove === moveNumber;
      if (preserveChartPoint) this.preserveLiveChartMove = null;
      this.applyPositionAnalysis(result, moveNumber, 'live', !preserveChartPoint);
      status.textContent = `${result.visits} visits`;
    } catch (error) {
      console.error('Live win-rate update failed:', error);
      if (generation === this.chartGeneration) status.textContent = 'Update failed';
    }
  }

  private requestPositionAnalysis(
    moves: ReturnType<GoGame['getKataGoMoves']>,
    maxVisits: number,
    includeOwnership: boolean,
    boardSize = this.game.size,
    komi = this.gameInfo?.komi ?? 6.5
  ): Promise<AnalysisResponse> {
    return analyzePosition(boardSize, moves, komi, maxVisits, includeOwnership);
  }

  private applyPositionAnalysis(
    result: AnalysisResponse,
    moveNumber: number,
    source: 'manual' | 'live' | 'replay',
    replaceExistingChartPoint = source !== 'replay'
  ): void {
    this.winrateChart.upsert({
      moveNumber,
      winrate: result.winrate,
      scoreLead: result.scoreLead,
      visits: result.visits,
    }, replaceExistingChartPoint);

    const ownershipEnabled = (document.getElementById('show-ownership') as HTMLInputElement).checked;
    const bestMovesEnabled = (document.getElementById('show-best-moves') as HTMLInputElement).checked;
    const visibleResult = bestMovesEnabled ? result : { ...result, topMoves: [] };

    if (source === 'manual' || bestMovesEnabled) {
      this.showAnalysis(visibleResult, result);
      this.renderer.setAnalysis(visibleResult);
      return;
    }

    if (ownershipEnabled && result.ownership) {
      // Territory can update independently without drawing suggestion markers.
      this.renderer.setAnalysis({ ...result, topMoves: [] });
    }
  }

  private async backfillWinrateHistory(): Promise<void> {
    const generation = this.chartGeneration;
    if (this.backfilledGeneration === generation) return;

    const moves = this.game.getKataGoMoves();
    if (moves.length === 0) return;
    this.backfilledGeneration = generation;

    const boardSize = this.game.size;
    const komi = this.gameInfo?.komi ?? 6.5;
    const status = document.getElementById('winrate-chart-status')!;
    status.textContent = 'Building history…';

    try {
      const points = await analyzeGameWinrates(boardSize, moves, komi, 1);
      if (generation !== this.chartGeneration) return;

      // Preserve any higher-visit live/manual point already on the chart.
      this.winrateChart.mergeMissing(points);
      status.textContent = `${points.length} positions`;
    } catch (error) {
      console.error('Win-rate history failed:', error);
      if (generation === this.chartGeneration) {
        status.textContent = 'History failed';
        this.backfilledGeneration = -1;
      }
    }
  }

  private resetWinrateHistory(): void {
    this.chartGeneration++;
    this.backfilledGeneration = -1;
    this.preserveLiveChartMove = null;
    this.liveAnalysisRequest++;
    this.replayAnalysisRequest++;
    this.replayAnalysisCache.clear();
    if (this.replayAnalysisTimer !== null) {
      window.clearTimeout(this.replayAnalysisTimer);
      this.replayAnalysisTimer = null;
    }
    if (this.liveAnalysisTimer !== null) {
      window.clearTimeout(this.liveAnalysisTimer);
      this.liveAnalysisTimer = null;
    }
    this.winrateChart.clear();
    const status = document.getElementById('winrate-chart-status');
    if (status) status.textContent = '';
  }

  private pruneAnalysisAfter(moveNumber: number): void {
    // Invalidate analysis still running for the discarded future branch while
    // retaining every chart/territory result that belongs to the shared past.
    this.chartGeneration++;
    this.backfilledGeneration = this.chartGeneration;
    this.liveAnalysisRequest++;
    this.replayAnalysisRequest++;

    if (this.liveAnalysisTimer !== null) {
      window.clearTimeout(this.liveAnalysisTimer);
      this.liveAnalysisTimer = null;
    }
    if (this.replayAnalysisTimer !== null) {
      window.clearTimeout(this.replayAnalysisTimer);
      this.replayAnalysisTimer = null;
    }

    this.winrateChart.truncateAfter(moveNumber);
    for (const cachedMove of this.replayAnalysisCache.keys()) {
      if (cachedMove > moveNumber) this.replayAnalysisCache.delete(cachedMove);
    }

    const status = document.getElementById('winrate-chart-status');
    if (status) status.textContent = `Playing from move ${moveNumber}`;
  }

  private showAnalysis(result: AnalysisResponse, fullResult: AnalysisResponse = result): void {
    this.latestAnalysis = fullResult;
    this.winrateDisplay.style.display = 'block';
    document.getElementById('best-moves-section')!.style.display = (
      document.getElementById('show-best-moves') as HTMLInputElement
    ).checked
      ? 'block'
      : 'none';

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
            <span class="move-rank" style="background: ${colors[i]}">${String.fromCharCode(97 + i)}</span>
            <span class="move-coord">${move.move}</span>
            <span class="move-winrate">${(move.winrate * 100).toFixed(1)}%</span>
          </div>
        `;
      })
      .join('');

    this.updateScoreEstimates();
  }

  private hideAnalysis(): void {
    this.winrateDisplay.style.display = 'none';
    document.getElementById('best-moves-section')!.style.display = (
      document.getElementById('show-best-moves') as HTMLInputElement
    ).checked
      ? 'block'
      : 'none';
    this.latestAnalysis = null;
    this.updateScoreEstimates();
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

  private setupPanelSplitter(): void {
    const container = document.querySelector('.game-container') as HTMLElement;
    const sidebar = document.getElementById('sidebar')!;
    const splitter = document.getElementById('panel-splitter')!;
    const minSidebarWidth = 300;
    const maxSidebarWidth = 620;
    const minBoardWidth = 540;
    const desktopBreakpoint = 1280;
    const storageKey = 'go-game-inspector-width';
    let isDragging = false;
    let queuedWidth: number | null = null;
    let resizeFrame: number | null = null;

    const getMaximumWidth = (): number => Math.max(
      minSidebarWidth,
      Math.min(maxSidebarWidth, container.clientWidth - minBoardWidth - splitter.offsetWidth - 24)
    );

    const storeWidth = (width: number): void => {
      try {
        localStorage.setItem(storageKey, String(Math.round(width)));
      } catch {
        // Resizing should still work when browser storage is unavailable.
      }
    };

    const applyWidth = (width: number, persist = false): number => {
      if (window.innerWidth < desktopBreakpoint) return sidebar.offsetWidth;

      const maximumWidth = getMaximumWidth();
      const clampedWidth = Math.max(minSidebarWidth, Math.min(width, maximumWidth));
      container.style.setProperty('--inspector-width', `${clampedWidth}px`);
      splitter.setAttribute('aria-valuenow', String(Math.round(clampedWidth)));
      splitter.setAttribute('aria-valuemax', String(Math.round(maximumWidth)));
      this.renderer.resizeToContainer();
      if (persist) storeWidth(clampedWidth);
      return clampedWidth;
    };

    const queueWidth = (width: number): void => {
      queuedWidth = width;
      if (resizeFrame !== null) return;

      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        if (queuedWidth === null) return;
        applyWidth(queuedWidth);
        queuedWidth = null;
      });
    };

    splitter.addEventListener('pointerdown', (event: PointerEvent) => {
      if (event.button !== 0 || window.innerWidth < desktopBreakpoint) return;
      isDragging = true;
      splitter.setPointerCapture(event.pointerId);
      container.classList.add('is-resizing');
      event.preventDefault();
    });

    splitter.addEventListener('pointermove', (event: PointerEvent) => {
      if (!isDragging) return;
      queueWidth(container.getBoundingClientRect().right - event.clientX - 12);
    });

    const stopDragging = (event: PointerEvent): void => {
      if (!isDragging) return;
      isDragging = false;
      container.classList.remove('is-resizing');
      if (splitter.hasPointerCapture(event.pointerId)) {
        splitter.releasePointerCapture(event.pointerId);
      }

      const finalWidth = queuedWidth ?? sidebar.getBoundingClientRect().width;
      queuedWidth = null;
      if (resizeFrame !== null) {
        cancelAnimationFrame(resizeFrame);
        resizeFrame = null;
      }
      applyWidth(finalWidth, true);
    };

    splitter.addEventListener('pointerup', stopDragging);
    splitter.addEventListener('pointercancel', stopDragging);

    splitter.addEventListener('keydown', (event: KeyboardEvent) => {
      const step = event.shiftKey ? 48 : 16;
      const currentWidth = sidebar.getBoundingClientRect().width;
      let nextWidth: number | null = null;

      if (event.key === 'ArrowLeft') nextWidth = currentWidth + step;
      if (event.key === 'ArrowRight') nextWidth = currentWidth - step;
      if (event.key === 'Home') nextWidth = minSidebarWidth;
      if (event.key === 'End') nextWidth = getMaximumWidth();
      if (nextWidth === null) return;

      event.preventDefault();
      applyWidth(nextWidth, true);
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth < desktopBreakpoint) {
        container.style.removeProperty('--inspector-width');
        return;
      }
      applyWidth(sidebar.getBoundingClientRect().width);
    });

    let initialWidth = 370;
    try {
      const storedWidth = Number(localStorage.getItem(storageKey));
      if (Number.isFinite(storedWidth) && storedWidth > 0) initialWidth = storedWidth;
    } catch {
      // Use the default width when browser storage is unavailable.
    }
    applyWidth(initialWidth);
  }

  private changeBoardSize(size: number): void {
    this.aiRequest++;
    this.aiThinking = false;
    this.game = new GoGame(size);
    this.resetWinrateHistory();
    this.renderer.updateGame(this.game);
    this.renderer.render();
    this.updateUI();
    this.hideAnalysis();
    this.scheduleAiMove();
  }

  private updateUI(): void {
    const player = this.game.currentPlayer;
    this.turnIndicator.textContent = `${player.charAt(0).toUpperCase() + player.slice(1)} to play`;
    this.stoneIcon.className = `stone-icon ${player}`;
    this.blackCaptures.textContent = this.game.captures.black.toString();
    this.whiteCaptures.textContent = this.game.captures.white.toString();
    this.updateMoveTimeline();

    const reviewBtn = document.getElementById('review-btn') as HTMLButtonElement | null;
    if (reviewBtn) {
      reviewBtn.disabled = this.game.moveHistory.length === 0;
    }
    const undoBtn = document.getElementById('undo-btn') as HTMLButtonElement | null;
    if (undoBtn) undoBtn.disabled = !this.game.canUndo();
    this.updateAiControls();
  }

  private setupTabs(): void {
    const tabButtons = document.querySelectorAll<HTMLButtonElement>('.inspector-tab');
    tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab as 'analysis' | 'scene';
        this.switchTab(tab);
      });
    });

    const savedTab = localStorage.getItem('go-game-inspector-tab');
    this.switchTab(savedTab === 'scene' ? 'scene' : 'analysis');
  }

  private switchTab(tab: 'analysis' | 'scene'): void {
    const tabButtons = document.querySelectorAll<HTMLButtonElement>('.inspector-tab');
    tabButtons.forEach((btn) => {
      const isCurrent = btn.dataset.tab === tab;
      btn.classList.toggle('active', isCurrent);
      btn.setAttribute('aria-pressed', String(isCurrent));
    });

    document.getElementById('tab-analysis')!.classList.toggle('active', tab === 'analysis');
    document.getElementById('tab-scene')!.classList.toggle('active', tab === 'scene');
    localStorage.setItem('go-game-inspector-tab', tab);
  }

  private setupSceneSettings(): void {
    const ambientSlider = document.getElementById('ambient-intensity') as HTMLInputElement;
    const ambientVal = document.getElementById('ambient-intensity-val')!;
    ambientSlider.addEventListener('input', (e) => {
      const val = parseFloat((e.target as HTMLInputElement).value);
      ambientVal.textContent = val.toFixed(2);
      this.renderer.setAmbientLightIntensity(val);
    });

    const keySlider = document.getElementById('key-intensity') as HTMLInputElement;
    const keyVal = document.getElementById('key-intensity-val')!;
    keySlider.addEventListener('input', (e) => {
      const val = parseFloat((e.target as HTMLInputElement).value);
      keyVal.textContent = val.toFixed(2);
      this.renderer.setKeyLightIntensity(val);
    });

    const keyColorPicker = document.getElementById('key-color') as HTMLInputElement;
    keyColorPicker.addEventListener('input', (e) => {
      const color = (e.target as HTMLInputElement).value;
      this.renderer.setKeyLightColor(color);
    });

    const fillSlider = document.getElementById('fill-intensity') as HTMLInputElement;
    const fillVal = document.getElementById('fill-intensity-val')!;
    fillSlider.addEventListener('input', (e) => {
      const val = parseFloat((e.target as HTMLInputElement).value);
      fillVal.textContent = val.toFixed(2);
      this.renderer.setFillLightIntensity(val);
    });

    const pointSlider = document.getElementById('point-intensity') as HTMLInputElement;
    const pointVal = document.getElementById('point-intensity-val')!;
    pointSlider.addEventListener('input', (e) => {
      const val = parseFloat((e.target as HTMLInputElement).value);
      pointVal.textContent = val.toFixed(2);
      this.renderer.setPointLightIntensity(val);
    });

    const enableShadowsCheckbox = document.getElementById('enable-shadows') as HTMLInputElement;
    const shadowParamsSection = document.getElementById('shadow-params-section')!;
    enableShadowsCheckbox.addEventListener('change', (e) => {
      const enabled = (e.target as HTMLInputElement).checked;
      this.renderer.setShadowsEnabled(enabled);
      shadowParamsSection.style.display = enabled ? 'block' : 'none';
    });

    const showLidCollisionMesh = document.getElementById('show-lid-collision-mesh') as HTMLInputElement;
    showLidCollisionMesh.addEventListener('change', () => {
      this.renderer.setLidCollisionMeshVisible(showLidCollisionMesh.checked);
    });

    const showStoneCollisionMesh = document.getElementById('show-stone-collision-mesh') as HTMLInputElement;
    showStoneCollisionMesh.addEventListener('change', () => {
      this.renderer.setStoneCollisionMeshVisible(showStoneCollisionMesh.checked);
    });

    const shadowResSelect = document.getElementById('shadow-resolution') as HTMLSelectElement;
    shadowResSelect.addEventListener('change', (e) => {
      const res = parseInt((e.target as HTMLSelectElement).value, 10);
      this.renderer.setShadowResolution(res);
    });

    const shadowRadiusSlider = document.getElementById('shadow-radius') as HTMLInputElement;
    const shadowRadiusVal = document.getElementById('shadow-radius-val')!;
    shadowRadiusSlider.addEventListener('input', (e) => {
      const val = parseFloat((e.target as HTMLInputElement).value);
      shadowRadiusVal.textContent = val.toFixed(1);
      this.renderer.setShadowRadius(val);
    });

    const shadowOpacitySlider = document.getElementById('shadow-opacity') as HTMLInputElement;
    const shadowOpacityVal = document.getElementById('shadow-opacity-val')!;
    shadowOpacitySlider.addEventListener('input', (e) => {
      const val = parseFloat((e.target as HTMLInputElement).value);
      shadowOpacityVal.textContent = val.toFixed(2);
      this.renderer.setShadowOpacity(val);
    });

    const shadowBiasSlider = document.getElementById('shadow-bias') as HTMLInputElement;
    const shadowBiasVal = document.getElementById('shadow-bias-val')!;
    shadowBiasSlider.addEventListener('input', (e) => {
      const val = parseFloat((e.target as HTMLInputElement).value);
      shadowBiasVal.textContent = val.toFixed(4);
      this.renderer.setShadowBias(val);
    });

    const shadowNormalBiasSlider = document.getElementById('shadow-normal-bias') as HTMLInputElement;
    const shadowNormalBiasVal = document.getElementById('shadow-normal-bias-val')!;
    shadowNormalBiasSlider.addEventListener('input', (e) => {
      const val = parseFloat((e.target as HTMLInputElement).value);
      shadowNormalBiasVal.textContent = val.toFixed(3);
      this.renderer.setShadowNormalBias(val);
    });

    const resetBtn = document.getElementById('reset-lights-btn') as HTMLButtonElement;
    resetBtn.addEventListener('click', () => {
      ambientSlider.value = '1.0';
      ambientVal.textContent = '1.00';
      this.renderer.setAmbientLightIntensity(1.0);

      keySlider.value = '2.0';
      keyVal.textContent = '2.00';
      this.renderer.setKeyLightIntensity(2.0);

      keyColorPicker.value = '#fff7e6';
      this.renderer.setKeyLightColor('#fff7e6');

      fillSlider.value = '0.45';
      fillVal.textContent = '0.45';
      this.renderer.setFillLightIntensity(0.45);

      pointSlider.value = '0.8';
      pointVal.textContent = '0.80';
      this.renderer.setPointLightIntensity(0.8);

      enableShadowsCheckbox.checked = true;
      this.renderer.setShadowsEnabled(true);
      shadowParamsSection.style.display = 'block';

      shadowResSelect.value = '1024';
      this.renderer.setShadowResolution(1024);

      shadowRadiusSlider.value = '3';
      shadowRadiusVal.textContent = '3.0';
      this.renderer.setShadowRadius(3);

      shadowOpacitySlider.value = '0.15';
      shadowOpacityVal.textContent = '0.15';
      this.renderer.setShadowOpacity(0.15);

      shadowBiasSlider.value = '-0.0001';
      shadowBiasVal.textContent = '-0.0001';
      this.renderer.setShadowBias(-0.0001);

      shadowNormalBiasSlider.value = '0.02';
      shadowNormalBiasVal.textContent = '0.020';
      this.renderer.setShadowNormalBias(0.02);
    });
  }

  private setupRulesToggle(): void {
    const btnJapanese = document.getElementById('btn-rules-japanese')!;
    const btnChinese = document.getElementById('btn-rules-chinese')!;

    btnJapanese.addEventListener('click', () => {
      this.selectedRules = 'japanese';
      btnJapanese.classList.add('active');
      btnChinese.classList.remove('active');
      this.updateScoreEstimates();
    });

    btnChinese.addEventListener('click', () => {
      this.selectedRules = 'chinese';
      btnChinese.classList.add('active');
      btnJapanese.classList.remove('active');
      this.updateScoreEstimates();
    });
  }

  private updateScoreEstimates(): void {
    const estimatesContainer = document.getElementById('territory-estimates')!;
    if (!this.latestAnalysis || !this.latestAnalysis.ownership) {
      estimatesContainer.style.display = 'none';
      return;
    }

    estimatesContainer.style.display = 'block';

    const ownership = this.latestAnalysis.ownership;
    const size = this.game.size;
    const komi = this.gameInfo?.komi !== undefined ? this.gameInfo.komi : 6.5;

    let bTerritory = 0;
    let wTerritory = 0;
    let bDeadStones = 0;
    let wDeadStones = 0;
    let bArea = 0;
    let wArea = 0;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = y * size + x;
        const val = ownership[idx];
        const pB = Math.max(0, val);
        const pW = Math.max(0, -val);
        
        const stone = this.game.getStone(x, y);
        
        // Chinese Area Scoring
        bArea += pB;
        wArea += pW;
        
        // Japanese / Korean Territory Scoring
        if (stone === null) {
          bTerritory += pB;
          wTerritory += pW;
        } else if (stone === 'white') {
          bTerritory += pB; 
          bDeadStones += pB; 
        } else if (stone === 'black') {
          wTerritory += pW; 
          wDeadStones += pW; 
        }
      }
    }

    const bPrisoners = this.game.captures.white + bDeadStones;
    const wPrisoners = this.game.captures.black + wDeadStones;

    const bValSpan = document.getElementById('est-black-val')!;
    const wValSpan = document.getElementById('est-white-val')!;
    const resValSpan = document.getElementById('est-result-val')!;
    const detailsDiv = document.getElementById('est-details-text')!;

    if (this.selectedRules === 'japanese') {
      const bTotal = bTerritory + bPrisoners;
      const wTotal = wTerritory + wPrisoners + komi;
      const diff = bTotal - wTotal;

      bValSpan.textContent = bTotal.toFixed(1);
      wValSpan.textContent = wTotal.toFixed(1);
      resValSpan.textContent = diff > 0 ? `B+${diff.toFixed(1)}` : `W+${Math.abs(diff).toFixed(1)}`;
      detailsDiv.textContent = `B: ${bTerritory.toFixed(1)} terr + ${bPrisoners.toFixed(1)} pris | W: ${wTerritory.toFixed(1)} terr + ${wPrisoners.toFixed(1)} pris + ${komi.toFixed(1)} komi`;
    } else {
      const bTotal = bArea;
      const wTotal = wArea + komi;
      const diff = bTotal - wTotal;

      bValSpan.textContent = bTotal.toFixed(1);
      wValSpan.textContent = wTotal.toFixed(1);
      resValSpan.textContent = diff > 0 ? `B+${diff.toFixed(1)}` : `W+${Math.abs(diff).toFixed(1)}`;
      detailsDiv.textContent = `B: ${bArea.toFixed(1)} area | W: ${wArea.toFixed(1)} area + ${komi.toFixed(1)} komi`;
    }
  }
  private enterReplayForCurrentGame(): void {
    if (this.game.isReplayMode) return;
    const history = this.game.moveHistory;
    const colors = this.game.moveColors;
    if (history.length === 0) return;

    const gameMoves: GameMove[] = history.map((pos, i) => ({
      color: colors[i],
      x: pos.x,
      y: pos.y
    }));

    if (!this.gameInfo) {
      this.gameInfo = {
        blackPlayer: 'Black',
        whitePlayer: 'White',
        blackRank: '',
        whiteRank: '',
        date: new Date().toISOString().slice(0, 10),
        result: '',
        komi: 6.5,
        boardSize: this.game.size,
        event: 'Local Game',
        round: ''
      };
    }

    this.game.loadGame(gameMoves);
    this.showGameInfo();
    this.showReplayControls();
    this.game.lastMoveReplay();
    this.updateReplayUI();
    this.renderer.render();
    this.scheduleReplayPositionAnalysis();
  }
}

new App();
