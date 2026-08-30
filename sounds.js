// Tilt Hole — sound design, entirely synthesized with the Web Audio API.
// No audio files. Everything degrades silently if Web Audio is unavailable
// or blocked, so it can never break the game.
//
// Tweak here:
//  - MUSIC_VOLUME / SFX_VOLUME: overall loudness of music vs. effects
//  - TEMPO_BPM: speed of the background loop
//  - MELODY: the note sequence for the start-screen loop
//  - ENGINE_VOLUME: loudness of the constant in-flight rocket engine hum
(function (global) {
  'use strict';

  var MUSIC_VOLUME = 0.14;
  var SFX_VOLUME = 0.22;
  var ENGINE_VOLUME = 0.16;
  var TEMPO_BPM = 78;

  // A ~0.1s silent WAV, played (looped, inaudibly) through a real <audio>
  // element the moment audio unlocks. iOS Safari otherwise routes
  // Web-Audio-only sound through its "ambient" audio session category,
  // which the phone's hardware silent/mute switch silences entirely —
  // even though the game itself has nothing to do with that switch. A
  // playing <audio>/<video> element switches the page to the "playback"
  // category, which ignores the mute switch, and Web Audio output then
  // follows. This is the standard, widely-documented workaround.
  var SILENT_UNLOCK_WAV =
    'data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YSADAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI' +
    'CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI' +
    'CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI' +
    'CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI' +
    'CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI' +
    'CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';

  var NOTES = {
    R: 0,
    A1: 55.00, D2: 73.42, E2: 82.41, A2: 110.00,
    A3: 220.00, B3: 246.94, C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.00,
    A4: 440.00, B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99,
    A5: 880.00, B5: 987.77, C6: 1046.50
  };

  // Slow, spacious ambient loop (sine pads instead of chiptune square
  // waves) with plenty of rests, meant to float under a starfield rather
  // than drive a beat. [noteName, durationInBeats].
  var MELODY = [
    ['E5', 1.5], ['R', 0.5], ['C5', 1.0], ['R', 0.5],
    ['A4', 1.5], ['R', 0.5], ['B4', 1.0], ['R', 0.5],
    ['D5', 1.5], ['R', 0.5], ['B4', 1.0], ['R', 0.5],
    ['C5', 2.0], ['R', 1.0],
    ['G4', 1.5], ['R', 0.5], ['A4', 1.0], ['R', 0.5],
    ['E5', 1.5], ['R', 0.5], ['D5', 1.0], ['R', 0.5],
    ['C5', 1.5], ['R', 0.5], ['A4', 1.0], ['R', 0.5],
    ['A4', 3.0], ['R', 1.0]
  ];

  // A sustained low drone under the melody sells the "floating in the
  // void" feel; it fades in/out alongside the melody rather than being
  // scheduled note-by-note.
  var DRONE_NOTE = 'A2';

  function SoundManager() {
    this.ctx = null;
    this.masterGain = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.engineGain = null;
    this.muted = false;
    this.musicTimer = null;
    this.musicLoopId = 0;
    this.ready = false;
    this._silentEl = null;
    this._droneNodes = null;
    this._engineNodes = null;
    this._noiseBuffer = null;
  }

  SoundManager.prototype._ensureContext = function () {
    if (this.ctx) return this.ready;
    try {
      var Ctx = global.AudioContext || global.webkitAudioContext;
      if (!Ctx) return false;
      this.ctx = new Ctx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 1;
      this.masterGain.connect(this.ctx.destination);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = MUSIC_VOLUME;
      this.musicGain.connect(this.masterGain);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = SFX_VOLUME;
      this.sfxGain.connect(this.masterGain);

      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = ENGINE_VOLUME;
      this.engineGain.connect(this.masterGain);

      this.ready = true;
    } catch (e) {
      this.ready = false;
    }
    return this.ready;
  };

  SoundManager.prototype._unlockIOSAudioSession = function () {
    if (this._silentEl || typeof global.Audio !== 'function') return;
    try {
      var el = new global.Audio(SILENT_UNLOCK_WAV);
      el.loop = true;
      el.setAttribute('playsinline', '');
      this._silentEl = el;
      var p = el.play();
      if (p && typeof p.catch === 'function') p.catch(function () { /* ignore */ });
    } catch (e) { /* ignore */ }
  };

  // Must be called from inside a user-gesture handler (click/tap) so the
  // browser's autoplay policy allows audio to start.
  SoundManager.prototype.unlock = function () {
    if (!this._ensureContext()) return;
    try {
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch (e) { /* ignore */ }
    this._unlockIOSAudioSession();
  };

  SoundManager.prototype.setMuted = function (muted) {
    this.muted = muted;
    if (this.masterGain) {
      try { this.masterGain.gain.value = muted ? 0 : 1; } catch (e) { /* ignore */ }
    }
  };

  SoundManager.prototype.toggleMute = function () {
    this.setMuted(!this.muted);
    return this.muted;
  };

  function playTone(ctx, dest, freq, startTime, duration, opts) {
    if (!freq) return; // rest
    opts = opts || {};
    var type = opts.type || 'square';
    var peak = opts.volume != null ? opts.volume : 1;
    try {
      var osc = ctx.createOscillator();
      var env = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, startTime);
      osc.connect(env);
      env.connect(dest);

      var attack = Math.min(0.015, duration * 0.2);
      var release = Math.min(0.08, duration * 0.4);
      env.gain.setValueAtTime(0, startTime);
      env.gain.linearRampToValueAtTime(peak, startTime + attack);
      env.gain.setValueAtTime(peak, Math.max(startTime + attack, startTime + duration - release));
      env.gain.linearRampToValueAtTime(0, startTime + duration);

      osc.start(startTime);
      osc.stop(startTime + duration + 0.02);
    } catch (e) { /* ignore single-note failures */ }
  }

  // Schedules the whole melody loop starting at `when`, then recursively
  // reschedules itself right before the loop ends for seamless looping.
  // A sustained low drone (started/stopped alongside, not scheduled
  // note-by-note) plays underneath for an ambient, floating-in-space feel.
  SoundManager.prototype.playBackgroundMusic = function () {
    if (!this._ensureContext()) return;
    this.stopBackgroundMusic();
    var self = this;
    var myLoopId = ++this.musicLoopId;
    var beatSec = 60 / TEMPO_BPM;

    var droneOsc = this.ctx.createOscillator();
    droneOsc.type = 'sine';
    droneOsc.frequency.value = NOTES[DRONE_NOTE];
    var droneGain = this.ctx.createGain();
    droneGain.gain.value = 0;
    droneOsc.connect(droneGain);
    droneGain.connect(this.musicGain);
    droneOsc.start();
    var droneNow = this.ctx.currentTime;
    droneGain.gain.linearRampToValueAtTime(0.55, droneNow + 2.5);
    this._droneNodes = { osc: droneOsc, gain: droneGain };

    function scheduleLoop(startTime) {
      if (myLoopId !== self.musicLoopId) return; // superseded/stopped
      var t = startTime;
      var totalBeats = 0;
      for (var i = 0; i < MELODY.length; i++) {
        var note = MELODY[i][0];
        var beats = MELODY[i][1];
        var dur = beats * beatSec;
        playTone(self.ctx, self.musicGain, NOTES[note], t, dur * 0.9, { type: 'sine', volume: 0.8 });
        t += dur;
        totalBeats += beats;
      }
      var loopDurationMs = totalBeats * beatSec * 1000;
      // Reschedule slightly before the loop ends so there is no gap/overlap.
      var delay = Math.max(0, loopDurationMs - 60);
      self.musicTimer = global.setTimeout(function () {
        scheduleLoop(startTime + totalBeats * beatSec);
      }, delay);
    }

    scheduleLoop(this.ctx.currentTime + 0.05);
  };

  SoundManager.prototype.stopBackgroundMusic = function () {
    this.musicLoopId++; // invalidates any pending scheduleLoop closures
    if (this.musicTimer) {
      global.clearTimeout(this.musicTimer);
      this.musicTimer = null;
    }
    if (this._droneNodes) {
      var drone = this._droneNodes;
      this._droneNodes = null;
      try {
        var now = this.ctx.currentTime;
        drone.gain.gain.cancelScheduledValues(now);
        drone.gain.gain.setValueAtTime(drone.gain.gain.value, now);
        drone.gain.gain.linearRampToValueAtTime(0, now + 0.4);
        global.setTimeout(function () { try { drone.osc.stop(); } catch (e) { /* ignore */ } }, 500);
      } catch (e) { /* ignore */ }
    }
  };

  // A short random-noise buffer, looped, is the basis of the constant
  // rocket engine hum — cheaper and more convincing than trying to fake
  // engine rumble out of oscillators alone.
  SoundManager.prototype._ensureNoiseBuffer = function () {
    if (this._noiseBuffer) return this._noiseBuffer;
    var duration = 2;
    var frameCount = Math.floor(this.ctx.sampleRate * duration);
    var buffer = this.ctx.createBuffer(1, frameCount, this.ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < frameCount; i++) data[i] = Math.random() * 2 - 1;
    this._noiseBuffer = buffer;
    return buffer;
  };

  // Starts a continuous engine hum (filtered noise + a low sawtooth
  // "body" tone) that plays for as long as a round is active. Idempotent —
  // calling it while already running is a no-op.
  SoundManager.prototype.startEngine = function () {
    if (!this._ensureContext() || this._engineNodes) return;
    var ctx = this.ctx;

    var noise = ctx.createBufferSource();
    noise.buffer = this._ensureNoiseBuffer();
    noise.loop = true;

    var noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.value = 500;
    noiseFilter.Q.value = 0.7;

    var hum = ctx.createOscillator();
    hum.type = 'sawtooth';
    hum.frequency.value = 68;

    var humFilter = ctx.createBiquadFilter();
    humFilter.type = 'lowpass';
    humFilter.frequency.value = 220;

    var engineEnvelope = ctx.createGain();
    engineEnvelope.gain.value = 0;

    noise.connect(noiseFilter);
    noiseFilter.connect(engineEnvelope);
    hum.connect(humFilter);
    humFilter.connect(engineEnvelope);
    engineEnvelope.connect(this.engineGain);

    var now = ctx.currentTime;
    engineEnvelope.gain.setValueAtTime(0, now);
    engineEnvelope.gain.linearRampToValueAtTime(0.55, now + 0.4);

    noise.start();
    hum.start();

    this._engineNodes = { noise: noise, hum: hum, noiseFilter: noiseFilter, envelope: engineEnvelope };
  };

  // Fades the engine out and tears it down. Safe to call even if the
  // engine isn't running.
  SoundManager.prototype.stopEngine = function () {
    if (!this._engineNodes || !this.ctx) return;
    var nodes = this._engineNodes;
    this._engineNodes = null;
    var ctx = this.ctx;
    try {
      var now = ctx.currentTime;
      nodes.envelope.gain.cancelScheduledValues(now);
      nodes.envelope.gain.setValueAtTime(nodes.envelope.gain.value, now);
      nodes.envelope.gain.linearRampToValueAtTime(0, now + 0.25);
    } catch (e) { /* ignore */ }
    global.setTimeout(function () {
      try { nodes.noise.stop(); } catch (e) { /* ignore */ }
      try { nodes.hum.stop(); } catch (e) { /* ignore */ }
    }, 300);
  };

  // Ties the engine's pitch/brightness to how fast the ship is currently
  // moving (0 = idle, 1 = top speed) for a bit of audible feedback. A
  // no-op while the engine isn't running.
  SoundManager.prototype.setEngineIntensity = function (t) {
    if (!this._engineNodes) return;
    try {
      this._engineNodes.noiseFilter.frequency.setTargetAtTime(300 + t * 900, this.ctx.currentTime, 0.05);
      this._engineNodes.hum.frequency.setTargetAtTime(55 + t * 40, this.ctx.currentTime, 0.08);
    } catch (e) { /* ignore */ }
  };

  SoundManager.prototype.playWinJingle = function () {
    if (!this._ensureContext()) return;
    var t = this.ctx.currentTime + 0.02;
    var notes = [['C5', 0.12], ['E5', 0.12], ['G5', 0.12], ['C6', 0.32]];
    for (var i = 0; i < notes.length; i++) {
      playTone(this.ctx, this.sfxGain, NOTES[notes[i][0]], t, notes[i][1], { type: 'triangle', volume: 1 });
      t += notes[i][1] * 0.85;
    }
  };

  // A descending pitch-and-filter sweep for "pulled into the black hole",
  // rather than a fixed note sequence — a falling whoosh reads better for
  // this than a musical phrase.
  SoundManager.prototype.playLoseSound = function () {
    if (!this._ensureContext()) return;
    var ctx = this.ctx;
    var t = ctx.currentTime + 0.02;
    var duration = 0.75;
    try {
      var osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(880, t);
      osc.frequency.exponentialRampToValueAtTime(50, t + duration - 0.05);

      var filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(4000, t);
      filter.frequency.exponentialRampToValueAtTime(90, t + duration - 0.05);

      var gain = ctx.createGain();
      gain.gain.setValueAtTime(0.9, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.sfxGain);

      osc.start(t);
      osc.stop(t + duration + 0.05);
    } catch (e) { /* ignore */ }
  };

  global.TiltHoleSounds = new SoundManager();
})(typeof window !== 'undefined' ? window : this);
