# Pop Art Two-Hand Chord Device — Design Spec

Date: 2026-11-09 (Asia/Hong_Kong)

## Goal
Single-page interactive web chord device: Pop Art comic UI, webcam in a jagged explosion frame (~65% of viewport, centered), MediaPipe hand finger-count gestures select root + quality, Web Audio plays the chord. Click panels and keyboard as fallback.

## Stack
Static `index.html` + `styles.css` + `app.js` (+ optional `audio.js`). MediaPipe Hand Landmarker via CDN (same approach as `/workspace/smoking-gesture-game`). No build step. Local launcher bat/command for camera on secure origin.

## UI (must match reference / prior canvas)
- Pop Art: bright red `#FF1744`, yellow `#FFEA00`, royal blue `#2979FF`, halftone dots, thick black outlines, flat 2D only.
- Top: comic instruction bubble (finger-count mapping).
- Center: comic explosion / starburst frame; camera preview inside; decorations only on frame border; keep camera interior clean for gestures. Frame size ≈ **65% of viewport**, centered.
- Left translucent narrow panel: roots C D E F G A B (do not block hands).
- Right translucent narrow panel: Major, Minor, Maj7, m7, Dom7, Half-dim7.
- Bottom: large selected chord name (e.g. `C Maj7`).
- One page only. Title: Two-Hand Chord Device.

## Gesture mapping (finger shapes)
Mirrored video. Left hand in view = root; right hand = quality.

### Left hand → root
| Shape | Root |
|------:|:-----|
| 1 finger | C |
| 2 | D |
| 3 | E |
| 4 | F |
| 5 | G |
| 6 (Chinese 六: thumb + pinky extended, others folded) | A |
| 7 (Chinese 七: thumb + index + middle tips pinched / forming 七) | B |
| Fist / 0 | no root |

### Right hand → quality
| Shape | Quality |
|------:|:--------|
| 1 | Major |
| 2 | Minor |
| 3 | Maj7 |
| 4 | m7 |
| 5 | Dom7 |
| 6 (thumb + pinky) | Half-dim7 |
| Fist / 0 | no quality |

Stabilize ~400ms before lock. When both root and quality locked, trigger chord. Changing either re-triggers. Soft skeleton overlay optional and faint.

## Audio
Web Audio oscillators (no asset files). Root C3–B3. Intervals:
- Major: 0,4,7
- Minor: 0,3,7
- Maj7: 0,4,7,11
- m7: 0,3,7,10
- Dom7: 0,4,7,10
- Half-dim7: 0,3,6,10
~0.8s decay. Resume AudioContext on first user gesture.

## Fallback
Panel clicks + keyboard. Camera denied → banner, panels still work. MediaPipe fail → click/keyboard only.

## Deliverables
`/workspace/pop-chord-device/` with README, `打開.bat`, `打開.command`, zip for user.
