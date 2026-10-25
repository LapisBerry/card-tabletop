import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TABLE_DEPTH, TABLE_WIDTH } from './dimensions';

/** Where the view starts: from the first seat, looking over the table. */
const HOME_TARGET = new THREE.Vector3(0, 0, 6);
const HOME_POSITION = new THREE.Vector3(0, 62, 66);

/**
 * Camera controls for the table.
 *
 * Mouse: right-drag moves the view, middle-drag (or Shift + right-drag) tilts
 * and turns it, the wheel zooms toward the pointer. The left button is kept
 * free for picking up cards. Touch: one finger moves, two fingers zoom and turn.
 * Keyboard: arrow keys move the view.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;

  constructor(domElement: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(40, 1, 1, 1500);
    const controls = new OrbitControls(this.camera, domElement);
    controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
    controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.screenSpacePanning = false; // pan across the table, not up into the air
    controls.zoomToCursor = true;
    controls.minDistance = 14;
    controls.maxDistance = 170;
    controls.minPolarAngle = 0.02; // almost straight down
    controls.maxPolarAngle = THREE.MathUtils.degToRad(78); // never below the table edge
    controls.keyPanSpeed = 20;
    controls.listenToKeyEvents(window);
    controls.addEventListener('change', () => this.keepOverTable());
    this.controls = controls;
    this.reset();
  }

  /** Goes back to the starting view. Tall, narrow screens start further back so the cards fit. */
  reset(): void {
    const pullBack = THREE.MathUtils.clamp(1.25 / this.camera.aspect, 1, 1.9);
    this.controls.target.copy(HOME_TARGET);
    this.camera.position.copy(HOME_POSITION).sub(HOME_TARGET).multiplyScalar(pullBack).add(HOME_TARGET);
    this.controls.update();
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Call once per frame, for the smooth slow-down after a drag. */
  update(): void {
    this.controls.update();
  }

  /** Stops the view from wandering off the table: the point it looks at stays above the felt. */
  private keepOverTable(): void {
    const target = this.controls.target;
    const clamped = new THREE.Vector3(
      THREE.MathUtils.clamp(target.x, -TABLE_WIDTH / 2, TABLE_WIDTH / 2),
      0,
      THREE.MathUtils.clamp(target.z, -TABLE_DEPTH / 2, TABLE_DEPTH / 2),
    );
    if (clamped.equals(target)) return;
    const shift = clamped.sub(target);
    target.add(shift);
    this.camera.position.add(shift);
  }
}
