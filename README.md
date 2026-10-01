# BioGlow Robot Game Simulator

An unofficial practice simulator for the **FIRST® LEGO® League Challenge 2026–27 BioGlow** robot game. It runs in any modern browser, including Chromebooks and tablets, with nothing to install.

Kids can build a program from SPIKE™ Prime–style word blocks, or import one saved from the LEGO Education SPIKE App. They can then watch a virtual robot run it on the mat, practice 2:30 matches and score the result.

## What it does

- **Field:** the 2.0 m × 1.14 m BioGlow mat on the 20 cm wireframe grid, with both home areas, the black lines and every mission model.
- **Loose pieces:** purple pieces slide and turn when the robot pushes them, and stop against walls and models. Drag them anywhere, add more, or reset them. A keystone species piece starts in left home. Mission models stay fixed, like the real Dual Lock; a "just for fun" setting lets the robot shove them too.
- **Left / Right:** one tap moves the start position to the matching spot in the other home.
- **Robot:** a two-wheel drive base you can configure, with a color sensor, a distance sensor, a gyro (yaw angle) and attachment motors.
- **Robot editor:** drag the color sensor, distance sensor and arms onto a top view of the robot. Each arm is a **lift/press** arm (tilts up and down) or a **sweep** arm (swings flat), points front, back, left or right, and has a length and gear ratio. Lowered and sweeping arms push loose pieces; arms stop when they press on a model or the mat, like SPIKE stall detection.
- **Blocks:** a drag-and-drop editor that looks and works like the SPIKE App: blocks snap together under "when program starts", the category menu uses SPIKE's colors, `if` and `repeat` are C-shaped, and sensor conditions are hexagon blocks that drop into `if` and `wait until`. The running block is outlined in yellow. Blocks cover moving, steering, start/stop moving, movement speed and motors, motor run / go to position / speed / stop, wait, wait until, if, repeat, reset yaw, write and beep.
- **SPIKE files:**
  - **Import:** reads `.llsp3` Word Blocks projects. Drive motors and sensor ports are read from the program. Blocks the simulator can't run yet show up in gray.
  - **Export:** writes `.llsp3` files that follow the SPIKE App's file layout.
- **Match mode:** a 2:30 clock. Stopping the robot outside home costs a precision token.
- **Score sheet:** all 15 missions, equipment inspection and precision tokens, using the rulebook's point values.
- **Saved progress:** your program, robot settings and score are saved in the browser.

### Not yet

- Mission mechanisms (levers, lifts, flips) don't react yet: an arm can press on a model, but the model doesn't change. Arms can push pieces but not pick them up.
- Arms are limited to straight front/back/left/right directions, with no odd angles, linkages or multi-joint arms.
- Not simulated yet: SPIKE Python projects, variables, light-matrix images, motor-position conditions, "else" branches, and extra stacks such as "when color" hats.
- Exported files re-import here, but opening them in the SPIKE App hasn't been confirmed yet.
- There is no live connection to the SPIKE App. Moving programs with files works everywhere. A desktop "virtual hub" helper might be possible later.

## Run it

GitHub Pages serves this repo as-is. To run it locally, use any static file server; browsers block ES modules on `file://`, so opening `index.html` directly won't work:

```bash
python -m http.server 8000
```

Then open http://localhost:8000.

## Tests

The tests need Node 18 or newer and have no dependencies:

```bash
npm test
```

To also check your own SPIKE projects, point the tests at a folder of `.llsp3` files. Keep those files out of this repo; `.gitignore` already excludes `*.llsp3` and `fixtures/`.

```bash
SPIKE_FIXTURES=path/to/your/projects npm test
```

## Libraries

The block editor is [Blockly](https://github.com/google/blockly) 11.2.2 (Apache 2.0), loaded from jsDelivr with its Scratch-style "zelos" look. Everything else is plain JavaScript with no dependencies.

## Code layout

| File | What it holds |
| --- | --- |
| `src/field.js` | Mat size, mission model positions, scoring rules |
| `src/blocks.js` | Block types and defaults |
| `src/workspace.js` | The Blockly block shapes, menu and editor setup |
| `src/blocks-json.js` | Converting between editor blocks and the simulator's program |
| `src/robot-view.js` | Drawing the robot on the field and in the robot editor |
| `src/sim.js` | Drive physics, sensors, collisions and the block runner |
| `src/spike-io.js` | `.llsp3` / `.sb3` zip reading and writing, block conversion |
| `src/app.js` | The page UI |

## Sources and accuracy

- Mission names and point values come from the official 2026–27 BioGlow Robot Game Rulebook. Check the FIRST Challenge Updates for changes during the season.
- Model positions were traced from the public field wireframe and may be off by a few centimetres. Fix them in `src/field.js`.
- Sensor readings are simplified. The mat is treated as green, home as white, the home borders as red and blue, and the printed lines as black.

FIRST®, FIRST® LEGO® League and BIOGLOW™ are trademarks of FIRST and the LEGO Group. LEGO®, SPIKE™ and LEGO Education are trademarks of the LEGO Group. This project is not affiliated with or endorsed by either.
