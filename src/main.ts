import * as THREE from 'three';
import sampleDeck from './data/wild-west-sample.json';
import { parseCardSet } from './model/cardSet';
import { demoSetup } from './model/setup';
import { Table } from './model/table';
import { CameraRig } from './view/cameraRig';
import { CardLayer } from './view/cardLayer';
import { CardTextures } from './view/cardTextures';
import { createTableScene } from './view/tableScene';

function start(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#table');
  if (!canvas) throw new Error('Missing #table canvas.');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  const anisotropy = renderer.capabilities.getMaxAnisotropy();

  const cardSet = parseCardSet(sampleDeck);
  const table = new Table();
  for (const action of demoSetup(cardSet.faces)) table.dispatch(action);

  const scene = createTableScene(anisotropy);
  const textures = new CardTextures(new Map(cardSet.faces.map((face) => [face.id, face])), cardSet.backLabel, anisotropy);
  const cards = new CardLayer(table, textures);
  scene.add(cards.group);

  const rig = new CameraRig(canvas);

  const resize = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height, false);
    rig.setAspect(width / height);
  };
  window.addEventListener('resize', resize);
  resize();
  rig.reset(); // again, now that the camera knows the screen shape

  const timer = new THREE.Timer();
  timer.connect(document); // pauses the clock while the tab is hidden
  renderer.setAnimationLoop((time) => {
    timer.update(time);
    const delta = Math.min(timer.getDelta(), 0.1);
    rig.update();
    cards.update(delta);
    renderer.render(scene, rig.camera);
  });

  setUpPanels(rig);

  // Handy for poking at the table from the browser console while developing.
  if (import.meta.env.DEV) Object.assign(window, { tabletop: { table, cards, textures, rig, scene } });
}

function setUpPanels(rig: CameraRig): void {
  const help = document.querySelector<HTMLElement>('#help');
  const toggle = document.querySelector<HTMLButtonElement>('#toggle-help');
  const reset = document.querySelector<HTMLButtonElement>('#reset-view');

  // Start with the panel closed on small screens, where it would cover the table.
  let helpOpen = !window.matchMedia('(max-width: 700px)').matches;
  const setHelp = (open: boolean) => {
    helpOpen = open;
    if (help) help.hidden = !open;
    toggle?.setAttribute('aria-expanded', String(open));
  };
  setHelp(helpOpen);
  toggle?.addEventListener('click', () => setHelp(!helpOpen));
  reset?.addEventListener('click', () => rig.reset());

  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === '?') setHelp(!helpOpen);
    if (event.key === 'h' || event.key === 'H') rig.reset();
  });
}

try {
  start();
} catch (error) {
  const box = document.querySelector<HTMLElement>('#error');
  if (box) {
    box.hidden = false;
    box.textContent = `The table could not start: ${error instanceof Error ? error.message : String(error)}`;
  }
  throw error;
}
