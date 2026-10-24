import * as THREE from 'three';
import { TABLE_DEPTH, TABLE_WIDTH } from './dimensions';

const RIM = 5;
const RIM_HEIGHT = 0.8;
const BODY_DEPTH = 4;

/** Builds the room: lights, a felt table with a wooden rim, and a dim floor. */
export function createTableScene(anisotropy: number): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#1d1915');
  scene.fog = new THREE.Fog('#1d1915', 180, 420);

  scene.add(new THREE.HemisphereLight('#fff4e0', '#3a2c20', 1.4));

  const sun = new THREE.DirectionalLight('#fff1dc', 2.2);
  sun.position.set(-30, 90, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const reach = Math.max(TABLE_WIDTH, TABLE_DEPTH) / 2 + RIM + 4;
  Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 10, far: 220 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);

  const felt = new THREE.Mesh(
    new THREE.PlaneGeometry(TABLE_WIDTH, TABLE_DEPTH),
    new THREE.MeshStandardMaterial({ map: feltTexture(anisotropy), roughness: 0.95, color: '#ffffff' }),
  );
  felt.name = 'felt';
  felt.rotation.x = -Math.PI / 2;
  felt.receiveShadow = true;
  scene.add(felt);

  const wood = new THREE.MeshStandardMaterial({ map: woodTexture(anisotropy), roughness: 0.55 });
  const outerW = TABLE_WIDTH + RIM * 2;
  const outerD = TABLE_DEPTH + RIM * 2;

  const body = new THREE.Mesh(new THREE.BoxGeometry(outerW, BODY_DEPTH, outerD), wood);
  body.position.y = -BODY_DEPTH / 2 - 0.01;
  body.receiveShadow = true;
  scene.add(body);

  // Each rail is built lengthwise along x and then turned, so the grain runs along it.
  const rails: [length: number, x: number, z: number, turned: boolean][] = [
    [outerW, 0, -(TABLE_DEPTH + RIM) / 2, false],
    [outerW, 0, (TABLE_DEPTH + RIM) / 2, false],
    [TABLE_DEPTH, -(TABLE_WIDTH + RIM) / 2, 0, true],
    [TABLE_DEPTH, (TABLE_WIDTH + RIM) / 2, 0, true],
  ];
  for (const [length, x, z, turned] of rails) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(length, RIM_HEIGHT, RIM), wood);
    rail.position.set(x, RIM_HEIGHT / 2, z);
    if (turned) rail.rotation.y = Math.PI / 2;
    rail.castShadow = true;
    rail.receiveShadow = true;
    scene.add(rail);
  }

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(1200, 1200),
    new THREE.MeshStandardMaterial({ color: '#2a231d', roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -70;
  scene.add(floor);

  return scene;
}

/** Green felt with a little noise, so the surface does not look like plastic. */
function feltTexture(anisotropy: number): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot draw on a canvas.');
  const image = ctx.createImageData(size, size);
  let seed = 12345;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < size * size; i++) {
    const n = (random() - 0.5) * 18;
    image.data[i * 4] = 46 + n;
    image.data[i * 4 + 1] = 94 + n;
    image.data[i * 4 + 2] = 64 + n;
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(TABLE_WIDTH / 12, TABLE_DEPTH / 12);
  texture.anisotropy = anisotropy;
  return texture;
}

/** Simple wood grain: warm brown with soft darker streaks. */
function woodTexture(anisotropy: number): THREE.Texture {
  const w = 512;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot draw on a canvas.');
  ctx.fillStyle = '#6b4325';
  ctx.fillRect(0, 0, w, h);
  let seed = 777;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 60; i++) {
    const y = random() * h;
    ctx.strokeStyle = `rgba(40, 22, 10, ${0.08 + random() * 0.18})`;
    ctx.lineWidth = 1 + random() * 3;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= w; x += 32) ctx.lineTo(x, y + Math.sin(x / 60 + i) * 3 * random());
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 1);
  texture.anisotropy = anisotropy;
  return texture;
}
