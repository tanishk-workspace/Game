import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js';
import { CONFIG } from './config.js';

export class Block {
  constructor(scene) {
    this.scene = scene;
    this.r = 0;
    this.c = 0;
    this.state = 'standing';

    const geo = new THREE.BoxGeometry(CONFIG.BLOCK_BASE, CONFIG.BLOCK_LENGTH, CONFIG.BLOCK_BASE);
    const mat = new THREE.MeshStandardMaterial({
      color: CONFIG.COLORS.BLOCK,
      roughness: 0.35,
      metalness: 0.15
    });

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: CONFIG.COLORS.BLOCK_EDGE })
    );
    this.mesh.add(edges);

    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);
    this.scene.add(this.mesh);

    this.isRolling = false;
    this.rollTimer = 0;
    this.rollAxis = new THREE.Vector3();
    this.rollTargetAngle = 0;
    this.pendingMove = null;
    this.onRollComplete = null;

    this.isFalling = false;
    this.isSinking = false;
    this.velocityY = 0;
  }

  reset(startR, startC) {
    if (!Number.isFinite(startR) || !Number.isFinite(startC)) {
      throw new Error(`Block.reset received invalid coordinates: (${startR}, ${startC})`);
    }

    this.r = startR;
    this.c = startC;
    this.state = 'standing';
    this.isRolling = false;
    this.isFalling = false;
    this.isSinking = false;
    this.velocityY = 0;
    this.pendingMove = null;
    this.onRollComplete = null;

    // Guarantee mesh is detached from any active roll pivot and owned by scene
    if (this.mesh.parent !== this.scene) {
      this.scene.add(this.mesh);
    }
    this.pivot.position.set(0, 0, 0);
    this.pivot.rotation.set(0, 0, 0);

    this.mesh.visible = true;
    this.syncMeshTransform();
  }

  getFootprint() {
    if (this.state === 'standing') return [[this.r, this.c]];
    if (this.state === 'lying_h') return [[this.r, this.c], [this.r, this.c + 1]];
    if (this.state === 'lying_v') return [[this.r, this.c], [this.r + 1, this.c]];
    return [];
  }

  syncMeshTransform() {
    this.mesh.rotation.set(0, 0, 0);

    if (this.state === 'standing') {
      this.mesh.position.set(this.c, CONFIG.BLOCK_LENGTH / 2, this.r);
    } else if (this.state === 'lying_h') {
      this.mesh.rotation.z = Math.PI / 2;
      this.mesh.position.set(this.c + 0.5, CONFIG.BLOCK_BASE / 2, this.r);
    } else if (this.state === 'lying_v') {
      this.mesh.rotation.x = Math.PI / 2;
      this.mesh.position.set(this.c, CONFIG.BLOCK_BASE / 2, this.r + 0.5);
    }
  }

  startRoll(dr, dc, onComplete) {
    if (this.isRolling || this.isFalling || this.isSinking) return false;

    this.syncMeshTransform();
    this.isRolling = true;
    this.rollTimer = 0;
    this.pendingMove = { dr, dc };
    this.onRollComplete = onComplete;

    let pivotX = this.mesh.position.x;
    let pivotZ = this.mesh.position.z;

    if (dc === 1) {
      pivotX = this.state === 'lying_h' ? this.c + 1.5 : this.c + 0.5;
      this.rollAxis.set(0, 0, 1);
      this.rollTargetAngle = -Math.PI / 2;
    } else if (dc === -1) {
      pivotX = this.c - 0.5;
      this.rollAxis.set(0, 0, 1);
      this.rollTargetAngle = Math.PI / 2;
    } else if (dr === 1) {
      pivotZ = this.state === 'lying_v' ? this.r + 1.5 : this.r + 0.5;
      this.rollAxis.set(1, 0, 0);
      this.rollTargetAngle = Math.PI / 2;
    } else if (dr === -1) {
      pivotZ = this.r - 0.5;
      this.rollAxis.set(1, 0, 0);
      this.rollTargetAngle = -Math.PI / 2;
    }

    this.pivot.position.set(pivotX, 0, pivotZ);
    this.pivot.rotation.set(0, 0, 0);
    this.pivot.attach(this.mesh);

    return true;
  }

  applyGridMove(dr, dc) {
    const b1R = this.r;
    const b1C = this.c;
    const b2R = this.state === 'lying_v' ? this.r + 1 : this.r;
    const b2C = this.state === 'lying_h' ? this.c + 1 : this.c;

    if (this.state === 'standing') {
      if (dc === 1) {
        this.state = 'lying_h';
        this.r = b1R;
        this.c = b1C + 1;
      } else if (dc === -1) {
        this.state = 'lying_h';
        this.r = b1R;
        this.c = b1C - 2;
      } else if (dr === 1) {
        this.state = 'lying_v';
        this.r = b1R + 1;
        this.c = b1C;
      } else if (dr === -1) {
        this.state = 'lying_v';
        this.r = b1R - 2;
        this.c = b1C;
      }
    } else if (this.state === 'lying_h') {
      if (dc === 1) {
        this.state = 'standing';
        this.r = b2R;
        this.c = b2C + 1;
      } else if (dc === -1) {
        this.state = 'standing';
        this.r = b1R;
        this.c = b1C - 1;
      } else if (dr !== 0) {
        this.r += dr;
      }
    } else if (this.state === 'lying_v') {
      if (dc !== 0) {
        this.c += dc;
      } else if (dr === 1) {
        this.state = 'standing';
        this.r = b2R + 1;
        this.c = b2C;
      } else if (dr === -1) {
        this.state = 'standing';
        this.r = b1R - 1;
        this.c = b1C;
      }
    }
  }

  update(dt, onFallDone, onSinkDone) {
    if (this.isRolling) {
      this.rollTimer += dt;
      const t = Math.min(this.rollTimer / CONFIG.ROLL_DURATION, 1);
      const eased = 1 - Math.pow(1 - t, 2);

      this.pivot.setRotationFromAxisAngle(this.rollAxis, this.rollTargetAngle * eased);

      if (t >= 1) {
        this.scene.attach(this.mesh);
        this.isRolling = false;
        this.applyGridMove(this.pendingMove.dr, this.pendingMove.dc);
        this.syncMeshTransform();
        if (this.onRollComplete) this.onRollComplete();
      }
    } else if (this.isFalling) {
      this.velocityY += 28 * dt;
      this.mesh.position.y -= this.velocityY * dt;
      this.mesh.rotation.x += 2.2 * dt;
      this.mesh.rotation.z += 1.5 * dt;

      if (this.mesh.position.y < -9) {
        this.isFalling = false;
        this.mesh.visible = false;
        if (onFallDone) onFallDone();
      }
    } else if (this.isSinking) {
      this.mesh.position.y -= 4.2 * dt;
      if (this.mesh.position.y <= -1.2) {
        this.isSinking = false;
        this.mesh.visible = false;
        if (onSinkDone) onSinkDone();
      }
    }
  }
}
