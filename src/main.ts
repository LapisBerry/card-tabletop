import * as THREE from 'three';
import sampleDeck from './data/wild-west-sample.json';
import { parseCardSet, type CardFace } from './model/cardSet';
import { demoSetup } from './model/setup';
import { IdGenerator, Table } from './model/table';
import { CardPreview } from './ui/cardPreview';
import { CameraRig } from './view/cameraRig';
import { CardLayer } from './view/cardLayer';
import { CardTextures } from './view/cardTextures';
import { Highlights } from './view/highlights';
import { CardInteraction } from './view/interaction';
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
  const faces = new Map(cardSet.faces.map((face) => [face.id, face]));
  const table = new Table();
  for (const action of demoSetup(cardSet.faces)) table.dispatch(action);

  const scene = createTableScene(anisotropy);
  const textures = new CardTextures(faces, cardSet.backLabel, anisotropy);
  const cards = new CardLayer(table, textures);
  const highlights = new Highlights();
  scene.add(cards.group, highlights.group);

  const rig = new CameraRig(canvas);
  // Ids for stacks made on this screen get their own prefix, so they never clash with the setup's.
  const interaction = new CardInteraction(canvas, rig.camera, table, cards, highlights, new IdGenerator('local-'));

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

  setUpHelp(rig);
  setUpCardPanels(table, interaction, faces);

  // Handy for poking at the table from the browser console while developing.
  if (import.meta.env.DEV) Object.assign(window, { tabletop: { table, cards, textures, rig, scene, interaction } });
}

function setUpHelp(rig: CameraRig): void {
  const help = document.querySelector<HTMLElement>('#help');
  const toggle = document.querySelector<HTMLButtonElement>('#toggle-help');
  const reset = document.querySelector<HTMLButtonElement>('#reset-view');

  // The panel starts open on a first visit to a wide screen, then remembers being closed.
  // On small screens it starts closed, because it would cover the table.
  const saved = readSetting(HELP_SETTING);
  let helpOpen = saved === null ? !window.matchMedia('(max-width: 700px)').matches : saved === 'open';
  const setHelp = (open: boolean, remember: boolean) => {
    helpOpen = open;
    if (help) help.hidden = !open;
    toggle?.setAttribute('aria-expanded', String(open));
    if (remember) writeSetting(HELP_SETTING, open ? 'open' : 'closed');
  };
  setHelp(helpOpen, false);
  toggle?.addEventListener('click', () => setHelp(!helpOpen, true));
  reset?.addEventListener('click', () => rig.reset());

  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === '?') setHelp(!helpOpen, true);
    if (event.key === 'h' || event.key === 'H') rig.reset();
  });
}

const HELP_SETTING = 'card-tabletop:help';

/** Browser storage can be missing or blocked (private windows, strict settings), so failures are ignored. */
function readSetting(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSetting(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not saved; the panel simply opens again next time.
  }
}

/** The enlarged card preview and the buttons for the selected stack. */
function setUpCardPanels(table: Table, interaction: CardInteraction, faces: ReadonlyMap<string, CardFace>): void {
  const previewRoot = document.querySelector<HTMLElement>('#preview');
  const previewCanvas = document.querySelector<HTMLCanvasElement>('#preview-card');
  const actions = document.querySelector<HTMLElement>('#actions');
  const count = document.querySelector<HTMLElement>('#actions-count');
  const preview = previewRoot && previewCanvas ? new CardPreview(previewRoot, previewCanvas, faces) : null;

  actions?.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    const stackId = interaction.selected;
    if (!button || !stackId) return;
    if (button.dataset.action === 'flip') interaction.flip(stackId);
    if (button.dataset.action === 'turn-left') interaction.turn(-1, stackId);
    if (button.dataset.action === 'turn-right') interaction.turn(1, stackId);
  });

  // Keep the preview on the side of the screen away from the pointer, so it never covers the card in use.
  let previewSide: 'left' | 'right' = 'right';
  window.addEventListener('pointermove', (event) => {
    const side =
      event.clientX > window.innerWidth * 0.6
        ? 'left'
        : event.clientX < window.innerWidth * 0.4
          ? 'right'
          : previewSide;
    if (side === previewSide) return;
    previewSide = side;
    refresh();
  });

  const refresh = () => {
    const state = table.state;
    // The preview shows the top card of the stack under the mouse, or else of the selected stack,
    // but only while it is face up: a face-down card stays secret.
    const previewStack = interaction.dragging ? null : state.stacks[interaction.hovered ?? interaction.selected ?? ''];
    const topId = previewStack?.cardIds[previewStack.cardIds.length - 1];
    const top = topId ? state.cards[topId] : undefined;
    preview?.show(top?.faceUp ? top.faceId : null, previewSide);

    const selected = state.stacks[interaction.selected ?? ''];
    if (actions) actions.hidden = !selected;
    if (count && selected) {
      const n = selected.cardIds.length;
      count.textContent = n === 1 ? '1 card' : `${n} cards`;
    }
  };
  interaction.subscribe(refresh);
  table.subscribe(refresh);
  refresh();
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
