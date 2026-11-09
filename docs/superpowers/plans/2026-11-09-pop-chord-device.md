# Pop Art Chord Device Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox syntax.

**Goal:** Ship a static Pop Art webcam chord device with MediaPipe finger-count gestures and Web Audio.

**Architecture:** Single-page static site; Hand Landmarker CDN; Web Audio synthesis; mirrored camera in explosion frame at 65% viewport.

**Tech Stack:** HTML/CSS/JS, MediaPipe Tasks Vision HandLandmarker, Web Audio API.

## Global Constraints
- Spec: `docs/superpowers/specs/2026-11-09-pop-chord-device-design.md`
- Finger map and UI rules from spec are mandatory
- Pattern reference: `/workspace/smoking-gesture-game` for MediaPipe load + hand helpers
- No npm build; bilingual ZH hints OK

### Task 1: Scaffold + Pop Art UI shell
**Files:** Create `index.html`, `styles.css`, stub `app.js`, README, launchers

### Task 2: Chord state + Web Audio + panel/keyboard
### Task 3: Camera + MediaPipe + finger shape detection (1–7)
### Task 4: Wire gestures to chord play + polish + zip
