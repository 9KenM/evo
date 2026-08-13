# Stellar Evolution Simulator — Plan

Phases 0–6 are complete. Phase 7 is the remaining scope. Open issues live in `DEFECTS.md`; this
document is the design and the reasoning behind it.

## Decisions locked

| Decision | Choice |
|---|---|
| Physics | Tout et al. (1996) ZAMS + Hurley, Pols & Tout (2000) analytic tracks |
| Lifecycle start | ZAMS (Hurley's domain start). No pre-main-sequence. |
| Language | TypeScript, branded unit types in the domain layer |
| Renderer | WebGL2 via three.js, used as plumbing only — all appearance in custom shaders |
| Time control | Play/pause + log speed slider, adaptive pacing on by default |

---

## Architecture

```
src/
  domain/              # pure, zero DOM, fully testable
    units.ts           # branded types: SolarMasses, Gyr, MsunPerYear
    zams.ts            # Tout et al. 1996
    mainSequence.ts    # Hurley MS perturbation terms
    giantBranch.ts     # xg/xh decode, GB/CHeB/AGB fits
    massLoss.ts        # max-of-five wind prescriptions
    postAGB.ts         # Miller Bertolami crossing
    track.ts           # phase timeline, wind integration, Fryer remnants
    lifecycle.ts       # computeTrack() -> LifecycleTrack
    classify.ts        # spectral type + luminosity class
    color.ts           # blackbody -> CIE XYZ -> linear sRGB
  data/
    sse-coefficients.json
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

Simulation and DOM writes stay out of the render loop. Domain gets no knowledge that a canvas exists.

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

One function drives both the timeline's non-linear axis and the playback pacing.

**The problem.** For a 1 M☉ star: MS ≈ 10 Gyr, Hertzsprung gap ≈ 30 Myr, planetary nebula ≈ 10 kyr.
Playing 12 Gyr over 60 seconds at constant rate gives the PN phase **0.00005 seconds** — it never
renders a single frame. A constant-rate slider cannot show the full lifecycle at any setting.

**Log time does not fix this.** The rapid changes are at the *end* of life, and a log axis compresses
exactly there. On a log axis from 1 Myr to 12 Gyr, the post-MS 2 Gyr occupies 1.9% of the width —
worse than the 17% a linear axis gives it.

**The shipped design: fixed shares per phase, warped within each phase.** A single warp integral
across the whole track was built first and failed — "typical rate" is not a meaningful quantity
across a track whose interval durations span orders of magnitude, so the result was either flat or
erratic depending on the softening. Instead `PHASE_SHARES` allocates a fixed fraction of the strip to
each phase, normalised over the phases a given star actually has; inside each phase, width is
distributed by local rate of change of `(ln L, ln R, ln T_eff)`. Every phase is guaranteed visible at
every mass — the 30 M☉ Hertzsprung gap goes from 0.09% of real time to 14% of the strip.

The cost is real and worth stating: the strip no longer encodes relative duration. The age ticks
carry that instead, bunching wherever time is compressed, the way ticks bunch on a log axis. This is
correct and readable.

The knobs, all scoped inside a phase rather than across phases:

- `WARP_SOFTENING = 0.6` — exponent applied to the rate of observable change. At 1 the fastest
  moment in a phase swallows the phase.
- `WARP_FLOOR_QUANTILE = 0.3` — quiescent floor, taken as a quantile of *that phase's own* softened
  rates. Per-phase is what makes the floor meaningful.
- `WARP_CEILING = 30` — cap on any single interval, as a multiple of its phase's floor.

Playback advances the warped coordinate at a constant rate, so screen time matches each phase's
allocated share. Toggling adaptive pacing off makes the speed slider a fraction of the track per
second. Measured over a full solar-mass playback:

| main sequence | HG | giant branch | CHeB | E-AGB | TP-AGB | nebula | white dwarf |
|---|---|---|---|---|---|---|---|
| 617 | 166 | 290 | 290 | 166 | 166 | **207** | 249 |

frames. The nebula is 30 kyr out of a 22.5 Gyr track — one part in 750,000 — and at constant rate
would get less than a single frame at any speed that made the main sequence watchable.
`lifecycle.test.ts` asserts both halves of that.

---

## Lifecycle bookmarks

Bookmarks are **generated, not authored** — Hurley classifies phase by its stellar type index, so
transitions fall out of the model.

### The single-star phase set

| k | Phase | Single star? |
|---|---|---|
| 0 | Low-mass MS, deeply or fully convective (M ≲ 0.7) | yes |
| 1 | Main sequence | yes |
| 2 | Hertzsprung gap | yes |
| 3 | First giant branch (RGB) | yes |
| 4 | Core helium burning | yes |
| 5 | Early AGB | yes |
| 6 | Thermally pulsing AGB | yes |
| 7–9 | Naked helium star (MS / HG / GB) | **both** — binary stripping, *or* self-stripping by LBV and Wolf–Rayet winds above ~25–30 M☉ |
| 10 | Helium white dwarf | no — needs the RGB truncated before the helium flash, which for a single star does not happen |
| 11 | CO white dwarf | yes |
| 12 | ONe white dwarf | yes, from M_c,BAGB > 2.25 (roughly 6–8 M☉ progenitors) |
| 13 | Neutron star | yes |
| 14 | Black hole | yes |
| 15 | Massless remnant | bookkeeping only in SSE; not reachable in the modelled range |

Two of these contradict the obvious reading. **Types 7–9 are not binary-only** — a single star above
roughly 25–30 M☉ strips its own envelope through its winds, which is inside this app's mass range.
And **type 0 is not cosmetic**: a fully convective star never ascends a giant branch at all. It burns
hydrogen for ~10¹³ yr and that is the whole story.

So single-star evolution has **seven burning phases, not three**.

### Derived bookmarks

Peak luminosity, maximum radius, RGB tip, helium flash, AGB tip, nebula ionisation (T_eff crosses
~30,000 K), and **"Earth engulfed"** (R > 1 AU) — that last one is the most engaging marker on a
1 M☉ track.

Two constraints the implementation depends on. Deduplication compares `warp()` values rather than
ages, because an age window scaled to total lifetime is wider than whole phases at high mass.
Discovery uses a coarse pass plus bisection wherever the phase index changes: a uniform 10,000-point
sweep across 12 Gyr has 1.2 Myr spacing and steps straight over a 10 kyr PN phase.

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
- Black hole → ~10 R_s, so the photon ring and lensed background stay in frame

Manual wheel zoom breaks away from auto-fit; a re-center control snaps back. Wheel steps map to a
constant *ratio* in log space, with hard clamps at both ends.

**Brace for the collapse.** A 30 M☉ supergiant (~1000 R☉) → ~10 M☉ black hole (R_s ≈ 30 km ≈
4×10⁻⁵ R☉) is **7.4 orders of magnitude**. Log-space easing is the only thing that works.

**Size scale** is a vertical ruler on the left: 1-2-5 ticks, auto unit switching (km → R☉ → AU),
ticks slide while labels snap to nice values. Reference markers when in range: Earth radius, Jupiter
radius, 1 R☉, 1 AU, Jupiter's orbit; R_s, photon sphere and shadow radius for black holes.

---

## Stage visuals

Continuous phases need no special handling now that the physics is right — Hurley gives smooth
L, R, T_eff throughout. Only three moments are genuinely discontinuous, and they are **events with
duration**, not stage swaps:

| Event | Real duration | Appearance |
|---|---|---|
| Post-AGB → planetary nebula | ~10⁴ yr | Envelope detaches; exposed core heats 5,000 → 30,000 K until it ionizes the shell from inside |
| Supernova | hours → weeks | Shock breakout flash, then expanding photosphere |
| Core collapse → remnant | seconds | 7 orders of magnitude of radius |

Archetypes share one HDR → bloom → filmic tonemap chain, cross-faded by weight:

- **Star** — limb darkening, granulation from 3D simplex/fBm noise. **Granule size scales with
  `log g`**: the Sun has millions of small cells, a red giant a handful of enormous ones. One
  uniform, and it makes giants read as giant rather than as a bigger orange ball.
- **AGB** — dusty wind that progressively self-obscures and reddens, driven by mass-loss rate.
- **Planetary nebula** — expanding ionized shell lit from within by the exposed core.
- **White dwarf** — small, hot, no granulation (radiative surface), slow multi-Gyr fade.
- **Neutron star** — hot point source; optional pulsar beams.
- **Black hole** — backward geodesic integration in the fragment shader. Shadow at 5.2 R_s; photon
  sphere at 1.5 R_s appears to a distant observer at ~2.6 R_s. Rendered as an isolated remnant: a
  pure lensing shadow against a lensed starfield, which is what a companionless stellar-mass black
  hole actually looks like. **No accretion disk** — a disk implies a donor; see Deferred.

### three.js scope

Used as plumbing, not as a renderer.

**Used:** linear working color space with `outputColorSpace` conversion at output; `HalfFloatType`
render targets; `EffectComposer` for the bloom → ACES filmic tonemap chain; render-target, resize,
and DPR management; context-loss handling.

**Not used:** scene graph, meshes, lights, materials, shadows, loaders, animation system. Every
archetype is a `ShaderMaterial` on a fullscreen quad, and all appearance is custom GLSL.

**Explicitly not helped by three:** the camera. Everything is screen-space with scale as a uniform,
so the log-space 8-order-of-magnitude zoom is custom regardless.

---

## Phases

| # | Scope | Status |
|---|---|---|
| 0 | Vite + TS + Vitest, ESM, drop jQuery | Met |
| 1 | Domain extraction: pure `evolve()`, branded units, six ported bugs fixed | Met |
| 2 | Tout ZAMS + Hurley tracks + metallicity + blackbody color | Met |
| 2b | Post-MS rewrite: GB machinery, CHeB/EAGB/TPAGB, post-AGB, mass-loss set, remnants from M_CO, MS perturbation terms | Met |
| 3 | three.js + EffectComposer HDR pipeline, log-space camera, archetypes | Met; two shader defects open |
| 4 | `computeTrack`, warped timeline, bookmarks, adaptive pacing, size scale | Met |
| 5 | Sliders, readout, SVG HR diagram with moving marker | Met |
| 6 | URL state, keyboard, reduced-motion, a11y | Met |
| 7 | Discontinuous-event animation | **Next** |

---

## Phase 7 — animating the sharp transitions

**This is a presentation concern and it must stay one.** The domain gets no synthetic durations, no
eased radii, and no invented intermediate states to make an animation land. If a transition is
instantaneous in the physics, it stays instantaneous in `evolve()`, and the renderer is what gives it
screen time. The moment the domain starts stretching time to look good, every number the readout
prints becomes untrustworthy.

**Continuous but fast — already solved.** The post-AGB crossing (~10⁴ yr), envelope ejection, and the
white dwarf's early cooling are genuinely continuous, and the phase-4 warp magnifies them
automatically. These need no animation work.

**Genuinely discontinuous — the actual scope.** Two cases:

| Event | Physical duration | What is actually observed |
|---|---|---|
| Core collapse → supernova | seconds | Shock breakout flash over hours, then an expanding photosphere over weeks to months |
| Envelope loss → naked helium star | continuous in mass, but dR/dt is extreme | Photosphere jumps from ~3,000 K and ~10³ R☉ to ~10⁵ K and a few R☉ |

The supernova is the clean case for the rule above: the *collapse* is seconds and unobservable, while
the *observable* is a shock breakout and an expanding photosphere lasting weeks. The renderer should
model the observable, not the collapse. Self-stripping is subtler — with correct winds the mass
really does decline smoothly, but the surface conditions cross so fast that a handful of samples
separate a red supergiant from a Wolf–Rayet star. (The naked-helium-star track itself is still
missing from the domain; see `DEFECTS.md`.)

Design constraints, so this stays honest:

- **Events are derived, not scripted.** The renderer keys off the domain's phase index and a
  normalised progress through the event, the same way archetypes already cross-fade by weight.
- **Screen duration is a presentation constant, decoupled from sim time.** An event may occupy two
  seconds of wall clock while representing three weeks or three seconds of stellar time.
- **The clock never lies.** The age readout and the timeline playhead keep showing true simulation
  time. If an event is being stretched for legibility, that is visible as the playhead sitting still,
  which is the honest depiction.
- **The timeline needs a glyph for zero-width events.** A phase band cannot represent an instant.
  Core collapse wants a mark on the strip, not a slice of it.

---

## Validation

The ported PHP tables are **not** an oracle. They are class-V dwarfs only, they are MESA output from a
flaky run with radii below ~0.7 M☉ demonstrated wrong, and nothing past the main sequence is a dwarf.
They must not be extended to try.

**The observed-star oracle** (`src/domain/observed.test.ts`) is the replacement, and it is shaped to
avoid circularity. Rather than asking whether a track reaches some state at some age — which needs an
age, and stellar ages are themselves model-derived — it asks the question the fits can answer on
their own: *given this star's measured mass and measured luminosity, does the model predict its
measured radius?* Radius is the right target because for giants it is an angular diameter and a
parallax, so it is the least model-contaminated number available; luminosity is an input, not a
prediction, which is what keeps the check honest.

Current agreement, all single (or wide, non-interacting) stars:

| Star | Phase | Model vs observed |
|---|---|---|
| Arcturus | first giant branch | radius +4.4% |
| Aldebaran | first giant branch | radius +4.3% |
| Antares | red supergiant | radius +8.2% |
| Pollux | red clump | luminosity +20% (a full prediction, not a fit) |
| Proxima Centauri | lower MS | radius +2%, luminosity −1% |
| Barnard's Star | lower MS | radius −8%, luminosity −26% |
| 61 Cygni A | lower MS | radius −2%, luminosity −17% |
| α Centauri B | lower MS | radius −7%, luminosity −13% |

Arcturus and Aldebaran agreeing to under 5% is inside Hurley's own quoted accuracy and is strong
evidence the coefficient block is decoded correctly. The lower-main-sequence rows are the direct
replacement for the excluded fixtures — the tables gave a 0.5 M☉ star a mean density 0.59x solar,
where these real dwarfs are several times denser than the Sun.

Stars to add as later phases arrive: Procyon A for the Hertzsprung gap, χ Cygni for the thermally
pulsing AGB, and Sirius B / 40 Eridani B / Procyon B for white dwarf cooling.

**The missing oracle is a reference grid** over (M, Z, age) → (L, R, T_eff, phase) from PySSE, COSMIC
or a MIST/PARSEC isochrone set, committed as a fixture. It is the only thing that would check the fits
across metallicity, which currently nothing does. The plan called for building it before the 2b
physics; it was skipped, and the IFMR bias recorded in `DEFECTS.md` is exactly the kind of error it
would have caught immediately.

### Provenance note

The published coefficients were cross-checked against `zdata.h` and `zcnsts.f` from a GPL-3.0
reference implementation. The paper's appendix and the reference source express the *same* coefficient
set in different arrangements, and resolving which `xg` or `xh` constant feeds which published
b-coefficient is far more reliable read off the reference than reconstructed from the appendix's prose
ordering. That indexing is a fact about the published data. The constants themselves are paper data
(Tout 1996 Table 1; Hurley 2000 Appendix), the formulae are published mathematics, the TypeScript is
an independent implementation, and no GPL code is vendored. Flagging it so the licensing position is
on the record rather than assumed.

---

## Deferred

**External phenomena as an evolution parameter.** Interaction effects — mass transfer, accretion,
common envelope, tides, mergers — and the stellar outliers they produce (blue stragglers, stripped
stars, Type Ia progenitors, X-ray binaries). Accretion disks belong here, not in the single-star
renderer, since a disk implies a donor.

This is deferred, not designed for. Per YAGNI, `evolve(mass, Z, age)` stays a three-argument pure
function; no speculative hooks, no options bag.

Worth knowing, though: Hurley, Tout & Pols (2002) — "BSE" — is the binary-star extension of the
*same* analytic framework, by the same authors. It layers interaction on top of the single-star
formulae rather than replacing them, so when this feature arrives it extends the existing engine
against a published model. That is a real payoff of picking Hurley, and it costs nothing today.

---

## Risks

**WebGL context loss.** three's `WebGLRenderer` covers most of it; still needs an explicit
`webglcontextlost`/`restored` path. No 2D fallback — WebGL2 is effectively universal and maintaining
two renderers is a bad trade. Clear "WebGL2 required" message instead.

**three.js version churn.** Color management and postprocessing APIs have changed materially between
revisions (notably r152's color-space overhaul). Pin the exact version; treat upgrades as deliberate
work, not routine dependency bumps.

**Bundle size.** ~150KB gzipped after tree-shaking. Acceptable, but only because it is buying the
HDR/color pipeline — if that stops being true, the dependency stops being justified.

---

## References

- Tout, Pols, Eggleton & Han (1996) — ZAMS L(M,Z), R(M,Z) rational fits
- Hurley, Pols & Tout (2000), MNRAS 315, 543 — analytic evolution tracks, 0.1–100 M☉,
  Z = 10⁻⁴–0.03. The type index, the GB/CHeB/AGB machinery, and the mass-loss set
- Miller Bertolami (2016), A&A 588, A25 — post-AGB tracks. The planetary nebula phase, which
  Hurley does not model at all
- Vassiliadis & Wood (1993), ApJ 413, 641 — Mira-pulsation-driven AGB superwind; what terminates
  the AGB and ejects the nebula
- Nieuwenhuijzen & de Jager (1990) — mass loss for luminous stars, L > 4000 L☉
- Humphreys & Davidson (1979) — the empirical upper luminosity boundary
- Fryer, Belczynski, Wiktorowicz et al. (2012), ApJ 749, 91 — compact remnant masses from the CO
  core; the "rapid" and "delayed" prescriptions
- Cummings et al. (2018) / Catalán et al. (2008) — initial-final mass relations, used as an output
  check rather than as the model
- Pecaut & Mamajek (2013) — modern MK spectral sequence
- James, von Tunzelmann, Franklin & Thorne (2015), arXiv:1502.03808 — Double Negative
  gravitational renderer; ray-bundle propagation through curved spacetime
- EHT Collaboration (2019), ApJL 875 L4 — photon ring and shadow geometry
- Hurley, Tout & Pols (2002), MNRAS 329, 897 — "BSE", the binary/interaction extension. Deferred;
  recorded here so the extension path is on file.
