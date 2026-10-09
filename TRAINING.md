# Practice lab candidate

This branch adds five available challenges, grouped by difficulty: measured
straight driving, a heading turn, stopping on a black line, stopping before an
obstacle, and following a bending line. Each has an explicit geometric goal,
time limit, measured feedback and three progressive hints. Reference programs
validate all five scenes in `test/training.test.mjs`. The scenes intentionally
contain no BioGlow mission mechanisms. A valid finish is program completion, or
only idle event listeners remaining with all motors stopped at the goal for
0.3 seconds. Waiting or unfinished stacks cannot claim this early finish.

Practice uses a standard 56 mm wheel / 112 mm track robot and a separate draft
for each challenge. Entering saves the complete raw main workspace (including
loose/disabled blocks), robot setup, sounds and start pose. Switching or leaving
uses a transactional editor load. Normal autosave is frozen during practice;
practice drafts use their own local storage key. Reloading returns to the main
program. Shared-library selection stays attached to the main program, and
shared writes/imports/robot changes are unavailable while practicing. Export
still exports the current practice draft. Enter/leave is a deliberate stop,
not a way to resume a previous running match.

## Debugging behavior

Pause freezes simulation time, including every stack, motor action, wait,
sensor event and match timer. Step advances all stacks through five 4 ms
physics/scheduler ticks (20 ms total); from idle it starts a fresh run paused. It is a time step, not “execute exactly
one Blockly block”: concurrent stacks share motors and sensors, and moves and
waits span several steps. Quarter and half speed reuse the existing speed
control. Existing block highlighting and variable/list readouts stay in use.
A bounded trace records actual executed commands and condition outcomes,
without evaluating reporters a second time. The color sample circle and
distance ray appear on the mat; reflection joins the existing sensor readouts.
Sound is silenced on pause rather than replaying a partial tone on resume.

Motor degrees are shaft rotation, not chassis heading. For an ideal in-place
turn with equal opposite wheel travel, heading change is wheel degrees × wheel
diameter / wheel spacing. With the standard geometry, 180 motor degrees gives
a 90° chassis turn. Yaw can be reset independently of absolute mat heading.

## Reliability experiments and limits

A batch always contains 20 independent simulator instances using a snapshot of
the program and robot. It does not replace the editor or foreground simulation.
Only the five validated practice scenes may be scored. Results show measured
feedback, overlaid paths, the success fraction, seed and exact chosen settings.
Cancellation or edits invalidate the batch; a partial batch is not presented as
a 20-run success rate. The 20-run count is a teaching choice, not a statistical
confidence claim.

Ideal adds no uncertainty. Custom uncertainty exposes these independent,
uniform, bounded parameters; numeric limits are UI safety limits, not observed
hardware distributions:

- Launch x/y error in millimetres and heading error in degrees: a new draw per run.
- Fixed left/right effective rolling-travel bias in percent: unchanged throughout
  a batch, representing a chosen persistent robot asymmetry.
- Additional left/right effective rolling variation in percent: one draw per
  wheel per run, held throughout that run.
- Reflected-light offset in percentage points and distance offset in millimetres:
  one draw per run, held throughout it. A reflection offset does not change the
  separately classified color name.

Rolling factors change ground travel per encoder degree. They do not invent
shaft rotation or inject independent motor-speed noise every animation frame.
Program random reporters and random list indices use the seeded stream too.
Any gyro correction must come from the student's actual blocks; no artificial
success/error discount is applied. Identical program, configuration, seed and
settings reproduce the same paths in this runtime version. The success rate
is conditional on the chosen simulated scenario, not a real-robot prediction.

