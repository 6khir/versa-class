# Maze Engine

Third locked product engine in VERSA CLASS. It builds printable rectangular maze packs locally on the CPU. The studio UI stays a projection of engine state: Overview → Maze Lab → Mockups → Preview → Export.

Target machine: MacBook Air M2, 16 GB, no discrete GPU. Maze math, validation, and SVG rendering do not load a local model.

## Architecture

```
Overview (theme / age / difficulty)
        │
        ▼
   Maze Lab (plan, generate, cancel, resume, regenerate)
        │  deterministic topology + one solution
        │  student SVG + solution SVG + PNG preview
        ▼
   Mockups / Preview / Export adapters
        │  cover + interiors + optional answer keys + back cover
        ▼
   PDF (raster-from-SVG) and PPTX
```

| Layer | Owns | Must not own |
| --- | --- | --- |
| `maze-contract.cjs` | Schema, presets, parse/migrate/recover | Generation |
| `maze-generator.cjs` | Seeded perfect mazes, validation | Theme copy, frames |
| `maze-svg.cjs` | Print-safe student/solution SVG | Remote calls |
| `maze-lab.cjs` | Book plan, cancel, resume, seeds | Export file formats |
| `maze-export.cjs` | Cover/back shells, job order, PDF/PPTX adapters | Maze math |
| `maze-prompts.cjs` / `maze-artwork.cjs` | Theme JSON + decorative frames | Walls, seeds, paths |
| Maze Lab UI | Projection of lab state | Persistence |

Generation is sequential on the main process. The renderer shows lazy thumbnails and one selected preview. It does not keep fifty decoded page bitmaps in memory.

## User workflow

1. **Overview** — Create or open a maze project. The engine is locked once the product format is `maze`.
2. **Maze Lab** — Set keyword/theme, age group, difficulty, page count (1–50), start/end icons, and whether export includes answer keys. Generate the book. Cancel keeps finished pages. Resume fills the rest. Select one maze to regenerate. Copy, lock, or reroll the book seed.
3. **Mockups Lab** — Uses the existing mockup selectors. Maze pages appear in book order: cover, student interiors, optional answer keys, back cover.
4. **Preview Lab** — Uses the existing preview-frame picker. Interior student rasters are sampled; the UI does not decode every page at once.
5. **Export** — Locked until every planned interior maze is `ready` and valid. Writes a raster PDF and a PPTX through the existing file-manager adapters.

## Presets

Age bands and difficulty tiers are app-owned. Gemini may suggest labels (`ageIntent`, `difficultyIntent`); it cannot send rows, columns, seeds, or wall grids.

| Difficulty | Tier | Grid | Typical use |
| --- | --- | --- | --- |
| Very Easy | 1 | 6×6 | Pre-K |
| Easy | 2 | 8×8 | Kindergarten / Grades 1–2 |
| Medium | 3 | 12×12 | Grades 3–5 |
| Hard | 4 | 16×16 | Grades 6–8 |
| Expert | 5 | 20×18 | Grades 6–8 stretch |

Each preset also owns minimum solution length, turns, dead ends, and entrance/exit Manhattan distance. Icons sit outside the passages so they cannot block the path.

## Validation

An accepted maze is a perfect rectangular maze:

- Every cell is reachable from the entrance
- Exactly one start-to-finish path
- No cycles; passage count equals cell count minus one
- Entrance and exit are different perimeter cells with open exterior walls
- Saved solution follows open passages
- Preset difficulty constraints hold
- Walls and icons fit the maze panel

Failed attempts are retried up to eight times with a derived `generationSeed`. Invalid mazes are not persisted as `ready`. Export rejects a student SVG that contains a solution path.

## What Gemini may and must not control

Live Gemini is **not wired** in Maze Lab generate. Local keyword fallback fills theme copy. The Slice 4 director remains available for tests and a future hook.

Gemini **may** suggest: theme id, age/difficulty *intent* labels, allowlisted start/end icons, frame variant, decorative frame prompt, title, instruction, page-plan copy.

Gemini **must not** control: rows, cols, cell size, wall thickness, seeds, wall grids, entrance/exit coordinates, topology, solution path, validation, or maze-panel geometry. Forbidden keys are stripped. Frame prompts that ask for letters, numbers, logos, maze lines, or objects in the center fall back to a text-free edge decoration.

Remote frames, when a provider is supplied, are capped at two in flight, retried a few times, and cached by theme + role + variant. Provider or invalid-configuration failures fall back to the software-owned page chrome. Decorative frames are local PNG/JPEG only — no remote SVG fetch.

## Seed reproducibility

- A book seed is stored on the maze config. If empty, the engine derives one from project id, difficulty, age, keyword, icons, and title.
- Each interior page uses `bookSeed:pageId`. Regenerating one page can add a salt so neighbors stay put.
- The same config + seed + page identity produces the same topology and solution.
- Lock the seed in Maze Lab to prevent accidental reroll.

## Export limitations

- **PDF is high-quality raster-from-SVG.** `pdf-lib` cannot embed SVG vectors. Print quality is the PNG raster, not a live vector path in the PDF.
- **No PNG zip artifact.** Export writes PDF and PPTX. Per-page SVG/PNG files stay in the project `maze/` folder.
- **Cover and back cover are software-owned shells** (title/instruction frame). They are not Gemini-authored pages.
- **Answer keys default on.** Uncheck “Include answer-key pages in export” in Maze Lab to ship student pages only.
- PPTX embeds the maze SVG as one picture per slide and reapplies title/instruction as slide text.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Generate does nothing | Project `productFormat` must be `maze`. Restart if maze IPC is missing. |
| Export locked / `BOOK_INCOMPLETE` | Every interior page must be `ready` with a student SVG on disk. Resume first. |
| `MAZE_INVALID` on export | Student SVG must not contain `#maze-solution`. Do not copy the solution file over the student file. |
| Seed will not reroll | Unlock the seed in Maze Lab. |
| One page failed | Read the inspector error. Regenerate that page. Other pages stay. |
| Theme looks generic | Live Gemini is not wired. Keyword fallback writes local title/instruction only. |
| Corrupted project opens empty | Parse recovery returns a valid empty maze project instead of crashing the studio. Re-enter config and generate again. |
| Frames never appear | Expected without a live image provider. Software chrome is used. |

## Performance gates (local)

Measured in `tests/maze-production-qa.test.cjs` and the generator suite:

- Typical easy maze generate + validate: under 100 ms
- Fifty maze topologies: under several seconds
- SVG pair for one page: under 100 ms typical
- Memory should stay bounded as page count rises; do not decode every preview at once
- Remote artwork time is N/A until Gemini is live-wired (mocked fallback is milliseconds)

## Honest limitations

- Rectangular mazes only in v1
- No `project:duplicate`
- Live Gemini theme/art director is implemented but not live-wired from Maze Lab generate
- No local GPU / SAM / OCR path for mazes
- PDF is raster, not vector
- No PNG zip
- Cover/back are shells
- Electron window UI responsiveness is not driveable from these tests; the implementation is sequential + lazy thumbs by design
