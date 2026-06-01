import { FlightState, FlightPhase } from '../types';

const PHASE_LABELS: Record<FlightPhase, string> = {
  prelaunch: 'PRE-LAUNCH',
  flight:    'FLIGHT',
  orbit:     'ORBIT',
  reentry:   'RE-ENTRY',
  landed:    'LANDED',
  destroyed: 'DESTROYED',
};

const PHASE_COLORS: Record<FlightPhase, string> = {
  prelaunch: '#8aa0b5',
  flight:    '#00e5ff',
  orbit:     '#2ee59d',
  reentry:   '#ff8a3d',
  landed:    '#b070ff',
  destroyed: '#ff5577',
};

export class HUD {
  private altValue:   HTMLElement;
  private velValue:   HTMLElement;
  private fuelFill:   HTMLElement;
  private fuelLabel:  HTMLElement;
  private phaseBadge: HTMLElement;
  private targetText: HTMLElement;
  private toast:      HTMLElement;
  private toastText:  HTMLElement;

  private toastTimer = 0;
  private lastPhase: FlightPhase | null = null;

  constructor() {
    this.altValue   = this.byId('alt-value');
    this.velValue   = this.byId('vel-value');
    this.fuelFill   = this.byId('fuel-bar-fill');
    this.fuelLabel  = this.byId('fuel-label');
    this.phaseBadge = this.byId('phase-badge');
    this.targetText = this.byId('target-text');
    this.toast      = this.byId('toast');
    this.toastText  = this.byId('toast-text');
  }

  update(state: FlightState, dt: number) {
    // --- Altitude (state.altitude is in km) ---
    const altM = state.altitude * 1000;
    if (altM >= 100_000) {
      this.altValue.textContent = `${(altM / 1000).toFixed(0)} km`;
    } else if (altM >= 1000) {
      this.altValue.textContent = `${(altM / 1000).toFixed(1)} km`;
    } else {
      this.altValue.textContent = `${Math.max(0, Math.round(altM))} m`;
    }

    // --- Velocity (state.speed is in km/s) ---
    const spdMs = state.speed * 1000;
    if (spdMs >= 1000) {
      this.velValue.textContent = `${(spdMs / 1000).toFixed(2)} km/s`;
    } else {
      this.velValue.textContent = `${Math.round(spdMs)} m/s`;
    }

    // --- Fuel ---
    const fuelPct = Math.max(0, Math.min(100, Math.round(state.fuel)));
    this.fuelFill.style.width = `${fuelPct}%`;
    this.fuelLabel.textContent = `Fuel ${fuelPct}%`;
    const fuelColor = fuelPct > 50 ? '#2ee59d' : fuelPct > 20 ? '#ffd54a' : '#ff5577';
    this.fuelFill.style.background = fuelColor;
    this.fuelFill.style.color = fuelColor; // drives the box-shadow glow

    // --- Phase ---
    if (state.phase !== this.lastPhase) {
      this.phaseBadge.textContent = PHASE_LABELS[state.phase] ?? state.phase.toUpperCase();
      const c = PHASE_COLORS[state.phase] ?? '#8aa0b5';
      this.phaseBadge.style.color = c;
      this.phaseBadge.style.borderColor = c;
      this.phaseBadge.style.boxShadow = `0 0 16px ${c}55, 0 4px 20px rgba(0,0,0,0.4)`;
      this.lastPhase = state.phase;
    }

    // --- Toast countdown ---
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast.classList.remove('show');
    }
  }

  setNextMilestone(text: string) {
    this.targetText.textContent = text;
  }

  showToast(message: string, duration = 3.5) {
    this.toastText.textContent = message;
    this.toast.classList.add('show');
    this.toastTimer = duration;
  }

  private byId(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (!el) throw new Error(`HUD: element #${id} missing`);
    return el;
  }
}
