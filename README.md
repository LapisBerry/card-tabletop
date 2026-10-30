# Card Tabletop

A 3D tabletop for card games in the browser, in the spirit of Tabletopia and
focused on games like Bang!. It is a free table: the app does not enforce game
rules, players move the cards themselves.

Built with [Three.js](https://threejs.org), TypeScript and [Vite](https://vite.dev).

## Run it

You need Node.js 22 or newer and [pnpm](https://pnpm.io) (the version is
pinned in `package.json`; `corepack enable` or `npm install -g pnpm` gets it).

```sh
pnpm install
pnpm dev         # opens a local server with live reload
pnpm test        # unit tests for the table model, plans and card loading
pnpm build       # type-check and build the site into dist/
```

## Controls

**Cards**

| Input | Does |
| --- | --- |
| Drag a card | Take the top card of its stack and carry it |
| Shift + drag, or on touch hold still for a moment and then drag | Carry the whole stack |
| Drop on another stack | Put the carried cards on top of it (it lights up green) |
| Drop near the DRAW or DISCARD spot | Snap onto the marked spot |
| Drop over your hand | Take the cards into your hand, where the gap opens |
| Click or tap | Select a stack; buttons for it appear above your hand |
| Double-click, double-tap, or F | Flip (a stack flips like a real pile: order reverses) |
| Q / E | Turn a quarter left / right |
| S | Shuffle |
| D, or 1 to 9 | Draw that many cards into your hand |
| Esc | Cancel a drag, or clear the selection |

Keys act on the stack under the mouse, or on the selected stack. Hovering a
face-up card shows it large at the side of the screen. Cards dropped partly
over another stack rest on top of it.

**Buttons for the selected stack**

| Button | Does |
| --- | --- |
| ⟲ Flip ⟳ | Turn left, flip, turn right |
| Draw (Take for one card) | Move the top card into your hand |
| Shuffle | Shuffle the stack in place |
| Deal… | Deal a number of cards to 2-7 players: yours go to your hand, the other seats get face-down piles round the table, turned to face them |
| Spread | Lay the stack out in a row so every card shows |
| Gather | Pile up this stack and every card touching it (shows only when something touches it) |

**Your hand**

The hand is a fan of cards along the bottom of the screen.

| Input | Does |
| --- | --- |
| Drag a card up | Play it onto the table, face up, where you drop it (onto a pile works too) |
| Drag a card sideways | Reorder the hand |
| Hover, or tap | Show the card large; tap again to put it away |

**View**

| Input | Does |
| --- | --- |
| Right-drag | Move the view |
| Middle-drag, or Shift + right-drag | Tilt and turn the view |
| Wheel | Zoom toward the pointer |
| Arrow keys | Move the view |
| One finger on the felt / two fingers (touch) | Move / zoom and turn |
| H | Reset the view |
| ? | Show or hide the controls panel |

## How it is put together

```
src/
  data/       card set JSON files
  model/      table state with no 3D code: cards, stacks, hands, actions,
              the table layout, and the plans behind shuffle, deal, spread
              and gather
  view/       Three.js: table, camera, card meshes, card pictures, and
              mouse/touch/keyboard handling (interaction.ts)
  ui/         page styles, the hand, the buttons and the card preview
  main.ts     wires the model and the view together
```

- **The model is separate from the view.** All table changes are `Action`
  objects applied by a pure `reduce` function in `src/model/table.ts`. Actions
  carry their own ids, so sending them to other players is how online
  multiplayer can work later.
- **Everything on the table is a stack.** A loose card is a stack of one and a
  deck is a tall stack, so moving, stacking and splitting all work the same way.
  Stack actions include `moveStack`, `splitStack`, `mergeStacks`,
  `transferTop`, `flipStack`, `turnStack`, `shuffleStack`, `spreadStack` and
  `gatherStacks`.
- **Hands live in the table state too.** `drawToHand`, `stackToHand`,
  `playToTable`, `playOntoStack` and `reorderHand` move cards between hands
  and the table. Bigger commands such as a deal are planned as a list of
  plain actions (`src/model/plans.ts`), so a shuffle carries its new order
  and a deal is the same on every screen.
- **Carrying cards is drawn by the view, not stored.** The table state changes
  when a drag takes a card off a stack and when the cards are dropped, not on
  every pointer move.
- **Card pictures are drawn in code** on a canvas (`src/view/cardArt.ts`): plain
  text on the front and one shared back. Front pictures are made only for
  face-up cards and freed when no card shows them.

## Card sets

A card set is a JSON file like `src/data/wild-west-sample.json`. Each entry is
one card design, with a list of the copies in the deck by rank and suit:

```json
{
  "id": "shot",
  "name": "Shot",
  "kind": "action",
  "text": "Shoot a player you can reach.",
  "copies": ["AS", "10H", "QD"]
}
```

`kind` is `action`, `equipment`, `character` or `role`. Copies use a rank
(`2`-`10`, `J`, `Q`, `K`, `A`) and a suit (`H`, `D`, `C`, `S`); leave `copies`
out for a single card with no rank, such as a role card. The sample deck uses
its own generic Western names and text.

## Publishing

`.github/workflows/pages.yml` publishes the site to GitHub Pages on every push
to `main`. Turn it on once in the repository's **Settings > Pages** by setting
**Source** to **GitHub Actions**.
