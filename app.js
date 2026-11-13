/**
 * Two-Hand Chord Device — Pop Art UI + MediaPipe Hand Landmarker
 * Left → root · Right → quality · stable dual-hand gate · Web Audio
 *
 * Stability stack (inspired by fingerpose post-filter + EMA landmark smoothing):
 * 1) confidence ≥ 0.5  2) EMA joints  3) majority-vote buffer
 * 4) 2-frame hysteresis per hand  5) both-hands state machine before audio
 */
(function () {
  // Prefer vendored assets (HK-friendly); CDN only as last-resort import fallback
  const MP_LOCAL_BUNDLE = "./vendor/mediapipe/vision_bundle.mjs";
  const MP_LOCAL_WASM = "./vendor/mediapipe/wasm";
  const HAND_MODEL = "./vendor/mediapipe/hand_landmarker.task";
  const MP_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18";
  const MP_CDN_FALLBACK = "https://unpkg.com/@mediapipe/tasks-vision@0.10.18";
  // Detector mins slightly below classify gate so borderline palms still reach JS filter
  const DETECT_MIN = 0.5;
  // Standard 21-landmark hand edges (MediaPipe topology) — used if API constant missing
  const HAND_CONNECTIONS_FALLBACK = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16],
    [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
  ];

  const ROOTS = ["C", "D", "E", "F", "G", "A", "B"];
  const QUALITIES = ["Major", "Minor", "Maj7", "m7", "Dom7", "Half-dim7"];

  // —— Tracking tunables (top-level so they are easy to tweak) ——
  const CONFIDENCE = 0.5;          // ignore HandLandmarker hands below this score
  const HYSTERESIS_FRAMES = 2;     // enter/exit a gesture only after ~2 consistent frames
  const EMA_ALPHA = 0.55;          // landmark blend: higher = snappier, lower = smoother
  const VOTE_BUFFER_SIZE = 3;      // sliding window for majority gesture vote

  const TIP = { THUMB: 4, INDEX: 8, MIDDLE: 12, RING: 16, PINKY: 20 };
  const PIP = { INDEX: 6, MIDDLE: 10, RING: 14, PINKY: 18 };
  const MCP = { INDEX: 5, MIDDLE: 9, RING: 13, PINKY: 17, THUMB: 2 };
  const WRIST = 0;

  const $ = (id) => document.getElementById(id);
  const video = $("webcam");
  const overlay = $("overlay");
  const ctx2d = overlay.getContext("2d");
  const btnStart = $("btn-start");
  const startOverlay = $("start-overlay");
  const loading = $("loading");
  const loadingText = $("loading-text");
  const banner = $("banner");
  const statusPill = $("status-pill");
  const gestureReadout = $("gesture-readout");
  const chordNameEl = $("chord-name");

  let HandLandmarker, FilesetResolver;
  let handLandmarker = null;
  let mpWasmPath = MP_LOCAL_WASM;
  let running = false;
  let lastVideoTime = -1;
  let rafId = 0;

  let lockedRoot = null;
  let lockedQuality = null;
  let lastPlayedKey = "";

  /** Per-hand tracker: EMA + vote buffer + hysteresis (L/R fully independent). */
  function createHandTracker(mode) {
    return {
      mode,                 // "root" | "quality"
      ema: null,            // smoothed landmarks [{x,y,z}, ...]
      votes: [],            // sliding gesture labels (incl. null misses)
      pending: null,        // candidate awaiting hysteresis
      pendingFrames: 0,     // how long pending has held
      stable: null,         // hysteresis-confirmed gesture (or null)
      seenThisFrame: false,
    };
  }
  const leftTracker = createHandTracker("root");
  const rightTracker = createHandTracker("quality");

  function isFileProtocol() {
    return location.protocol === "file:";
  }
  function cameraLikelyBlocked() {
    return (
      isFileProtocol() ||
      !window.isSecureContext ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    );
  }

  function setStatus(text, mode) {
    if (!statusPill) return;
    statusPill.textContent = text;
    statusPill.classList.toggle("live", mode === "live");
    statusPill.classList.toggle("warn", mode === "warn");
  }

  function showBanner(msg) {
    banner.textContent = msg;
    banner.classList.remove("hidden");
  }

  function hideBanner() {
    banner.classList.add("hidden");
  }

  function setLoading(on, text) {
    loading.classList.toggle("hidden", !on);
    if (text) loadingText.textContent = text;
  }

  /** Lead-sheet symbols for the orange chord dock: C, Am, Cmaj7, Am7, C7, Cm7b5. */
  function formatChordSymbol(root, quality) {
    switch (quality) {
      case "Major":
        return root;
      case "Minor":
        return `${root}m`;
      case "Maj7":
        return `${root}maj7`;
      case "m7":
        return `${root}m7`;
      case "Dom7":
        return `${root}7`;
      case "Half-dim7":
        return `${root}m7b5`;
      default:
        return root && quality ? `${root} ${quality}` : "—";
    }
  }

  function updateChordUI() {
    chordNameEl.textContent =
      lockedRoot && lockedQuality
        ? formatChordSymbol(lockedRoot, lockedQuality)
        : "—";

    document.querySelectorAll(".root-pill").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.root === lockedRoot);
    });
    document.querySelectorAll(".quality-pill").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.quality === lockedQuality);
    });
  }

  function maybePlay() {
    if (!lockedRoot || !lockedQuality) {
      lastPlayedKey = "";
      updateChordUI();
      if (window.ChordAudio) ChordAudio.stop();
      return;
    }
    const key = `${lockedRoot}|${lockedQuality}`;
    updateChordUI();
    lastPlayedKey = key;
    if (window.ChordAudio) {
      ChordAudio.resume().then(() => {
        // Ignore if hands/selection cleared while AudioContext was resuming
        if (lastPlayedKey === key) ChordAudio.setChord(lockedRoot, lockedQuality);
      });
    }
  }

  function setRoot(root, fromGesture) {
    if (root === lockedRoot) return;
    lockedRoot = root;
    maybePlay();
    if (!fromGesture && window.ChordAudio) ChordAudio.resume();
  }

  function setQuality(quality, fromGesture) {
    if (quality === lockedQuality) return;
    lockedQuality = quality;
    maybePlay();
    if (!fromGesture && window.ChordAudio) ChordAudio.resume();
  }

  /* ---------- stability helpers ---------- */

  /** EMA on 21 joints — dampens single-frame landmark jitter before classify. */
  function smoothLandmarks(tracker, rawLm) {
    if (!rawLm || !rawLm.length) {
      tracker.ema = null;
      return null;
    }
    if (!tracker.ema || tracker.ema.length !== rawLm.length) {
      tracker.ema = rawLm.map((p) => ({ x: p.x, y: p.y, z: p.z || 0 }));
      return tracker.ema;
    }
    const a = EMA_ALPHA;
    const inv = 1 - a;
    for (let i = 0; i < rawLm.length; i++) {
      const s = tracker.ema[i];
      const r = rawLm[i];
      s.x = a * r.x + inv * s.x;
      s.y = a * r.y + inv * s.y;
      s.z = a * (r.z || 0) + inv * s.z;
    }
    return tracker.ema;
  }

  /** Sliding-window majority vote — prefer persistent labels over one-frame spikes. */
  function majorityVote(tracker, gesture) {
    tracker.votes.push(gesture);
    if (tracker.votes.length > VOTE_BUFFER_SIZE) tracker.votes.shift();
    const counts = Object.create(null);
    let nullN = 0;
    let best = null;
    let bestN = 0;
    for (const g of tracker.votes) {
      if (g == null) {
        nullN += 1;
        continue;
      }
      counts[g] = (counts[g] || 0) + 1;
      if (counts[g] > bestN) {
        best = g;
        bestN = counts[g];
      }
    }
    // Null plurality clears the hand (exit path for lost / fist frames)
    if (nullN > bestN) return null;
    // Need a clear plurality (≥2) so a lone flicker cannot win an empty-ish buffer
    if (bestN < 2 && tracker.votes.length >= 2) return null;
    return best;
  }

  /**
   * Hysteresis / lag gate: switch stable gesture only after HYSTERESIS_FRAMES
   * of the same voted label (including null → clear). Blocks 1-frame flicker.
   */
  function applyHysteresis(tracker, voted) {
    if (voted === tracker.stable) {
      tracker.pending = voted;
      tracker.pendingFrames = HYSTERESIS_FRAMES;
      return tracker.stable;
    }
    if (voted === tracker.pending) {
      tracker.pendingFrames += 1;
    } else {
      tracker.pending = voted;
      tracker.pendingFrames = 1;
    }
    if (tracker.pendingFrames >= HYSTERESIS_FRAMES) {
      tracker.stable = tracker.pending;
    }
    return tracker.stable;
  }

  /** Hand lost this frame — feed null into vote/hysteresis; reset EMA after full exit. */
  function markHandMiss(tracker) {
    tracker.seenThisFrame = false;
    const voted = majorityVote(tracker, null);
    applyHysteresis(tracker, voted);
    if (tracker.stable == null) tracker.ema = null;
  }

  /**
   * Dual-hand chord state machine.
   * Sustained pad ONLY while both trackers have a non-null stable gesture.
   * Chord change retargets the pad; losing either hand fades audio out.
   * Single-hand or single-frame noise never starts audio.
   */
  function chordStateMachine() {
    const root = leftTracker.stable;
    const quality = rightTracker.stable;
    if (gestureReadout) {
      const lr = leftTracker.pending || leftTracker.stable || "—";
      const rr = rightTracker.pending || rightTracker.stable || "—";
      const lock =
        root && quality ? "🔒" : root || quality ? "…" : "—";
      gestureReadout.textContent = `L: ${root || lr} · R: ${quality || rr} ${lock}`;
    }
    if (!root || !quality) {
      // Keep last locked UI for click/keyboard continuity; stop sustained audio.
      if (lastPlayedKey) {
        lastPlayedKey = "";
        if (window.ChordAudio) ChordAudio.stop();
      }
      return;
    }
    lockedRoot = root;
    lockedQuality = quality;
    const key = `${root}|${quality}`;
    updateChordUI();
    if (key === lastPlayedKey) return;
    lastPlayedKey = key;
    if (window.ChordAudio) {
      ChordAudio.resume().then(() => {
        if (lastPlayedKey === key) ChordAudio.setChord(root, quality);
      });
    }
  }

  /* ---------- geometry helpers ---------- */
  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
  }
  function dist2(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function isFingerExtended(lm, tipIdx, pipIdx, mcpIdx) {
    const tip = lm[tipIdx];
    const pip = lm[pipIdx];
    const mcp = lm[mcpIdx];
    const wrist = lm[WRIST];
    return (
      dist(tip, wrist) > dist(pip, wrist) * 0.95 ||
      (tip.y < pip.y - 0.02 && dist(tip, mcp) > dist(pip, mcp) * 0.8)
    );
  }

  function isThumbExtended(lm, handednessLabel) {
    const tip = lm[TIP.THUMB];
    const ip = lm[3];
    const mcp = lm[MCP.THUMB];
    const wrist = lm[WRIST];
    const pinkyMcp = lm[MCP.PINKY];
    const palmWidth = Math.max(0.04, dist2(mcp, pinkyMcp));
    // Away from palm center along hand width
    const palmCenter = {
      x: (lm[MCP.INDEX].x + lm[MCP.PINKY].x) / 2,
      y: (lm[MCP.INDEX].y + lm[MCP.PINKY].y) / 2,
    };
    const away = dist2(tip, palmCenter) > palmWidth * 0.55;
    const outstretched = dist(tip, wrist) > dist(ip, wrist) * 0.95;
    return away && outstretched;
  }

  function fingerFlags(lm, handednessLabel) {
    return {
      thumb: isThumbExtended(lm, handednessLabel),
      index: isFingerExtended(lm, TIP.INDEX, PIP.INDEX, MCP.INDEX),
      middle: isFingerExtended(lm, TIP.MIDDLE, PIP.MIDDLE, MCP.MIDDLE),
      ring: isFingerExtended(lm, TIP.RING, PIP.RING, MCP.RING),
      pinky: isFingerExtended(lm, TIP.PINKY, PIP.PINKY, MCP.PINKY),
    };
  }

  function countNonThumb(f) {
    return [f.index, f.middle, f.ring, f.pinky].filter(Boolean).length;
  }

  function isLiu(f) {
    // 六: thumb + pinky only
    return f.thumb && f.pinky && !f.index && !f.middle && !f.ring;
  }

  function isQi(lm, f) {
    // 七: true pinch — thumb clearly involved + index/middle out, ring/pinky in,
    // tips tightly clustered (stricter than old 1.15× so a plain D "2 fingers"
    // with a nearby thumb does not become B).
    if (!f.thumb || !f.index || !f.middle) return false;
    if (f.ring || f.pinky) return false;
    const tips = [lm[TIP.THUMB], lm[TIP.INDEX], lm[TIP.MIDDLE]];
    const handScale = Math.max(0.05, dist2(lm[WRIST], lm[MCP.INDEX]));
    const dTI = dist2(tips[0], tips[1]);
    const dTM = dist2(tips[0], tips[2]);
    const dIM = dist2(tips[1], tips[2]);
    return (
      dTI < handScale * 0.8 &&
      dTM < handScale * 0.85 &&
      dIM < handScale * 0.8
    );
  }

  /**
   * Classify shape → root index or quality index code.
   * Returns: for roots: C..B or null; for qualities: Major..Half-dim7 or null
   * mode: "root" | "quality"
   */
  function classifyShape(lm, handednessLabel, mode) {
    const f = fingerFlags(lm, handednessLabel);
    const n = countNonThumb(f);

    // 六 first: unambiguous thumb+pinky only
    if (isLiu(f)) {
      return mode === "root" ? "A" : "Half-dim7";
    }

    // 七 only when it looks like a real pinch candidate — never before
    // clear 1–5 finger counts. Two extended fingers (D / Minor) must win
    // unless thumb is involved and tips are tightly clustered.
    if (
      mode === "root" &&
      f.thumb &&
      !f.ring &&
      !f.pinky &&
      n <= 2 &&
      isQi(lm, f)
    ) {
      return "B";
    }

    // Prefer non-thumb count for 1–4; 5 = open hand (thumb may also be up)
    let count = n;
    if (n === 4 && f.thumb) count = 5;
    else if (n === 4 && !f.thumb) count = 4;
    else if (n >= 1 && n <= 3) {
      // Ignore thumb for 1–3 finger counts (common when counting)
      count = n;
    } else if (n === 0 && !f.thumb) {
      return null; // fist
    } else if (n === 0 && f.thumb) {
      // thumb only — ignore
      return null;
    }

    if (mode === "root") {
      const map = { 1: "C", 2: "D", 3: "E", 4: "F", 5: "G" };
      return map[count] || null;
    }
    const map = { 1: "Major", 2: "Minor", 3: "Maj7", 4: "m7", 5: "Dom7" };
    return map[count] || null;
  }

  /* ---------- MediaPipe ---------- */
  async function importMediaPipe() {
    const urls = [
      MP_LOCAL_BUNDLE,
      `${MP_CDN}/vision_bundle.mjs`,
      `${MP_CDN_FALLBACK}/vision_bundle.mjs`,
    ];
    let lastErr;
    for (const url of urls) {
      try {
        setLoading(true, url.startsWith("./") ? "Loading local MediaPipe…" : "Downloading MediaPipe…");
        const mod = await import(/* @vite-ignore */ url);
        HandLandmarker = mod.HandLandmarker;
        FilesetResolver = mod.FilesetResolver;
        // Always prefer local wasm/model even if the JS bundle came from CDN
        mpWasmPath = MP_LOCAL_WASM;
        return;
      } catch (e) {
        lastErr = e;
        console.warn("MediaPipe import failed:", url, e);
      }
    }
    const detail = lastErr && lastErr.message ? lastErr.message : String(lastErr || "unknown");
    throw new Error("MediaPipe bundle load failed — " + detail);
  }

  async function createLandmarker() {
    await importMediaPipe();
    setLoading(true, "Loading WASM + hand model…");
    let vision;
    try {
      vision = await FilesetResolver.forVisionTasks(mpWasmPath);
    } catch (e) {
      // Last resort: CDN wasm if local folder missing
      console.warn("Local wasm resolve failed, trying CDN wasm", e);
      vision = await FilesetResolver.forVisionTasks(`${MP_CDN}/wasm`);
    }
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: HAND_MODEL, delegate },
      runningMode: "VIDEO",
      numHands: 2,
      minHandDetectionConfidence: DETECT_MIN,
      minHandPresenceConfidence: DETECT_MIN,
      minTrackingConfidence: DETECT_MIN,
    });
    try {
      handLandmarker = await HandLandmarker.createFromOptions(vision, opts("GPU"));
    } catch (gpuErr) {
      console.warn("GPU HandLandmarker failed, trying CPU", gpuErr);
      try {
        handLandmarker = await HandLandmarker.createFromOptions(vision, opts("CPU"));
      } catch (cpuErr) {
        const detail = (cpuErr && cpuErr.message) || String(cpuErr);
        throw new Error("HandLandmarker init failed — " + detail);
      }
    }
  }

  async function startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    await new Promise((resolve) => {
      if (video.readyState >= 2) resolve();
      else video.onloadeddata = () => resolve();
    });
    resizeOverlay();
  }

  function resizeOverlay() {
    const host = video.parentElement;
    const rect = host.getBoundingClientRect();
    let w = Math.floor(rect.width * devicePixelRatio);
    let h = Math.floor(rect.height * devicePixelRatio);
    if (w < 2 || h < 2) {
      w = Math.floor((video.videoWidth || 640) * devicePixelRatio);
      h = Math.floor((video.videoHeight || 480) * devicePixelRatio);
    }
    overlay.width = w;
    overlay.height = h;
  }

  window.addEventListener("resize", () => {
    if (running) resizeOverlay();
  });

  function coverMapping() {
    const cw = overlay.width;
    const ch = overlay.height;
    const vw = video.videoWidth || cw;
    const vh = video.videoHeight || ch;
    const scale = Math.max(cw / vw, ch / vh);
    const dw = vw * scale;
    const dh = vh * scale;
    return { ox: (cw - dw) / 2, oy: (ch - dh) / 2, dw, dh };
  }

  function toCanvas(lm) {
    const { ox, oy, dw, dh } = coverMapping();
    // Video + overlay both use CSS scaleX(-1). Landmarks stay in camera space —
    // do NOT flip X here or the skeleton doubles-mirrors onto the wrong side.
    return { x: ox + lm.x * dw, y: oy + lm.y * dh };
  }

  /** Normalize MediaPipe connection entries: {start,end} objects OR [a,b] pairs. */
  function connectionPair(conn) {
    if (conn == null) return null;
    if (Array.isArray(conn)) {
      return [conn[0], conn[1]];
    }
    if (typeof conn === "object") {
      const a = conn.start ?? conn[0];
      const b = conn.end ?? conn[1];
      return [a, b];
    }
    return null;
  }

  function drawHands(landmarksList) {
    ctx2d.clearRect(0, 0, overlay.width, overlay.height);
    if (!landmarksList || !landmarksList.length) return;
    ctx2d.save();
    ctx2d.lineWidth = 2 * devicePixelRatio;
    ctx2d.strokeStyle = "rgba(255, 234, 0, 0.35)";
    ctx2d.fillStyle = "rgba(255, 23, 68, 0.45)";
    // HAND_CONNECTIONS entries are {start,end} — NOT iterable pairs.
    // `for (const [a,b] of connections)` throws "is not iterable" and kills the RAF loop.
    const connections =
      (HandLandmarker && HandLandmarker.HAND_CONNECTIONS) ||
      HAND_CONNECTIONS_FALLBACK;
    landmarksList.forEach((lm) => {
      for (const conn of connections) {
        const pair = connectionPair(conn);
        if (!pair) continue;
        const [a, b] = pair;
        if (a == null || b == null || !lm[a] || !lm[b]) continue;
        const pa = toCanvas(lm[a]);
        const pb = toCanvas(lm[b]);
        ctx2d.beginPath();
        ctx2d.moveTo(pa.x, pa.y);
        ctx2d.lineTo(pb.x, pb.y);
        ctx2d.stroke();
      }
      for (const p of lm) {
        const c = toCanvas(p);
        ctx2d.beginPath();
        ctx2d.arc(c.x, c.y, 3 * devicePixelRatio, 0, Math.PI * 2);
        ctx2d.fill();
      }
    });
    ctx2d.restore();
  }

  /**
   * HandLandmarker score field: handednesses[i][0].score (0–1).
   * Presence/tracking are filtered via createFromOptions mins; JS result
   * does not expose a separate hand-presence score per landmark set.
   */
  function handConfidence(handednesses, index) {
    const cat = handednesses?.[index]?.[0];
    if (!cat) return 0;
    const s = typeof cat.score === "number" ? cat.score : 0;
    return s;
  }

  function processHands(result) {
    leftTracker.seenThisFrame = false;
    rightTracker.seenThisFrame = false;
    const drawLms = [];

    if (result && result.landmarks && result.handednesses) {
      for (let i = 0; i < result.landmarks.length; i++) {
        const score = handConfidence(result.handednesses, i);
        // Gate 1 — confidence threshold 0.6
        if (score < CONFIDENCE) continue;

        const label = result.handednesses[i]?.[0]?.categoryName || "";
        const tracker =
          label === "Left" ? leftTracker :
          label === "Right" ? rightTracker : null;
        if (!tracker) continue;

        tracker.seenThisFrame = true;
        const smoothed = smoothLandmarks(tracker, result.landmarks[i]);
        if (smoothed) drawLms.push(smoothed);

        const rawGesture = classifyShape(smoothed, label, tracker.mode);
        const voted = majorityVote(tracker, rawGesture);
        applyHysteresis(tracker, voted);
      }
    }

    if (!leftTracker.seenThisFrame) markHandMiss(leftTracker);
    if (!rightTracker.seenThisFrame) markHandMiss(rightTracker);

    chordStateMachine();
    return drawLms;
  }

  function loop() {
    if (!running) return;
    const now = performance.now();
    if (video.currentTime !== lastVideoTime && handLandmarker) {
      lastVideoTime = video.currentTime;
      let result = null;
      try {
        result = handLandmarker.detectForVideo(video, now);
      } catch (_) {}
      // Classify first (EMA), then draw smoothed joints.
      // Never let draw errors stop the RAF loop — that froze gestures after first frame.
      try {
        const smoothed = processHands(result);
        drawHands(smoothed);
      } catch (err) {
        console.warn("frame process/draw error", err);
      }
    }
    rafId = requestAnimationFrame(loop);
  }

  async function start() {
    if (running) return;
    if (window.ChordAudio) await ChordAudio.resume();

    if (cameraLikelyBlocked()) {
      showBanner(
        "Camera blocked on file:// — use 打開.bat / 打開.command for gestures. Panels & keyboard still work."
      );
      setStatus("Click / keyboard mode", "warn");
      startOverlay.classList.add("hidden");
      return;
    }

    try {
      setLoading(true, "Starting camera…");
      await startCamera();
      await createLandmarker();
      setLoading(false);
      hideBanner();
      startOverlay.classList.add("hidden");
      running = true;
      setStatus("Camera live", "live");
      loop();
    } catch (err) {
      console.error(err);
      setLoading(false);
      showBanner(
        "Camera / MediaPipe unavailable — use left/right panels or keyboard. " +
          (err && err.message ? err.message : "")
      );
      setStatus("Fallback mode", "warn");
      startOverlay.classList.add("hidden");
    }
  }

  /* ---------- panels + keyboard ---------- */
  function bindPanels() {
    document.querySelectorAll(".root-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (window.ChordAudio) ChordAudio.resume();
        setRoot(btn.dataset.root, false);
      });
    });
    document.querySelectorAll(".quality-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (window.ChordAudio) ChordAudio.resume();
        setQuality(btn.dataset.quality, false);
      });
    });
  }

  function bindKeyboard() {
    const rootKeys = {
      Digit1: "C",
      Digit2: "D",
      Digit3: "E",
      Digit4: "F",
      Digit5: "G",
      Digit6: "A",
      Digit7: "B",
      KeyA: "C",
      KeyS: "D",
      KeyD: "E",
      KeyF: "F",
      KeyG: "G",
      KeyH: "A",
      KeyJ: "B",
    };
    const qualityKeys = {
      KeyQ: "Major",
      KeyW: "Minor",
      KeyE: "Maj7",
      KeyR: "m7",
      KeyT: "Dom7",
      KeyY: "Half-dim7",
    };
    window.addEventListener("keydown", (e) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (rootKeys[e.code]) {
        e.preventDefault();
        if (window.ChordAudio) ChordAudio.resume();
        setRoot(rootKeys[e.code], false);
      } else if (qualityKeys[e.code]) {
        e.preventDefault();
        if (window.ChordAudio) ChordAudio.resume();
        setQuality(qualityKeys[e.code], false);
      } else if (e.code === "Space") {
        e.preventDefault();
        if (lockedRoot && lockedQuality && window.ChordAudio) {
          // Soft re-attack: fade, then restart the sustained pad
          ChordAudio.resume().then(() => {
            ChordAudio.stop();
            lastPlayedKey = "";
            maybePlay();
          });
        }
      }
    });
  }

  btnStart.addEventListener("click", () => start());
  bindPanels();
  bindKeyboard();
  updateChordUI();
  setStatus("Ready — press START", "");

  if (isFileProtocol()) {
    showBanner(
      "Opened via file:// — panels/keyboard work. For camera gestures, double-click 打開.bat (Win) or 打開.command (Mac)."
    );
  }

  // —— Mascot parallax + rules modal ——
  (function setupMascotAndHelp() {
    const mascot = $("guide-mascot");
    const bubble = $("mascot-bubble");
    const btnHelp = $("btn-help");
    const overlay = $("overlay-rules");
    const btnClose = $("btn-rules-close");
    const btnOk = $("btn-rules-ok");
    if (!mascot || !btnHelp || !overlay) return;

    const tips = [
      "Hi！跟住滑鼠郁 · 撳我換提示",
      "左手：根音 1–5／六／七",
      "右手：屬性 1–5／六 = Half-dim7",
      "雙手同時穩定先持續發聲（鬆開即停）",
      "撳右下角 ? 睇中英規則",
      "Hello! I follow your mouse",
      "Click ? for bilingual rules",
    ];
    let tipI = 0;
    function showTip(i) {
      tipI = ((i % tips.length) + tips.length) % tips.length;
      if (bubble) bubble.textContent = tips[tipI];
    }

    let targetX = 0, targetY = 0, targetRot = 0;
    let curX = 0, curY = 0, curRot = 0;
    function tick() {
      curX += (targetX - curX) * 0.12;
      curY += (targetY - curY) * 0.12;
      curRot += (targetRot - curRot) * 0.1;
      mascot.style.transform =
        `translate3d(${curX.toFixed(2)}px, ${curY.toFixed(2)}px, 0) rotate(${curRot.toFixed(2)}deg)`;
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);

    window.addEventListener("mousemove", (e) => {
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = (e.clientY / window.innerHeight) * 2 - 1;
      targetX = Math.max(0, Math.min(36, nx * 22 + 10));
      targetY = Math.max(-16, Math.min(12, ny * 14));
      targetRot = nx * 3.5 + ny * 1.5;
    });
    document.addEventListener("mouseleave", () => {
      targetX = targetY = targetRot = 0;
    });

    mascot.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showTip(tipI + 1);
    });

    function openRules() {
      overlay.classList.remove("hidden");
    }
    function closeRules() {
      overlay.classList.add("hidden");
    }
    btnHelp.addEventListener("click", openRules);
    btnClose?.addEventListener("click", closeRules);
    btnOk?.addEventListener("click", closeRules);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeRules();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !overlay.classList.contains("hidden")) closeRules();
    });

    overlay.querySelectorAll(".lang-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        const lang = tab.getAttribute("data-lang");
        overlay.querySelectorAll(".lang-tab").forEach((t) => {
          const on = t === tab;
          t.classList.toggle("active", on);
          t.setAttribute("aria-selected", on ? "true" : "false");
        });
        $("rules-zh")?.classList.toggle("hidden", lang !== "zh");
        $("rules-en")?.classList.toggle("hidden", lang !== "en");
      });
    });
  })();

})();
