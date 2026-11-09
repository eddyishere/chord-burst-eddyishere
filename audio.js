/**
 * Web Audio chord engine — no asset files.
 * Roots C3–B3; qualities use semitone intervals from the design spec.
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

  let ctx = null;
  let master = null;
  let activeNodes = [];

  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.22;
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

  function stopAll() {
    const now = ctx ? ctx.currentTime : 0;
    for (const n of activeNodes) {
      try {
        n.gain.gain.cancelScheduledValues(now);
        n.gain.gain.setTargetAtTime(0.0001, now, 0.03);
        n.osc.stop(now + 0.08);
      } catch (_) {}
    }
    activeNodes = [];
  }

  /**
   * Play a chord for ~0.8s decay.
   * @param {string} root e.g. "C"
   * @param {string} quality e.g. "Maj7"
   */
  function playChord(root, quality) {
    ensureCtx();
    const base = ROOT_MIDI[root];
    const intervals = QUALITY_INTERVALS[quality];
    if (base == null || !intervals) return;

    stopAll();
    const now = ctx.currentTime;
    const duration = 0.85;

    intervals.forEach((semi, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = i === 0 ? "triangle" : "sine";
      osc.frequency.value = midiToHz(base + semi);
      const peak = i === 0 ? 0.55 : 0.32;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(peak, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(gain);
      gain.connect(master);
      osc.start(now);
      osc.stop(now + duration + 0.05);
      activeNodes.push({ osc, gain });
    });
  }

  global.ChordAudio = {
    resume,
    playChord,
    stopAll,
    ROOT_MIDI,
    QUALITY_INTERVALS,
  };
})(window);
