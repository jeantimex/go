import { GoGame, Position } from './game';
import { AnalysisResponse } from './analysis';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as CANNON from 'cannon-es';

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
  private gridHelper: THREE.GridHelper | null = null;
  private floorMesh: THREE.Mesh | null = null;

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
  private lidScatterRadius = 1.0;
  private readonly capturedStoneScale = 0.95;
  private readonly capturedStoneRadius = 0.46 * this.capturedStoneScale;

  // Cannon.js Physics
  private world!: CANNON.World;
  private stonePhysicsMaterial!: CANNON.Material;
  private lidPhysicsMaterial!: CANNON.Material;
  private blackLidBody: CANNON.Body | null = null;
  private whiteLidBody: CANNON.Body | null = null;
  private lidColliderHelpers: THREE.LineSegments[] = [];
  private lidColliderDebugPositions: number[][] = [];
  private showLidCollisionMesh = false;
  private showStoneCollisionMesh = false;
  private capturedStoneCollisionShape: CANNON.ConvexPolyhedron | null = null;
  private capturedStones: {
    mesh: THREE.Mesh;
    body: CANNON.Body;
    lidType: 'black' | 'white';
  }[] = [];

  // Event Listeners references for cleanup
  private clickListener!: (e: MouseEvent) => void;
  private mousemoveListener!: (e: MouseEvent) => void;
  private mouseleaveListener!: () => void;
  private resizeListener!: () => void;

  private animationFrameId: number | null = null;
  private lastPhysicsStepTime = performance.now();
  private readonly physicsTimeScale = 1.2;

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

    // Initialize Cannon.js physics world
    this.world = new CANNON.World();
    // The scene is not modeled in meters, so slightly stronger gravity gives
    // the small stones a convincingly quick drop at this visual scale.
    this.world.gravity.set(0, -14, 0);
    this.world.allowSleep = true;
    (this.world.solver as any).iterations = 10;
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);

    this.stonePhysicsMaterial = new CANNON.Material('polished-go-stone');
    this.lidPhysicsMaterial = new CANNON.Material('wooden-lid');

    // Slate/shell stones are hard and polished: they click on impact, bounce
    // very little, and slide briefly before friction brings them to rest.
    this.world.addContactMaterial(new CANNON.ContactMaterial(
      this.stonePhysicsMaterial,
      this.lidPhysicsMaterial,
      {
        friction: 0.16,
        restitution: 0.18,
        contactEquationStiffness: 2e7,
        contactEquationRelaxation: 4,
        frictionEquationStiffness: 5e6,
        frictionEquationRelaxation: 4,
      }
    ));
    this.world.addContactMaterial(new CANNON.ContactMaterial(
      this.stonePhysicsMaterial,
      this.stonePhysicsMaterial,
      {
        friction: 0.12,
        restitution: 0.12,
        contactEquationStiffness: 2e7,
        contactEquationRelaxation: 4,
        frictionEquationStiffness: 5e6,
        frictionEquationRelaxation: 4,
      }
    ));

    this.scene = new THREE.Scene();
    
    // Set up foggy grid helper background matching threejs.org/examples/#webgl_animation_skinning_morph
    this.scene.background = new THREE.Color(0xe0e0e0);
    this.scene.fog = new THREE.Fog(0xe0e0e0, 45, 120); // Pushed fog start out to 45 so the board stays perfectly crisp

    // Grid floor helper
    this.gridHelper = new THREE.GridHelper(200, 40, 0x000000, 0x000000);
    this.gridHelper.material.opacity = 0.2;
    this.gridHelper.material.transparent = true;
    this.scene.add(this.gridHelper);

    // Create a shadow-receiving floor plane (shadow catcher)
    const floorMat = new THREE.ShadowMaterial({ opacity: 0.15 });
    const floorGeom = new THREE.PlaneGeometry(200, 200);
    floorGeom.rotateX(-Math.PI / 2);
    this.floorMesh = new THREE.Mesh(floorGeom, floorMat);
    this.floorMesh.receiveShadow = true;
    this.scene.add(this.floorMesh);

    // Perspective Camera for beautiful 3D view and OrbitControls
    this.camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 100);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false // Solid background clear color
    });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap; // Default shadow mapping type (VSM is selectable in Scene settings)
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
    this.ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
    this.scene.add(this.ambientLight);

    // Warm key light
    this.keyLight = new THREE.DirectionalLight(0xfff7e6, 2.0);
    this.keyLight.position.set(8, 15, 6);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.width = 1024; // Default to 1024 matching UI reset
    this.keyLight.shadow.mapSize.height = 1024;
    this.keyLight.shadow.camera.near = 0.5;
    this.keyLight.shadow.camera.far = 40; // Extended depth boundary
    const d = 24; // Widened frustum to fully cover board, bowls, lids and captured stones
    this.keyLight.shadow.camera.left = -d;
    this.keyLight.shadow.camera.right = d;
    this.keyLight.shadow.camera.top = d;
    this.keyLight.shadow.camera.bottom = -d;
    // Set fine-tuned bias and normalBias to completely resolve diagonal shadow acne (self-shadowing) on flat surfaces
    this.keyLight.shadow.bias = -0.0001;
    this.keyLight.shadow.normalBias = 0.02;
    this.keyLight.shadow.radius = 3; // Default blur radius for PCF soft shadows
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

  /**
   * Build a low-poly biconvex lens matching the rendered Go stone. Unlike a
   * box or cylinder, the rounded edge has no stable face for a stone to stand
   * on, so edge landings naturally tip over.
   */
  private createStoneCollisionShape(scale: number): CANNON.ConvexPolyhedron {
    // Eight radial segments keep the rounded lens behavior while reducing
    // convex SAT work by roughly 75% compared with the previous 16 segments.
    const segments = 8;
    const radius = 0.46 * scale;
    const halfHeight = 0.46 * 0.38 * scale;
    const shoulderRadius = radius * 0.82;
    const shoulderY = halfHeight * 0.48;
    const vertices: CANNON.Vec3[] = [new CANNON.Vec3(0, halfHeight, 0)];

    const addRing = (ringRadius: number, y: number): void => {
      for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        vertices.push(new CANNON.Vec3(
          Math.cos(angle) * ringRadius,
          y,
          Math.sin(angle) * ringRadius
        ));
      }
    };

    addRing(shoulderRadius, shoulderY);
    addRing(radius, 0);
    addRing(shoulderRadius, -shoulderY);
    const bottomIndex = vertices.length;
    vertices.push(new CANNON.Vec3(0, -halfHeight, 0));

    const faces: number[][] = [];
    const ringStart = [1, 1 + segments, 1 + segments * 2];
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      faces.push([0, ringStart[0] + next, ringStart[0] + i]);

      for (let ring = 0; ring < ringStart.length - 1; ring++) {
        faces.push([
          ringStart[ring] + i,
          ringStart[ring] + next,
          ringStart[ring + 1] + next,
          ringStart[ring + 1] + i,
        ]);
      }

      faces.push([
        ringStart[2] + i,
        ringStart[2] + next,
        bottomIndex,
      ]);
    }

    return new CANNON.ConvexPolyhedron({ vertices, faces });
  }

  /** Sample the visible GLTF lid and use the same samples for physics and its
   * green debug wireframe. Heightfield's local Z axis is rotated onto world Y.
   */
  private createLidCollider(
    lid: { mesh: THREE.Mesh; box: THREE.Box3; center: THREE.Vector3 },
    radius: number
  ): CANNON.Body {
    // A 9x9 surface retains the lid's broad curvature with one quarter of the
    // heightfield cells used by the previous 17x17 collider.
    const sampleCount = 9;
    const diameter = radius * 2;
    const elementSize = diameter / (sampleCount - 1);
    const baseY = lid.box.min.y;
    const raycaster = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const data: number[][] = [];
    const worldHeights: number[][] = [];

    for (let xIndex = 0; xIndex < sampleCount; xIndex++) {
      const heightColumn: number[] = [];
      const worldColumn: number[] = [];
      const x = lid.center.x - radius + xIndex * elementSize;

      for (let zIndex = 0; zIndex < sampleCount; zIndex++) {
        // The -X rotation below maps increasing local Y toward decreasing Z.
        const z = lid.center.z + radius - zIndex * elementSize;
        raycaster.set(new THREE.Vector3(x, lid.box.max.y + 1, z), down);
        const hit = raycaster.intersectObject(lid.mesh, false)[0];
        const surfaceY = hit?.point.y ?? baseY;
        heightColumn.push(Math.max(0, surfaceY - baseY));
        worldColumn.push(surfaceY);
      }

      data.push(heightColumn);
      worldHeights.push(worldColumn);
    }

    const shape = new CANNON.Heightfield(data, { elementSize });
    const body = new CANNON.Body({
      mass: 0,
      material: this.lidPhysicsMaterial,
    });
    body.addShape(shape);
    body.position.set(lid.center.x - radius, baseY, lid.center.z + radius);
    body.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(body);

    const positions: number[] = [];
    const addSegment = (ax: number, az: number, bx: number, bz: number): void => {
      const aDistance = Math.hypot(
        lid.center.x - radius + ax * elementSize - lid.center.x,
        lid.center.z + radius - az * elementSize - lid.center.z
      );
      const bDistance = Math.hypot(
        lid.center.x - radius + bx * elementSize - lid.center.x,
        lid.center.z + radius - bz * elementSize - lid.center.z
      );
      if (aDistance > radius || bDistance > radius) return;

      positions.push(
        lid.center.x - radius + ax * elementSize,
        worldHeights[ax][az] + 0.008,
        lid.center.z + radius - az * elementSize,
        lid.center.x - radius + bx * elementSize,
        worldHeights[bx][bz] + 0.008,
        lid.center.z + radius - bz * elementSize
      );
    };

    for (let x = 0; x < sampleCount; x++) {
      for (let z = 0; z < sampleCount; z++) {
        if (x + 1 < sampleCount) addSegment(x, z, x + 1, z);
        if (z + 1 < sampleCount) addSegment(x, z, x, z + 1);
        if (x + 1 < sampleCount && z + 1 < sampleCount) {
          addSegment(x, z, x + 1, z + 1);
        }
      }
    }

    this.lidColliderDebugPositions.push(positions);
    if (this.showLidCollisionMesh) {
      this.createLidCollisionHelper(positions);
    }

    return body;
  }

  private createLidCollisionHelper(positions: number[]): void {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
    });
    const helper = new THREE.LineSegments(geometry, material);
    helper.name = 'lid-collision-mesh';
    helper.renderOrder = 10;
    this.scene.add(helper);
    this.lidColliderHelpers.push(helper);
  }

  private clearLidCollisionHelpers(): void {
    this.lidColliderHelpers.forEach(helper => {
      this.scene.remove(helper);
      helper.geometry.dispose();
      (helper.material as THREE.Material).dispose();
    });
    this.lidColliderHelpers = [];
  }

  private createStoneCollisionHelper(mesh: THREE.Mesh): void {
    if (mesh.getObjectByName('stone-collision-mesh')) return;
    const geometry = new THREE.WireframeGeometry(this.stoneGeom);
    const material = new THREE.LineBasicMaterial({ color: 0x00ffff });
    const helper = new THREE.LineSegments(geometry, material);
    helper.name = 'stone-collision-mesh';
    mesh.add(helper);
  }

  private clearStoneCollisionHelper(mesh: THREE.Mesh): void {
    const helper = mesh.getObjectByName('stone-collision-mesh') as THREE.LineSegments | undefined;
    if (!helper) return;
    mesh.remove(helper);
    helper.geometry.dispose();
    (helper.material as THREE.Material).dispose();
  }

  private loadGltfModel(): void {
    const loader = new GLTFLoader();
    loader.load('go_board/scene.gltf', (gltf) => {
      // Find board mesh to determine board boundaries for stone visibility filtering
      const boardMesh = gltf.scene.getObjectByName('Board_Wood_0') as THREE.Mesh;
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

        // Force world matrix update so Box3 and world position calculations are correct
        gltf.scene.updateMatrixWorld(true);

        // Re-calculate bounding box and top Y coordinate of scaled board
        const scaledBox = new THREE.Box3().setFromObject(boardMesh);
        scaledBox.getSize(this.boardSizeVec);
        scaledBox.getCenter(this.boardCenterVec);
        this.boardTopY = this.boardCenterVec.y + this.boardSizeVec.y / 2;

        // Find the absolute lowest Y coordinate among all visible wood meshes (to find the bottom of the legs)
        let absoluteMinY = Infinity;
        gltf.scene.traverse((node) => {
          if (node instanceof THREE.Mesh && node.visible) {
            const nameLower = node.name.toLowerCase();
            if (nameLower.includes('wood')) {
              const meshBox = new THREE.Box3().setFromObject(node);
              if (meshBox.min.y < absoluteMinY) {
                absoluteMinY = meshBox.min.y;
              }
            }
          }
        });
        const floorY = absoluteMinY === Infinity ? 0 : absoluteMinY;

        if (this.gridHelper) {
          this.gridHelper.position.y = floorY;
        }
        if (this.floorMesh) {
          this.floorMesh.position.y = floorY;
        }

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

        // Detect wooden bowls and lids/covers from GLTF scene in scaled world coordinates
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

          // Calculate the true radius of the lids dynamically
          const lidRadius = lid1.size.x / 2;
          this.lidScatterRadius = lidRadius * 0.88; // 88% of the actual radius to align perfectly right inside the rim groove

          // Sample the actual lid surfaces for collision and visualize those
          // heightfields as green meshes.
          const blackLid = lid1.center.x > lid2.center.x ? lid1 : lid2;
          const whiteLid = lid1.center.x > lid2.center.x ? lid2 : lid1;
          this.blackLidBody = this.createLidCollider(blackLid, this.lidScatterRadius);
          this.whiteLidBody = this.createLidCollider(whiteLid, this.lidScatterRadius);
        }

        // Traverse scene to set shadow flags & hide board stones and lid stones
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

          const nameLower = node.name.toLowerCase();
          if (nameLower.includes('stone')) {
            const worldPos = new THREE.Vector3();
            node.getWorldPosition(worldPos);

            // Hide stone if it falls within the board boundaries
            const isOnBoard = worldPos.x >= scaledBox.min.x && worldPos.x <= scaledBox.max.x &&
                              worldPos.z >= scaledBox.min.z && worldPos.z <= scaledBox.max.z;

            // Hide stone if it is on top of either the Black or White Lid (with a radius threshold of 1.4 units)
            let isOnLid = false;
            const lidRadiusThreshold = 1.4;
            if (this.blackLidCenter) {
              const distToBlackLid = new THREE.Vector2(worldPos.x, worldPos.z).distanceTo(new THREE.Vector2(this.blackLidCenter.x, this.blackLidCenter.z));
              if (distToBlackLid < lidRadiusThreshold) isOnLid = true;
            }
            if (this.whiteLidCenter) {
              const distToWhiteLid = new THREE.Vector2(worldPos.x, worldPos.z).distanceTo(new THREE.Vector2(this.whiteLidCenter.x, this.whiteLidCenter.z));
              if (distToWhiteLid < lidRadiusThreshold) isOnLid = true;
            }

            if (isOnBoard || isOnLid) {
              node.visible = false;
            } else {
              node.visible = true;
            }
          }
        });
      }

      // Hide temporary procedural board
      this.boardMesh.visible = false;

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

  private animate(time: number = performance.now()): void {
    this.animationFrameId = requestAnimationFrame((nextTime) => this.animate(nextTime));

    if (this.controls) {
      this.controls.update();
    }

    // Step physics world and synchronize stone positions
    if (this.world) {
      const hasActiveStones = this.capturedStones.some(
        stone => stone.body.sleepState !== CANNON.Body.SLEEPING
      );
      const realFrameTime = Math.min(Math.max((time - this.lastPhysicsStepTime) / 1000, 0), 0.05);
      const frameTime = realFrameTime * this.physicsTimeScale;
      this.lastPhysicsStepTime = time;

      // Once the pile is asleep, collision detection and the solver are
      // skipped entirely. New stones start awake and resume the fixed step.
      if (hasActiveStones) {
        this.world.step(1 / 60, frameTime, 3);
      }

      // Sync three.js mesh positions and rotations with Cannon.js bodies
      this.capturedStones.forEach(stone => {
        // Circular bounding constraint (keep stones inside the lid rim)
        const center = stone.lidType === 'black' ? this.blackLidCenter : this.whiteLidCenter;
        const lidTopY = stone.lidType === 'black' ? this.blackLidTopY : this.whiteLidTopY;

        if (center) {
          const dx = stone.body.position.x - center.x;
          const dz = stone.body.position.z - center.z;
          const dist = Math.sqrt(dx * dx + dz * dz);

          const maxRadius = this.lidScatterRadius - this.capturedStoneRadius;

          if (dist > maxRadius && maxRadius > 0) {
            const angle = Math.atan2(dz, dx);

            // Push stone back inside the boundary
            stone.body.position.x = center.x + Math.cos(angle) * maxRadius;
            stone.body.position.z = center.z + Math.sin(angle) * maxRadius;

            // Remove outward velocity at the wooden rim. Vertical contact with
            // the lid remains bouncy, but the rim must not inject energy back
            // into the pile on every frame.
            const normalX = Math.cos(angle);
            const normalZ = Math.sin(angle);
            const dot = stone.body.velocity.x * normalX + stone.body.velocity.z * normalZ;

            if (dot > 0) {
              stone.body.velocity.x -= dot * normalX;
              stone.body.velocity.z -= dot * normalZ;
              stone.body.velocity.x *= 0.82;
              stone.body.velocity.z *= 0.82;

              stone.body.angularVelocity.x *= 0.5;
              stone.body.angularVelocity.y *= 0.5;
              stone.body.angularVelocity.z *= 0.5;
            }
            stone.body.aabbNeedsUpdate = true;
          }

          // Safety net only. Normal support comes from the sampled lid
          // heightfield; this prevents a body escaping after a very large step.
          if (stone.body.position.y < lidTopY - 0.75) {
            stone.body.position.set(center.x, lidTopY + 0.6, center.z);
            stone.body.velocity.setZero();
            stone.body.angularVelocity.setZero();
          }
        }

        // Copy positions to Three.js mesh - cylinder center aligns well with visual mesh center
        stone.mesh.position.copy(stone.body.position as any);
        stone.mesh.quaternion.copy(stone.body.quaternion as any);
      });
    }

    this.renderer.render(this.scene, this.camera);
  }

  private setupEventListeners(): void {
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    this.clickListener = (e: MouseEvent) => {
      if (this.game.isReplayMode) return;

      const pos = this.getRaycastPosition(e, raycaster, mouse);
      if (pos) {
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

  resizeToContainer(): void {
    this.resize();
    // Draw the existing scene immediately after the drawing buffer is resized.
    // This avoids a blank frame without rerunning the expensive board/physics sync.
    this.renderer.render(this.scene, this.camera);
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



  setShadowResolution(res: number): void {
    if (this.keyLight) {
      this.keyLight.shadow.mapSize.width = res;
      this.keyLight.shadow.mapSize.height = res;
      // Force Three.js to reallocate the shadow render target with the new size
      if (this.keyLight.shadow.map) {
        this.keyLight.shadow.map.dispose();
        this.keyLight.shadow.map = null;
      }
      this.setShadowsEnabled(this.renderer.shadowMap.enabled);
    }
  }

  setShadowRadius(radius: number): void {
    if (this.keyLight) {
      this.keyLight.shadow.radius = radius;
    }
  }

  setShadowOpacity(opacity: number): void {
    if (this.floorMesh) {
      const mat = this.floorMesh.material as THREE.ShadowMaterial;
      mat.opacity = opacity;
      mat.needsUpdate = true;
    }
  }

  setShadowBias(bias: number): void {
    if (this.keyLight) {
      this.keyLight.shadow.bias = bias;
    }
  }

  setShadowNormalBias(normalBias: number): void {
    if (this.keyLight) {
      this.keyLight.shadow.normalBias = normalBias;
    }
  }

  setLidCollisionMeshVisible(visible: boolean): void {
    this.showLidCollisionMesh = visible;
    this.clearLidCollisionHelpers();
    if (visible) {
      this.lidColliderDebugPositions.forEach(positions => {
        this.createLidCollisionHelper(positions);
      });
    }
  }

  setStoneCollisionMeshVisible(visible: boolean): void {
    this.showStoneCollisionMesh = visible;
    this.capturedStones.forEach(stone => {
      if (visible) {
        this.createStoneCollisionHelper(stone.mesh);
      } else {
        this.clearStoneCollisionHelper(stone.mesh);
      }
    });
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
    if (!this.game.isReplayMode && this.hoverPos && this.game.canPlaceStone(this.hoverPos.x, this.hoverPos.y)) {
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
    // Stone center is lifted 0.08 and its scaled half-height is ~0.175.
    // Keep the marker above the curved crown with a small safety gap.
    pos.y += 0.28 * scale;

    if (this.lastMoveMarkerType === 'circle') {
      const circleGeom = new THREE.RingGeometry(0.12 * scale, 0.16 * scale, 32);
      circleGeom.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({
        color,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      });
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
      const mat = new THREE.MeshBasicMaterial({
        color,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      });
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
          side: THREE.DoubleSide,
          depthTest: false,
          depthWrite: false,
        });
        this.markerMesh = new THREE.Mesh(numGeom, mat);
        this.markerMesh.position.copy(pos);
        this.scene.add(this.markerMesh);
      }
    }

    if (this.markerMesh) {
      this.markerMesh.renderOrder = 100;
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
    this.syncCapturedStonesPhysics();
  }

  private syncCapturedStonesPhysics(): void {
    if (!this.isGltfLoaded || !this.blackLidCenter || !this.whiteLidCenter || !this.world) return;

    // Filter current stones by lid type
    const currentOnBlackLid = this.capturedStones.filter(s => s.lidType === 'black');
    const currentOnWhiteLid = this.capturedStones.filter(s => s.lidType === 'white');

    const targetWhiteCaptured = this.game.captures.black; // white stones on black lid
    const targetBlackCaptured = this.game.captures.white; // black stones on white lid

    // 1. Sync stones on Black Lid (white captured stones)
    this.syncLidStones(currentOnBlackLid, targetWhiteCaptured, 'black', this.blackLidCenter, this.blackLidTopY, this.whiteMat);

    // 2. Sync stones on White Lid (black captured stones)
    this.syncLidStones(currentOnWhiteLid, targetBlackCaptured, 'white', this.whiteLidCenter, this.whiteLidTopY, this.blackMat);
  }

  private syncLidStones(
    currentStones: typeof this.capturedStones,
    targetCount: number,
    lidType: 'black' | 'white',
    lidCenter: THREE.Vector3,
    lidTopY: number,
    material: THREE.MeshStandardMaterial
  ): void {
    if (currentStones.length < targetCount) {
      // Spawn new stones!
      const spawnCount = targetCount - currentStones.length;
      for (let i = 0; i < spawnCount; i++) {
        // Spawn stone mesh
        const mesh = new THREE.Mesh(this.stoneGeom, material);
        const scale = this.capturedStoneScale;
        mesh.scale.set(scale, scale, scale);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.scene.add(mesh);

        if (this.showStoneCollisionMesh) {
          this.createStoneCollisionHelper(mesh);
        }

        // Spawn position: above the lid center to fall down
        // Spawn near the center so stones land cleanly on the lid
        const spawnAngle = Math.random() * Math.PI * 2;
        const spawnRadius = Math.random() * (this.lidScatterRadius * 0.3);
        const spawnX = lidCenter.x + Math.cos(spawnAngle) * spawnRadius;
        const spawnZ = lidCenter.z + Math.sin(spawnAngle) * spawnRadius;
        const spawnY = lidTopY + 0.55 + (i * 0.18);

        mesh.position.set(spawnX, spawnY, spawnZ);

        // Use a biconvex lens matching the visual stone. Its rounded perimeter
        // cannot provide the stable vertical face the old box collider had.
        if (!this.capturedStoneCollisionShape) {
          this.capturedStoneCollisionShape = this.createStoneCollisionShape(scale);
        }
        const body = new CANNON.Body({
          mass: 0.18,
          position: new CANNON.Vec3(spawnX, spawnY, spawnZ),
          material: this.stonePhysicsMaterial,
          linearDamping: 0.14,
          angularDamping: 0.32,
          allowSleep: true,
          // Cannon combines linear and angular speed for sleeping. A higher
          // limit is needed for a small stone whose visible motion has ended
          // but which retains a tiny residual spin.
          sleepSpeedLimit: 0.45,
          sleepTimeLimit: 0.2,
        });
        body.addShape(this.capturedStoneCollisionShape);

        // Start mostly flat with slight random tilt
        body.quaternion.setFromEuler(
          (Math.random() - 0.5) * 0.3,
          Math.random() * Math.PI * 2,
          (Math.random() - 0.5) * 0.3
        );
        body.velocity.set(
          (Math.random() - 0.5) * 0.28,
          -0.85,
          (Math.random() - 0.5) * 0.28
        );
        body.angularVelocity.set(
          (Math.random() - 0.5) * 1.2,
          (Math.random() - 0.5) * 1.8,
          (Math.random() - 0.5) * 1.2
        );

        this.world.addBody(body);
        
        const stoneData = { mesh, body, lidType };
        this.capturedStones.push(stoneData);
      }
    } else if (currentStones.length > targetCount) {
      // Remove excess stones (from the end of the array)
      const removeCount = currentStones.length - targetCount;
      for (let i = 0; i < removeCount; i++) {
        const stone = currentStones[currentStones.length - 1 - i];
        
        // Remove mesh from scene
        this.clearStoneCollisionHelper(stone.mesh);
        this.scene.remove(stone.mesh);

        // Remove from physics world
        this.world.removeBody(stone.body);

        // Remove from main array
        const idx = this.capturedStones.indexOf(stone);
        if (idx !== -1) {
          this.capturedStones.splice(idx, 1);
        }
      }
    }
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

    // Clear captured stones physics
    this.capturedStones.forEach(stone => {
      if (this.world) this.world.removeBody(stone.body);
      this.clearStoneCollisionHelper(stone.mesh);
      this.scene.remove(stone.mesh);
    });
    this.capturedStones = [];
    if (this.blackLidBody && this.world) this.world.removeBody(this.blackLidBody);
    if (this.whiteLidBody && this.world) this.world.removeBody(this.whiteLidBody);
    this.clearLidCollisionHelpers();
    this.lidColliderDebugPositions = [];

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

    if (this.gridHelper) {
      this.scene.remove(this.gridHelper);
      if (this.gridHelper.geometry) this.gridHelper.geometry.dispose();
      if (Array.isArray(this.gridHelper.material)) {
        this.gridHelper.material.forEach(m => m.dispose());
      } else if (this.gridHelper.material) {
        this.gridHelper.material.dispose();
      }
    }

    if (this.floorMesh) {
      this.scene.remove(this.floorMesh);
      if (this.floorMesh.geometry) this.floorMesh.geometry.dispose();
      if (Array.isArray(this.floorMesh.material)) {
        this.floorMesh.material.forEach(m => m.dispose());
      } else if (this.floorMesh.material) {
        this.floorMesh.material.dispose();
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
