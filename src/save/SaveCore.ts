// Save format, integrity checks and schema migrations. Pure — storage is injected.

import { SCHEMA_VERSION, createGameState } from '../sim/GameState.js';
import type { GameState } from '../sim/types.js';

export interface SaveEnvelope {
  format: 'gamnb-save';
  schemaVersion: number;
  savedAt: number;
  slot: string;
  label: string;
  checksum: string;
  state: GameState;
}

export interface SaveSummary { slot: string; label: string; savedAt: number; title: string; playTime: number; ok: boolean; recovered?: boolean }

export interface StorageAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export const SLOTS = ['auto', 'slot1', 'slot2', 'slot3'] as const;
export type SlotId = typeof SLOTS[number];

/** FNV-1a 32-bit — enough to detect truncated or corrupted writes. */
export function checksum(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

type Migration = (s: Record<string, unknown>) => Record<string, unknown>;
/**
 * MIGRATIONS[n] upgrades a version-n state to version n+1.
 * Add one here every time SCHEMA_VERSION is bumped. Never delete old ones.
 */
export const MIGRATIONS: Record<number, Migration> = {
  // 0 -> 1: pre-release saves had no settings/abilities blocks.
  0: (s) => ({
    ...s,
    abilities: (s['abilities'] as string[] | undefined) ?? [],
    settings: (s['settings'] as object | undefined) ?? { quality: 'medium', invertY: false, sensitivity: 1, debug: false },
    schemaVersion: 1,
  }),
};

export function migrate(raw: Record<string, unknown>, target = SCHEMA_VERSION): GameState {
  let s = raw;
  let v = typeof s['schemaVersion'] === 'number' ? (s['schemaVersion'] as number) : 0;
  if (v > target) throw new Error(`Save is from a newer version (${v}) of the game.`);
  while (v < target) {
    const m = MIGRATIONS[v];
    if (!m) throw new Error(`No migration from schema ${v}`);
    s = m(s);
    v = (s['schemaVersion'] as number) ?? v + 1;
  }
  return repair(s as unknown as GameState);
}

/** Fill in anything missing so a partially-written save still loads. */
export function repair(s: GameState): GameState {
  const fresh = createGameState(s.seed ?? 1337, s.createdAt ?? Date.now());
  const out: GameState = {
    ...fresh, ...s,
    player: { ...fresh.player, ...(s.player ?? {}) },
    belief: { ...fresh.belief, ...(s.belief ?? {}) },
    npcs: { ...fresh.npcs },
    flags: { ...fresh.flags, ...(s.flags ?? {}) },
    settings: { ...fresh.settings, ...(s.settings ?? {}) },
    abilities: Array.isArray(s.abilities) ? s.abilities : [],
    journal: Array.isArray(s.journal) ? s.journal : fresh.journal,
  };
  for (const id of Object.keys(fresh.npcs)) out.npcs[id] = { ...fresh.npcs[id]!, ...(s.npcs?.[id] ?? {}) };
  out.belief.npc = { ...fresh.belief.npc, ...(s.belief?.npc ?? {}) };
  out.belief.regions = { ...fresh.belief.regions, ...(s.belief?.regions ?? {}) };
  for (const k of ['events', 'testimonies', 'rumors'] as const) if (!Array.isArray(out.belief[k])) (out.belief as any)[k] = [];
  if (!Number.isFinite(out.player.x) || !Number.isFinite(out.player.z)) out.player = { ...fresh.player };
  return out;
}

export function encode(state: GameState, slot: string, label: string, now = Date.now()): string {
  const stateText = JSON.stringify(state);
  const env: SaveEnvelope = {
    format: 'gamnb-save', schemaVersion: state.schemaVersion, savedAt: now, slot, label,
    checksum: checksum(stateText), state,
  };
  return JSON.stringify(env);
}

export function decode(text: string): GameState {
  const env = JSON.parse(text) as SaveEnvelope;
  if (!env || env.format !== 'gamnb-save' || !env.state) throw new Error('Not a save file');
  const sum = checksum(JSON.stringify(env.state));
  if (sum !== env.checksum) throw new Error('Checksum mismatch');
  return migrate(env.state as unknown as Record<string, unknown>);
}

const key = (slot: string) => `gamnb:${slot}`;
const bakKey = (slot: string) => `gamnb:${slot}:bak`;

export class SaveManager {
  constructor(private store: StorageAdapter) {}

  /** Write with a backup of the previous good save, then verify by reading back. */
  async save(state: GameState, slot: SlotId, label: string): Promise<void> {
    const text = encode(state, slot, label);
    const prev = await this.store.get(key(slot));
    if (prev) {
      try { decode(prev); await this.store.set(bakKey(slot), prev); } catch { /* keep older backup */ }
    }
    await this.store.set(key(slot), text);
    const check = await this.store.get(key(slot));
    if (check !== text) throw new Error('Save verification failed');
  }

  /** Load a slot; falls back to its backup if the main copy is damaged. */
  async load(slot: SlotId): Promise<{ state: GameState; recovered: boolean } | null> {
    const main = await this.store.get(key(slot));
    if (main) {
      try { return { state: decode(main), recovered: false }; } catch { /* fall through */ }
    }
    const bak = await this.store.get(bakKey(slot));
    if (bak) {
      try { return { state: decode(bak), recovered: true }; } catch { /* fall through */ }
    }
    return null;
  }

  async list(): Promise<SaveSummary[]> {
    const out: SaveSummary[] = [];
    for (const slot of SLOTS) {
      const main = await this.store.get(key(slot));
      if (!main) {
        if (await this.store.get(bakKey(slot))) out.push({ slot, label: 'Recovered backup', savedAt: 0, title: '', playTime: 0, ok: true, recovered: true });
        continue;
      }
      try {
        const env = JSON.parse(main) as SaveEnvelope;
        const st = decode(main);
        out.push({ slot, label: env.label, savedAt: env.savedAt, title: st.form.title, playTime: st.playTime, ok: true });
      } catch {
        const hasBak = !!(await this.store.get(bakKey(slot)));
        out.push({ slot, label: hasBak ? 'Damaged — backup available' : 'Damaged save', savedAt: 0, title: '', playTime: 0, ok: hasBak, recovered: hasBak });
      }
    }
    return out;
  }

  async latest(): Promise<SlotId | null> {
    const list = (await this.list()).filter((s) => s.ok);
    if (!list.length) return null;
    list.sort((a, b) => b.savedAt - a.savedAt);
    return list[0]!.slot as SlotId;
  }

  async remove(slot: SlotId): Promise<void> {
    await this.store.remove(key(slot));
    await this.store.remove(bakKey(slot));
  }
}

export class MemoryStorage implements StorageAdapter {
  map = new Map<string, string>();
  async get(k: string) { return this.map.get(k) ?? null; }
  async set(k: string, v: string) { this.map.set(k, v); }
  async remove(k: string) { this.map.delete(k); }
  async keys() { return [...this.map.keys()]; }
}
