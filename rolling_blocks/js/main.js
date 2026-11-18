import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js';
import { CONFIG } from './config.js';
import { Board } from './board.js';
import { Block } from './block.js';

class Bloxorz3DApp {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.levelDisplay = document.getElementById('level-display');
    this.movesDisplay = document.getElementById('moves-display');
    this.modalOverlay = document.getElementById('modal-overlay');
    this.modalTitle = document.getElementById('modal-title');
    this.modalSubtitle = document.getElementById('modal-subtitle');
    this.modalBtn = document.getElementById('modal-btn');

    this.levels = [];
    this.currentLevelIdx = 0;
    this.moves = 0;
    this.gameState = 'playing';

    this.initThree();
    this.initEvents();
    this.loadLevelsJSON();
  }

  initThree() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(CONFIG.COLORS.BG);

    const aspect = window.innerWidth / window.innerHeight;
    const d = CONFIG.ISO_FRUSTUM_SIZE;
    this.camera = new THREE.OrthographicCamera(
      (-d * aspect) / 2,
      (d * aspect) / 2,
      d / 2,
      -d / 2,
      0.1,
      100
    );

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.05);
    dirLight.position.set(10, 18, 12);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(2048, 2048);
    this.scene.add(dirLight);

    const rimLight = new THREE.DirectionalLight(0x6c8cff, 0.3);
    rimLight.position.set(-10, 8, -10);
    this.scene.add(rimLight);

    this.board = new Board(this.scene);
    this.block = new Block(this.scene);
    this.clock = new THREE.Clock();
    }
    updateViewport() {
    const width = document.documentElement.clientWidth;
    const height = document.documentElement.clientHeight;
    const aspect = width / height;

    // Base frustum from config
    let d = CONFIG.ISO_FRUSTUM_SIZE;

    // Dynamically measure the loaded level's grid size
    if (this.board && this.board.grid && this.board.grid.length > 0) {
      const rows = this.board.grid.length;
      const cols = this.board.grid[0].length;

      // In an isometric view, the horizontal span is proportional to (rows + cols)
      // Multiply by 0.85 for comfortable screen-edge padding
      const isoWidth = (rows + cols) * 0.85;
      const isoHeight = (rows + cols) * 0.55;

      // Required frustum size to fit horizontally (isoWidth / aspect) and vertically (isoHeight)
      const requiredForWidth = isoWidth / aspect;
      const requiredForHeight = isoHeight;

      // Pick whichever is largest so wide maps scale down without cropping
      d = Math.max(CONFIG.ISO_FRUSTUM_SIZE, requiredForWidth, requiredForHeight);
    } else if (aspect < 1) {
      // Fallback before level JSON finishes loading
      d = CONFIG.ISO_FRUSTUM_SIZE / aspect;
    }

    // Maintain exact 1:1 dimension ratio using aspect
    this.camera.left = (-d * aspect) / 2;
    this.camera.right = (d * aspect) / 2;
    this.camera.top = d / 2;
    this.camera.bottom = -d / 2;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height, false);
  }

  /**
   * Single source of truth: converts all "r,c" strings in level.json
   * into validated [Number, Number] pairs once upon loading.
   */
  normalizeLevels(rawLevels) {
    const parseCoord = (val) => {
      if (Array.isArray(val) && val.length === 2) {
        return [Number(val[0]), Number(val[1])];
      }
      if (typeof val === 'string' && val.includes(',')) {
        const [r, c] = val.split(',').map(s => Number(s.trim()));
        return [r, c];
      }
      throw new Error(`Invalid coordinate format in level.json: ${JSON.stringify(val)}`);
    };

    return rawLevels.map(lvl => ({
      ...lvl,
      start_pos: parseCoord(lvl.start_pos),
      soft_tiles: (lvl.soft_tiles || []).map(parseCoord),
      bridges: (lvl.bridges || []).map(parseCoord),
      switches: (lvl.switches || []).map(sw => ({
        ...sw,
        pos: parseCoord(sw.pos),
        targets: (sw.targets || []).map(parseCoord)
      }))
    }));
  }

  async loadLevelsJSON() {
    try {
      // Cache-bust query ensures localhost always loads fresh JSON
      const response = await fetch(`levels/level.json?t=${Date.now()}`);
      if (!response.ok) throw new Error(`HTTP ${response.status} loading levels/level.json`);
      const rawData = await response.json();
      this.levels = this.normalizeLevels(rawData);
      this.startLevel(0);
      this.animate();
    } catch (err) {
      console.error('[Bloxorz3D] Level Load Failed:', err);
      this.showModal(
        'Load Error',
        err.message,
        'Retry',
        () => location.reload(),
        true
      );
    }
  }

  startLevel(index) {
    this.currentLevelIdx = index;
    const levelData = this.levels[index];

    this.moves = 0;
    this.gameState = 'playing';
    this.hideModal();

    this.board.loadLevel(levelData);

    const [startR, startC] = levelData.start_pos;
    this.block.reset(startR, startC);

    const center = this.board.getCenter();
    this.camera.position.set(center.x - 12, 10, center.z + 12);
    this.camera.lookAt(center.x, 0, center.z);

    // Recalculate zoom to fit the newly loaded level's exact dimensions
    this.updateViewport();
    this.updateHUD();
  }

  handleMove(dr, dc) {
    if (this.gameState !== 'playing') return;

    this.block.startRoll(dr, dc, () => {
      this.moves += 1;
      this.updateHUD();
      this.evaluateRules();
    });
  }

  evaluateRules() {
    const footprint = this.block.getFootprint();

    for (const [r, c] of footprint) {
      if (!this.board.inBounds(r, c)) {
        this.block.isFalling = true;
        return;
      }
      const tile = this.board.grid[r][c];
      if (!tile.isSolid && !tile.isBridgeActive) {
        this.block.isFalling = true;
        return;
      }
    }

    if (this.block.state === 'standing') {
      const tile = this.board.grid[this.block.r][this.block.c];
      if (tile.isSoft) {
        this.board.collapseTile(this.block.r, this.block.c);
        this.block.isFalling = true;
        return;
      }
    }

    for (const [r, c] of footprint) {
      const tile = this.board.grid[r][c];
      if (tile.switchType === 'soft' && tile.targetBridge.length > 0) {
        tile.targetBridge.forEach(([br, bc]) => this.board.activateBridge(br, bc));
      } else if (tile.switchType === 'heavy' && this.block.state === 'standing' && tile.targetBridge.length > 0) {
        tile.targetBridge.forEach(([br, bc]) => this.board.activateBridge(br, bc));
      }
    }

    if (this.block.state === 'standing') {
      const tile = this.board.grid[this.block.r][this.block.c];
      if (tile.isGoal) {
        this.block.isSinking = true;
      }
    }
  }

  updateHUD() {
    this.levelDisplay.textContent = `${this.currentLevelIdx + 1} / ${this.levels.length}`;
    this.movesDisplay.textContent = this.moves;
  }

  showModal(title, subtitle, btnText, onClick, isFail = false) {
    this.modalTitle.textContent = title;
    this.modalTitle.className = isFail ? 'fail' : 'win';
    this.modalSubtitle.textContent = subtitle;
    this.modalBtn.textContent = btnText;
    this.modalBtn.onclick = onClick;
    this.modalOverlay.classList.remove('hidden');
  }

  hideModal() {
    this.modalOverlay.classList.add('hidden');
  }