There is no defensible universal “normal SPIKE straight-driving variability”
preset in the reviewed evidence. LEGO distinguishes regulated speed, which
adjusts motor power to maintain speed under load, from power mode. Raw no-load
RPM tolerance therefore cannot be directly treated as independent wheel-speed
noise. [LEGO's line-following lesson](https://education.lego.com/en-us/lessons/prime-competition-ready/training-camp-3-react-to-lines/)
explains that distinction. The
[Medium Angular Motor specifications](https://assets.education.lego.com/v3/assets/blt293eea581807678a/blt692436dd1e8fa71c/5f8801d5c8a27c1d9614c27e/techspecs_technicmediumangularmotor.pdf?locale=en-us)
describe motor and encoder hardware bounds, not ground-path probability distributions.

The reviewed [EV3 straight-drive experiment](https://ieomsociety.org/proceedings/2021monterrey/481.pdf)
used repeated trials on one FLL-mat setup and distinguishes systematic lateral
bias from scatter and gyro correction. It does not establish a SPIKE population
preset. Likewise, a [SPIKE repeated mission demonstration](https://www.fllcasts.com/tutorials/1924-10-out-of-10-on-accurately-reaching-a-mission-model-with-basic-use-of-motion-sensor-from-lego-education-spike-prime)
combines turns and straights; endpoint gaps are not a per-metre noise model.
Future physical calibration should measure repeated straight runs, separate
initial alignment, persistent bias and run scatter, and record surface,
geometry, speed, control mode and battery conditions. No calibration-import
workflow or hardware control is added here.

A tested geometric check: 1° initial heading error produces about 17.45 mm
lateral displacement over 1 m. Curvature that gradually accumulates from 0°
to 1° produces about half that displacement. These must not be conflated.

## Color sensing footprint

Photo, plain and practice surfaces share an approximate 8 mm diameter disk:
49 equally weighted sample positions within a 4 mm radius. A 1 mm surface grid
is interpolated bilinearly at each position so fractional motion produces
continuous reflected-light changes at a line edge. Grid reconstruction adds
up to one grid cell of edge smoothing; this is a teaching approximation,
not a measured SPIKE optical footprint or calibrated sensor response.

Color names classify the averaged RGB, rather than voting on color labels or
reading only the center. Reflected light averages the surface reflectance
separately: photo pixels use rounded 8 + 90 × luminance; synthetic plain colors
keep their approximate assigned values (black 8, white 98), while practice uses
black 8 and white 90. Thus a half-black/half-white practice reading is about 49.
Intermediate mixed colors may report no color. Reflection offsets are applied
after averaging, then clipped to 0–100; they do not change color classification.

At field edges, probes extend the nearest boundary surface value. An off-field
sensor center returns no color and zero reflection, even with a trial offset.
An unavailable photo uses the plain surface; practice takes precedence over
both. Leaving practice restores the selected main surface. The small magenta
disk depicts the nominal 4 mm sample radius at the transformed sensor position;
the larger robot circle is only a sensor locator. Native browser rendering of
this overlay remains pending while the Mac is locked.

The continuous edge response changes feedback trajectories. The reference
proportional line follower (20% speed, gain 0.8, reflection target 49) now stops
after six simulation seconds. It finishes within 3.2 cm with all driving samples
within the existing 3 cm line tolerance; grading thresholds were not relaxed.

## Compact lab chooser

Practice Lab opens a native modal dialog with all five labs grouped by difficulty.
Cancel, Escape and clicking outside close it without changing any draft. Selecting
a lab closes the chooser and focuses its heading; cancel returns focus to the
opening button. The active panel has Switch lab and Return to my program, a goal
and feedback. Hints/instructions and trials are collapsed until requested. The
idle practice panel is hidden and the teaching debugger starts collapsed.

The Open from GitHub button is hidden from rendering, accessibility and keyboard
navigation using display:none. Its element, handlers, modal, module and saved
configuration remain available for later restoration.

Automated callback tests use the real setupTraining/save code with DOM/Blockly
shims, including all five labs, cancellation, error handling, repeated switching,
focus destinations and unsaved main restoration. The updated native-browser
harness remains unrun while the Mac is locked.
