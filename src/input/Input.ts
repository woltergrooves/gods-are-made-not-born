// Unified input: keyboard + mouse, touch (virtual joystick + camera drag + buttons) and gamepad.
// Gameplay code only ever reads the abstract InputState.

export interface InputState {
  moveX: number; moveY: number;    // -1..1, y = forward
  lookX: number; lookY: number;    // accumulated camera delta this frame (radians-ish)
  sprint: boolean;
  jump: boolean;                   // pressed this frame
  dodge: boolean;
  interact: boolean;
  interactHeld: boolean;
  ability: boolean;
  pause: boolean;
  debug: boolean;
  journal: boolean;
}

export type ButtonId = 'jump' | 'dodge' | 'interact' | 'ability';

export class Input {
  state: InputState = this.blank();
  private keys = new Set<string>();
  private pressed = new Set<string>();
  private mouseDown = false;
  private touchLook: { id: number; x: number; y: number } | null = null;
  private stick: { id: number; ox: number; oy: number; x: number; y: number } | null = null;
  private held = new Set<ButtonId>();
  private tapped = new Set<ButtonId>();
  sensitivity = 1;
  invertY = false;
  enabled = true;
  onStick: ((active: boolean, ox: number, oy: number, dx: number, dy: number) => void) | null = null;
  touchMode = false;

  constructor(private surface: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code); this.pressed.add(e.code);
      if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.held.clear(); });
    surface.addEventListener('mousedown', (e) => { if (e.button === 0 || e.button === 2) { this.mouseDown = true; this.touchMode = false; } });
    window.addEventListener('mouseup', () => (this.mouseDown = false));
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (this.mouseDown || document.pointerLockElement === surface) {
        this.state.lookX += e.movementX * 0.0042 * this.sensitivity;
        this.state.lookY += e.movementY * 0.0035 * this.sensitivity * (this.invertY ? -1 : 1);
      }
    });
    surface.addEventListener('contextmenu', (e) => e.preventDefault());
    surface.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: false });
    surface.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false });
    surface.addEventListener('touchend', (e) => this.onTouchEnd(e), { passive: false });
    surface.addEventListener('touchcancel', (e) => this.onTouchEnd(e), { passive: false });
  }

  private blank(): InputState {
    return { moveX: 0, moveY: 0, lookX: 0, lookY: 0, sprint: false, jump: false, dodge: false, interact: false, interactHeld: false, ability: false, pause: false, debug: false, journal: false };
  }

  /** Called by on-screen buttons. */
  button(id: ButtonId, down: boolean): void {
    if (down) { this.held.add(id); this.tapped.add(id); } else this.held.delete(id);
  }

  private onTouchStart(e: TouchEvent): void {
    e.preventDefault();
    this.touchMode = true;
    const w = window.innerWidth;
    for (const t of Array.from(e.changedTouches)) {
      if (t.clientX < w * 0.42 && !this.stick) {
        this.stick = { id: t.identifier, ox: t.clientX, oy: t.clientY, x: t.clientX, y: t.clientY };
        this.onStick?.(true, t.clientX, t.clientY, 0, 0);
      } else if (!this.touchLook) {
        this.touchLook = { id: t.identifier, x: t.clientX, y: t.clientY };
      }
    }
  }
  private onTouchMove(e: TouchEvent): void {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (this.stick && t.identifier === this.stick.id) {
        this.stick.x = t.clientX; this.stick.y = t.clientY;
        this.onStick?.(true, this.stick.ox, this.stick.oy, t.clientX - this.stick.ox, t.clientY - this.stick.oy);
      } else if (this.touchLook && t.identifier === this.touchLook.id) {
        if (this.enabled) {
          this.state.lookX += (t.clientX - this.touchLook.x) * 0.0068 * this.sensitivity;
          this.state.lookY += (t.clientY - this.touchLook.y) * 0.0055 * this.sensitivity * (this.invertY ? -1 : 1);
        }
        this.touchLook.x = t.clientX; this.touchLook.y = t.clientY;
      }
    }
  }
  private onTouchEnd(e: TouchEvent): void {
    for (const t of Array.from(e.changedTouches)) {
      if (this.stick && t.identifier === this.stick.id) { this.stick = null; this.onStick?.(false, 0, 0, 0, 0); }
      if (this.touchLook && t.identifier === this.touchLook.id) this.touchLook = null;
    }
  }

  /** Build this frame's state. Call once per frame before gameplay. */
  poll(): InputState {
    const s = this.state;
    const k = (c: string) => this.keys.has(c);
    const p = (c: string) => this.pressed.has(c);
    let mx = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
    let my = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
    let sprint = k('ShiftLeft') || k('ShiftRight');
    if (this.stick) {
      const R = 58;
      const dx = this.stick.x - this.stick.ox, dy = this.stick.y - this.stick.oy;
      const len = Math.hypot(dx, dy);
      const m = Math.min(1, len / R);
      if (len > 6) { mx = (dx / len) * m; my = (-dy / len) * m; }
      sprint = sprint || len > R * 1.15;
    }
    let jump = p('Space') || this.tapped.has('jump');
    let dodge = p('KeyQ') || p('ControlLeft') || this.tapped.has('dodge');
    let interact = p('KeyE') || p('Enter') || this.tapped.has('interact');
    let interactHeld = k('KeyE') || this.held.has('interact');
    let ability = p('KeyF') || this.tapped.has('ability');
    const pause = p('Escape') || p('KeyP');
    const debug = p('Backquote') || p('F2');
    const journal = p('KeyJ') || p('Tab');

    // gamepad (standard mapping)
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp) continue;
      const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
      if (Math.abs(dz(gp.axes[0] ?? 0)) + Math.abs(dz(gp.axes[1] ?? 0)) > 0) { mx = dz(gp.axes[0] ?? 0); my = -dz(gp.axes[1] ?? 0); }
      s.lookX += dz(gp.axes[2] ?? 0) * 0.05 * this.sensitivity;
      s.lookY += dz(gp.axes[3] ?? 0) * 0.04 * this.sensitivity * (this.invertY ? -1 : 1);
      const b = (i: number) => !!gp.buttons[i]?.pressed;
      const edge = (i: number) => { const key = `gp${i}`; const now = b(i); const was = this.keys.has(key); if (now) this.keys.add(key); else this.keys.delete(key); return now && !was; };
      jump = jump || edge(0); dodge = dodge || edge(1); interact = interact || edge(2); ability = ability || edge(3);
      interactHeld = interactHeld || b(2);
      sprint = sprint || b(10) || b(6);
    }

    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    s.moveX = this.enabled ? mx : 0; s.moveY = this.enabled ? my : 0;
    s.sprint = sprint; s.jump = this.enabled && jump; s.dodge = this.enabled && dodge;
    s.interact = this.enabled && interact; s.interactHeld = this.enabled && interactHeld; s.ability = this.enabled && ability;
    s.pause = pause; s.debug = debug; s.journal = journal;
    this.pressed.clear(); this.tapped.clear();
    return s;
  }

  /** Reset look deltas after the camera consumed them. */
  consumeLook(): void { this.state.lookX = 0; this.state.lookY = 0; }
}
