type Action = 'throttleUp' | 'throttleDown' | 'rotateLeft' | 'rotateRight' | 'reset';

export class InputManager {
  private keys = new Set<string>();
  private active: Record<Action, boolean> = {
    throttleUp:   false,
    throttleDown: false,
    rotateLeft:   false,
    rotateRight:  false,
    reset:        false,
  };
  private resetEdge = false;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyR') this.resetEdge = true;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur',  () => this.keys.clear());

    this.bindButton('btn-throttle-up',   'throttleUp');
    this.bindButton('btn-throttle-down', 'throttleDown');
    this.bindButton('btn-rotate-left',   'rotateLeft');
    this.bindButton('btn-rotate-right',  'rotateRight');
    this.bindButton('btn-reset',         'reset', /* edge */ true);
  }

  private bindButton(id: string, action: Action, edge = false) {
    const el = document.getElementById(id);
    if (!el) return;

    const setHeld = (held: boolean) => {
      this.active[action] = held;
      el.classList.toggle('held', held);
    };

    const down = (e: Event) => {
      e.preventDefault();
      if (edge && action === 'reset') this.resetEdge = true;
      setHeld(true);
    };
    const up = (e: Event) => {
      e.preventDefault();
      setHeld(false);
    };

    // Use pointer events (covers mouse + touch + pen on modern browsers)
    el.addEventListener('pointerdown',   down);
    el.addEventListener('pointerup',     up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave',  up);

    // Fallback for older mobile browsers
    el.addEventListener('touchstart', down, { passive: false });
    el.addEventListener('touchend',   up,   { passive: false });

    // Prevent context menu on long-press
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Returns throttle delta per second (Game multiplies by dt). */
  getThrottleDelta(): number {
    const up   = this.keys.has('KeyW') || this.keys.has('Space') || this.active.throttleUp;
    const down = this.keys.has('KeyS') || this.active.throttleDown;
    if (up && !down) return  2.0;
    if (down && !up) return -2.0;
    return 0;
  }

  /** Returns rotation direction: -1 left, +1 right, 0 none. */
  getRotation(): number {
    const left  = this.keys.has('KeyA') || this.keys.has('ArrowLeft')  || this.active.rotateLeft;
    const right = this.keys.has('KeyD') || this.keys.has('ArrowRight') || this.active.rotateRight;
    if (left  && !right) return -1;
    if (right && !left)  return  1;
    return 0;
  }

  /** Edge-triggered: returns true only once per press. */
  consumeReset(): boolean {
    const v = this.resetEdge;
    this.resetEdge = false;
    return v;
  }
}
