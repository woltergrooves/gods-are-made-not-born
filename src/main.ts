// Bootstrap: pick a quality preset, build the valley, show the title screen.

import { Game } from './game/Game.js';
import { detectDefaultQuality, type Quality } from './render/Renderer.js';

const BUILD = '0.1.0';

function fatal(msg: string): void {
  document.getElementById('loading')?.classList.add('hidden');
  const f = document.getElementById('fatal')!;
  f.classList.remove('hidden');
  document.getElementById('fatal-msg')!.textContent = msg;
}

async function boot(): Promise<void> {
  document.getElementById('build-id')!.textContent = BUILD;
  const test = document.createElement('canvas');
  if (!(test.getContext('webgl2') || test.getContext('webgl'))) {
    fatal('This browser does not support WebGL, which the game needs to draw the valley.');
    return;
  }
  let quality: Quality = detectDefaultQuality();
  const params = new URLSearchParams(location.search);
  try {
    const saved = localStorage.getItem('gamnb:quality') as Quality | null;
    if (saved === 'low' || saved === 'medium' || saved === 'high') quality = saved;
  } catch { /* storage may be blocked */ }
  const q = params.get('quality');
  if (q === 'low' || q === 'medium' || q === 'high') quality = q;

  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const game = new Game(canvas, quality);
  (window as unknown as { __game: Game }).__game = game; // dev/test hook
  try {
    const vol = parseFloat(localStorage.getItem('gamnb:volume') ?? '');
    if (Number.isFinite(vol)) game.audio.volume = vol;
  } catch { /* ignore */ }
  game.state.settings.quality = quality;
  await game.init();
  await game.showTitle();
  if (params.has('autostart')) game.startNew();
}

window.addEventListener('error', (e) => console.error('[game]', e.message));
boot().catch((e) => { console.error(e); fatal(String(e?.message ?? e)); });
