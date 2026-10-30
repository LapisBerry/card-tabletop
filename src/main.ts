import * as THREE from 'three';
import sampleDeck from './data/wild-west-sample.json';
import { parseCardSet, type CardFace } from './model/cardSet';
import { TableCommands } from './model/commands';
import { LOCAL_HAND_ID, ZONES } from './model/layout';
import { demoSetup } from './model/setup';
import { IdGenerator, Table } from './model/table';
import { ActionBar } from './ui/actionBar';
import { CardPreview } from './ui/cardPreview';
import { HandPanel } from './ui/handPanel';
import { CameraRig } from './view/cameraRig';
import { CardLayer } from './view/cardLayer';
import { CardTextures } from './view/cardTextures';
import { Highlights } from './view/highlights';
import { CardInteraction } from './view/interaction';
import { createTableScene } from './view/tableScene';
import { createZoneMarks } from './view/zoneMarks';

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
  scene.add(createZoneMarks(ZONES), cards.group, highlights.group);

  const rig = new CameraRig(canvas);
  // Ids for stacks made on this screen get their own prefix, so they never clash with the setup's.
  const ids = new IdGenerator('local-');
  const commands = new TableCommands(table, ids, LOCAL_HAND_ID);
  const interaction = new CardInteraction(canvas, rig.camera, table, cards, highlights, ids, commands, ZONES);

  const handRoot = document.querySelector<HTMLElement>('#hand');
  const resize = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height, false);
    rig.setSize(width, height, handRoot?.offsetHeight ?? 0);
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
  const hand = setUpCardPanels(table, interaction, commands, faces);

  // Handy for poking at the table from the browser console while developing.
  if (import.meta.env.DEV) {
    Object.assign(window, { tabletop: { table, cards, textures, rig, scene, interaction, commands, hand } });
  }
}

function setUpHelp(rig: CameraRig): void {
  const help = document.querySelector<HTMLElement>('#help');
  const toggle = document.querySelector<HTMLButtonElement>('#toggle-help');
  const reset = document.querySelector<HTMLButtonElement>('#reset-view');

  // The panel starts open on a first visit to a large screen, then remembers being closed.
  // On small screens it starts closed, because it would cover the table.
  const saved = readSetting(HELP_SETTING);
  const small = window.matchMedia('(max-width: 700px), (max-height: 520px)').matches;
  let helpOpen = saved === null ? !small : saved === 'open';
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

/** The hand along the bottom, the buttons for the selected stack, and the enlarged card preview. */
function setUpCardPanels(
  table: Table,
  interaction: CardInteraction,
  commands: TableCommands,
  faces: ReadonlyMap<string, CardFace>,
): HandPanel | null {
  const previewRoot = document.querySelector<HTMLElement>('#preview');
  const previewCanvas = document.querySelector<HTMLCanvasElement>('#preview-card');
  const preview = previewRoot && previewCanvas ? new CardPreview(previewRoot, previewCanvas, faces) : null;

  const actionsRoot = document.querySelector<HTMLElement>('#actions');
  const dealRoot = document.querySelector<HTMLElement>('#deal');
  if (actionsRoot && dealRoot) new ActionBar(actionsRoot, dealRoot, table, interaction, commands);

  let handFaceId: string | null = null;
  const handRoot = document.querySelector<HTMLElement>('#hand');
  const handCards = document.querySelector<HTMLElement>('#hand-cards');
  const hand =
    handRoot && handCards
      ? new HandPanel(handRoot, handCards, table, commands.handId, faces, {
          onCarryOut: (cardId, event) => interaction.carryFromHand(commands.handId, cardId, event),
          onFocus: (faceId) => {
            handFaceId = faceId;
            refresh();
          },
        })
      : null;
  if (hand) interaction.setHandDock(hand);

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

  function refresh(): void {
    // A card in the hand comes first. Otherwise the preview shows the top card of the stack under
    // the mouse, or else of the selected stack, but only while it is face up: a face-down card stays secret.
    if (handFaceId) {
      preview?.show(handFaceId, previewSide);
      return;
    }
    const state = table.state;
    const stack = interaction.dragging ? null : state.stacks[interaction.hovered ?? interaction.selected ?? ''];
    const topId = stack?.cardIds[stack.cardIds.length - 1];
    const top = topId ? state.cards[topId] : undefined;
    preview?.show(top?.faceUp ? top.faceId : null, previewSide);
  }
  interaction.subscribe(refresh);
  table.subscribe(refresh);
  refresh();
  return hand;
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
