import { GoGame, Position } from './game';
import { AnalysisResponse } from './analysis';
import * as THREE from 'three';

export type LastMoveMarkerType = 'none' | 'circle' | 'triangle' | 'number';

export class BoardRenderer {
  private canvas: HTMLCanvasElement;
  private game: GoGame;
  private cellSize: number = 32;
  private padding: number = 40;
  private hoverPos: Position | null = null;
  showOwnership: boolean = false;
  lastMoveMarkerType: LastMoveMarkerType = 'none';
  private analysis: AnalysisResponse | null = null;

  // Three.js Core Objects
  private scene!: THREE.Scene;
  private camera!: THREE.OrthographicCamera;
  private renderer!: THREE.WebGLRenderer;
  private boardMesh!: THREE.Mesh;
  private boardTex!: THREE.CanvasTexture;
  private boardCache!: HTMLCanvasElement;
  private cacheCtx!: CanvasRenderingContext2D;

  // Three.js Geometries & Materials
  private stoneGeom!: THREE.SphereGeometry;
  private blackMat!: THREE.MeshStandardMaterial;
  private whiteMat!: THREE.MeshStandardMaterial;
  private ghostMat!: THREE.MeshStandardMaterial;

  // Active Meshes Map
  private stoneMeshes: Map<string, THREE.Mesh> = new Map();
  private hoverMesh: THREE.Mesh | null = null;
  private markerMesh: THREE.Mesh | null = null;

  // Event Listeners references for cleanup
  private clickListener!: (e: MouseEvent) => void;
  private mousemoveListener!: (e: MouseEvent) => void;
  private mouseleaveListener!: () => void;
  private resizeListener!: () => void;

  private readonly starPoints19 = [
    [3, 3], [9, 3], [15, 3],
    [3, 9], [9, 9], [15, 9],
    [3, 15], [9, 15], [15, 15]
  ];
  private readonly starPoints13 = [
    [3, 3], [9, 3], [3, 9], [9, 9], [6, 6]
  ];
  private readonly starPoints9 = [
    [2, 2], [6, 2], [2, 6], [6, 6], [4, 4]
  ];

  constructor(canvas: HTMLCanvasElement, game: GoGame) {
    this.canvas = canvas;
    this.game = game;
    this.initThree();
    this.setupEventListeners();
  }

