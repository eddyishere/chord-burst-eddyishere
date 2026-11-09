# Chord Burst

Pop Art comic UI + webcam hand gestures → play chords with Web Audio.

Left hand selects **root** (C–B). Right hand selects **quality** (Major / Minor / Maj7 / m7 / Dom7 / Half-dim7). Stability stack: confidence ≥ 0.6, EMA landmark smoothing, majority-vote buffer, 4-frame hysteresis per hand; audio only when **both** hands are stable. Changing the locked chord re-triggers playback.

## Fastest start

1. Unzip `pop-chord-device.zip`
2. Double-click **`index.html`** — panels + keyboard work immediately (no install)
3. For **camera gestures**, double-click **`打開.bat`** (Windows) or **`打開.command`** (Mac) — starts a tiny local Python server at `http://127.0.0.1:5500/`

Chrome often blocks `getUserMedia` on `file://`. The launchers fix that (Python 3 required).

## Gestures (mirrored selfie view)

### Left hand → root
| Shape | Root |
|------:|:-----|
| 1 finger | C |
| 2 | D |
| 3 | E |
| 4 | F |
| 5 | G |
| 六 (thumb + pinky) | A |
| 七 (thumb + index + middle tips pinched) | B |

### Right hand → quality
| Shape | Quality |
|------:|:--------|
| 1 | Major |
| 2 | Minor |
| 3 | Maj7 |
| 4 | m7 |
| 5 | Dom7 |
| 六 (thumb + pinky) | Half-dim7 |

## Click / keyboard fallback

- Click left pills for roots, right pills for qualities
- Roots: `1`–`7` or `A S D F G H J`
- Qualities: `Q W E R T Y`
- `Space` re-triggers the current chord

## Files

```
pop-chord-device/
├── index.html
├── styles.css
├── app.js
├── audio.js
├── 打開.bat          # Windows local server
├── 打開.command      # Mac local server
├── README.md
└── reference-ui.jpg  # design reference (optional)
```

## Stack

Static HTML/CSS/JS. MediaPipe Hand Landmarker via CDN (jsDelivr / unpkg). Web Audio oscillators only — no sound assets. Video stays on-device.

## Audio intervals

- Major 0,4,7 · Minor 0,3,7 · Maj7 0,4,7,11 · m7 0,3,7,10 · Dom7 0,4,7,10 · Half-dim7 0,3,6,10  
- Roots C3–B3 · ~0.8s decay
