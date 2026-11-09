/**
 * Web Audio sustained chord pad — no asset files.
 * Roots C3–B3; qualities use semitone intervals from the design spec.
 * Holds a soft continuous tone while setChord(root, quality) is active;
 * stop()/stopAll() fade out gently.
 */
(function (global) {
  const ROOT_MIDI = { C: 48, D: 50, E: 52, F: 53, G: 55, A: 57, B: 59 };
  const QUALITY_INTERVALS = {
    Major: [0, 4, 7],
    Minor: [0, 3, 7],
    Maj7: [0, 4, 7, 11],
    m7: [0, 3, 7, 10],
    Dom7: [0, 4, 7, 10],
    "Half-dim7": [0, 3, 6, 10],
  };

  const ATTACK = 0.035;   // ~35ms soft attack
  const RELEASE = 0.12;   // ~120ms gentle release
  const MASTER_GAIN = 0.18;
  const ROOT_PEAK = 0.42;
  const PARTIAL_PEAK = 0.24;

  let ctx = null;
  let master = null;
  /** @type {{ osc: OscillatorNode, gain: GainNode }[]} */
  let voices = [];
  let currentKey = "";
  let stopping = false;

  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = MASTER_GAIN;
      master.connect(ctx.destination);
    }
    return ctx;
  }

  async function resume() {
    ensureCtx();
    if (ctx.state === "suspended") await ctx.resume();
    return ctx;
  }

  function midiToHz(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function chordKey(root, quality) {
    return `${root}|${quality}`;
  }

  /**
   * Fade out and stop all sustained voices.
   */
  function stop() {
    if (!ctx || (!voices.length && !currentKey)) {
      currentKey = "";
      stopping = false;
      return;
    }
    const now = ctx.currentTime;
    stopping = true;
    currentKey = "";
    const toStop = voices.slice();
    voices = [];
    for (const v of toStop) {
      try {
        v.gain.gain.cancelScheduledValues(now);
        const cur = Math.max(0.0001, v.gain.gain.value);
        v.gain.gain.setValueAtTime(cur, now);
        v.gain.gain.exponentialRampToValueAtTime(0.0001, now + RELEASE);
        v.osc.stop(now + RELEASE + 0.05);
      } catch (_) {}
    }
    stopping = false;
  }

  function stopAll() {
    stop();
  }

  /**
   * Retarget existing voices to new frequencies (same voice count),
   * or rebuild if interval count differs. Soft crossfade via gain dip.
   */
  function retargetVoices(base, intervals) {
    const now = ctx.currentTime;
    if (voices.length === intervals.length) {
      // Brief gain dip + frequency glide to avoid clicks
      for (let i = 0; i < voices.length; i++) {
        const v = voices[i];
        const peak = i === 0 ? ROOT_PEAK : PARTIAL_PEAK;
        const hz = midiToHz(base + intervals[i]);
        try {
          v.gain.gain.cancelScheduledValues(now);
          const cur = Math.max(0.0001, v.gain.gain.value);
          v.gain.gain.setValueAtTime(cur, now);
          v.gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * 0.35), now + 0.025);
          v.gain.gain.exponentialRampToValueAtTime(peak, now + 0.08);
          v.osc.frequency.cancelScheduledValues(now);
          v.osc.frequency.setValueAtTime(v.osc.frequency.value, now);
          v.osc.frequency.exponentialRampToValueAtTime(Math.max(20, hz), now + 0.05);
        } catch (_) {}
      }
      return;
    }
    // Voice count changed — fade old, spawn new
    stop();
    startVoices(base, intervals);
  }

  function startVoices(base, intervals) {
    ensureCtx();
    const now = ctx.currentTime;
    voices = [];
    intervals.forEach((semi, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = i === 0 ? "triangle" : "sine";
      osc.frequency.value = midiToHz(base + semi);
      const peak = i === 0 ? ROOT_PEAK : PARTIAL_PEAK;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(peak, now + ATTACK);
      osc.connect(gain);
      gain.connect(master);
      osc.start(now);
      voices.push({ osc, gain });
    });
  }

  /**
   * Start or update a sustained chord pad.
   * Same root+quality while already playing → no-op.
   * @param {string} root e.g. "C"
   * @param {string} quality e.g. "Maj7"
   */
  function setChord(root, quality) {
    ensureCtx();
    const base = ROOT_MIDI[root];
    const intervals = QUALITY_INTERVALS[quality];
    if (base == null || !intervals) return;

    const key = chordKey(root, quality);
    if (key === currentKey && voices.length > 0 && !stopping) return;

    if (voices.length > 0) {
      retargetVoices(base, intervals);
    } else {
      startVoices(base, intervals);
    }
    currentKey = key;
    stopping = false;
  }

  /** @deprecated one-shot API — maps to setChord for compatibility */
  function playChord(root, quality) {
    setChord(root, quality);
  }

  global.ChordAudio = {
    resume,
    setChord,
    playChord,
    stop,
    stopAll,
    ROOT_MIDI,
    QUALITY_INTERVALS,
  };
})(window);
