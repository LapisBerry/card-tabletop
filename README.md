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
pnpm test        # unit tests for the table model and card loading
pnpm build       # type-check and build the site into dist/
```

## Controls

| Input | Does |
| --- | --- |
| Right-drag | Move the view |
| Middle-drag, or Shift + right-drag | Tilt and turn the view |
| Wheel | Zoom toward the pointer |
| Arrow keys | Move the view |
| One finger / two fingers (touch) | Move / zoom and turn |
| H | Reset the view |
| ? | Show or hide the controls panel |

The left mouse button is kept free for picking up cards, which comes next.

## How it is put together

```
src/
  data/       card set JSON files
  model/      table state with no 3D code: cards, stacks, actions
  view/       Three.js: table, camera, card meshes and card pictures
  ui/         page styles
  main.ts     wires the model and the view together
```

- **The model is separate from the view.** All table changes are `Action`
  objects applied by a pure `reduce` function in `src/model/table.ts`. Actions
  carry their own ids, so sending them to other players is how online
  multiplayer can work later.
- **Everything on the table is a stack.** A loose card is a stack of one and a
  deck is a tall stack, so moving, stacking and splitting all work the same way.
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
