import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TABLE_DEPTH, TABLE_WIDTH } from '../model/dimensions';

/** Where the view starts: from the first seat, looking over the table. */
const HOME_TARGET = new THREE.Vector3(0, 0, 6);
/** Up-and-down view angle, in degrees, of the part of the screen not covered by the hand. */
const FIELD_OF_VIEW = 40;
/** How far the starting view is from the point it looks at, and how far it leans back from straight down. */
const HOME_DISTANCE = 86;
const HOME_TILT = THREE.MathUtils.degToRad(44);
/** Tall, narrow screens start further back and look down more steeply, so the table fills more of the height. */
const NARROW_DISTANCE = HOME_DISTANCE * 1.4;
const NARROW_TILT = THREE.MathUtils.degToRad(20);

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
  private visibleAspect = 1.6;

  constructor(domElement: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(FIELD_OF_VIEW, 1, 1, 1500);
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

  /** Goes back to the starting view, fitted to the shape of the screen. */
  reset(): void {
    // 0 on a wide screen, 1 on a phone held upright.
    const narrow = THREE.MathUtils.clamp((1.25 - this.visibleAspect) / 0.7, 0, 1);
    const tilt = THREE.MathUtils.lerp(HOME_TILT, NARROW_TILT, narrow);
    const distance = THREE.MathUtils.lerp(HOME_DISTANCE, NARROW_DISTANCE, narrow);
    this.controls.target.copy(HOME_TARGET);
    this.camera.position.set(0, Math.cos(tilt) * distance, Math.sin(tilt) * distance).add(HOME_TARGET);
    this.controls.update();
  }

  /**
   * Fits the view to the screen. The bottom `coveredBottom` pixels are hidden
   * behind the hand, so the point the view looks at sits in the middle of the
   * space above it instead of the middle of the screen.
   */
  setSize(width: number, height: number, coveredBottom = 0): void {
    const covered = THREE.MathUtils.clamp(coveredBottom, 0, height * 0.4);
    const open = Math.max(1, height - covered);
    this.visibleAspect = width / open;
    // Render the top part of a taller picture whose middle is the middle of the open space,
    // widening the lens so the open space alone shows as much as a whole screen used to.
    const halfTan = Math.tan(THREE.MathUtils.degToRad(FIELD_OF_VIEW / 2)) * ((height + covered) / open);
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(halfTan));
    this.camera.setViewOffset(width, height + covered, 0, covered, width, height);
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
