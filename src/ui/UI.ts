// DOM overlays: menus, HUD, dialogue, journal, settings and the developer panel.

import * as THREE from 'three';
import type { Input, ButtonId } from '../input/Input.js';
import type { GameState } from '../sim/types.js';
import { ASPECTS, DOMAINS } from '../sim/types.js';
import { NPCS, NPC_BY_ID, DOMAIN_NAMES, FACTIONS } from '../sim/content.js';
import { regionalBelief, freshness } from '../sim/BeliefEngine.js';
import { abilityName, activeConsequences } from '../sim/GameState.js';
import type { SaveSummary } from '../save/SaveCore.js';
import type { DialogueLine } from '../sim/dialogue.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export class UI {
  private toastQueue: { kind: string; text: string }[] = [];
  private toastTimer = 0;
  private dialogue: DialogueLine[] = [];
  private dialogueDone: (() => void) | null = null;
  private barkEls = new Map<string, HTMLElement>();
  private screenStack: string[] = [];
  onMenu: ((act: string, from: string) => void) | null = null;
  onSlot: ((slot: string) => void) | null = null;
  onSettings: ((s: Partial<GameState['settings']> & { volume?: number; fps?: boolean }) => void) | null = null;

  constructor(private input: Input) {
    document.querySelectorAll<HTMLButtonElement>('.menu button, .journal-wrap [data-act]').forEach((b) => {
      b.addEventListener('click', () => {
        const scr = b.closest('.screen') as HTMLElement | null;
        this.onMenu?.(b.dataset['act']!, scr?.id ?? '');
      });
    });
    $('btn-pause').addEventListener('click', () => this.onMenu?.('pause', 'hud'));
    $('btn-journal').addEventListener('click', () => this.onMenu?.('journal', 'hud'));
    // action buttons: pointer events so multi-touch works with the joystick
    document.querySelectorAll<HTMLButtonElement>('#buttons .act').forEach((b) => {
      const id = b.dataset['btn'] as ButtonId;
      const down = (e: Event) => { e.preventDefault(); e.stopPropagation(); b.classList.add('pressed'); this.input.button(id, true); };
      const up = (e: Event) => { e.preventDefault(); b.classList.remove('pressed'); this.input.button(id, false); };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
      b.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    });
    $('dialogue').addEventListener('pointerdown', (e) => { e.preventDefault(); this.advanceDialogue(); });
    input.onStick = (active, ox, oy, dx, dy) => {
      const st = $('stick');
      st.classList.toggle('hidden', !active);
      if (!active) return;
      st.style.left = `${ox}px`; st.style.top = `${oy}px`;
      const len = Math.hypot(dx, dy), m = Math.min(len, 50);
      const k = len > 0 ? m / len : 0;
      $('stick-knob').style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    };
    const set = () => this.onSettings?.({
      quality: ($('s-quality') as HTMLSelectElement).value as GameState['settings']['quality'],
      sensitivity: parseFloat(($('s-sens') as HTMLInputElement).value),
      invertY: ($('s-invert') as HTMLInputElement).checked,
      debug: ($('s-debug') as HTMLInputElement).checked,
      volume: parseFloat(($('s-vol') as HTMLInputElement).value),
      fps: ($('s-fps') as HTMLInputElement).checked,
    });
    for (const id of ['s-quality', 's-sens', 's-invert', 's-debug', 's-vol', 's-fps']) $(id).addEventListener('input', set);
  }

  // ── screens ──
  show(id: string, on = true): void { $(id).classList.toggle('hidden', !on); }
  isOpen(id: string): boolean { return !$(id).classList.contains('hidden'); }
  pushScreen(id: string): void {
    const cur = this.screenStack[this.screenStack.length - 1];
    if (cur) this.show(cur, false);
    this.screenStack.push(id); this.show(id, true);
  }
  popScreen(): string | undefined {
    const cur = this.screenStack.pop();
    if (cur) this.show(cur, false);
    const prev = this.screenStack[this.screenStack.length - 1];
    if (prev) this.show(prev, true);
    return prev;
  }
  clearScreens(): void { for (const s of this.screenStack) this.show(s, false); this.screenStack = []; }
  get anyScreen(): boolean { return this.screenStack.length > 0; }

  setLoading(p: number, label: string): void {
    $('load-fill').style.width = `${Math.round(p * 100)}%`;
    $('load-label').textContent = label;
  }

  setSettings(s: GameState['settings'], volume: number, fps: boolean): void {
    ($('s-quality') as HTMLSelectElement).value = s.quality;
    ($('s-sens') as HTMLInputElement).value = String(s.sensitivity);
    ($('s-invert') as HTMLInputElement).checked = s.invertY;
    ($('s-debug') as HTMLInputElement).checked = s.debug;
    ($('s-vol') as HTMLInputElement).value = String(volume);
    ($('s-fps') as HTMLInputElement).checked = fps;
  }

  renderSlots(mode: 'save' | 'load', list: SaveSummary[]): void {
    $('slots-title').textContent = mode === 'save' ? 'Save' : 'Load';
    const el = $('slot-list');
    el.innerHTML = '';
    const slots = mode === 'save' ? ['slot1', 'slot2', 'slot3'] : ['auto', 'slot1', 'slot2', 'slot3'];
    for (const slot of slots) {
      const s = list.find((l) => l.slot === slot);
      const b = document.createElement('button');
      const name = slot === 'auto' ? 'Autosave' : `Slot ${slot.slice(-1)}`;
      const detail = s ? (s.savedAt ? `${s.title || 'Nameless'} · ${fmtTime(s.playTime)} · ${new Date(s.savedAt).toLocaleString()}` : s.label) : 'Empty';
      b.innerHTML = `<span>${name}</span><small>${escapeHtml(detail)}${s?.recovered ? ' · backup' : ''}</small>`;
      b.disabled = mode === 'load' && (!s || !s.ok);
      if (b.disabled) b.style.opacity = '0.4';
      b.addEventListener('click', () => this.onSlot?.(slot));
      el.appendChild(b);
    }
  }

  // ── HUD ──
  setTouchLayout(touch: boolean): void { $('buttons').classList.toggle('desktop', !touch); }

  setForm(title: string, domains: string[]): void {
    $('form-title').textContent = title;
    $('form-domains').textContent = domains.map((d) => DOMAIN_NAMES[d as keyof typeof DOMAIN_NAMES] ?? d).join(' · ');
  }

  setAbility(ability: string | null, label: string | null): void {
    const b = $('b-ability');
    b.classList.toggle('locked', !ability);
    b.querySelector('span')!.textContent = label ?? (ability ? abilityName(ability) : 'Power');
  }

  setInteract(label: string | null): void {
    $('b-interact-label').textContent = label ? label.split(' ')[0]! : 'Act';
    $('b-interact').classList.toggle('ready', !!label);
  }

  prompt(text: string | null, progress = 0): void {
    const p = $('prompt');
    p.classList.toggle('hidden', !text);
    if (text) {
      $('prompt-text').textContent = text;
      $('prompt-ring').style.strokeDashoffset = String(106.8 * (1 - progress));
    }
  }

  hint(text: string | null): void {
    $('hint').classList.toggle('hidden', !text);
    if (text) $('hint').textContent = text;
  }
  objective(text: string | null): void {
    $('objective').classList.toggle('hidden', !text);
    if (text) $('objective').textContent = text;
  }

  stamina(v: number, max: number): void {
    const el = $('stamina');
    el.classList.toggle('show', v < max - 0.5);
    el.classList.toggle('low', v < 25);
    $('stamina-fill').style.width = `${(v / max) * 100}%`;
  }

  toast(kind: string, text: string): void {
    this.toastQueue.push({ kind, text });
    if (this.toastQueue.length > 8) this.toastQueue.splice(0, this.toastQueue.length - 8);
  }

  hudMode(mode: 'play' | 'talk' | 'cinematic'): void {
    const h = $('hud');
    h.classList.toggle('talking', mode === 'talk');
    h.classList.toggle('cinematic', mode === 'cinematic');
  }

  update(dt: number): void {
    this.toastTimer -= dt;
    const box = $('toasts');
    if (this.toastTimer <= 0 && this.toastQueue.length) {
      const t = this.toastQueue.shift()!;
      const el = document.createElement('div');
      el.className = `toast ${t.kind}`;
      el.textContent = t.text;
      box.appendChild(el);
      const life = 3.4 + t.text.length * 0.035;
      setTimeout(() => el.classList.add('out'), life * 1000);
      setTimeout(() => el.remove(), life * 1000 + 700);
      while (box.children.length > 3) box.firstElementChild?.remove();
      this.toastTimer = 1.1;
    }
  }

  barks(items: { id: string; text: string | null; pos: THREE.Vector3 }[], camera: THREE.Camera): void {
    const root = $('barks');
    const seen = new Set<string>();
    const w = window.innerWidth, h = window.innerHeight;
    for (const it of items) {
      if (!it.text) continue;
      const v = it.pos.clone().project(camera);
      if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) continue;
      seen.add(it.id);
      let el = this.barkEls.get(it.id);
      if (!el) { el = document.createElement('div'); el.className = 'bark'; root.appendChild(el); this.barkEls.set(it.id, el); }
      if (el.textContent !== it.text) el.textContent = it.text;
      el.style.left = `${(v.x * 0.5 + 0.5) * w}px`;
      el.style.top = `${(-v.y * 0.5 + 0.5) * h}px`;
    }
    for (const [id, el] of this.barkEls) if (!seen.has(id)) { el.remove(); this.barkEls.delete(id); }
  }

  fps(v: number | null, extra = ''): void {
    $('fps').classList.toggle('hidden', v === null);
    if (v !== null) $('fps').textContent = `${v.toFixed(0)} fps ${extra}`;
  }

  // ── dialogue ──
  get talking(): boolean { return this.dialogue.length > 0; }
  openDialogue(lines: DialogueLine[], done: () => void): void {
    if (!lines.length) { done(); return; }
    this.dialogue = [...lines];
    this.dialogueDone = done;
    this.show('dialogue', true);
    this.hudMode('talk');
    this.renderDialogue();
  }
  private renderDialogue(): void {
    const l = this.dialogue[0]!;
    $('dlg-speaker').textContent = l.speaker;
    $('dlg-text').textContent = l.text;
  }
  advanceDialogue(): void {
    if (!this.dialogue.length) return;
    this.dialogue.shift();
    if (this.dialogue.length) this.renderDialogue();
    else { this.show('dialogue', false); this.hudMode('play'); const d = this.dialogueDone; this.dialogueDone = null; d?.(); }
  }

  // ── journal ──
  renderJournal(state: GameState): void {
    const f = state.form;
    const b = regionalBelief(state, 'amahara');
    const chips = ASPECTS.filter((a) => Math.abs(b.aspects[a]) > 0.04).sort((x, y) => b.aspects[y] - b.aspects[x])
      .map((a) => `<span class="chip">${cap(a)} <b>${pct(b.aspects[a])}</b></span>`).join('');
    const dchips = DOMAINS.filter((d) => b.domains[d] > 0.04).map((d) => `<span class="chip">${DOMAIN_NAMES[d]} <b>${pct(b.domains[d])}</b></span>`).join('');
    const kur = state.belief.regions.kurogane;
    const cons = activeConsequences(state).map((c) => `<li>${escapeHtml(c.description)}</li>`).join('');
    $('j-identity').innerHTML = `<div class="title">${escapeHtml(f.title)}</div>
      <div class="note">How Amahara sees you (${pct(state.belief.regions.amahara.awareness)} of the village has heard of you)</div>
      <div class="aspects">${chips || '<span class="chip">No one believes in you yet</span>'}${dchips}</div>
      ${state.abilities.length ? `<div class="aspects">${state.abilities.map((a) => `<span class="chip">Power: <b>${abilityName(a)}</b></span>`).join('')}</div>` : ''}
      ${kur.awareness > 0 ? `<p class="note">Kurogane, beyond the pass: ${escapeHtml(kur.folk.summary)}</p>` : ''}
      ${cons ? `<h3>The valley has changed</h3><ul class="note">${cons}</ul>` : ''}`;
    $('j-beliefs').innerHTML = NPCS.filter((n) => state.belief.npc[n.id]!.conviction > 0.01 || state.npcs[n.id]!.memory.length).map((n) => {
      const nb = state.belief.npc[n.id]!;
      const top = ASPECTS.filter((a) => nb.aspects[a] > 0.08).sort((x, y) => nb.aspects[y] - nb.aspects[x]).slice(0, 3);
      const fac = n.faction !== 'none' ? ` · ${FACTIONS[n.faction].name}` : '';
      return `<div class="belief-row"><div class="who">${n.name}<small>${n.title}${fac}</small></div><div>${escapeHtml(nb.summary)}
        <div class="bars">${top.map((a) => `<span class="chip">${cap(a)} <b>${pct(nb.aspects[a])}</b></span>`).join('')}</div></div></div>`;
    }).join('') || '<p class="note">No one has truly perceived you yet.</p>';
    $('j-log').innerHTML = [...state.journal].reverse().slice(0, 60)
      .map((j) => `<li class="${j.kind}">${escapeHtml(j.text)}</li>`).join('');
  }

  // ── developer panel ──
  renderDebug(state: GameState, extra: Record<string, string>): void {
    const el = $('debug');
    const row = (label: string, vals: number[]) => `<tr><td>${label}</td>${vals.map((v) => `<td class="${v > 0.005 ? 'pos' : v < -0.005 ? 'neg' : ''}">${v.toFixed(2)}</td>`).join('')}</tr>`;
    const head = `<tr><th></th>${ASPECTS.map((a) => `<th>${a.slice(0, 3)}</th>`).join('')}<th>conv</th></tr>`;
    let rows = '';
    for (const n of NPCS) { const b = state.belief.npc[n.id]!; rows += row(n.name, [...ASPECTS.map((a) => b.aspects[a]), b.conviction]); }
    for (const r of ['amahara', 'kurogane'] as const) { const f = state.belief.regions[r].folk; rows += row(`folk:${r}`, [...ASPECTS.map((a) => f.aspects[a]), f.conviction]); }
    const rb = regionalBelief(state, 'amahara');
    rows += row('REGION', [...ASPECTS.map((a) => rb.aspects[a]), rb.conviction]);
    const npcRows = Object.values(state.npcs).map((n) => `<tr><td>${NPC_BY_ID[n.id]?.name}</td><td>${n.mood}</td><td>rel ${n.relationship.toFixed(2)}</td><td>fear ${n.fear.toFixed(2)}</td><td>${n.present ? '' : 'gone'}</td></tr>`).join('');
    const rumors = state.belief.rumors.slice(-8).reverse().map((r) => `<tr><td>${r.id} ${NPC_BY_ID[r.originator]?.name ?? r.originator}:${r.readingId}</td><td>fresh ${freshness(r, state.worldTime).toFixed(2)}</td><td>${r.holders.length} hold</td><td>${r.rejectedBy.length} rej</td></tr>`).join('');
    const events = state.belief.events.slice(-6).reverse().map((e) => `<div>${e.id} @${e.time.toFixed(0)}m · seen by ${e.witnesses.join(', ') || 'no one'}</div>`).join('');
    el.innerHTML = `<h4>Belief (aspects)</h4><table>${head}${rows}</table>
      <h4>NPC state</h4><table>${npcRows}</table>
      <h4>Rumors</h4><table>${rumors}</table>
      <h4>Events</h4>${events || '<div>none</div>'}
      <h4>World</h4><div>${Object.entries(state.flags).map(([k, v]) => `${k}=${v}`).join(' · ')}</div>
      <div>form: ${state.form.title} stage ${state.form.stage} [${state.form.parts.join(',')}] · t=${state.worldTime.toFixed(1)}m</div>
      <div>${Object.entries(extra).map(([k, v]) => `${k}: ${v}`).join(' · ')}</div>`;
  }
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
const pct = (v: number) => `${Math.round(v * 100)}%`;
function fmtTime(s: number): string { const m = Math.floor(s / 60); return `${m}m ${Math.floor(s % 60)}s`; }
function escapeHtml(s: string): string { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!); }
