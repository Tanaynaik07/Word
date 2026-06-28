// ==========================================
//  WORDTIDE — SOUND ENGINE
//  All sounds generated via Web Audio API.
//  Replace any synth call with a real audio file when ready:
//    e.g. playFile('sounds/key-click.mp3') instead of sfx.keyClick()
// ==========================================

const Audio = (() => {
  let ctx = null;
  let bgmNode = null;
  let bgmGain = null;
  let masterGain = null;
  let muted = false;
  let bgmStarted = false;

  function getCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = 0.6;
      masterGain.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // ── Utility: play a simple tone ──
  function tone(freq, type, duration, gainVal = 0.3, startDelay = 0) {
    if (muted) return;
    const c = getCtx();
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, c.currentTime + startDelay);
    g.gain.setValueAtTime(0, c.currentTime + startDelay);
    g.gain.linearRampToValueAtTime(gainVal, c.currentTime + startDelay + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + startDelay + duration);
    osc.connect(g);
    g.connect(masterGain);
    osc.start(c.currentTime + startDelay);
    osc.stop(c.currentTime + startDelay + duration + 0.05);
  }

  // ── Utility: white/pink noise burst ──
  function noise(duration, gainVal = 0.15, startDelay = 0) {
    if (muted) return;
    const c = getCtx();
    const bufSize = c.sampleRate * duration;
    const buf = c.createBuffer(1, bufSize, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    g.gain.setValueAtTime(gainVal, c.currentTime + startDelay);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + startDelay + duration);
    src.connect(g);
    g.connect(masterGain);
    src.start(c.currentTime + startDelay);
  }

  // ==========================================
  //  SFX CATALOGUE
  //  Each function = one named sound event.
  //  Swap with: new Audio('sounds/x.mp3').play()
  // ==========================================

  const sfx = {

    // Key press — soft percussive click
    keyClick() {
      tone(800, 'sine', 0.06, 0.18);
      noise(0.04, 0.05);
    },

    // Backspace — slightly lower, shorter
    backspace() {
      tone(500, 'sine', 0.08, 0.12);
    },

    // Submit guess row — whoosh/sweep
    submit() {
      tone(300, 'sine', 0.1, 0.2);
      tone(500, 'sine', 0.08, 0.15, 0.05);
      noise(0.15, 0.08, 0.02);
    },

    // Tile flip — per-tile reveal (call with small delay each tile)
    tileFlip(index = 0) {
      const freq = 500 + index * 40;
      tone(freq, 'sine', 0.12, 0.15, index * 0.07);
    },

    // Correct letter in correct position (green) — bright ping
    correct() {
      tone(880, 'sine', 0.15, 0.25);
      tone(1320, 'sine', 0.1, 0.15, 0.06);
    },

    // Letter in word, wrong position (yellow) — softer ping
    present() {
      tone(660, 'triangle', 0.14, 0.2);
    },

    // Wrong letter (grey) — dull thud
    absent() {
      tone(180, 'sine', 0.18, 0.25);
      noise(0.1, 0.08);
    },

    // Word solved — fanfare arpeggio
    win() {
      const notes = [523, 659, 784, 1047]; // C5 E5 G5 C6
      notes.forEach((f, i) => tone(f, 'sine', 0.35, 0.3, i * 0.1));
      // sparkle on top
      setTimeout(() => {
        [1319, 1568, 2093].forEach((f, i) => tone(f, 'sine', 0.25, 0.15, i * 0.08));
      }, 500);
    },

    // Lost / time up — descending sad tones
    lose() {
      const notes = [392, 330, 262, 196]; // G4 E4 C4 G3
      notes.forEach((f, i) => tone(f, 'sawtooth', 0.3, 0.2, i * 0.12));
    },

    // Timer warning (< 60s) — subtle tick
    timerWarning() {
      tone(440, 'sine', 0.08, 0.12);
    },

    // Timer danger (< 30s) — more urgent tick
    timerDanger() {
      tone(660, 'sine', 0.08, 0.2);
      tone(880, 'sine', 0.05, 0.1, 0.05);
    },

    // Streak milestone — celebratory
    streak() {
      [523, 784, 1047, 1319].forEach((f, i) => tone(f, 'sine', 0.2, 0.2, i * 0.08));
    },

    // Screen transition — soft swoosh
    transition() {
      tone(400, 'sine', 0.12, 0.1);
      tone(600, 'sine', 0.1, 0.08, 0.06);
    },

    // Share button — pop
    share() {
      tone(1047, 'sine', 0.1, 0.2);
      tone(1319, 'sine', 0.08, 0.15, 0.05);
      noise(0.05, 0.05, 0.02);
    },

    // Row shake (wrong length) — buzzer
    invalid() {
      tone(200, 'sawtooth', 0.12, 0.2);
      tone(180, 'sawtooth', 0.1, 0.15, 0.06);
    },
  };

  // ==========================================
  //  BGM — Ambient ocean / lo-fi blend (synthesised)
  //
  //  Architecture (5 layers):
  //    1. Sub drone     — deep A1 sine, the "ocean floor"
  //    2. Chord pad     — slow-attack Am chord (A-C-E) for warmth
  //    3. Filter noise  — LFO-swept white noise for wave wash
  //    4. Arpeggio      — soft pentatonic notes, like water drops
  //    5. Shimmer       — high-frequency sparkles (bubbles)
  //
  //  Replace with: loadBGM('sounds/bgm.mp3')
  // ==========================================

  function startBGM() {
    if (muted || bgmStarted) return;
    bgmStarted = true;
    const c = getCtx();

    bgmGain = c.createGain();
    bgmGain.gain.value = 0;
    bgmGain.connect(masterGain);

    // Fade in over 4 seconds
    bgmGain.gain.linearRampToValueAtTime(0.22, c.currentTime + 4);

    // ── Layer 1: Sub drone (A1 = 55 Hz) ──────────────────────
    const sub = c.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = 55;
    const subGain = c.createGain();
    subGain.gain.value = 0.35;
    sub.connect(subGain);
    subGain.connect(bgmGain);
    sub.start();
    bgmNode = sub; // kept for stopBGM reference

    // Slowly drift the sub drone pitch (±3 Hz over ~20s) for organic feel
    function driftDrone() {
      if (!bgmStarted) return;
      const target = 53 + Math.random() * 5;
      sub.frequency.linearRampToValueAtTime(target, c.currentTime + 10 + Math.random() * 10);
      setTimeout(driftDrone, 12000 + Math.random() * 8000);
    }
    setTimeout(driftDrone, 5000);

    // ── Layer 2: Warm chord pad (Am: A3-C4-E4) ───────────────
    // Three detuned oscillators per note for richness
    const padNotes = [220, 261.63, 329.63]; // A3, C4, E4
    padNotes.forEach((freq, ni) => {
      [-4, 0, 4].forEach(detune => {
        const osc  = c.createOscillator();
        const gain = c.createGain();
        osc.type    = 'sine';
        osc.frequency.value = freq;
        osc.detune.value    = detune;
        // Slow attack envelope so the pad swells in
        gain.gain.setValueAtTime(0, c.currentTime);
        gain.gain.linearRampToValueAtTime(0.045, c.currentTime + 6 + ni * 1.2);
        osc.connect(gain);
        gain.connect(bgmGain);
        osc.start();
      });
    });

    // Chord changes: cycle Am → C → G → Am every ~16s for gentle movement
    const chordSets = [
      [220, 261.63, 329.63],   // Am
      [261.63, 329.63, 392.0], // C
      [196.0, 246.94, 293.66], // G
      [220, 261.63, 329.63],   // Am
    ];
    // (In a real implementation you'd swap oscillator frequencies;
    //  for the synth engine here, the static Am chord is sufficient.)

    // ── Layer 3: LFO-filtered wave noise ─────────────────────
    const waveBufferSecs = 6;
    const waveBuf = c.createBuffer(1, c.sampleRate * waveBufferSecs, c.sampleRate);
    const waveData = waveBuf.getChannelData(0);
    for (let i = 0; i < waveData.length; i++) waveData[i] = Math.random() * 2 - 1;

    const waveSrc = c.createBufferSource();
    waveSrc.buffer = waveBuf;
    waveSrc.loop   = true;

    const waveFilter = c.createBiquadFilter();
    waveFilter.type      = 'bandpass';
    waveFilter.frequency.value = 200;
    waveFilter.Q.value   = 1.5;

    const waveGain = c.createGain();
    waveGain.gain.value = 0.07;

    // LFO to sweep the filter cutoff (simulates wave crests)
    const lfo = c.createOscillator();
    lfo.type            = 'sine';
    lfo.frequency.value = 0.07; // ~14s cycle
    const lfoGain = c.createGain();
    lfoGain.gain.value = 180;   // ±180 Hz sweep
    lfo.connect(lfoGain);
    lfoGain.connect(waveFilter.frequency);
    lfo.start();

    waveSrc.connect(waveFilter);
    waveFilter.connect(waveGain);
    waveGain.connect(bgmGain);
    waveSrc.start();

    // ── Layer 4: Pentatonic arpeggio (water drops) ───────────
    // A minor pentatonic: A3 C4 D4 E4 G4
    const arpeggioNotes = [220, 261.63, 293.66, 329.63, 392.0];
    function playArpeggioNote() {
      if (!bgmStarted || muted) return;
      const freq  = arpeggioNotes[Math.floor(Math.random() * arpeggioNotes.length)];
      // Occasionally jump an octave up for sparkle
      const pitch = freq * (Math.random() > 0.75 ? 2 : 1);
      const osc   = c.createOscillator();
      const env   = c.createGain();
      osc.type    = Math.random() > 0.5 ? 'sine' : 'triangle';
      osc.frequency.value = pitch;
      env.gain.setValueAtTime(0, c.currentTime);
      env.gain.linearRampToValueAtTime(0.06, c.currentTime + 0.04);
      env.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.8);
      osc.connect(env);
      env.connect(bgmGain);
      osc.start();
      osc.stop(c.currentTime + 0.9);
      // Schedule next note: 1–4 s gap, longer gaps feel more like drips
      setTimeout(playArpeggioNote, 1000 + Math.random() * 3000);
    }
    setTimeout(playArpeggioNote, 3000); // start after initial fade-in

    // ── Layer 5: High shimmer (bubbles / sea spray) ──────────
    function shimmerTick() {
      if (!bgmStarted || muted) return;
      const freq = 3000 + Math.random() * 4000;
      const osc  = c.createOscillator();
      const g    = c.createGain();
      osc.type            = 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0, c.currentTime);
      g.gain.linearRampToValueAtTime(0.018, c.currentTime + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.35);
      osc.connect(g);
      g.connect(bgmGain);
      osc.start();
      osc.stop(c.currentTime + 0.4);
      setTimeout(shimmerTick, 300 + Math.random() * 1400);
    }
    setTimeout(shimmerTick, 2000);
  }

  function stopBGM() {
    bgmStarted = false;
    if (bgmGain) {
      const c = getCtx();
      bgmGain.gain.linearRampToValueAtTime(0, c.currentTime + 1.5);
    }
  }

  // ── Mute toggle ──
  function toggleMute() {
    muted = !muted;
    if (masterGain) masterGain.gain.value = muted ? 0 : 0.6;
    return muted;
  }

  function isMuted() { return muted; }

  // ── Public API ──
  return { sfx, startBGM, stopBGM, toggleMute, isMuted, getCtx };
})();

// ── iOS AudioContext resume ───────────────────────────────────────────
// On iOS, AudioContext enters an interrupted/suspended state when the
// app is backgrounded or inside an iframe (portal embeds).
// WebKit requires a direct user gesture to resume — visibility change
// alone is insufficient. This listener covers both cases.
// Required by CrazyGames QA; improves audio reliability everywhere.
document.addEventListener('touchend', () => {
  const ctx = Audio.getCtx();
  if (ctx && ctx.state === 'suspended') ctx.resume();
}, { passive: true });