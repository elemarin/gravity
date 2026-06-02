export type ControlAction = 'throttleUp' | 'throttleDown' | 'rotateLeft' | 'rotateRight';

export class InputManager {
  private keys = new Set<string>();
  private active: Record<ControlAction, boolean> = {
    throttleUp:   false,
    throttleDown: false,
    rotateLeft:   false,
    rotateRight:  false,
  };
  private resetEdge = false;

  private keydown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    this.keys.add(e.code);
    if (e.code === 'KeyR') this.resetEdge = true;
  };
  private keyup = (e: KeyboardEvent) => this.keys.delete(e.code);
  private blur  = () => this.keys.clear();

  constructor() {
    window.addEventListener('keydown', this.keydown);
    window.addEventListener('keyup',   this.keyup);
    window.addEventListener('blur',    this.blur);
  }

  /** React buttons call these from pointerdown/pointerup. */
  setAction(action: ControlAction, held: boolean) {
    this.active[action] = held;
  }

  triggerReset() { this.resetEdge = true; }

  getThrottleDelta(): number {
    const up   = this.keys.has('KeyW') || this.keys.has('Space') || this.keys.has('ArrowUp')   || this.active.throttleUp;
    const down = this.keys.has('KeyS') || this.keys.has('ArrowDown') || this.active.throttleDown;
    if (up && !down) return  2.5;
    if (down && !up) return -2.5;
    return 0;
  }

  getRotation(): number {
    const left  = this.keys.has('KeyA') || this.keys.has('ArrowLeft')  || this.active.rotateLeft;
    const right = this.keys.has('KeyD') || this.keys.has('ArrowRight') || this.active.rotateRight;
    if (left  && !right) return -1;
    if (right && !left)  return  1;
    return 0;
  }

  consumeReset(): boolean {
    const v = this.resetEdge;
    this.resetEdge = false;
    return v;
  }

  dispose() {
    window.removeEventListener('keydown', this.keydown);
    window.removeEventListener('keyup',   this.keyup);
    window.removeEventListener('blur',    this.blur);
  }
}