initEvents() {
    // 1. Handle window resize and mobile orientation changes
    window.addEventListener('resize', () => {
      this.updateViewport();
    });

    // 2. On-screen mobile D-pad controls
    const dpadButtons = document.querySelectorAll('.dpad .control-btn');
    dpadButtons.forEach(btn => {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const dr = Number(btn.dataset.dr);
        const dc = Number(btn.dataset.dc);
        this.handleMove(dr, dc);
      });
    });

    // 3. On-screen restart button
    const restartBtn = document.getElementById('btn-restart');
    if (restartBtn) {
      restartBtn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.startLevel(this.currentLevelIdx);
      });
    }

    // 4. Desktop keyboard controls (WASD, Arrows, R, Enter)
    window.addEventListener('keydown', e => {
      if (e.key === 'r' || e.key === 'R') {
        this.startLevel(this.currentLevelIdx);
        return;
      }

      if (e.key === 'Enter' && this.gameState === 'won') {
        this.modalBtn.click();
        return;
      }

      switch (e.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
          this.handleMove(-1, 0);
          break;
        case 'ArrowDown':
        case 's':
        case 'S':
          this.handleMove(1, 0);
          break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
          this.handleMove(0, -1);
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          this.handleMove(0, 1);
          break;
      }
    });
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const dt = Math.min(this.clock.getDelta(), 0.05);

    this.board.update(dt);
    this.block.update(
      dt,
      () => {
        this.gameState = 'lost';
        this.showModal(
          'YOU FELL OFF!',
          'Press R or click below to retry this level.',
          'Retry Level',
          () => this.startLevel(this.currentLevelIdx),
          true
        );
      },
      () => {
        this.gameState = 'won';
        const isLast = this.currentLevelIdx >= this.levels.length - 1;
        if (isLast) {
          this.showModal(
            'GAME COMPLETED!',
            `All ${this.levels.length} stages cleared!`,
            'Play Again',
            () => this.startLevel(0),
            false
          );
        } else {
          this.showModal(
            'STAGE CLEAR!',
            `Completed in ${this.moves} moves. Press ENTER for Next Level.`,
            'Next Level',
            () => this.startLevel(this.currentLevelIdx + 1),
            false
          );
        }
      }
    );

    this.renderer.render(this.scene, this.camera);
  }
}

new Bloxorz3DApp();