  private initThree(): void {
    const width = this.canvas.clientWidth || 600;
    const height = this.canvas.clientHeight || 600;

    this.scene = new THREE.Scene();

    // Orthographic Camera looking straight down
    this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
    this.camera.position.set(0, 15, 0);
    this.camera.lookAt(0, 0, 0);
    this.camera.up.set(0, 0, -1);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true
    });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setSize(width, height, false);

    // Create Cache Canvas for 2D board drawing
    const size = this.cellSize * (this.game.size - 1) + this.padding * 2;
    this.boardCache = document.createElement('canvas');
    this.boardCache.width = size;
    this.boardCache.height = size;
    this.cacheCtx = this.boardCache.getContext('2d')!;

    // Create Board CanvasTexture
    this.boardTex = new THREE.CanvasTexture(this.boardCache);
    this.boardTex.colorSpace = THREE.SRGBColorSpace;

    // Create Board 3D Mesh
    const boardWidth3D = size / this.cellSize;
    const boardGeom = new THREE.BoxGeometry(boardWidth3D, 0.4, boardWidth3D);

    const sideMat = new THREE.MeshStandardMaterial({
      color: 0xb8956b,
      roughness: 0.5
    });
    const topMat = new THREE.MeshStandardMaterial({
      map: this.boardTex,
      roughness: 0.3
    });

    const materials = [sideMat, sideMat, topMat, sideMat, sideMat, sideMat];

    this.boardMesh = new THREE.Mesh(boardGeom, materials);
    this.boardMesh.position.set(0, -0.2, 0); // top face is exactly at Y=0
    this.boardMesh.receiveShadow = true;
    this.scene.add(this.boardMesh);

    // Setup Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.85);
    dirLight.position.set(4, 12, 4);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 25;

    const d = 12;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    dirLight.shadow.bias = -0.0005;

    this.scene.add(dirLight);

    // Geometries & Materials for Stones
    this.stoneGeom = new THREE.SphereGeometry(0.46, 32, 16);
    this.stoneGeom.scale(1, 0.38, 1); // squash into biconvex lens shape

    this.blackMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a1a,
      roughness: 0.2,
      metalness: 0.1
    });

    this.whiteMat = new THREE.MeshStandardMaterial({
      color: 0xf0f0f0,
      roughness: 0.15,
      metalness: 0.1
    });

    this.ghostMat = new THREE.MeshStandardMaterial({
      color: 0x333333,
      transparent: true,
      opacity: 0.5,
      roughness: 0.3
    });

    this.resize();
  }

  private setupEventListeners(): void {
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    this.clickListener = (e: MouseEvent) => {
      const pos = this.getRaycastPosition(e, raycaster, mouse);
      if (pos) {
        if (this.game.isReplayMode) {
          this.game.exitReplayMode();
        }
        if (this.game.placeStone(pos.x, pos.y)) {
          this.render();
          this.onMove?.();
        }
      }
    };

    this.mousemoveListener = (e: MouseEvent) => {
      const pos = this.getRaycastPosition(e, raycaster, mouse);
      if (pos?.x !== this.hoverPos?.x || pos?.y !== this.hoverPos?.y) {
        this.hoverPos = pos;
        this.render();
      }
    };

    this.mouseleaveListener = () => {
      this.hoverPos = null;
      this.render();
    };

    this.resizeListener = () => {
      this.resize();
      this.render();
    };

    this.canvas.addEventListener('click', this.clickListener);
    this.canvas.addEventListener('mousemove', this.mousemoveListener);
    this.canvas.addEventListener('mouseleave', this.mouseleaveListener);
    window.addEventListener('resize', this.resizeListener);
  }

  private getRaycastPosition(e: MouseEvent, raycaster: THREE.Raycaster, mouse: THREE.Vector2): Position | null {
    const rect = this.canvas.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, this.camera);
    const intersects = raycaster.intersectObject(this.boardMesh);

    if (intersects.length > 0) {
      const pt = intersects[0].point;
      const size = this.game.size;
      const boardWidth2D = this.cellSize * (size - 1) + this.padding * 2;

      const rx = pt.x * this.cellSize;
      const ry = pt.z * this.cellSize;
      const tx = rx + boardWidth2D / 2;
      const ty = ry + boardWidth2D / 2;

      const x = Math.round((tx - this.padding) / this.cellSize);
      const y = Math.round((ty - this.padding) / this.cellSize);

      if (this.game.isValidPosition(x, y)) {
        return { x, y };
      }
    }
    return null;
  }

  private get3DPosition(x: number, y: number): THREE.Vector3 {
    const size = this.game.size;
    const boardWidth2D = this.cellSize * (size - 1) + this.padding * 2;
    const tx = this.padding + x * this.cellSize;
    const ty = this.padding + y * this.cellSize;

    const rx = tx - boardWidth2D / 2;
    const ry = ty - boardWidth2D / 2;

    return new THREE.Vector3(rx / this.cellSize, 0, ry / this.cellSize);
  }

  private resize(): void {
    const containerWidth = this.canvas.parentElement?.clientWidth || window.innerWidth;
    const containerHeight = this.canvas.parentElement?.clientHeight || window.innerHeight;

    // Subtract header height and paddings for layout alignment
    const availHeight = containerHeight - 80;
    const sizePx = Math.max(280, Math.floor(Math.min(containerWidth - 40, availHeight - 40)));

    this.renderer.setSize(sizePx, sizePx, true);

    const size = this.game.size;
    const boardWidth3D = (this.cellSize * (size - 1) + this.padding * 2) / this.cellSize;

    this.camera.left = -boardWidth3D / 2;
    this.camera.right = boardWidth3D / 2;
    this.camera.top = boardWidth3D / 2;
    this.camera.bottom = -boardWidth3D / 2;
    this.camera.updateProjectionMatrix();
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
    // 1. Redraw grid canvas texture
    this.updateGridCanvas();
    this.boardTex.needsUpdate = true;

    // 2. Sync 3D stone meshes
    const currentStoneKeys = new Set<string>();

    for (let y = 0; y < this.game.size; y++) {
      for (let x = 0; x < this.game.size; x++) {
        const stone = this.game.getStone(x, y);
        if (stone) {
          const key = `${x},${y}`;
          currentStoneKeys.add(key);

          const existingMesh = this.stoneMeshes.get(key);
          if (existingMesh) {
            const isColorMatch = (stone === 'black' && existingMesh.material === this.blackMat) ||
                                 (stone === 'white' && existingMesh.material === this.whiteMat);
            if (!isColorMatch) {
              this.scene.remove(existingMesh);
              this.stoneMeshes.delete(key);
              this.createStoneMesh(x, y, stone);
            }
          } else {
            this.createStoneMesh(x, y, stone);
          }
        }
      }
    }

    this.stoneMeshes.forEach((mesh, key) => {
      if (!currentStoneKeys.has(key)) {
        this.scene.remove(mesh);
        this.stoneMeshes.delete(key);
      }
    });

    // 3. Sync Hover Stone Mesh
    if (this.hoverPos && this.game.canPlaceStone(this.hoverPos.x, this.hoverPos.y)) {
      if (!this.hoverMesh) {
        this.hoverMesh = new THREE.Mesh(this.stoneGeom, this.ghostMat);
        this.scene.add(this.hoverMesh);
      }
      this.hoverMesh.position.copy(this.get3DPosition(this.hoverPos.x, this.hoverPos.y));
      this.ghostMat.color.setHex(this.game.currentPlayer === 'black' ? 0x222222 : 0xdddddd);
      this.hoverMesh.visible = true;
    } else if (this.hoverMesh) {
      this.hoverMesh.visible = false;
    }

    // 4. Sync Last Move Marker Mesh
    if (this.lastMoveMarkerType !== 'none' && this.game.lastMove) {
      this.updateLastMoveMarker(this.game.lastMove.x, this.game.lastMove.y);
    } else if (this.markerMesh) {
      this.scene.remove(this.markerMesh);
      this.markerMesh = null;
    }

    // 5. Render Scene
    this.renderer.render(this.scene, this.camera);
  }

  private createStoneMesh(x: number, y: number, color: 'black' | 'white'): void {
    const material = color === 'black' ? this.blackMat : this.whiteMat;
    const mesh = new THREE.Mesh(this.stoneGeom, material);
    mesh.position.copy(this.get3DPosition(x, y));
    mesh.position.y = 0.08;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.stoneMeshes.set(`${x},${y}`, mesh);
  }

  private updateLastMoveMarker(x: number, y: number): void {
    if (this.markerMesh) {
      this.scene.remove(this.markerMesh);
      this.markerMesh = null;
    }

    const stone = this.game.getStone(x, y);
    const color = stone === 'black' ? 0xffffff : 0x000000;
    const pos = this.get3DPosition(x, y);
    pos.y = 0.22; // Float slightly above the stone

    if (this.lastMoveMarkerType === 'circle') {
      const circleGeom = new THREE.RingGeometry(0.12, 0.16, 32);
      circleGeom.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
      this.markerMesh = new THREE.Mesh(circleGeom, mat);
      this.markerMesh.position.copy(pos);
      this.scene.add(this.markerMesh);
    } else if (this.lastMoveMarkerType === 'triangle') {
      const triGeom = new THREE.ShapeGeometry(new THREE.Shape([
        new THREE.Vector2(0, 0.13),
        new THREE.Vector2(-0.13, -0.1),
        new THREE.Vector2(0.13, -0.1)
      ]));
      triGeom.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
      this.markerMesh = new THREE.Mesh(triGeom, mat);
      this.markerMesh.position.copy(pos);
      this.scene.add(this.markerMesh);
    } else if (this.lastMoveMarkerType === 'number') {
      const moveNum = this.game.isReplayMode ? this.game.getCurrentMoveNumber() : this.game.moveHistory.length;
      if (moveNum > 0) {
        const numCanvas = document.createElement('canvas');
        numCanvas.width = 64;
        numCanvas.height = 64;
        const numCtx = numCanvas.getContext('2d')!;
        numCtx.fillStyle = stone === 'black' ? '#ffffff' : '#000000';
        numCtx.font = 'bold 38px sans-serif';
        numCtx.textAlign = 'center';
        numCtx.textBaseline = 'middle';
        numCtx.fillText(moveNum.toString(), 32, 32);

        const numTex = new THREE.CanvasTexture(numCanvas);
        const numGeom = new THREE.PlaneGeometry(0.5, 0.5);
        numGeom.rotateX(-Math.PI / 2);
        const mat = new THREE.MeshBasicMaterial({
          map: numTex,
          transparent: true,
          side: THREE.DoubleSide
        });
        this.markerMesh = new THREE.Mesh(numGeom, mat);
        this.markerMesh.position.copy(pos);
        this.scene.add(this.markerMesh);
      }
    }
  }

  private updateGridCanvas(): void {
    const size = this.boardCache.width;
    const ctx = this.cacheCtx;

    ctx.fillStyle = '#DCB468';
    ctx.fillRect(0, 0, size, size);

    this.drawWoodGrain(ctx, size);
    this.drawGridLines(ctx);
    this.drawStarPoints(ctx);
    this.drawCoordinates(ctx);

    if (this.showOwnership && this.analysis?.ownership) {
      this.drawOwnership2D(ctx);
    }

    if (this.analysis) {
      this.drawSuggestedMoves2D(ctx);
    }
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

  private drawOwnership2D(ctx: CanvasRenderingContext2D): void {
    if (!this.analysis?.ownership) return;

    const ownership = this.analysis.ownership;

    for (let y = 0; y < this.game.size; y++) {
      for (let x = 0; x < this.game.size; x++) {
        const idx = y * this.game.size + x;
        const value = ownership[idx];
        const certainty = Math.abs(value);

        if (certainty < 0.1) continue;

        const px = this.padding + x * this.cellSize;
        const py = this.padding + y * this.cellSize;
        const isBlackTerritory = value > 0;

        const minScale = 0.08;
        const maxScale = 0.24;
        const clampedCertainty = Math.max(0.1, Math.min(1.0, certainty));
        const scale = minScale + (maxScale - minScale) * (clampedCertainty - 0.1) / 0.9;
        const markerSize = this.cellSize * scale;

        const x1 = px - markerSize / 2;
        const y1 = py - markerSize / 2;

        ctx.save();
        if (isBlackTerritory) {
          ctx.fillStyle = '#111';
          ctx.fillRect(x1, y1, markerSize, markerSize);

          ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
          ctx.lineWidth = 1;
          ctx.strokeRect(x1, y1, markerSize, markerSize);
        } else {
          ctx.fillStyle = '#fff';
          ctx.fillRect(x1, y1, markerSize, markerSize);

          ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
          ctx.lineWidth = 1;
          ctx.strokeRect(x1, y1, markerSize, markerSize);
        }
        ctx.restore();
      }
    }
  }

  private drawSuggestedMoves2D(ctx: CanvasRenderingContext2D): void {
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
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = colors[index];
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#fff';
      ctx.font = `bold ${this.cellSize * 0.35}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${index + 1}`, px, py);
      ctx.restore();
    });
  }

  dispose(): void {
    this.canvas.removeEventListener('click', this.clickListener);
    this.canvas.removeEventListener('mousemove', this.mousemoveListener);
    this.canvas.removeEventListener('mouseleave', this.mouseleaveListener);
    window.removeEventListener('resize', this.resizeListener);

    this.boardMesh.geometry.dispose();
    if (Array.isArray(this.boardMesh.material)) {
      this.boardMesh.material.forEach(m => m.dispose());
    } else {
      this.boardMesh.material.dispose();
    }

    if (this.boardTex) this.boardTex.dispose();

    this.stoneGeom.dispose();
    this.blackMat.dispose();
    this.whiteMat.dispose();
    this.ghostMat.dispose();

    this.stoneMeshes.forEach(mesh => {
      this.scene.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
    });
    this.stoneMeshes.clear();

    if (this.markerMesh) {
      this.scene.remove(this.markerMesh);
      if (this.markerMesh.geometry) this.markerMesh.geometry.dispose();
      if (Array.isArray(this.markerMesh.material)) {
        this.markerMesh.material.forEach(m => m.dispose());
      } else if (this.markerMesh.material) {
        this.markerMesh.material.dispose();
      }
    }

    if (this.hoverMesh) {
      this.scene.remove(this.hoverMesh);
      if (this.hoverMesh.geometry) this.hoverMesh.geometry.dispose();
    }

    this.renderer.dispose();
  }
}
