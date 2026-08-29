// Tilt Hole — sound design, entirely synthesized with the Web Audio API.
// No audio files. Everything degrades silently if Web Audio is unavailable
// or blocked, so it can never break the game.
//
// Tweak here:
//  - MUSIC_VOLUME / SFX_VOLUME: overall loudness of music vs. effects
//  - TEMPO_BPM: speed of the background loop
//  - MELODY: the note sequence for the start-screen loop
(function (global) {
  'use strict';

  var MUSIC_VOLUME = 0.16;
  var SFX_VOLUME = 0.22;
  var TEMPO_BPM = 132;

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
    A3: 220.00, B3: 246.94, C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.00,
    A4: 440.00, B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99,
    A5: 880.00, B5: 987.77, C6: 1046.50
  };

  // Original chiptune-style loop: [noteName, durationInBeats]. 8-bar feel.
  var MELODY = [
    ['E5', 0.5], ['B4', 0.25], ['C5', 0.25], ['D5', 0.5], ['C5', 0.25], ['B4', 0.25],
    ['A4', 0.5], ['A4', 0.25], ['C5', 0.25], ['E5', 0.5], ['D5', 0.25], ['C5', 0.25],
    ['B4', 0.75], ['C5', 0.25], ['D5', 0.5], ['E5', 0.5],
    ['C5', 0.5], ['A4', 0.5], ['A4', 1.0],
    ['R', 0.5], ['D5', 0.5], ['F5', 0.25], ['A5', 0.5], ['G5', 0.25], ['F5', 0.25],
    ['E5', 0.5], ['C5', 0.25], ['E5', 0.25], ['D5', 0.5], ['C5', 0.25], ['B4', 0.25],
    ['A4', 0.5], ['A4', 0.25], ['C5', 0.25], ['E5', 0.5], ['D5', 0.25], ['C5', 0.25],
    ['B4', 1.0], ['A4', 1.0]
  ];

  function SoundManager() {
    this.ctx = null;
    this.masterGain = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.muted = false;
    this.musicTimer = null;
    this.musicLoopId = 0;
    this.ready = false;
    this._silentEl = null;
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
  SoundManager.prototype.playBackgroundMusic = function () {
    if (!this._ensureContext()) return;
    this.stopBackgroundMusic();
    var self = this;
    var myLoopId = ++this.musicLoopId;
    var beatSec = 60 / TEMPO_BPM;

    function scheduleLoop(startTime) {
      if (myLoopId !== self.musicLoopId) return; // superseded/stopped
      var t = startTime;
      var totalBeats = 0;
      for (var i = 0; i < MELODY.length; i++) {
        var note = MELODY[i][0];
        var beats = MELODY[i][1];
        var dur = beats * beatSec;
        playTone(self.ctx, self.musicGain, NOTES[note], t, dur * 0.92, { type: 'square', volume: 0.9 });
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
  };

  SoundManager.prototype.playWinJingle = function () {
    if (!this._ensureContext()) return;
    var t = this.ctx.currentTime + 0.02;
    var notes = [['C5', 0.12], ['E5', 0.12], ['G5', 0.12], ['C6', 0.28]];
    for (var i = 0; i < notes.length; i++) {
      playTone(this.ctx, this.sfxGain, NOTES[notes[i][0]], t, notes[i][1], { type: 'square', volume: 1 });
      t += notes[i][1] * 0.85;
    }
  };

  SoundManager.prototype.playLoseSound = function () {
    if (!this._ensureContext()) return;
    var t = this.ctx.currentTime + 0.02;
    var notes = [['A4', 0.18], ['F4', 0.18], ['D4', 0.18], ['C4', 0.4]];
    for (var i = 0; i < notes.length; i++) {
      playTone(this.ctx, this.sfxGain, NOTES[notes[i][0]], t, notes[i][1], { type: 'triangle', volume: 1 });
      t += notes[i][1] * 0.9;
    }
  };

  global.TiltHoleSounds = new SoundManager();
})(typeof window !== 'undefined' ? window : this);
