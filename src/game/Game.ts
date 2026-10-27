// Game lifecycle: owns the world, the player, the simulation and the frame loop.
// Visual code reads simulation state; decisions are made in src/sim, never here.

import * as THREE from 'three';
import { GameRenderer, PRESETS, type Quality } from '../render/Renderer.js';
import { Valley } from '../world/Valley.js';
import { PlayerController, CameraRig } from '../player/PlayerController.js';
import { SpiritBody } from '../player/SpiritBody.js';
import { NpcManager } from '../npc/NpcManager.js';
import { Input } from '../input/Input.js';
import { UI } from '../ui/UI.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import { SaveManager, type SlotId } from '../save/SaveCore.js';
import { IdbStorage } from '../platform/IdbStorage.js';
import { createGameState, stepWorld, activeConsequences, applyFloodOutcome, abilityName, refreshForm, type FloodOutcome } from '../sim/GameState.js';
import { recordEvent, log, type WitnessInput } from '../sim/BeliefEngine.js';
import { dialogueFor, barkFor } from '../sim/dialogue.js';
import type { GameState } from '../sim/types.js';
import { PLACES, riverX, heightAt, distToRiver, forestDensity } from '../world/layout.js';

type Mode = 'loading' | 'title' | 'intro' | 'play' | 'paused';
const FLOOD_DURATION = 170; // seconds of player time before the village acts without you

interface Prompt { id: string; text: string; hold: number; act: () => void }

export class Game {
  renderer!: GameRenderer;
  valley!: Valley;
  camera = new THREE.PerspectiveCamera(58, 1, 0.1, 1600);
  player!: PlayerController;
  rig!: CameraRig;
  body!: SpiritBody;
  npcs!: NpcManager;
  input: Input;
  ui: UI;
  audio = new AudioEngine();
  saves = new SaveManager(new IdbStorage());
  state: GameState = createGameState();
  mode: Mode = 'loading';
  private last = performance.now();
  private time = 0;
  private cons = new Set<string>();
  private consTimer = 0;
  private journalSeen = 0;
  private holdProgress = 0;
  private holdId = '';
  private cooldown = 0;
  private autosaveTimer = 0;
  private pendingAutosave = -1;
  private hintTimer = 0;
  private sequence: { t: number; steps: { at: number; fn: () => void; done?: boolean }[] } | null = null;
  private vfx: { mesh: THREE.Mesh; t: number; dur: number; grow: number }[] = [];
  private showFps = false;
  private debugTimer = 0;
  private lastTitle = '';
  private quality: Quality;

  constructor(private canvas: HTMLCanvasElement, quality: Quality) {
    this.quality = quality;
    this.input = new Input(canvas);
    this.ui = new UI(this.input);
  }

