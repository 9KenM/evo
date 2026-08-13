# Known defects

Things that are wrong, or unverified, and not yet fixed. Entries are removed when fixed rather than
struck through — the git history is the record of what was here.

Ordered by phase, then by how much they distort what the user sees.

---

## Physics

### Third dredge-up is not implemented
The initial–final mass relation is emergent now, which makes it testable, and it comes out
systematically heavy: +4% at 1 M☉ rising to +29% at 6 M☉.

| M_i | model M_f | Kalirai |
|---|---|---|
| 1 | 0.522 | 0.503 |
| 3 | 0.834 | 0.721 |
| 5 | 1.167 | 0.939 |
| 6 | 1.350 | 1.048 |

Hurley cuts secular core growth on the thermally pulsing AGB by `λ = min(0.9, 0.3 + 0.001·M⁵)`, and
the bias tracks λ almost exactly — at 1 M☉ λ = 0.30 against a 4% error, at 5 M☉ λ = 0.9 against 24%.
The core keeps growing when 90% of that growth should be cancelled. Fix is localised to the TPAGB
branch in `track.ts`.

### The solar track reaches present-day values ~15% late
L = 1.02, R = 1.01, T = 5777 K arrive at **5.27 Gyr** rather than 4.57. The values along the track
are right; where they fall in time is not. Suspect the early main sequence brightens too slowly.
Needs an isochrone comparison rather than a single-point tweak.

### Red supergiant radii run large
Betelgeuse predicts ~1050 R☉ against an observed 640–764 — the error grows with luminosity, since
Antares is +8% and the giants under 5%. Three causes are tangled: the fits predate recent downward
revisions to RSG radii, Betelgeuse's own distance/mass/radius are disputed, and a pulsating extended
atmosphere has no single radius. Recorded in `observed.test.ts` as a bounded expectation rather than
a passing check.

### Neutron star cooling is a stand-in
`T ∝ t^(−1/6)` with the radius fixed at 11 km independent of mass. Neutrino cooling dominates the
first ~10⁵ yr and is far faster than this. Untouched by 2b.

### Luminosity-class thresholds are arbitrary
Ia0/I/II/III cut at 10⁶/10⁴/5×10³ L☉, inherited from the original engine and never checked against
an MK calibration.

### Low-metallicity terminal age is uncorroborated
`L_TMS = 7.7 L☉` for 1 M☉ at [Fe/H] = −1.5, a 5× rise on ZAMS against 3× at solar. May be
legitimate — the star sits above M_hook there and the hook steepens at low Z — but it is the
least-corroborated number in the engine.

### The spectral scale is the dwarf sequence, applied to giants
Pecaut & Mamajek's table is for class V. A G8III is cooler than a G8V, so evolved stars carry a
systematic subtype offset. Fixing it needs separate per-luminosity-class temperature scales.

---

## Rendering (phase 3)

### Hot stars clip to flat white
`EXPOSURE_COMPENSATION = 0.8` leaves the disk at `1.1 × radiance^0.2`. The Sun lands at 1.1, just
under the ACES knee as designed, but an O6V at 38,500 K lands at 5.0 — 4.5× over — and hard-clips.
An O star and a G star render as the same white blob while the timeline strip directly beneath them
correctly shows one blue and one white. The two surfaces disagree.

### Granulation degenerates into a hard seam at very low surface gravity
At a 30 M☉ supergiant (log g ≈ −2.15) `uGranuleScale` works out to 0.089, below one noise cycle
across the disk, so it renders as a straight horizontal edge splitting the disk into two flat tones.
The log-g coupling is right; it needs a floor.

---

## UI

### Size-scale margins duplicate layout knowledge
`TOP_MARGIN = 48` and `BOTTOM_MARGIN = 150` in `sizeScale.ts` are hardcoded pixel values that must
track the controls bar and transport heights in CSS. They will drift.

### `1 AU = 215.03 R☉` is defined in three places
`lifecycle.ts`, `format.ts`, `sizeScale.ts`. Should be one constant in `domain/constants.ts`.

---

## UI, phases 5–6

### Keyboard seeks during the rebuild debounce act on the previous track
Changing mass or metallicity defers the track rebuild by 120 ms. An arrow-key seek inside that window
reads the outgoing track, so it lands somewhere on the old one; the age is then clamped into the new
track's range. Harmless in practice — nobody presses an arrow within 120 ms of releasing a slider —
but it is a real inconsistency, and the fix is to make the seek helpers rebuild synchronously first.

### The HR diagram samples the white dwarf coarsely
Path samples are uniform in warped position, so the white dwarf gets its allocated ~12% regardless of
how much happens in it. Its first few thousand years drop it two decades in luminosity, which is
drawn as one long straight segment rather than the curve it actually follows. Correct topology,
approximate shape, and only visible on a 190px panel.

---

## Testing

### No independent reference grid
Everything is checked against published *anchor points* — the Sun, the RGB tip, a handful of observed
stars — rather than against an independent model across (M, Z, age). A PySSE / COSMIC / MIST grid
committed as a fixture is the only thing that would check the fits across metallicity, which
currently nothing does. The plan says to build it before the 2b physics; it was skipped, and the
IFMR bias above is exactly the kind of error it would have caught immediately.
