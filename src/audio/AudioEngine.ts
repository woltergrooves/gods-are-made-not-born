// Fully procedural soundscape (no external audio files): rain, river, wind, thunder,
// temple bells, Karplus–Strong koto phrases and spirit effects. Everything is original synthesis.

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private music!: GainNode;
  private reverb!: ConvolverNode;
  private rainGain!: GainNode;
  private riverGain!: GainNode;
  private windGain!: GainNode;
  private fallGain!: GainNode;
  private droneGain!: GainNode;
  private droneOsc: OscillatorNode[] = [];
  private humGain!: GainNode;
  private hum!: OscillatorNode;
  private noise!: AudioBuffer;
  private brown!: AudioBuffer;
  private notes = new Map<number, AudioBuffer>();
  private nextPhrase = 4;
  private dread = 0;
  muted = false;
  volume = 0.8;

  async start(): Promise<void> {
    if (this.ctx) { if (this.ctx.state === 'suspended') await this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3;
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    this.master.connect(comp).connect(ctx.destination);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.2);
    const revGain = ctx.createGain(); revGain.gain.value = 0.55;
    this.reverb.connect(revGain).connect(this.master);
    this.music = ctx.createGain(); this.music.gain.value = 0.5;
    this.music.connect(this.master); this.music.connect(this.reverb);

    this.noise = this.makeNoise(4, false);
    this.brown = this.makeNoise(4, true);
    this.rainGain = this.loop(this.noise, [{ t: 'highpass', f: 900 }, { t: 'lowpass', f: 7000 }], 0.0);
    this.riverGain = this.loop(this.brown, [{ t: 'lowpass', f: 900 }, { t: 'peaking', f: 300, g: 6 }], 0.0);
    this.fallGain = this.loop(this.brown, [{ t: 'lowpass', f: 1800 }], 0.0);
    this.windGain = this.loop(this.brown, [{ t: 'bandpass', f: 420, q: 0.6 }], 0.0, true);

    // dark drone
    this.droneGain = ctx.createGain(); this.droneGain.gain.value = 0.0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
    this.droneGain.connect(lp).connect(this.music);
    for (const f of [36.7, 55.0, 73.6]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = 0.08;
      o.connect(g).connect(this.droneGain); o.start();
      this.droneOsc.push(o);
    }
    // spirit hum
    this.hum = ctx.createOscillator(); this.hum.type = 'sine'; this.hum.frequency.value = 220;
    this.humGain = ctx.createGain(); this.humGain.gain.value = 0;
    this.hum.connect(this.humGain).connect(this.reverb);
    this.hum.start();

    // pre-render koto notes (D "in"-style pentatonic: D Eb G A Bb across octaves)
    const scale = [146.8, 155.6, 196.0, 220.0, 233.1, 293.7, 311.1, 392.0, 440.0, 466.2];
    scale.forEach((f, i) => this.notes.set(i, this.karplus(f, 2.6)));
    const fade = (g: GainNode, v: number) => g.gain.setTargetAtTime(v, ctx.currentTime, 2.5);
    fade(this.droneGain, 0.5);
  }

  private makeNoise(sec: number, brown: boolean): AudioBuffer {
    const ctx = this.ctx!;
    const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return b;
  }

  private impulse(sec: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * sec;
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    return b;
  }

  private loop(buf: AudioBuffer, filters: { t: BiquadFilterType; f: number; q?: number; g?: number }[], gain: number, lfo = false): GainNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    let node: AudioNode = src;
    let first: BiquadFilterNode | null = null;
    for (const f of filters) {
      const bq = ctx.createBiquadFilter(); bq.type = f.t; bq.frequency.value = f.f;
      if (f.q) bq.Q.value = f.q;
      if (f.g) bq.gain.value = f.g;
      node.connect(bq); node = bq;
      first ??= bq;
    }
    const g = ctx.createGain(); g.gain.value = gain;
    node.connect(g).connect(this.master);
    if (lfo && first) {
      const o = ctx.createOscillator(); o.frequency.value = 0.09;
      const og = ctx.createGain(); og.gain.value = 260;
      o.connect(og).connect(first.frequency); o.start();
    }
    src.start(0, Math.random() * buf.duration);
    return g;
  }

  private karplus(freq: number, sec: number): AudioBuffer {
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;
    const b = ctx.createBuffer(1, sr * sec, sr);
    const d = b.getChannelData(0);
    const N = Math.round(sr / freq);
    const ring = new Float32Array(N);
    for (let i = 0; i < N; i++) ring[i] = (Math.random() * 2 - 1) * (1 - i / N * 0.5);
    let idx = 0;
    for (let i = 0; i < d.length; i++) {
      const a = ring[idx]!, nb = ring[(idx + 1) % N]!;
      const v = (a + nb) * 0.5 * 0.996;
      ring[idx] = v;
      d[i] = a * 0.6 * (i < 40 ? i / 40 : 1);
      idx = (idx + 1) % N;
    }
    return b;
  }

  private playNote(i: number, when: number, vol: number): void {
    const ctx = this.ctx!;
    const buf = this.notes.get(i);
    if (!buf) return;
    const s = ctx.createBufferSource(); s.buffer = buf;
    s.playbackRate.value = this.dread > 0.4 ? 0.985 : 1;
    const g = ctx.createGain(); g.gain.value = vol;
    const p = ctx.createStereoPanner(); p.pan.value = (Math.random() - 0.5) * 0.6;
    s.connect(g).connect(p).connect(this.music);
    s.start(when);
  }

  /** Temple bell: inharmonic partials with long decay and beating. */
  bell(distance = 0.2, pitch = 1, vol = 0.5): void {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const base = 98 * pitch;
    const out = ctx.createGain(); out.gain.value = vol * (1 - distance * 0.7);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3800 - distance * 3000;
    out.connect(lp).connect(this.reverb);
    lp.connect(this.master);
    for (const [r, a, d] of [[1, 0.5, 7], [2.0, 0.28, 5], [2.76, 0.22, 4], [4.07, 0.12, 2.5], [5.4, 0.08, 1.8], [8.93, 0.04, 1]] as const) {
      for (const det of [-0.6, 0.6]) {
        const o = ctx.createOscillator(); o.frequency.value = base * r + det;
        const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a * 0.5, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.connect(g).connect(out); o.start(t); o.stop(t + d + 0.1);
      }
    }
  }

  thunder(delay: number, power: number): void {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource(); s.buffer = this.brown;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(1400 * power, t); lp.frequency.exponentialRampToValueAtTime(90, t + 3.5);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1.2 * power, t + 0.08); g.gain.exponentialRampToValueAtTime(0.001, t + 4.5);
    s.connect(lp).connect(g).connect(this.master); g.connect(this.reverb);
    s.start(t, Math.random() * 2); s.stop(t + 5);
  }

  sfx(kind: 'jump' | 'dodge' | 'chime' | 'ward' | 'howl' | 'rend' | 'land' | 'crash' | 'lift' | 'form'): void {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const env = (g: GainNode, a: number, peak: number, d: number) => { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); };
    const noiseBurst = (f0: number, f1: number, peak: number, d: number, type: BiquadFilterType = 'bandpass') => {
      const s = ctx.createBufferSource(); s.buffer = this.noise;
      const bq = ctx.createBiquadFilter(); bq.type = type; bq.frequency.setValueAtTime(f0, t); bq.frequency.exponentialRampToValueAtTime(f1, t + d); bq.Q.value = 1.2;
      const g = ctx.createGain(); env(g, 0.01, peak, d);
      s.connect(bq).connect(g).connect(this.master); g.connect(this.reverb);
      s.start(t, Math.random()); s.stop(t + d + 0.1);
    };
    const tone = (f: number, type: OscillatorType, peak: number, d: number, f1?: number, dest: AudioNode = this.master) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + d);
      const g = ctx.createGain(); env(g, 0.02, peak, d);
      o.connect(g).connect(dest); g.connect(this.reverb); o.start(t); o.stop(t + d + 0.1);
    };
    switch (kind) {
      case 'jump': noiseBurst(500, 2400, 0.25, 0.35); tone(330, 'sine', 0.06, 0.4, 660); break;
      case 'dodge': noiseBurst(3000, 400, 0.35, 0.3); break;
      case 'land': noiseBurst(300, 80, 0.3, 0.25, 'lowpass'); break;
      case 'chime': tone(880, 'sine', 0.12, 1.4); tone(1318, 'sine', 0.06, 1.0); break;
      case 'lift': [440, 554, 659, 880].forEach((f, i) => { const o = ctx.createOscillator(); o.frequency.value = f; const g = ctx.createGain(); g.gain.setValueAtTime(0, t + i * 0.12); g.gain.linearRampToValueAtTime(0.08, t + i * 0.12 + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.12 + 2); o.connect(g).connect(this.reverb); o.start(t + i * 0.12); o.stop(t + i * 0.12 + 2.2); }); break;
      case 'ward': [523, 659, 784, 1046].forEach((f) => tone(f, 'triangle', 0.06, 2.2)); break;
      case 'form': [293, 440, 587, 880].forEach((f) => tone(f, 'sine', 0.07, 3.5)); this.bell(0.5, 1.5, 0.25); break;
      case 'howl': {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(140, t); o.frequency.linearRampToValueAtTime(95, t + 1.6); o.frequency.exponentialRampToValueAtTime(55, t + 2.6);
        const ws = ctx.createWaveShaper(); const curve = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 4); } ws.curve = curve;
        const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.setValueAtTime(700, t); f1.frequency.linearRampToValueAtTime(380, t + 2.4); f1.Q.value = 3;
        const g = ctx.createGain(); env(g, 0.15, 0.55, 2.5);
        o.connect(ws).connect(f1).connect(g).connect(this.master); g.connect(this.reverb);
        o.start(t); o.stop(t + 3);
        noiseBurst(200, 60, 0.4, 2.2, 'lowpass');
        break;
      }
      case 'rend': noiseBurst(4000, 200, 0.6, 0.6, 'lowpass'); tone(80, 'square', 0.25, 0.5, 40); break;
      case 'crash': noiseBurst(1800, 60, 0.9, 1.6, 'lowpass'); tone(60, 'sine', 0.5, 1.2, 30); break;
    }
  }

  setDread(d: number): void {
    this.dread = d;
    if (!this.ctx) return;
    this.droneOsc[2]?.frequency.setTargetAtTime(73.6 + d * 4.2, this.ctx.currentTime, 1.5);
    this.droneGain.gain.setTargetAtTime(0.45 + d * 0.6, this.ctx.currentTime, 1.5);
  }

  /** Per-frame ambience mix. */
  update(dt: number, p: { rain: number; riverDist: number; fallDist: number; speed: number; inForest: number; paused: boolean }): void {
    const ctx = this.ctx; if (!ctx) return;
    const now = ctx.currentTime;
    const k = 0.3;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume * (p.paused ? 0.45 : 1), now, 0.2);
    this.rainGain.gain.setTargetAtTime(0.11 * p.rain, now, k);
    this.riverGain.gain.setTargetAtTime(0.5 * Math.max(0.05, 1 - p.riverDist / 45), now, k);
    this.fallGain.gain.setTargetAtTime(0.4 * Math.max(0, 1 - p.fallDist / 70), now, k);
    this.windGain.gain.setTargetAtTime(0.12 + 0.12 * p.inForest, now, k);
    this.hum.frequency.setTargetAtTime(180 + p.speed * 9, now, 0.2);
    this.humGain.gain.setTargetAtTime(0.012 + p.speed * 0.0025, now, 0.3);
    this.nextPhrase -= dt;
    if (this.nextPhrase <= 0 && !p.paused) {
      this.nextPhrase = 5 + Math.random() * 8;
      const len = 2 + Math.floor(Math.random() * 4);
      let n = Math.floor(Math.random() * 6) + 2;
      for (let i = 0; i < len; i++) {
        this.playNote(n, now + i * (0.35 + Math.random() * 0.45), 0.12 + Math.random() * 0.06);
        n = Math.max(0, Math.min(9, n + [-2, -1, 1, 2, -1][Math.floor(Math.random() * 5)]!));
      }
    }
  }
}
