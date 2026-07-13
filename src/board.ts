import { GoGame, Position } from './game';
import { AnalysisResponse } from './analysis';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

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
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private controls!: OrbitControls;
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

  // GLTF 3D Model Variables
  private isGltfLoaded = false;
  private boardTopY = 0;
  private boardCenterVec = new THREE.Vector3(0, 0, 0);
  private boardSizeVec = new THREE.Vector3(20, 0.4, 20);
  private gridPlaneMesh: THREE.Mesh | null = null;
  private readonly overlayScale = 1.06;
  private gltfScene: THREE.Group | null = null;

  // Lights
  private ambientLight!: THREE.AmbientLight;
  private keyLight!: THREE.DirectionalLight;
  private fillLight!: THREE.DirectionalLight;
  private pointLight!: THREE.PointLight;

  // Captured stones positioning
  private blackLidCenter: THREE.Vector3 | null = null;
  private whiteLidCenter: THREE.Vector3 | null = null;
  private blackLidTopY = 0;
  private whiteLidTopY = 0;
  private capturedStoneMeshes: THREE.Mesh[] = [];

  // Event Listeners references for cleanup
  private clickListener!: (e: MouseEvent) => void;
  private mousemoveListener!: (e: MouseEvent) => void;
  private mouseleaveListener!: () => void;
  private resizeListener!: () => void;

  private animationFrameId: number | null = null;

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
    this.loadGltfModel();
  }

  private initThree(): void {
    const width = this.canvas.clientWidth || 600;
    const height = this.canvas.clientHeight || 600;

    this.scene = new THREE.Scene();

    // Perspective Camera for beautiful 3D view and OrbitControls
    this.camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 100);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true
    });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setSize(width, height, false);

    // Setup OrbitControls
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 80;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05; // Prevent camera from going below ground

    // Create Cache Canvas for 2D board drawing
    const size = this.cellSize * (this.game.size - 1) + this.padding * 2;
    this.boardCache = document.createElement('canvas');
    this.boardCache.width = size;
    this.boardCache.height = size;
    this.cacheCtx = this.boardCache.getContext('2d')!;

    // Create Board CanvasTexture
    this.boardTex = new THREE.CanvasTexture(this.boardCache);
    this.boardTex.colorSpace = THREE.SRGBColorSpace;

    // Create Procedural Board 3D Mesh (Visible until GLTF board loads)
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
    this.boardMesh.visible = false; // Hidden by default to prevent visual flickering before GLTF loads
    this.scene.add(this.boardMesh);

    // Setup Lights (Rich multi-directional setup for high fidelity 3D highlights)
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(this.ambientLight);

    // Warm key light
    this.keyLight = new THREE.DirectionalLight(0xfff7e6, 1.25);
    this.keyLight.position.set(8, 15, 6);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.width = 1024;
    this.keyLight.shadow.mapSize.height = 1024;
    this.keyLight.shadow.camera.near = 0.5;
    this.keyLight.shadow.camera.far = 30;
    const d = 12;
    this.keyLight.shadow.camera.left = -d;
    this.keyLight.shadow.camera.right = d;
    this.keyLight.shadow.camera.top = d;
    this.keyLight.shadow.camera.bottom = -d;
    this.keyLight.shadow.bias = -0.0005;
    this.scene.add(this.keyLight);

    // Cool fill light
    this.fillLight = new THREE.DirectionalLight(0xe6f7ff, 0.45);
    this.fillLight.position.set(-8, 8, -6);
    this.scene.add(this.fillLight);

    // Soft point light near board accents
    this.pointLight = new THREE.PointLight(0xffffff, 0.8, 15);
    this.pointLight.position.set(4, 5, -4);
    this.scene.add(this.pointLight);

    // Geometries & Materials for Stones
    this.stoneGeom = new THREE.SphereGeometry(0.46, 32, 16);
    this.stoneGeom.scale(1, 0.38, 1); // squash into biconvex lens shape

    this.blackMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a1a,
      roughness: 0.2,
      metalness: 0.1
    });

    this.whiteMat = new THREE.MeshStandardMaterial({
      color: 0xf5f5f5,
      roughness: 0.15,
      metalness: 0.1
    });

    this.ghostMat = new THREE.MeshStandardMaterial({
      color: 0x333333,
      transparent: true,
      opacity: 0.5,
      roughness: 0.3
    });

    // Start continuous rendering loop for smoother OrbitControls interaction
    this.animate();
    this.resize();
    this.resetCamera();
  }

  private loadGltfModel(): void {
    const loader = new GLTFLoader();
    loader.load('go_board/scene.gltf', (gltf) => {
      // Find board mesh to determine board boundaries for stone visibility filtering
      const boardMesh = gltf.scene.getObjectByName('Board_Wood_0') as THREE.Mesh;
      let minX = -10, maxX = 10, minZ = -10, maxZ = 10;
      if (boardMesh) {
        const boardBox = new THREE.Box3().setFromObject(boardMesh);
        minX = boardBox.min.x;
        maxX = boardBox.max.x;
        minZ = boardBox.min.z;
        maxZ = boardBox.max.z;
      }

      // Update matrices before querying positions
      gltf.scene.updateMatrixWorld(true);

      // 1. Traverse scene: set shadow flags & hide pre-baked game stones on the board, leaving bowl stones visible
      gltf.scene.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.castShadow = true;
          node.receiveShadow = true;

          // Resolve Z-fighting on the model's baked grid plane mesh
          if (node.name === 'Plane.001_Material_0') {
            node.position.y += 0.001;
            if (node.material) {
              const mats = Array.isArray(node.material) ? node.material : [node.material];
              mats.forEach(mat => {
                mat.polygonOffset = true;
                mat.polygonOffsetFactor = -1;
                mat.polygonOffsetUnits = -1;
              });
            }
          }
        }

        // Only hide pre-baked stones if they are physically on the board grid area
        const nameLower = node.name.toLowerCase();
        if (nameLower.includes('stone')) {
          const worldPos = new THREE.Vector3();
          node.getWorldPosition(worldPos);

          if (worldPos.x >= minX && worldPos.x <= maxX && worldPos.z >= minZ && worldPos.z <= maxZ) {
            node.visible = false;
          } else {
            node.visible = true;
          }
        }
      });

      // 2. Locate board mesh and align dimensions with scaling
      if (boardMesh) {
        // Calculate raw size of board in GLTF
        const box = new THREE.Box3().setFromObject(boardMesh);
        const rawSize = new THREE.Vector3();
        box.getSize(rawSize);

        // Compute scaling factor to match procedural board size
        const size2D = this.cellSize * (this.game.size - 1) + this.padding * 2;
        const targetWidth = size2D / this.cellSize;
        const scaleFactor = targetWidth / rawSize.x;

        // Apply scale to GLTF scene
        gltf.scene.scale.set(scaleFactor, scaleFactor, scaleFactor);

        // Force world matrix update so Box3 calculations are correct
        gltf.scene.updateMatrixWorld(true);

        // Re-calculate bounding box and top Y coordinate of scaled board
        const scaledBox = new THREE.Box3().setFromObject(boardMesh);
        scaledBox.getSize(this.boardSizeVec);
        scaledBox.getCenter(this.boardCenterVec);
        this.boardTopY = this.boardCenterVec.y + this.boardSizeVec.y / 2;

        // Create transparent grid overlay plane
        const planeGeom = new THREE.PlaneGeometry(this.boardSizeVec.x * this.overlayScale, this.boardSizeVec.z * this.overlayScale);
        planeGeom.rotateX(-Math.PI / 2);
        
        const planeMat = new THREE.MeshStandardMaterial({
          map: this.boardTex,
          transparent: true,
          opacity: 1.0,
          roughness: 0.4,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2
        });
        
        this.gridPlaneMesh = new THREE.Mesh(planeGeom, planeMat);
        this.gridPlaneMesh.position.set(this.boardCenterVec.x, this.boardTopY + 0.008, this.boardCenterVec.z);
        this.gridPlaneMesh.receiveShadow = true;
        this.scene.add(this.gridPlaneMesh);
      }

      // Hide temporary procedural board
      this.boardMesh.visible = false;

      // Detect wooden bowls and lids/covers from GLTF scene
      const spheres: { mesh: THREE.Mesh, box: THREE.Box3, size: THREE.Vector3, center: THREE.Vector3 }[] = [];
      gltf.scene.traverse((node) => {
        if (node instanceof THREE.Mesh && node.name.startsWith('Sphere')) {
          const box = new THREE.Box3().setFromObject(node);
          const size = new THREE.Vector3();
          box.getSize(size);
          const center = new THREE.Vector3();
          box.getCenter(center);
          spheres.push({ mesh: node, box, size, center });
        }
      });

      // Sort by size.y (height) ascending. The first two are the flatter lids/covers!
      spheres.sort((a, b) => a.size.y - b.size.y);

      if (spheres.length >= 4) {
        const lid1 = spheres[0];
        const lid2 = spheres[1];

        // The one with larger X is the Black Lid (on the right)
        // The one with smaller X is the White Lid (on the left)
        if (lid1.center.x > lid2.center.x) {
          this.blackLidCenter = lid1.center;
          this.whiteLidCenter = lid2.center;
        } else {
          this.blackLidCenter = lid2.center;
          this.whiteLidCenter = lid1.center;
        }
        
        // Also get the height level on top of the lid
        this.blackLidTopY = lid1.center.y + lid1.size.y / 2;
        this.whiteLidTopY = lid2.center.y + lid2.size.y / 2;
      }

      // Add GLTF scene
      this.gltfScene = gltf.scene;
      this.scene.add(gltf.scene);
      this.isGltfLoaded = true;

      // Center controls target on board
      if (this.controls) {
        this.resetCamera();
      }

      this.resize();
      this.render();
    }, undefined, (error) => {
      console.warn('Failed to load GLTF board, falling back to procedural board:', error);
      this.boardMesh.visible = true;
      this.render();
    });
  }

  private animate(): void {
    this.animationFrameId = requestAnimationFrame(() => this.animate());

    if (this.controls) {
      this.controls.update();
    }

    this.renderer.render(this.scene, this.camera);
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
    const targetMesh = this.isGltfLoaded && this.gridPlaneMesh ? this.gridPlaneMesh : this.boardMesh;
    const intersects = raycaster.intersectObject(targetMesh);

    if (intersects.length > 0) {
      const pt = intersects[0].point;
      const size = this.game.size;

      if (this.isGltfLoaded) {
        const boardWidth2D = this.cellSize * (size - 1) + this.padding * 2;
        const gridWidth2D = this.cellSize * (size - 1);
        const ratio = gridWidth2D / boardWidth2D;

        const gridWidth3D = this.boardSizeVec.x * this.overlayScale * ratio;
        const gridDepth3D = this.boardSizeVec.z * this.overlayScale * ratio;

        const localX = pt.x - this.boardCenterVec.x;
        const localZ = pt.z - this.boardCenterVec.z;

        const x = Math.round(((localX / gridWidth3D) + 0.5) * (size - 1));
        const y = Math.round(((localZ / gridDepth3D) + 0.5) * (size - 1));

        if (this.game.isValidPosition(x, y)) {
          return { x, y };
        }
      } else {
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
    }
    return null;
  }

  private getGridSpacing3D(): number {
    const size = this.game.size;
    if (this.isGltfLoaded) {
      const boardWidth2D = this.cellSize * (size - 1) + this.padding * 2;
      const gridWidth2D = this.cellSize * (size - 1);
      const ratio = gridWidth2D / boardWidth2D;
      return (this.boardSizeVec.x * this.overlayScale * ratio) / (size - 1);
    }
    return 1.0;
  }

  private get3DPosition(x: number, y: number): THREE.Vector3 {
    const size = this.game.size;

    if (this.isGltfLoaded) {
      const boardWidth2D = this.cellSize * (size - 1) + this.padding * 2;
      const gridWidth2D = this.cellSize * (size - 1);
      const ratio = gridWidth2D / boardWidth2D;

      const gridWidth3D = this.boardSizeVec.x * this.overlayScale * ratio;
      const gridDepth3D = this.boardSizeVec.z * this.overlayScale * ratio;

      const pctX = x / (size - 1) - 0.5;
      const pctY = y / (size - 1) - 0.5;

      return new THREE.Vector3(
        this.boardCenterVec.x + pctX * gridWidth3D,
        this.boardTopY,
        this.boardCenterVec.z + pctY * gridDepth3D
      );
    } else {
      const boardWidth2D = this.cellSize * (size - 1) + this.padding * 2;
      const tx = this.padding + x * this.cellSize;
      const ty = this.padding + y * this.cellSize;

      const rx = tx - boardWidth2D / 2;
      const ry = ty - boardWidth2D / 2;

      return new THREE.Vector3(rx / this.cellSize, 0, ry / this.cellSize);
    }
  }

  private resize(): void {
    const width = this.canvas.parentElement?.clientWidth || window.innerWidth;
    const height = this.canvas.parentElement?.clientHeight || window.innerHeight;

    this.renderer.setSize(width, height, true);

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private getFitCameraDistance(): number {
    const size = this.game.size;
    const boardWidth2D = this.cellSize * (size - 1) + this.padding * 2;
    const targetWidth = boardWidth2D / this.cellSize;
    
    // We want the board to fit inside the camera view with a 60% margin
    const visibleDim = targetWidth * 1.6;
    
    const aspect = this.camera.aspect;
    const vFovRad = (this.camera.fov / 2) * (Math.PI / 180);
    
    if (aspect >= 1) {
      // Landscape or square: fit vertically
      return visibleDim / (2 * Math.tan(vFovRad));
    } else {
      // Portrait: fit horizontally
      const hFovRad = Math.atan(Math.tan(vFovRad) * aspect);
      return visibleDim / (2 * Math.tan(hFovRad));
    }
  }

  private resetCamera(): void {
    const dist = this.getFitCameraDistance();
    
    // Set camera straight top-down looking at the board center
    this.camera.position.set(this.boardCenterVec.x, this.boardCenterVec.y + dist, this.boardCenterVec.z + 0.01);
    
    if (this.controls) {
      this.controls.target.copy(this.boardCenterVec);
      this.controls.update();
    }
  }
  updateGame(game: GoGame): void {
    this.game = game;
    
    // Re-create the cache canvas for the new board size
    const size = this.cellSize * (this.game.size - 1) + this.padding * 2;
    this.boardCache.width = size;
    this.boardCache.height = size;
    this.cacheCtx = this.boardCache.getContext('2d')!;

    // Re-create/update the board texture
    if (this.boardTex) {
      this.boardTex.dispose();
    }
    this.boardTex = new THREE.CanvasTexture(this.boardCache);
    this.boardTex.colorSpace = THREE.SRGBColorSpace;

    // Update materials mapping
    if (this.boardMesh) {
      const topMat = (this.boardMesh.material as THREE.Material[])[2] as THREE.MeshStandardMaterial;
      if (topMat) {
        topMat.map = this.boardTex;
        topMat.needsUpdate = true;
      }
    }

    if (this.gridPlaneMesh) {
      const planeMat = this.gridPlaneMesh.material as THREE.MeshStandardMaterial;
      if (planeMat) {
        planeMat.map = this.boardTex;
        planeMat.needsUpdate = true;
      }
    }

    // Clear all existing stone meshes
    this.stoneMeshes.forEach(mesh => {
      this.scene.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
    });
    this.stoneMeshes.clear();

    if (this.markerMesh) {
      this.scene.remove(this.markerMesh);
      this.markerMesh = null;
    }

    if (this.hoverMesh) {
      this.scene.remove(this.hoverMesh);
      this.hoverMesh = null;
    }

    this.resize();
    this.resetCamera();
  }
  setAmbientLightIntensity(val: number): void {
    if (this.ambientLight) this.ambientLight.intensity = val;
  }

  setKeyLightIntensity(val: number): void {
    if (this.keyLight) this.keyLight.intensity = val;
  }

  setKeyLightColor(colorHex: string): void {
    if (this.keyLight) this.keyLight.color.set(colorHex);
  }

  setFillLightIntensity(val: number): void {
    if (this.fillLight) this.fillLight.intensity = val;
  }

  setPointLightIntensity(val: number): void {
    if (this.pointLight) this.pointLight.intensity = val;
  }

  setShadowsEnabled(enabled: boolean): void {
    this.renderer.shadowMap.enabled = enabled;
    
    // We must update the materials to re-compile shaders for shadow maps
    this.scene.traverse((node) => {
      if (node instanceof THREE.Mesh && node.material) {
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        mats.forEach(mat => {
          mat.needsUpdate = true;
        });
      }
    });

    if (this.keyLight) {
      this.keyLight.castShadow = enabled;
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
    // 1. Redraw grid canvas texture
    this.updateGridCanvas();
    this.boardTex.needsUpdate = true;

    // 2. Get scale bounds
    const scale = this.getGridSpacing3D();

    // 3. Sync 3D stone meshes
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
            } else {
              // Recalculate 3D position in case GLTF loaded late
              existingMesh.position.copy(this.get3DPosition(x, y));
              existingMesh.position.y += 0.08 * scale;
              existingMesh.scale.set(scale, scale, scale);
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

    // 4. Sync Hover Stone Mesh
    if (this.hoverPos && this.game.canPlaceStone(this.hoverPos.x, this.hoverPos.y)) {
      if (!this.hoverMesh) {
        this.hoverMesh = new THREE.Mesh(this.stoneGeom, this.ghostMat);
        this.scene.add(this.hoverMesh);
      }
      this.hoverMesh.position.copy(this.get3DPosition(this.hoverPos.x, this.hoverPos.y));
      this.hoverMesh.position.y += 0.08 * scale;
      this.hoverMesh.scale.set(scale, scale, scale);
      this.ghostMat.color.setHex(this.game.currentPlayer === 'black' ? 0x222222 : 0xdddddd);
      this.hoverMesh.visible = true;
    } else if (this.hoverMesh) {
      this.hoverMesh.visible = false;
    }

    // 5. Sync Last Move Marker Mesh
    if (this.lastMoveMarkerType !== 'none' && this.game.lastMove) {
      this.updateLastMoveMarker(this.game.lastMove.x, this.game.lastMove.y, scale);
    } else if (this.markerMesh) {
      this.scene.remove(this.markerMesh);
      this.markerMesh = null;
    }

    // 6. Sync Captured Stones on the Bowl Lids
    this.updateCapturedStones3D();
  }

  private createStoneMesh(x: number, y: number, color: 'black' | 'white'): void {
    const material = color === 'black' ? this.blackMat : this.whiteMat;
    const mesh = new THREE.Mesh(this.stoneGeom, material);
    mesh.position.copy(this.get3DPosition(x, y));
    
    const scale = this.getGridSpacing3D();
    mesh.position.y += 0.08 * scale;
    mesh.scale.set(scale, scale, scale);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.stoneMeshes.set(`${x},${y}`, mesh);
  }

  private updateLastMoveMarker(x: number, y: number, scale: number): void {
    if (this.markerMesh) {
      this.scene.remove(this.markerMesh);
      this.markerMesh = null;
    }

    const stone = this.game.getStone(x, y);
    const color = stone === 'black' ? 0xffffff : 0x000000;
    const pos = this.get3DPosition(x, y);
    pos.y += 0.22 * scale; // Float slightly above the stone

    if (this.lastMoveMarkerType === 'circle') {
      const circleGeom = new THREE.RingGeometry(0.12 * scale, 0.16 * scale, 32);
      circleGeom.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
      this.markerMesh = new THREE.Mesh(circleGeom, mat);
      this.markerMesh.position.copy(pos);
      this.scene.add(this.markerMesh);
    } else if (this.lastMoveMarkerType === 'triangle') {
      const triGeom = new THREE.ShapeGeometry(new THREE.Shape([
        new THREE.Vector2(0, 0.13 * scale),
        new THREE.Vector2(-0.13 * scale, -0.1 * scale),
        new THREE.Vector2(0.13 * scale, -0.1 * scale)
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
        const numGeom = new THREE.PlaneGeometry(0.5 * scale, 0.5 * scale);
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

    ctx.clearRect(0, 0, size, size);

    if (!this.isGltfLoaded) {
      ctx.fillStyle = '#DCB468';
      ctx.fillRect(0, 0, size, size);
      this.drawWoodGrain(ctx, size);
      this.drawGridLines(ctx);
      this.drawStarPoints(ctx);
      this.drawCoordinates(ctx);
    }

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

  private updateCapturedStones3D(): void {
    // Clear old captured stone meshes
    this.capturedStoneMeshes.forEach(mesh => {
      this.scene.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
    });
    this.capturedStoneMeshes = [];

    if (!this.isGltfLoaded || !this.blackLidCenter || !this.whiteLidCenter) return;

    // Black captured white stones (placed on Black Lid)
    const whiteCapturedCount = this.game.captures.black;
    for (let i = 0; i < whiteCapturedCount; i++) {
      const mesh = new THREE.Mesh(this.stoneGeom, this.whiteMat);
      mesh.position.copy(this.getCapturedStonePosition(i, this.blackLidCenter, this.blackLidTopY));
      const scale = 0.85; // Captured stones are slightly smaller
      mesh.scale.set(scale, scale, scale);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.capturedStoneMeshes.push(mesh);
    }

    // White captured black stones (placed on White Lid)
    const blackCapturedCount = this.game.captures.white;
    for (let i = 0; i < blackCapturedCount; i++) {
      const mesh = new THREE.Mesh(this.stoneGeom, this.blackMat);
      mesh.position.copy(this.getCapturedStonePosition(i, this.whiteLidCenter, this.whiteLidTopY));
      const scale = 0.85; // Captured stones are slightly smaller
      mesh.scale.set(scale, scale, scale);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.capturedStoneMeshes.push(mesh);
    }
  }

  private getCapturedStonePosition(index: number, lidCenter: THREE.Vector3, lidTopY: number): THREE.Vector3 {
    // Arrange in a neat, slightly jittered spiral grid layout
    const radiusStep = 0.15;
    const angleStep = 0.65; // spiral step in radians

    if (index === 0) {
      return new THREE.Vector3(lidCenter.x, lidTopY + 0.02, lidCenter.z);
    }

    // Concentric spiral rings
    const r = Math.sqrt(index) * radiusStep;
    const theta = index * angleStep;

    // Slight hand-placed jitter (deterministic seed to avoid vibration during rotations)
    const seed = index * 12345.67;
    const jitterX = (Math.sin(seed) * 0.5) * 0.04;
    const jitterZ = (Math.cos(seed) * 0.5) * 0.04;
    
    // Stack layers of stones if there are many captured stones
    const layer = Math.floor(index / 12);
    const stackY = layer * 0.08;

    return new THREE.Vector3(
      lidCenter.x + r * Math.cos(theta) + jitterX,
      lidTopY + 0.02 + stackY,
      lidCenter.z + r * Math.sin(theta) + jitterZ
    );
  }

  dispose(): void {
    this.canvas.removeEventListener('click', this.clickListener);
    this.canvas.removeEventListener('mousemove', this.mousemoveListener);
    this.canvas.removeEventListener('mouseleave', this.mouseleaveListener);
    window.removeEventListener('resize', this.resizeListener);

    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }

    if (this.controls) {
      this.controls.dispose();
    }

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

    if (this.gridPlaneMesh) {
      this.scene.remove(this.gridPlaneMesh);
      if (this.gridPlaneMesh.geometry) this.gridPlaneMesh.geometry.dispose();
      if (Array.isArray(this.gridPlaneMesh.material)) {
        this.gridPlaneMesh.material.forEach(m => m.dispose());
      } else if (this.gridPlaneMesh.material) {
        this.gridPlaneMesh.material.dispose();
      }
    }

    if (this.gltfScene) {
      this.scene.remove(this.gltfScene);
      this.gltfScene.traverse(node => {
        if (node instanceof THREE.Mesh) {
          if (node.geometry) node.geometry.dispose();
          if (Array.isArray(node.material)) {
            node.material.forEach(m => m.dispose());
          } else if (node.material) {
            node.material.dispose();
          }
        }
      });
      this.gltfScene = null;
    }

    this.capturedStoneMeshes.forEach(mesh => {
      this.scene.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
    });
    this.capturedStoneMeshes = [];

    this.renderer.dispose();
  }
}
