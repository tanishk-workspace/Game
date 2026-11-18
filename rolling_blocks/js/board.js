import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js';
import { CONFIG } from './config.js';

export class Board {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.grid = [];
    this.rows = 0;
    this.cols = 0;
  }

  loadLevel(levelData) {
    // Clear existing meshes
    while (this.group.children.length > 0) {
      this.group.remove(this.group.children[0]);
    }

    this.rows = levelData.blueprint.length;
    this.cols = Math.max(...levelData.blueprint.map(row => row.length));

    // 1. Initialize empty matrix
    this.grid = Array.from({ length: this.rows }, () =>
      Array.from({ length: this.cols }, () => ({
        isSolid: false,
        isSoft: false,
        isGoal: false,
        switchType: null,
        targetBridge: [],
        isBridgeActive: false,
        mesh: null,
        falling: false,
        velocityY: 0
      }))
    );

    // 2. Parse blueprint characters
    levelData.blueprint.forEach((rowStr, r) => {
      for (let c = 0; c < rowStr.length; c++) {
        const ch = rowStr[c];
        if (ch === '1') {
          this.grid[r][c].isSolid = true;
        } else if (ch === '9') {
          this.grid[r][c].isSolid = true;
          this.grid[r][c].isGoal = true;
        }
      }
    });

    // Helper to convert "r,c" strings (or [r, c] arrays) to [Number, Number]
    const parseCoord = coord =>
      typeof coord === 'string' ? coord.split(',').map(Number) : coord;

    // 3. Apply soft fragile tiles
    (levelData.soft_tiles || []).forEach(coord => {
      const [r, c] = parseCoord(coord);
      if (this.inBounds(r, c)) this.grid[r][c].isSoft = true;
    });

    // 4. Inject switches
    (levelData.switches || []).forEach(sw => {
      const [sr, sc] = parseCoord(sw.pos);
      if (this.inBounds(sr, sc)) {
        this.grid[sr][sc].switchType = sw.type;
        this.grid[sr][sc].targetBridge = (sw.targets || []).map(parseCoord);
      }
    });

    // 5. Mark bridges initially locked/invisible
    const bridgeSet = new Set(
      (levelData.bridges || []).map(coord => {
        const [br, bc] = parseCoord(coord);
        return `${br},${bc}`;
      })
    );

    bridgeSet.forEach(key => {
      const [br, bc] = key.split(',').map(Number);
      if (this.inBounds(br, bc)) {
        this.grid[br][bc].isSolid = false;
        this.grid[br][bc].isBridgeActive = false;
      }
    });

    // 6. Create 3D meshes
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const tile = this.grid[r][c];
        const isBridgeTile = bridgeSet.has(`${r},${c}`);

        if (tile.isSolid || isBridgeTile) {
          tile.mesh = this.createTileMesh(r, c, tile, isBridgeTile);
          tile.mesh.visible = tile.isSolid;
          this.group.add(tile.mesh);
        }
      }
    }
  }

  createTileMesh(r, c, tile, isBridgeTile) {
    const holder = new THREE.Group();
    holder.position.set(c * CONFIG.TILE_SIZE, -CONFIG.TILE_HEIGHT / 2, r * CONFIG.TILE_SIZE);

    if (tile.isGoal) {
      // Build a hollow square frame so the block visually drops inside the hole
      const frameThickness = 0.14;
      const mat = new THREE.MeshStandardMaterial({ color: CONFIG.COLORS.HOLE_RIM, roughness: 0.7 });

      const topBar = new THREE.Mesh(new THREE.BoxGeometry(1, CONFIG.TILE_HEIGHT, frameThickness), mat);
      topBar.position.z = -0.5 + frameThickness / 2;

      const botBar = new THREE.Mesh(new THREE.BoxGeometry(1, CONFIG.TILE_HEIGHT, frameThickness), mat);
      botBar.position.z = 0.5 - frameThickness / 2;

      const leftBar = new THREE.Mesh(new THREE.BoxGeometry(frameThickness, CONFIG.TILE_HEIGHT, 1 - frameThickness * 2), mat);
      leftBar.position.x = -0.5 + frameThickness / 2;

      const rightBar = new THREE.Mesh(new THREE.BoxGeometry(frameThickness, CONFIG.TILE_HEIGHT, 1 - frameThickness * 2), mat);
      rightBar.position.x = 0.5 - frameThickness / 2;

      holder.add(topBar, botBar, leftBar, rightBar);
      return holder;
    }

    let color = CONFIG.COLORS.TILE_TOP;
    if (tile.isSoft) color = CONFIG.COLORS.SOFT_TILE;
    else if (isBridgeTile) color = CONFIG.COLORS.BRIDGE_ACTIVE;

    const geo = new THREE.BoxGeometry(CONFIG.TILE_SIZE * 0.98, CONFIG.TILE_HEIGHT, CONFIG.TILE_SIZE * 0.98);
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.45,
      metalness: 0.1
    });

    const box = new THREE.Mesh(geo, mat);
    box.receiveShadow = true;

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: CONFIG.COLORS.TILE_EDGE })
    );
    box.add(edges);
    holder.add(box);

    // Add 3D Switch Buttons (Circle for soft, X for heavy)
    if (tile.switchType === 'soft') {
      const btnGeo = new THREE.CylinderGeometry(0.26, 0.28, 0.08, 24);
      const btnMat = new THREE.MeshStandardMaterial({ color: CONFIG.COLORS.SWITCH_SOFT });
      const btn = new THREE.Mesh(btnGeo, btnMat);
      btn.position.y = CONFIG.TILE_HEIGHT / 2 + 0.03;
      holder.add(btn);
    } else if (tile.switchType === 'heavy') {
      const xMat = new THREE.MeshStandardMaterial({ color: CONFIG.COLORS.SWITCH_HEAVY });
      const bar1 = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.08, 0.14), xMat);
      bar1.rotation.y = Math.PI / 4;
      bar1.position.y = CONFIG.TILE_HEIGHT / 2 + 0.03;

      const bar2 = bar1.clone();
      bar2.rotation.y = -Math.PI / 4;
      holder.add(bar1, bar2);
    }

    return holder;
  }

  activateBridge(r, c) {
    if (!this.inBounds(r, c)) return;
    const tile = this.grid[r][c];
    tile.isSolid = true;
    tile.isBridgeActive = true;
    if (tile.mesh) {
      tile.mesh.visible = true;
    }
  }

  collapseTile(r, c) {
    if (!this.inBounds(r, c)) return;
    this.grid[r][c].falling = true;
  }

  update(dt) {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const tile = this.grid[r][c];
        if (tile.falling && tile.mesh) {
          tile.velocityY += 28 * dt;
          tile.mesh.position.y -= tile.velocityY * dt;
          tile.mesh.rotation.x += 1.8 * dt;
        }
      }
    }
  }

  inBounds(r, c) {
    return r >= 0 && r < this.rows && c >= 0 && c < this.cols;
  }

  getCenter() {
    return new THREE.Vector3((this.cols - 1) / 2, 0, (this.rows - 1) / 2);
  }
}
