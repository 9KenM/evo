# Stellar Evolution Simulator — Modernization Plan

## Decisions locked

| Decision | Choice |
|---|---|
| Physics | Tout et al. (1996) ZAMS + Hurley, Pols & Tout (2000) analytic tracks |
| Lifecycle start | ZAMS (Hurley's domain start). No pre-main-sequence. |
| Language | TypeScript, branded unit types in the domain layer |
| Renderer | WebGL2 via three.js, used as plumbing only — all appearance in custom shaders |
| PHP | Port `genTables.php` tables to JSON as test fixtures; delete `genStar.php` |
| Time control | Play/pause + log speed slider, adaptive pacing on by default |

---

## Why the current code is being replaced

### Confirmed physics bugs (reproduced by running the engine)

| | Current output | Correct |
|---|---|---|
| Sun's spectral type | `G7V` | `G2V` — subtype index is inverted; 0 is hottest in a class |
| White dwarf from 1 M☉ | 0.057 M☉ | ~0.55 — `(M-0.1)/(8-0.1)*(1.4-0.9)` missing `+ 0.9` |
| Neutron star from 15 M☉ | 0.74 M☉ | ~1.4 — same missing-offset bug (`+ 1.4`) |
| Giant-branch mass loss | none; mass stays 1.000 | Reimers' rate is per-year, multiplied by an age in Gyr — off by 10⁹ |
| WD temp at 1000 Gyr | 20,000 K | ~4000 K — `ageREM / 99999999` makes cooling take 10⁸ Gyr |
| 30 M☉ luminosity | 810,000 L☉ | ~150,000 — M–L exponent steepens to `M⁴` above 20 M☉, wrong direction |

Beyond bugs: subgiant and giant phases are hardcoded at exactly 10% of MS lifetime each, with
luminosity jumping by exact 5× and 25× steps. Transitions are discontinuities, not tracks.
Metallicity does not exist anywhere in the codebase.

### Confirmed rendering defects

- **Resize breaks framing.** `frameWidth/Height` update on resize; `frameX/frameY` never recompute.
  After one resize the star sits at screen (10, 0), hidden behind the controls bar.
- **Zoom state is implicit and unclamped.** Wheel zoom *works* — the context transform accumulates
  because `REN.draw()` never resets it. But the tracked `REN.zoom` variable has drifted out of sync
  with the actual transform (1.88 vs 2.389 measured), and neither end is clamped. Unreadable,
  unresettable, unserializable.
- **Hit-testing targets the wrong coordinates.** `REN.element` sets `x=260, y=0`; `drawStar` draws at
  `(mapWidth/2 + 10, mapHeight/2)`. The mousedown handler also references an undeclared global
  `selected` and DOM ids that don't exist.
- **Additive compositing in sRGB space.** `globalCompositeOperation = 'lighter'` adds gamma-encoded
  values, which is not adding light. Primary cause of the washed-toward-white look.

### Not a defect

Rendering performance. Measured 121 rAF/sec and 0.05 ms per full draw. The 3000×3000 offscreen
canvas is waste, but it is not a bottleneck. Do not rewrite for speed.

---

## File disposition

| File | Fate |
|---|---|
| `star.js` | → `src/domain/`. Bug table above is the migration checklist. |
| `star2.js` | Delete. Broken half-refactor; mixes `this` and `star`, would throw. |
| `renderer.js` | → `src/render/`. ~180 lines are dead (hover, select-arrow, commented bg blocks). |
| `script.js` | Split: clock → `app.ts`, readout → `ui/readout.ts` |
| `genTables.php` | → `src/data/zams-tables.json` via one-shot Node script, then delete |
| `genStar.php` | Delete. No age parameter; nothing in it serves an evolution sim. |
| `jquery.mousewheel.js`, `Stats.js` | Delete |
| `index.html`, `style.css` | Rewrite. Both load `http://` resources that break on https. |
| `img/` | Keep the 3 backgrounds in use; the other 10 are unreferenced |

---

## Architecture

```
src/
  domain/              # pure, zero DOM, fully testable
    units.ts           # branded types: SolarMasses, Gyr, MsunPerYear
    zams.ts            # Tout et al. 1996
    tracks.ts          # Hurley et al. 2000
    lifecycle.ts       # computeTrack() -> LifecycleTrack
    classify.ts        # spectral type + luminosity class
    color.ts           # blackbody -> CIE XYZ -> linear sRGB
  data/
    zams-tables.json   # ported from genTables.php, used as fixtures
  render/
    stage.ts           # three.js renderer + EffectComposer setup
    camera.ts          # log-space zoom, auto-fit — custom, not three's camera
    archetypes/        # star, agb, nebula, whiteDwarf, neutronStar, blackHole
                       # each a ShaderMaterial on a fullscreen quad
    post/              # bloom + ACES filmic tonemap passes
  ui/
    timeline.ts        # warped lifecycle strip + bookmarks
    sizeScale.ts       # vertical physical-scale ruler
    controls.ts  readout.ts  hrDiagram.ts
  app.ts               # wiring + clock only
```

The structural fix: today `REN.element.update()` advances `EVO.age`, regenerates the star, and
rewrites the info panel — simulation and DOM writes inside the render loop. Domain gets no
knowledge that a canvas exists.

---

## Screen layout

```
┌──────────────────────────────────────────────────────────────────┐
│  mass ▭▭▭●▭▭  metallicity ▭●▭▭▭▭   [type: G2V]  [3.2 R☉]        │
├───┬──────────────────────────────────────────────────────────────┤
│ 1 │                                                              │
│ A │                                                              │
│ U │                        ●                                     │
│   │                                                              │
│ 1 │                    (WebGL viewport)                          │
│ R │                                                              │
│ ☉ │                                                              │
│   │                                                     ┌──────┐ │
│ 1 │                                                     │  HR  │ │
│ M │                                                     │ diag │ │
│ km│                                                     └──────┘ │
├───┴──────────────────────────────────────────────────────────────┤
│ ▶ ‖  speed ▭▭●▭▭▭                                                │
│ ├──────────────────────┼────┼──┼─╫─┼──────────────────────────┤  │
│ ZAMS                 TAMS  RGB CHeB║AGB  PN         WD cooling    │
│ 0                    10Gyr        ▲current                       │
│                            ← magnified where change is rapid →   │
└──────────────────────────────────────────────────────────────────┘
```

---

## The time-warp function

One function drives both the timeline's non-linear axis and the playback pacing. This is the core
idea and it is worth stating precisely.

**The problem.** For a 1 M☉ star: MS ≈ 10 Gyr, Hertzsprung gap ≈ 30 Myr, planetary nebula ≈ 10 kyr.
Playing 12 Gyr over 60 seconds at constant rate gives the PN phase **0.00005 seconds** — it never
renders a single frame. A constant-rate slider cannot show the full lifecycle at any setting.

**Log time does not fix this.** The rapid changes are at the *end* of life, and a log axis compresses
exactly there. On a log axis from 1 Myr to 12 Gyr, the post-MS 2 Gyr occupies 1.9% of the width —
worse than the 17% a linear axis gives it.

**The warp.** Let the observable state be `(ln L, ln R, ln T_eff)`. Define

```
v(t) = ‖ d/dt (ln L, ln R, ln T_eff) ‖         # rate of observable change
w(t) = ε + v(t)^α                               # softened, floored
s(t) = ∫₀ᵗ w dt′ ⁄ ∫₀^t_end w dt′               # normalized to [0,1]
```

- **Timeline x-axis** maps `s` uniformly → rapid-change regions are automatically magnified. This
  *is* the magnifier; it needs no separate mechanism.
- **Playback** advances `s` at a constant rate → the sim crawls through transitions and sprints
  through quiescent burning. The speed slider is a multiplier on `ds/dt_real`.
- Toggle adaptive off and the slider becomes a literal yr/sec rate.

### Revised in phase 4

The single-integral form above was built and did not work. Two failures, both instructive:

1. **A softening of 0.35 flattened the warp to nothing** — warped shares came out within a percent
   of real time shares. Too much compression to differentiate anything.
2. **Raising it made the result erratic rather than better.** At 0.6 the same track gave the
   Hertzsprung gap 5.4% at 5 M☉ but 0.22% at 30 M☉, and the black hole 1%. The cause is that the
   floor is a quantile over *intervals*, and interval durations vary by orders of magnitude within
   a single track, so "typical rate" is not a meaningful quantity across the whole thing.

Shipped instead: **fixed shares per phase, warped within each phase.** `PHASE_SHARES` allocates
40 / 14 / 20 / 26 percent to main sequence, Hertzsprung gap, giant branch and remnant; inside each,
width is distributed by local rate of change. Every phase is guaranteed visible at every mass — the
30 M☉ Hertzsprung gap goes from 0.09% of real time to 14% of the strip, a 150x magnification — and
the layout no longer lurches when the mass slider moves.

The cost is real and worth stating: the strip no longer encodes relative duration. The age ticks
carry that instead, bunching wherever time is compressed, the way ticks bunch on a log axis.

Two tuning knobs, exposed in a dev panel during development:
- `α ≈ 0.35` — softening. At α=1 the PN phase (dlnT/dt ~10⁶× the MS rate) would swallow the strip.
- `ε` — floor, tuned so the main sequence retains ~35% of the width. It is most of the star's life
  and that fact should be legible.

Time tickmarks along the bottom will therefore be non-uniformly spaced, bunching where time is
compressed — the same way a log plot's ticks bunch. This is correct and readable.

---

## Lifecycle bookmarks

Bookmarks are **generated, not authored** — Hurley already classifies phase by its stellar type
index, so transitions fall out of the model:

`0` low-mass MS · `1` MS · `2` Hertzsprung gap · `3` first giant branch · `4` core He burning ·
`5` early AGB · `6` thermally pulsing AGB · `7–9` naked helium star · `10–12` white dwarf ·
`13` neutron star · `14` black hole · `15` massless remnant

Plus derived bookmarks: peak luminosity, maximum radius, and **"Earth engulfed"** (R > 1 AU) — that
last one is the most engaging marker on a 1 M☉ track.

**Discovery needs adaptive sampling.** A uniform 10,000-point sweep across 12 Gyr has 1.2 Myr
spacing and steps straight over a 10 kyr PN phase. Coarse pass first, then bisect wherever the
phase index changes, to pin each transition.

`computeTrack(mass, Z): LifecycleTrack` is pure and cached per (M, Z), recomputed debounced on
slider drag. Returns bookmarks, `warp`/`unwarp`, total lifetime, and `sample(t)`.

---

## Camera and size scale

**Auto-zoom fits the object in the viewport.** The camera frames `visualExtent(state)`, which is
deliberately *not* `state.radius`:

- Star / giant → stellar radius
- AGB → radius plus dust envelope
- Planetary nebula → the **nebula**, not the core; the shell is the spectacle
- White dwarf / neutron star → stellar radius
- Black hole → ~10 R_s, so the photon ring and lensed background stay in frame. Framing a bare
  30 km R_s would show nothing.

Manual wheel zoom stays and breaks away from auto-fit; a re-center control snaps back. Wheel steps
map to a constant *ratio* in log space — the current code adds a linear delta to a multiplicative
transform, which is the runaway feel. Hard clamps at both ends.

**Brace for the collapse.** A 30 M☉ supergiant (~1000 R☉) → ~10 M☉ black hole (R_s ≈ 30 km ≈
4×10⁻⁵ R☉) is **7.4 orders of magnitude**. Log-space easing is the only thing that works.

**Size scale** is a vertical ruler on the left: 1-2-5 ticks, auto unit switching (km → R☉ → AU),
ticks slide while labels snap to nice values. Reference markers drawn when in range: Earth radius,
Jupiter radius, 1 R☉, 1 AU, Jupiter's orbit; R_s and the photon sphere for black holes.

---

## Stage visuals

Continuous phases need no special handling once the physics is right — Hurley gives smooth
L, R, T_eff throughout, so MS → subgiant → giant is continuous swelling and reddening. Only three
moments are genuinely discontinuous, and they are **events with duration**, not stage swaps:

| Event | Real duration | Appearance |
|---|---|---|
| Post-AGB → planetary nebula | ~10⁴ yr | Envelope detaches; exposed core heats 5,000 → 30,000 K until it ionizes the shell from inside |
| Supernova | hours → weeks | Shock breakout flash, then expanding photosphere |
| Core collapse → remnant | seconds | 7 orders of magnitude of radius |

Archetypes share one HDR → bloom → filmic tonemap chain, cross-faded by weight:

- **Star** — limb darkening (dot product against surface normal, raised to a power matching the
  empirical solar law), granulation from 3D simplex/fBm noise. **Granule size scales with `log g`**:
  the Sun has millions of small cells, a red giant a handful of enormous ones. One uniform, and it
  makes giants read as giant rather than as a bigger orange ball.
- **AGB** — dusty wind that progressively self-obscures and reddens, driven by mass-loss rate.
- **Planetary nebula** — expanding ionized shell lit from within by the exposed core.
- **White dwarf** — small, hot, no granulation (radiative surface), slow multi-Gyr fade.
- **Neutron star** — hot point source; optional pulsar beams.
- **Black hole** — backward geodesic integration in the fragment shader. Shadow at 5.2 R_s;
  photon sphere at 1.5 R_s appears to a distant observer at ~2.6 R_s. Rendered as an isolated
  remnant: a pure lensing shadow against a gravitationally lensed starfield, which is what a
  companionless stellar-mass black hole actually looks like. **No accretion disk** — see Deferred.

Reference implementation measured at **121 fps, 1039×898**, hundreds of curved ray steps per pixel,
in this same browser. Geodesic tracing is affordable for a single object.

### three.js scope

Used as plumbing, not as a renderer. The distinction matters for keeping the dependency honest.

**Used:** linear working color space with `outputColorSpace` conversion at output; `HalfFloatType`
render targets; `EffectComposer` for the bloom → ACES filmic tonemap chain; render-target, resize,
and DPR management; context-loss handling.

**Not used:** scene graph, meshes, lights, materials, shadows, loaders, animation system. Every
archetype is a `ShaderMaterial` on a fullscreen quad, and all appearance is custom GLSL.

**Explicitly not helped by three:** the camera. Everything is screen-space with scale as a uniform,
so the log-space 8-order-of-magnitude zoom is custom regardless.

---

## Phases

| # | Scope | Verifiable when |
|---|---|---|
| 0 | Vite + TS + Vitest, ESM, drop jQuery, vendor font. Logic ported verbatim, bugs intact. | App behaves identically; `npm run dev` works |
| 1 | Domain extraction: pure `evolve()`, single-pass, branded units. Fix the six bugs. Old renderer still attached. | Sun classifies G2V; WD from 1 M☉ ≈ 0.55 M☉; mass drops on the giant branch |
| 2 | Tout ZAMS + Hurley tracks + metallicity + blackbody color. | Validated vs. ported tables, Sun at 4.57 Gyr (L=1.00, R=1.00, T=5772 K), continuity at every phase boundary |
| 2b | Hurley MS perturbation terms + giant-branch machinery. See "Phase 2 status". | Sun classifies G2V at 4.57 Gyr; giant branch reaches realistic tip luminosity |
| 3 | three.js + EffectComposer HDR pipeline, log-space camera, archetypes. | Resize keeps the star centered; collapse traverses 7 orders smoothly |
| 4 | `computeTrack`, warped timeline, bookmarks, adaptive pacing, size scale. | PN phase is visible during full-lifecycle playback |
| 5 | Sliders, readout, SVG HR diagram with moving marker. | — |
| 6 | URL state, keyboard, reduced-motion, a11y. | — |

---

## Phase 2 status

Landed and validated:

- **Tout (1996) ZAMS**, metallicity-dependent L and R. Reproduces the zero-age Sun at
  L = 0.698, R = 0.888, T = 5598 K (real ≈ 5620 K).
- **Hurley (2000) timescales** — t_BGB and the main-sequence hook fraction. Sun 11.0 Gyr,
  5 M☉ 104 Myr, 30 M☉ 5.81 Myr against a real ≈ 6 Myr. The Hertzsprung gap is now the real
  t_BGB − t_MS rather than a hardcoded 10% of the main sequence.
- **Hurley terminal-age anchors** L_TMS and R_TMS. The Sun brightens ~3x and swells ~1.8x across
  its main sequence, against the 5.6% the previous engine gave.
- **Metallicity** threaded through every fit as ζ = log10(Z/Z☉), exposed as [Fe/H].
- **Blackbody colour** — Planck spectrum integrated against the CIE 1931 observer (Wyman, Sloan &
  Shirley 2013 analytic fit), to linear sRGB. Validated against published Planckian locus
  coordinates from 2856 K to 20000 K. Emits linear-light values for the phase-3 HDR pipeline.
- **Coefficient extraction is mechanical**, not transcribed: `scripts/extract-sse-coefficients.mjs`
  parses all 509 published constants and fails loudly on any count mismatch.
- **Phase-boundary continuity** asserted at 0.8, 1, 2, 5 and 12 M☉.

Deferred to 2b:

- **MS perturbation terms** (Hurley's α, β, η and the hook corrections). Without them the main
  sequence is a log-space interpolation between the ZAMS and terminal-age anchors, which grows the
  radius too fast early. Consequence: the Sun reads 5540 K / G5V at 4.57 Gyr instead of
  5772 K / G2V. Both endpoints are correct; only the path between them is approximate.
- **Giant-branch machinery** (the GB parameter block, core-mass–luminosity relation, t_inf
  timescales). The giant phase duration is currently a fraction of t_BGB and its tip luminosity is
  far below the real RGB tip, which in turn understates Reimers mass loss.
- **Unverified:** the terminal-age luminosity at low metallicity. At [Fe/H] = −1.5 a 1 M☉ star
  gets L_TMS = 7.7 L☉, a factor of 5 above its ZAMS value against 3x at solar. That may be
  legitimate — the star sits above M_hook there, and the hook steepens at low Z — but it is the
  least-corroborated number in the engine and wants checking against a published isochrone.

### Provenance note (see also: Scientific verification backlog)

The published coefficients were cross-checked against `zdata.h` from a GPL-3.0 reference
implementation. The constants themselves are paper data (Tout 1996 Table 1; Hurley 2000 Appendix)
and the formulae are published mathematics; the TypeScript here is an independent implementation,
not a translation of that source, and no GPL code is vendored. Flagging it so the licensing
position is on the record rather than assumed.

---

## Scientific verification backlog

**Nothing in this list is known to be wrong.** It is the set of values that are currently
*uncorroborated* — carried over, approximated, or validated only against a single anchor. The
engine passes 56 tests, but a passing test only proves agreement with what was asserted, and
several of these were asserted from the same reasoning that produced the code.

Deferred deliberately so it can be done in one focused pass rather than piecemeal.

### Strategy

The cheapest high-value move is an **independent oracle**. Generate a reference grid over
(M, Z, age) → (L, R, T_eff, phase) from PySSE, COSMIC or a MIST/PARSEC isochrone set, commit it as
a fixture, and diff the engine against it. That converts most items below from "reason about it"
into "run the comparison", and it catches coefficient-assembly errors that self-consistent tests
cannot. Note the licensing position in the provenance note above: generated *output* is data, which
is a different question from vendoring source.

### Specific items

| Area | What is uncorroborated | Check against |
|---|---|---|
| Low-Z terminal age | L_TMS = 7.7 L☉ for 1 M☉ at [Fe/H] = −1.5, a 5x rise on ZAMS versus 3x at solar | Published isochrone at matching Z; globular-cluster turnoff luminosities |
| Present-day Sun | 5540 K / G5V at 4.57 Gyr instead of 5772 K / G2V | Resolves with the 2b perturbation terms — reconfirm afterwards |
| Giant branch | Tip luminosity far below the real RGB tip; duration is `0.15 × t_BGB`, a stand-in and not a fit | Hurley GB machinery (2b), then RGB tip L for a solar-mass star |
| Mass loss | Reimers only, with η = 0.4. No hot-star radiative winds, no dust-driven AGB winds. Magnitude understated because it scales with the depressed tip luminosity | Vink et al. for OB winds; total RGB mass loss ≈ 0.2–0.3 M☉ for the Sun |
| White dwarf IFMR | Kalirai et al. (2008) applied across the whole 0.1–8 M☉ range, beyond its calibrated span | Catalán et al. / Cummings et al. IFMRs at the extremes |
| Neutron star mass | Linear interpolation 1.25 → 2.0 M☉ over an 8–25 M☉ progenitor range. Invented, not fitted | Observed NS mass distribution; Hurley remnant prescription |
| Black hole mass | `max(3, 0.3 × M_initial)`. Invented | Fryer et al. fallback prescriptions; observed BH mass function |
| WD cooling | Mestel `L ∝ M·t^(−7/5)` with a 10⁻³ Gyr floor. Spot-checked at 1 and 10 Gyr only | Bergeron / Fontaine cooling tracks |
| NS cooling | `T ∝ t^(−1/6)`, crude; radius fixed at 11 km independent of mass | Modified-URCA cooling curves; NS mass–radius relations |
| Spectral boundaries | Class temperature ranges carried over unchanged from the original engine, never checked against a published calibration | Pecaut & Mamajek modern MK sequence |
| Luminosity classes | Ia0/I/II/III cut at 10⁶/10⁴/5×10³ L☉ — arbitrary thresholds inherited from the original | MK luminosity-class calibration |
| Colour | Wyman analytic CMF fit validated to ~1 decimal place on the Planckian locus | Full CIE 1931 tabulated observer, if tighter agreement is wanted |
| Zero-age Sun | ZAMS T = 5598 K against a real ≈ 5620 K — agrees, but on a single point | Broader ZAMS comparison once the oracle grid exists |

Two structural notes: the ported PHP tables are **not** a trustworthy oracle — they are MESA output
from a flaky run, with radii below ~0.7 M☉ already demonstrated wrong and the L/T/Y rows flagged as
copied placeholders. And the HR diagram arriving in phase 5 is itself a verification tool: a wrong
track shape is far more obvious plotted than tabulated, so revisit this list once it exists.

---

## Deferred

**External phenomena as an evolution parameter.** Interaction effects — mass transfer, accretion,
common envelope, tides, mergers — and the stellar outliers they produce (blue stragglers, stripped
stars, Type Ia progenitors, X-ray binaries). Accretion disks belong here, not in the single-star
renderer, since a disk implies a donor.

This is deferred, not designed for. Per YAGNI, `evolve(mass, Z, age)` stays a three-argument pure
function; no speculative hooks, no options bag.

Worth knowing, though: the phase-2 choice already lands on the right foundation. Hurley, Tout & Pols
(2002) — "BSE" — is the binary-star extension of the *same* analytic framework as the Hurley (2000)
tracks being adopted here, by the same authors. It layers interaction on top of the single-star
formulae rather than replacing them. So when this feature arrives it extends the existing engine
against a published model, instead of needing a different foundation. That is a real payoff of
picking Hurley over a bespoke model, and it costs nothing today.

---

## Risks

**Hurley transcription.** Several hundred hardcoded coefficients; a mistyped digit yields plausible
wrong numbers. Mitigated in phase 2 by the ported PHP tables as ZAMS fixtures across all 60
spectral-type × luminosity-class rows, the solar checkpoint, and monotonicity/continuity assertions
at every phase boundary.

**Warp tuning is empirical.** `α` and `ε` will need visual iteration. Expose them in a dev panel.

**Track recompute on slider drag.** Hurley is analytic and fast, but bookmark discovery with
bisection is not free. Debounce, cache per (M, Z), and move to a Web Worker if it hitches.

**WebGL context loss.** three's `WebGLRenderer` covers most of it; still needs an explicit
`webglcontextlost`/`restored` path. No 2D fallback — WebGL2 is effectively universal and
maintaining two renderers is a bad trade. Clear "WebGL2 required" message instead.

**three.js version churn.** Color management and postprocessing APIs have changed materially between
revisions (notably r152's color-space overhaul). Pin the exact version; treat upgrades as deliberate
work, not routine dependency bumps.

**Bundle size.** ~150KB gzipped after tree-shaking. Acceptable, but only because it is buying the
HDR/color pipeline — if that stops being true, the dependency stops being justified.

---

## References

- Tout, Pols, Eggleton & Han (1996) — ZAMS L(M,Z), R(M,Z) rational fits
- Hurley, Pols & Tout (2000) — analytic evolution tracks, 0.1–100 M☉, Z = 10⁻⁴–0.03
- James, von Tunzelmann, Franklin & Thorne (2015), arXiv:1502.03808 — Double Negative
  gravitational renderer; ray-bundle propagation through curved spacetime
- EHT Collaboration (2019), ApJL 875 L4 — photon ring and shadow geometry
- Hurley, Tout & Pols (2002), MNRAS 329, 897 — "BSE", the binary/interaction extension of the
  above tracks. Deferred; recorded here so the extension path is on file.