  async init(): Promise<void> {
    this.renderer = new GameRenderer(this.canvas, this.quality);
    this.valley = new Valley();
    const progress = async (p: number, label: string) => { this.ui.setLoading(p, label); await new Promise((r) => requestAnimationFrame(() => r(null))); };
    await this.valley.build(PRESETS[this.quality], this.quality, progress);
    const scene = this.valley.scene;
    scene.add(this.camera);
    this.player = new PlayerController(this.valley.collision, this.valley.surfaces());
    this.rig = new CameraRig(this.camera, this.valley.collision);
    this.body = new SpiritBody(scene);
    this.npcs = new NpcManager(scene, this.valley.collision, this.valley.village.bridgeDeck, this.quality !== 'low');
    this.npcs.mioRockTop = this.valley.mioRockTop;
    await progress(0.95, 'Compiling shaders');
    this.renderer.setup(scene, this.camera);
    this.onResize();
    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.onResize(), 200));
    // warm up: compile every material once before the player sees anything
    this.player.teleport(PLACES.start.x, PLACES.start.z, Math.PI * 0.55);
    this.rig.snapBehind(this.player);
    this.renderer.renderer.compile(scene, this.camera);
    this.valley.weather.onThunder = (d, p) => this.audio.thunder(d, p);
    this.player.onJump = () => this.audio.sfx('jump');
    this.player.onDodge = () => this.audio.sfx('dodge');
    this.player.onLand = (k) => { if (k > 0.4) this.audio.sfx('land'); };
    this.wireUi();
    await progress(1, 'Ready');
    this.mode = 'title';
    this.last = performance.now();
    requestAnimationFrame(() => this.frame());
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.resize();
  }

  // ─── Menus ────────────────────────────────────────────────────────────────

  private slotMode: 'save' | 'load' = 'load';

  private wireUi(): void {
    const ui = this.ui;
    ui.onMenu = (act, from) => this.menu(act, from);
    ui.onSlot = (slot) => this.slotChosen(slot as SlotId);
    ui.onSettings = (s) => {
      const st = this.state.settings;
      if (s.quality) { if (s.quality !== st.quality) { st.quality = s.quality; try { localStorage.setItem('gamnb:quality', s.quality); } catch { /* */ } } }
      if (s.sensitivity !== undefined) st.sensitivity = s.sensitivity;
      if (s.invertY !== undefined) st.invertY = s.invertY;
      if (s.debug !== undefined) st.debug = s.debug;
      if (s.volume !== undefined) { this.audio.volume = s.volume; try { localStorage.setItem('gamnb:volume', String(s.volume)); } catch { /* */ } }
      if (s.fps !== undefined) this.showFps = s.fps;
      this.input.sensitivity = st.sensitivity; this.input.invertY = st.invertY;
      ui.show('debug', st.debug && this.mode !== 'title');
    };
  }

  async showTitle(): Promise<void> {
    this.mode = 'title';
    this.ui.clearScreens();
    this.ui.show('hud', false);
    this.ui.show('loading', false);
    this.ui.pushScreen('title');
    const latest = await this.saves.latest();
    this.ui.show('btn-continue', !!latest);
    // the title screen sits over a slow flight above the village
    this.rig.cinematic = { from: new THREE.Vector3(riverX(74), 5.5, 74), to: new THREE.Vector3(riverX(46), 6.5, 46), lookFrom: new THREE.Vector3(30, 5, 20), lookTo: new THREE.Vector3(48, 6, 18), t: 0, dur: 70 };
  }

  private async menu(act: string, from: string): Promise<void> {
    const ui = this.ui;
    await this.audio.start();
    switch (act) {
      case 'new': ui.clearScreens(); this.startNew(); break;
      case 'continue': {
        const slot = await this.saves.latest();
        if (slot) await this.loadSlot(slot);
        break;
      }
      case 'load': this.slotMode = 'load'; ui.renderSlots('load', await this.saves.list()); ui.pushScreen('slots'); break;
      case 'save': this.slotMode = 'save'; ui.renderSlots('save', await this.saves.list()); ui.pushScreen('slots'); break;
      case 'settings': ui.setSettings(this.state.settings, this.audio.volume, this.showFps); ui.pushScreen('settings'); break;
      case 'back': ui.popScreen(); break;
      case 'pause': if (this.mode === 'play') this.pause(true); break;
      case 'resume': this.pause(false); break;
      case 'journal':
        ui.renderJournal(this.state);
        if (this.mode === 'play') { this.mode = 'paused'; this.input.enabled = false; }
        ui.pushScreen('journal');
        break;
      case 'close':
        ui.popScreen();
        if (!ui.anyScreen && this.mode === 'paused') { this.mode = 'play'; this.input.enabled = true; }
        break;
      case 'quit': await this.autosave('Quit'); this.showTitle(); break;
    }
    void from;
  }

  private async slotChosen(slot: SlotId): Promise<void> {
    if (this.slotMode === 'save') {
      try {
        await this.saves.save(this.state, slot, `Manual · ${this.state.form.title}`);
        this.ui.toast('system', 'Saved.');
        this.audio.sfx('chime');
      } catch (e) { this.ui.toast('world', `Save failed: ${(e as Error).message}`); }
      this.ui.renderSlots('save', await this.saves.list());
    } else {
      await this.loadSlot(slot);
    }
  }

  private pause(on: boolean): void {
    if (on) { this.mode = 'paused'; this.input.enabled = false; this.ui.pushScreen('pause'); }
    else { this.ui.clearScreens(); this.mode = 'play'; this.input.enabled = true; }
  }

  // ─── Session start / load ────────────────────────────────────────────────

  startNew(): void {
    const settings = { ...this.state.settings, quality: this.quality };
    this.state = createGameState(Math.floor(Math.random() * 1e9));
    this.state.settings = settings;
    this.journalSeen = this.state.journal.length;
    this.applyLoadedWorld();
    this.ui.show('title', false);
    this.ui.show('hud', true);
    this.ui.hudMode('cinematic');
    this.mode = 'intro';
    this.input.enabled = false;
    // Opening: drift through the forest toward the village while the bells ring.
    this.rig.cinematic = {
      from: new THREE.Vector3(-82, 14, 60), to: new THREE.Vector3(PLACES.start.x - 7, heightAt(PLACES.start.x, PLACES.start.z) + 3.2, PLACES.start.z + 3),
      lookFrom: new THREE.Vector3(-40, 6, 30), lookTo: new THREE.Vector3(PLACES.mioRock.x, 1.5, PLACES.mioRock.z), t: 0, dur: 9,
    };
    const card = document.createElement('div');
    card.id = 'intro-card';
    card.innerHTML = '<div>Amahara Valley<small>The Valley of Whispers — the night of the flood</small></div>';
    document.body.appendChild(card);
    this.runSequence([
      { at: 0.3, fn: () => this.audio.bell(0.7, 1, 0.6) },
      { at: 2.2, fn: () => this.valley.weather.strike(1) },
      { at: 3.6, fn: () => this.audio.bell(0.6, 1, 0.6) },
      { at: 6.2, fn: () => this.audio.bell(0.5, 1, 0.5) },
      { at: 6.5, fn: () => card.remove() },
      { at: 9.1, fn: () => this.beginPlay(true) },
    ]);
  }

  private beginPlay(fresh: boolean): void {
    this.mode = 'play';
    this.input.enabled = true;
    this.ui.hudMode('play');
    this.rig.cinematic = null;
    this.rig.snapBehind(this.player);
    this.rig.yaw = Math.atan2(this.player.pos.x - PLACES.mioRock.x, this.player.pos.z - PLACES.mioRock.z);
    if (fresh) {
      this.hintTimer = 14;
      log(this.state, 'world', 'Mio, the miller’s daughter, is trapped on a rock in the rising river. No one can see you yet.');
      void this.autosave('Prologue');
    }
  }

  private applyLoadedWorld(): void {
    const st = this.state;
    this.player.teleport(st.player.x, st.player.z, st.player.yaw);
    this.player.pos.y = Math.max(this.player.pos.y, st.player.y);
    this.rig.snapBehind(this.player);
    refreshForm(st);
    this.body.applyForm(st.form);
    this.lastTitle = st.form.title;
    this.refreshConsequences();
    this.npcs.placeAll(st, this.cons);
    const resolved = st.flags['flood_phase'] === 'resolved';
    this.valley.river.floodTarget = resolved ? 0.15 : 0.35;
    this.valley.river.flood = this.valley.river.floodTarget;
    this.valley.weather.intensity = resolved ? 0.55 : 1;
    this.input.sensitivity = st.settings.sensitivity;
    this.input.invertY = st.settings.invertY;
    this.ui.show('debug', st.settings.debug);
    this.ui.setForm(st.form.title, st.form.domains);
    this.journalSeen = st.journal.length;
  }

  async loadSlot(slot: SlotId): Promise<void> {
    const res = await this.saves.load(slot);
    if (!res) { this.ui.toast('world', 'That save could not be read.'); return; }
    const quality = this.state.settings.quality;
    this.state = res.state;
    this.state.settings.quality = quality;
    this.applyLoadedWorld();
    this.ui.clearScreens();
    this.ui.show('hud', true);
    this.beginPlay(false);
    this.ui.toast('system', res.recovered ? 'The save was damaged — restored from its backup.' : 'Loaded.');
  }

  async autosave(label: string): Promise<void> {
    const p = this.player.pos;
    this.state.player = { x: p.x, y: p.y, z: p.z, yaw: this.player.yaw };
    try { await this.saves.save(this.state, 'auto', `Auto · ${label}`); }
    catch (e) { console.warn('autosave failed', e); }
  }

  // ─── Frame loop ──────────────────────────────────────────────────────────

  private frame(): void {
    requestAnimationFrame(() => this.frame());
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 1 / 15);
    this.last = now;
    this.time += dt;
    try { this.tick(dt); }
    catch (e) { console.error(e); }
  }

  private tick(dt: number): void {
    const input = this.input.poll();
    const st = this.state;
    if (input.debug) { st.settings.debug = !st.settings.debug; this.ui.show('debug', st.settings.debug); }
    if (input.pause && (this.mode === 'play' || this.mode === 'paused')) {
      if (this.ui.talking) this.ui.advanceDialogue();
      else if (this.mode === 'play') this.pause(true);
      else this.pause(false);
    }
    if (input.journal && this.mode === 'play') void this.menu('journal', 'hud');

    const playing = this.mode === 'play' && !this.ui.talking;
    if (this.sequence) this.advanceSequence(dt);

    if (playing) {
      this.player.update(dt, input, this.rig.yaw);
      stepWorld(st, dt);
      this.afterSim();
      this.updateFlood(dt);
      this.updateInteraction(dt, input);
      this.updateAbility(input, dt);
      this.autosaveTimer += dt;
      if (this.autosaveTimer > 120 && st.flags['flood_phase'] === 'resolved') { this.autosaveTimer = 0; void this.autosave('Wandering'); }
      if (this.pendingAutosave > 0) { this.pendingAutosave -= dt; if (this.pendingAutosave <= 0) void this.autosave(String(st.flags['flood_outcome'] ?? 'Checkpoint')); }
    } else if (this.ui.talking && input.interact) {
      this.ui.advanceDialogue();
    }
    this.consTimer -= dt;
    if (this.consTimer <= 0) { this.consTimer = 1.5; this.refreshConsequences(); }

    // camera & presentation
    if (this.mode === 'play' && !this.ui.talking) this.rig.update(dt, input, this.player, this.player.speed > 0.5);
    else this.rig.update(dt, { ...input, lookX: 0, lookY: 0 }, this.player, false);
    this.input.consumeLook();

    this.body.root.position.copy(this.player.pos);
    this.body.root.rotation.y = this.player.yaw;
    this.body.root.visible = this.mode !== 'title';
    this.body.update(dt, this.time, this.player.speed, 0, this.player.grounded);
    const visible = this.mode === 'play';
    this.npcs.update(dt, st, this.cons, this.player.pos, visible, this.valley.river.flood);
    this.valley.update(dt, this.time, this.camera.position, this.player.pos);
    this.updateVfx(dt);
    this.ui.update(dt);
    if (this.mode === 'play' || this.mode === 'intro') this.updateHud(dt);
    this.audio.update(dt, {
      rain: this.valley.weather.intensity, riverDist: Math.max(0, distToRiver(this.camera.position.x, this.camera.position.z)),
      fallDist: this.valley.waterfallDistance(this.camera.position), speed: this.mode === 'play' ? this.player.speed : 0,
      inForest: forestDensity(this.player.pos.x, this.player.pos.z), paused: this.mode === 'paused' || this.mode === 'title',
    });
    this.audio.setDread(this.valley.dreadLevel);
    this.renderer.render(this.valley.scene, this.camera, dt, this.time, this.valley.weather.flash, this.valley.dreadLevel);
    if (this.showFps) this.ui.fps(this.renderer.fps, `· ${this.renderer.renderer.info.render.calls} calls · pr ${this.renderer.pixelRatio.toFixed(2)}`);
    else this.ui.fps(null);
    if (st.settings.debug) {
      this.debugTimer -= dt;
      if (this.debugTimer <= 0) {
        this.debugTimer = 0.5;
        this.ui.renderDebug(st, { fps: this.renderer.fps.toFixed(0), pos: `${this.player.pos.x.toFixed(1)},${this.player.pos.y.toFixed(1)},${this.player.pos.z.toFixed(1)}`, cons: [...this.cons].join(','), flood: this.valley.river.flood.toFixed(2) });
      }
    }
  }

  private afterSim(): void {
    const st = this.state;
    // surface new journal entries as toasts
    while (this.journalSeen < st.journal.length) {
      const j = st.journal[this.journalSeen++]!;
      if (j.kind !== 'system') this.ui.toast(j.kind, j.text);
    }
    if (st.form.title !== this.lastTitle) {
      this.lastTitle = st.form.title;
      this.body.applyForm(st.form);
      this.body.triggerPulse();
      this.audio.sfx('form');
      this.ui.setForm(st.form.title, st.form.domains);
      if (st.flags['flood_phase'] === 'resolved') this.pendingAutosave = 2;
    }
  }

  private refreshConsequences(): void {
    const ids = new Set(activeConsequences(this.state).map((c) => c.id));
    const changed = ids.size !== this.cons.size || [...ids].some((i) => !this.cons.has(i));
    this.cons = ids;
    if (changed) this.valley.applyConsequences(ids, this.state.flags);
  }

  // ─── The Flood ───────────────────────────────────────────────────────────

  private get floodActive(): boolean { return this.state.flags['flood_phase'] !== 'resolved'; }

  private updateFlood(dt: number): void {
    const st = this.state;
    if (!this.floodActive) { this.ui.objective(null); return; }
    if (this.sequence) return;
    const elapsed = ((st.flags['flood_elapsed'] as number) ?? 0) + dt;
    st.flags['flood_elapsed'] = elapsed;
    this.valley.river.floodTarget = Math.min(1, 0.35 + elapsed / 75);
    const left = FLOOD_DURATION - elapsed;
    this.ui.objective(left > 60 ? 'The river is rising around Mio’s rock.' : left > 20 ? 'The water is at Mio’s waist.' : 'Someone on the bank is wading in…');
    if (left <= 0) this.resolveFlood('ignored');
  }

  private witnesses(at: THREE.Vector3, visibility: number, audible = false): WitnessInput[] {
    const out: WitnessInput[] = [];
    for (const a of this.npcs.actors.values()) {
      if (!this.state.npcs[a.id]!.present) continue;
      out.push({ id: a.id, distance: a.pos.distanceTo(at), visibility: audible ? 1 : visibility });
    }
    return out;
  }

  private resolveFlood(outcome: FloodOutcome): void {
    const st = this.state;
    if (!this.floodActive) return;
    const rock = new THREE.Vector3(PLACES.mioRock.x, 0.6, PLACES.mioRock.z);
    const vis = Math.max(0.6, this.body.visibility); // the storm and the lightning reveal it
    const P = this.player.pos.clone();
    const hana = this.npcs.actors.get('hana')!, daichi = this.npcs.actors.get('daichi')!;
    const bankE = new THREE.Vector3(riverX(13) + 6.5, heightAt(riverX(13) + 6.5, 13.5), 13.5);
    const mio = this.npcs.actors.get('mio')!;
    switch (outcome) {
      case 'rescue': {
        st.flags['flood_phase'] = 'active';
        this.audio.sfx('lift');
        this.body.triggerPulse();
        mio.override = new THREE.Vector3(rock.x + 2, 2.2, rock.z + 0.6);
        this.runSequence([
          { at: 1.0, fn: () => { mio.override = bankE.clone(); } },
          { at: 2.4, fn: () => {
            recordEvent(st, 'flood_rescue', { x: rock.x, y: rock.y, z: rock.z }, { mio_survived: true, by: 'spirit' }, this.witnesses(rock, vis));
            this.finishFlood('rescue');
            mio.override = null;
          } },
        ]);
        break;
      }
      case 'weir': {
        st.flags['flood_phase'] = 'active';
        const weir = new THREE.Vector3(riverX(PLACES.weirZ), 0.5, PLACES.weirZ);
        this.burst(weir, '#ffb070', 9);
        this.audio.sfx('crash'); this.audio.sfx('rend');
        this.rig.shake = 1.2;
        this.valley.weather.strike(1);
        st.flags['flood_outcome'] = 'weir';
        this.valley.applyConsequences(this.cons, st.flags);
        this.valley.river.floodTarget = 0;
        this.runSequence([
          { at: 2.6, fn: () => {
            this.audio.sfx('crash'); this.rig.shake = 0.7;
            recordEvent(st, 'flood_weir_shattered', { x: weir.x, y: weir.y, z: weir.z }, { bridge_destroyed: true, mio_survived: true }, this.witnesses(weir, Math.max(vis, 0.9)));
            this.finishFlood('weir');
            this.burst(new THREE.Vector3(riverX(26), 1.5, 26), '#c0a080', 6);
          } },
          { at: 3.2, fn: () => { hana.override = rock.clone().setY(0.5); } },
          { at: 6.0, fn: () => { hana.override = null; } },
        ]);
        break;
      }
      case 'howl': {
        st.flags['flood_phase'] = 'active';
        this.audio.sfx('howl');
        this.rig.shake = 1.5;
        this.valley.weather.strike(1.2);
        this.burst(P.clone().setY(P.y + 1.2), '#ff3040', 14);
        recordEvent(st, 'flood_howl', { x: P.x, y: P.y, z: P.z }, { mio_survived: true, by: 'hana' }, this.witnesses(P, 1, true));
        this.runSequence([
          { at: 0.8, fn: () => { hana.override = rock.clone().setY(0.4); } },
          { at: 3.4, fn: () => { mio.override = bankE.clone(); hana.override = bankE.clone().add(new THREE.Vector3(1, 0, 1)); } },
          { at: 5.2, fn: () => { this.finishFlood('howl'); mio.override = null; hana.override = null; } },
        ]);
        break;
      }
      case 'ignored': {
        st.flags['flood_phase'] = 'active';
        daichi.override = rock.clone().setY(0.4);
        this.runSequence([
          { at: 2.6, fn: () => { mio.override = new THREE.Vector3(riverX(10) - 7, heightAt(riverX(10) - 7, 9), 9); daichi.override = mio.override.clone().add(new THREE.Vector3(-1, 0, 0.5)); } },
          { at: 4.0, fn: () => {
            this.audio.sfx('crash');
            recordEvent(st, 'flood_ignored', { x: P.x, y: P.y, z: P.z }, { mio_survived: true, by: 'daichi' }, this.witnesses(P, this.body.visibility));
            this.finishFlood('ignored');
            daichi.override = null; mio.override = null;
          } },
        ]);
        break;
      }
    }
  }

  private finishFlood(outcome: FloodOutcome): void {
    applyFloodOutcome(this.state, outcome);
    this.valley.river.floodTarget = outcome === 'weir' ? 0 : 0.15;
    this.valley.weather.intensity = 0.55;
    this.refreshConsequences();
    this.valley.applyConsequences(this.cons, this.state.flags);
    if (this.cons.has('warden_bells')) this.valley.ringWardenBells();
    this.pendingAutosave = 4;
    this.ui.objective(null);
  }

  // ─── Interaction & abilities ─────────────────────────────────────────────

  private currentPrompt(): Prompt | null {
    const st = this.state, P = this.player.pos;
    if (this.sequence) return null;
    if (this.floodActive) {
      const dMio = Math.hypot(P.x - PLACES.mioRock.x, P.z - PLACES.mioRock.z);
      if (dMio < 3.6) return { id: 'rescue', text: 'Hold — lift Mio out of the flood', hold: 1.4, act: () => this.resolveFlood('rescue') };
      const dWeir = Math.hypot(P.x - riverX(PLACES.weirZ), P.z - PLACES.weirZ);
      if (dWeir < 7) return { id: 'weir', text: 'Shatter the old weir', hold: 0.6, act: () => this.resolveFlood('weir') };
    }
    const dBell = Math.hypot(P.x - PLACES.shrine.x, P.z - (PLACES.shrine.z + 2));
    if (dBell < 4.5) return { id: 'bell', text: 'Touch the silent bell', hold: 0, act: () => this.touchBell() };
    const n = this.npcs.nearest(P, 3.4, st);
    if (n && !(n.id === 'mio' && this.floodActive)) return { id: `talk:${n.id}`, text: `Approach ${n.id[0]!.toUpperCase()}${n.id.slice(1)}`, hold: 0, act: () => this.talk(n.id) };
    return null;
  }

  private updateInteraction(dt: number, input: { interact: boolean; interactHeld: boolean }): void {
    const p = this.currentPrompt();
    if (!p) { this.ui.prompt(null); this.ui.setInteract(null); this.holdProgress = 0; return; }
    this.ui.setInteract(p.text.replace(/^Hold — /, ''));
    if (p.hold > 0) {
      if (this.holdId !== p.id) { this.holdProgress = 0; this.holdId = p.id; }
      if (input.interactHeld || input.interact) this.holdProgress += dt / p.hold;
      else this.holdProgress = Math.max(0, this.holdProgress - dt * 2);
      this.ui.prompt(p.text, Math.min(1, this.holdProgress));
      if (this.holdProgress >= 1) { this.holdProgress = 0; this.ui.prompt(null); p.act(); }
    } else {
      this.ui.prompt(p.text, 0);
      if (input.interact) { this.ui.prompt(null); p.act(); }
    }
  }

  private talk(id: string): void {
    const lines = dialogueFor(this.state, id);
    this.audio.sfx('chime');
    this.ui.openDialogue(lines, () => {
      const npc = this.state.npcs[id]!;
      if (!npc.memory.includes('spoke_with_spirit') && this.state.form.stage > 0) npc.memory.push('spoke_with_spirit');
    });
  }

  private touchBell(): void {
    const st = this.state;
    this.audio.bell(0.1, 0.8, 0.05);
    const first = !st.flags['bell_touched'];
    st.flags['bell_touched'] = true;
    const lines = [
      { speaker: '', text: 'The bronze is cold. When you touch it, there is no sound at all — as if something has eaten the note before it could be born.', mood: '' },
      { speaker: '', text: 'Words are cut into the post beneath it, half hidden by moss: “What is remembered, remains. What is forgotten, is food.”', mood: '' },
      { speaker: '', text: 'Somewhere up the mountain path, another bell has fallen silent too.', mood: '' },
    ];
    this.ui.openDialogue(lines, () => { if (first) log(st, 'world', 'At the abandoned shrine you found a bell that makes no sound. Something on the mountain is eating them.'); });
  }

  /** Pick the power that best matches who the valley thinks you are. */
  private activeAbility(): string | null {
    const st = this.state;
    if (this.floodActive) {
      const d = Math.hypot(this.player.pos.x - PLACES.mioRock.x, this.player.pos.z - PLACES.mioRock.z);
      return d < 40 ? 'storm_howl' : null;
    }
    const pref: Record<string, string> = { guardian: 'ward', terror: 'howl', destruction: 'rend' };
    for (const a of st.form.dominant) { const ab = pref[a]; if (ab && st.abilities.includes(ab)) return ab; }
    return st.abilities[0] ?? null;
  }

  private updateAbility(input: { ability: boolean }, dt: number): void {
    this.cooldown -= dt;
    const ab = this.activeAbility();
    this.ui.setAbility(ab, ab === 'storm_howl' ? 'Howl' : ab ? abilityName(ab).split(' ').pop()! : null);
    if (!input.ability || !ab || this.cooldown > 0 || this.sequence) return;
    const P = this.player.pos.clone();
    const st = this.state;
    if (ab === 'storm_howl') { this.resolveFlood('howl'); return; }
    this.cooldown = 8;
    if (ab === 'ward') {
      this.audio.sfx('ward');
      this.burst(P.clone().setY(P.y + 1), '#ffd585', 8, true);
      recordEvent(st, 'ward_shown', { x: P.x, y: P.y, z: P.z }, {}, this.witnesses(P, this.body.visibility));
    } else if (ab === 'howl') {
      this.audio.sfx('howl'); this.rig.shake = 1;
      this.burst(P.clone().setY(P.y + 1.2), '#ff3040', 12);
      recordEvent(st, 'howl_used', { x: P.x, y: P.y, z: P.z }, {}, this.witnesses(P, 1, true));
    } else if (ab === 'rend') {
      this.audio.sfx('rend'); this.rig.shake = 0.6;
      const f = P.clone().add(new THREE.Vector3(Math.sin(this.player.yaw) * 2, 1, Math.cos(this.player.yaw) * 2));
      this.burst(f, '#ff7a2a', 5);
      recordEvent(st, 'ember_rend', { x: f.x, y: f.y, z: f.z }, {}, this.witnesses(f, this.body.visibility));
    }
    this.body.triggerPulse();
  }

  // ─── VFX & HUD ───────────────────────────────────────────────────────────

  private burst(at: THREE.Vector3, color: string, size: number, flat = false): void {
    const geo = flat ? new THREE.TorusGeometry(1, 0.06, 6, 64) : new THREE.SphereGeometry(1, 24, 16);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, wireframe: !flat });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(at);
    if (flat) m.rotation.x = Math.PI / 2;
    this.valley.scene.add(m);
    this.vfx.push({ mesh: m, t: 0, dur: 1.4, grow: size });
  }

  private updateVfx(dt: number): void {
    this.vfx = this.vfx.filter((v) => {
      v.t += dt;
      const k = v.t / v.dur;
      v.mesh.scale.setScalar(0.3 + k * v.grow);
      (v.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
      if (k >= 1) { this.valley.scene.remove(v.mesh); v.mesh.geometry.dispose(); (v.mesh.material as THREE.Material).dispose(); return false; }
      return true;
    });
  }

  private updateHud(dt: number): void {
    this.ui.stamina(this.player.stamina, this.player.maxStamina);
    this.ui.setTouchLayout(this.input.touchMode || matchMedia('(pointer: coarse)').matches);
    if (!this.floodActive && this.hintTimer > 0 && this.hintTimer < 7) this.hintTimer = 0.01;
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      const touch = this.input.touchMode || matchMedia('(pointer: coarse)').matches;
      this.ui.hint(this.hintTimer > 7
        ? (touch ? 'Left thumb to drift · drag the right side to look' : 'WASD to drift · drag the mouse to look · Shift to rush')
        : (touch ? 'Mio is on the rock in the river. What you do next is yours.' : 'Mio is on the rock in the river. E to act · F for power · Space to rise'));
      if (this.hintTimer <= 0) this.ui.hint(null);
    }
    const barks: { id: string; text: string | null; pos: THREE.Vector3 }[] = [];
    for (const a of this.npcs.actors.values()) {
      const d = a.pos.distanceTo(this.camera.position);
      if (d > 38 || !this.state.npcs[a.id]!.present) continue;
      const showEvery = (Math.floor(this.time / 3.5) + a.id.length) % 3 === 0;
      barks.push({ id: a.id, text: showEvery ? barkFor(this.state, a.id) : null, pos: a.pos.clone().add(new THREE.Vector3(0, a.fig.style.height + 0.55, 0)) });
    }
    this.ui.barks(barks, this.camera);
  }

  private runSequence(steps: { at: number; fn: () => void }[]): void {
    this.sequence = { t: 0, steps: steps.map((s) => ({ ...s })) };
  }

  private advanceSequence(dt: number): void {
    const s = this.sequence!;
    s.t += dt;
    for (const st of s.steps) if (!st.done && s.t >= st.at) { st.done = true; st.fn(); }
    if (s.steps.every((x) => x.done)) this.sequence = null;
  }
}

