'use client';

import { useEffect, useState } from 'react';
import {
  FlightPlan, Maneuver, TriggerType, TRIGGER_LABELS,
  MissionKind, MissionSpec, MISSION_LABELS,
  describeTrigger, describeActions, newNodeId,
} from '@/lib/game/plan/FlightPlan';
import { Body, DESTINATIONS, destinationTargetId, isLandable } from '@/lib/game/bodies';
import { autoPlan, defaultOrbitKm, minimumOrbitKm } from '@/lib/game/plan/AutoPlan';
import { requiredDeltaV } from '@/lib/game/career/Requirements';

type Props = {
  plan: FlightPlan;
  bodies: Body[];
  hasLander: boolean;
  preview: { apoapsis: number; periapsis: number; impact: boolean } | null;
  /** Estimated Δv (m/s) of the loaded rocket — gates the launch by budget. */
  buildDeltaV: number;
  onChange: (plan: FlightPlan) => void;
  onPlay: () => void;
};

const TRIGGER_TYPES: TriggerType[] = [
  'at-altitude', 'at-apoapsis', 'at-periapsis',
  'at-apoapsis-altitude', 'at-periapsis-altitude',
  'at-time', 'on-fuel-empty', 'at-transfer-window', 'at-soi-entry', 'after-orbit',
  'after-touchdown',
];

const TARGET_TRIGGERS: TriggerType[] = ['at-soi-entry', 'at-transfer-window', 'after-orbit'];

const VALUE_TRIGGERS: TriggerType[] = [
  'at-altitude', 'at-time', 'at-apoapsis-altitude', 'at-periapsis-altitude',
  'after-touchdown',
];

function valueLabel(t: TriggerType): string {
  if (t === 'at-time') return 'Time (s)';
  if (t === 'at-apoapsis-altitude') return 'Apoapsis (km)';
  if (t === 'at-periapsis-altitude') return 'Periapsis (km)';
  if (t === 'after-touchdown') return 'Delay (s)';
  return 'Altitude (km)';
}

function fmtKm(km: number): string {
  if (km >= 1000) return `${(km / 1000).toFixed(1)} Mm`;
  return `${Math.round(km)} km`;
}

export default function PlanPanel({ plan, bodies, hasLander, preview, buildDeltaV, onChange, onPlay }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState(true);

  const updateNode = (id: string, patch: Partial<Maneuver>) =>
    onChange({ ...plan, nodes: plan.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) });

  const updateTrigger = (id: string, patch: Partial<Maneuver['trigger']>) =>
    onChange({
      ...plan,
      nodes: plan.nodes.map((n) => (n.id === id ? { ...n, trigger: { ...n.trigger, ...patch } } : n)),
    });

  const updateActions = (id: string, patch: Partial<Maneuver['actions']>) =>
    onChange({
      ...plan,
      nodes: plan.nodes.map((n) => (n.id === id ? { ...n, actions: { ...n.actions, ...patch } } : n)),
    });

  const addNode = () => {
    const id = newNodeId();
    onChange({
      ...plan,
      nodes: [...plan.nodes, { id, trigger: { type: 'at-altitude', value: 30 }, actions: { heading: 60 } }],
    });
    setEditing(id);
    setOpen(true);
  };

  const removeNode = (id: string) => {
    onChange({ ...plan, nodes: plan.nodes.filter((n) => n.id !== id) });
    if (editing === id) setEditing(null);
  };

  const otherBodies = bodies.slice(1);
  const targetId = destinationTargetId(plan.destinationId, plan.launchBodyId);

  // Mission objective + target orbit drive the auto-planner.
  const mission: MissionSpec = plan.mission ?? { kind: 'orbit', orbitKm: defaultOrbitKm(plan.launchBodyId) };
  // Which objectives make sense for the chosen destination. Gas giants have no
  // surface, so they only offer orbit objectives.
  const canLand = targetId ? isLandable(targetId) : isLandable(plan.launchBodyId);
  const missionKinds: MissionKind[] = targetId
    ? (canLand ? ['orbit', 'orbit-return', 'land', 'land-return'] : ['orbit', 'orbit-return'])
    : (canLand ? ['orbit', 'land'] : ['orbit']);
  const showOrbitKm = mission.kind === 'orbit' || mission.kind === 'orbit-return';

  // Δv budget gate — the rocket must carry enough delta-v for the chosen mission.
  const requiredDv = requiredDeltaV(plan.launchBodyId, plan.destinationId, mission.kind);
  const haveDv = Math.round(buildDeltaV);
  const dvShort = haveDv < requiredDv;
  const dvShortfall = requiredDv - haveDv;
  // Orbit slider range scales to the body being orbited (the target, if any).
  const orbitBody = (targetId ? bodies.find((b) => b.id === targetId) : bodies[0]) ?? bodies[0];
  const orbitMin = orbitBody ? minimumOrbitKm(orbitBody.id) : 20;
  const orbitMax = orbitBody ? orbitBody.radius * 6 + 200 : 600;
  const orbitValue = Math.max(orbitMin, Math.round(mission.orbitKm));

  const regen = (destId: string, m: MissionSpec) =>
    onChange(autoPlan(plan.launchBodyId, destId, m));

  // Switching destination keeps the objective if still valid, else falls back.
  const setDestination = (id: string) => {
    const nextTargetId = destinationTargetId(id, plan.launchBodyId);
    const landable = nextTargetId ? isLandable(nextTargetId) : isLandable(plan.launchBodyId);
    const isLand = mission.kind === 'land' || mission.kind === 'land-return';
    let valid: MissionKind = mission.kind;
    if (!nextTargetId && isLand) valid = 'land';           // orbiting the launch world
    if (isLand && !landable) valid = nextTargetId ? 'orbit-return' : 'orbit';
    if (!isLand && !nextTargetId) valid = 'orbit';
    regen(id, { ...mission, kind: valid });
  };
  const setMissionKind = (kind: MissionKind) => regen(plan.destinationId, { ...mission, kind });
  const setOrbitKm = (orbitKm: number) => regen(plan.destinationId, { ...mission, orbitKm });
  const regenerate = () => regen(plan.destinationId, mission);
  const setLaunch = (patch: Partial<FlightPlan['launch']>) =>
    onChange({ ...plan, launch: { ...plan.launch, ...patch } });

  useEffect(() => {
    if (showOrbitKm && mission.orbitKm < orbitMin) {
      setOrbitKm(orbitMin);
    }
    // setOrbitKm regenerates from current props; avoid including it as a changing dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showOrbitKm, mission.orbitKm, orbitMin]);

  return (
    <div className="absolute inset-x-0 bottom-0 z-30 font-pixel
                    pb-[calc(0.75rem+env(safe-area-inset-bottom))]
                    px-[calc(0.75rem+env(safe-area-inset-left))]
                    pr-[calc(0.75rem+env(safe-area-inset-right))]
                    md:inset-x-auto md:left-3 md:right-auto
                    md:top-[calc(4.25rem+env(safe-area-inset-top))] md:bottom-3
                    md:w-[380px] md:max-w-[38vw] md:p-0 md:flex md:items-stretch">
      <div className="panel mx-auto max-w-md flex min-h-0 flex-col overflow-hidden
                      md:mx-0 md:max-w-none md:w-full md:h-full">
        {/* Header row */}
        <button
          onClick={() => setOpen((o) => !o)}
          className="shrink-0 flex items-center justify-between gap-2 px-3 py-2.5 border-b border-white/10"
        >
          <span className="shrink-0 text-[10px] tracking-[0.2em] uppercase text-cyan font-black">
            ▸ FLIGHT PLAN
          </span>
          <span className="min-w-0 flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-[10px] text-dim tabular-nums leading-tight">
            {preview && (
              <>
                <span className="text-green">AP {fmtKm(preview.apoapsis)}</span>
                <span className={preview.impact ? 'text-red' : 'text-cyan'}>
                  {preview.impact ? 'IMPACT' : `PE ${fmtKm(preview.periapsis)}`}
                </span>
              </>
            )}
            <span className="text-ink">{open ? '▾' : '▴'}</span>
          </span>
        </button>

        {open && (
          <div className="max-h-[46vh] min-h-0 md:max-h-none md:flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2">
            {/* Destination */}
            <div>
              <div className="flex items-center justify-between">
                <span className="stat-label">1 · Destination</span>
                <button onClick={regenerate}
                  className="text-[10px] rounded-md px-2 py-0.5 border border-green/50 bg-green/15 text-green font-bold active:scale-95">
                  ✨ Auto-plan
                </button>
              </div>
              <div className="mt-1">
                <Dropdown
                  value={plan.destinationId}
                  options={DESTINATIONS.map((d) => ({ id: d.id, name: d.name }))}
                  onChange={setDestination}
                />
              </div>
            </div>

            {/* Objective */}
            <div>
              <span className="stat-label">2 · Objective</span>
              <div className="mt-1">
                <Dropdown
                  value={mission.kind}
                  options={missionKinds.map((k) => ({ id: k, name: MISSION_LABELS[k] }))}
                  onChange={(k) => setMissionKind(k as MissionKind)}
                />
              </div>
              {/* Target orbit altitude */}
              {showOrbitKm && (
                <div className="mt-2 rounded-lg border border-white/10 bg-white/[0.04] p-2">
                  <Slider
                    label="Orbit" enabled value={orbitValue}
                    min={Math.round(orbitMin)} max={Math.round(orbitMax)} step={1} suffix="km"
                    onToggle={() => {}}
                    onChange={setOrbitKm}
                  />
                </div>
              )}
              {/* Δv budget — the progression gate. */}
              <div className={`mt-2 rounded-md border px-2.5 py-1.5 text-[10px] leading-snug
                ${dvShort ? 'border-red/45 bg-red/[0.08]' : 'border-green/40 bg-green/[0.06]'}`}>
                <div className="flex items-center justify-between tabular-nums font-bold">
                  <span className={dvShort ? 'text-red' : 'text-green'}>
                    {dvShort ? '⚠ Δv TOO SHORT' : '✓ Δv BUDGET MET'}
                  </span>
                  <span className="text-dim">
                    <span className={dvShort ? 'text-red' : 'text-green'}>{haveDv}</span>
                    {' / '}{requiredDv} m/s
                  </span>
                </div>
              </div>
              {(mission.kind === 'land-return' || mission.kind === 'orbit-return') && (
                <div className="mt-1 text-[10px] text-orange/90 leading-snug">
                  ↩ Return trips are ambitious — pack extra fuel{mission.kind === 'land-return' ? ' and a lander that can fly back up' : ''}. Launch, then warp.
                </div>
              )}
              {targetId && (
                <div className="mt-1 text-[10px] text-cyan/90 leading-snug">
                  ✨ Auto-plan flies the whole route. Build a capable rocket{(mission.kind === 'land' || mission.kind === 'land-return') ? ' with a lander' : ''}, then launch &amp; warp.
                </div>
              )}
            </div>

            {/* Launch vector */}
            <div className="rounded-lg border border-white/10 bg-white/[0.04] p-2 flex flex-col gap-2">
              <span className="stat-label">Launch</span>
              <Slider
                label="Aim" enabled value={plan.launch.heading}
                min={-90} max={90} step={1} suffix="°"
                onToggle={() => {}}
                onChange={(v) => setLaunch({ heading: v })}
              />
              <Slider
                label="Power" enabled value={Math.round(plan.launch.power * 100)}
                min={0} max={100} step={1} suffix="%"
                onToggle={() => {}}
                onChange={(v) => setLaunch({ power: v / 100 })}
              />
            </div>

            <span className="stat-label mt-1">Maneuvers</span>
            {plan.nodes.length === 0 && (
              <p className="text-[11px] text-dim text-center py-2">
                No maneuvers yet — add stage points to shape the flight.
              </p>
            )}

            {plan.nodes.map((node, i) => {
              const isEditing = editing === node.id;
              return (
                <div key={node.id}
                     className={`rounded-lg border ${isEditing ? 'border-cyan/50 bg-cyan/[0.05]' : 'border-white/10 bg-white/[0.03]'}`}>
                  <div className="flex items-center gap-2 pr-2">
                    <button
                      type="button"
                      onClick={() => setEditing(isEditing ? null : node.id)}
                      className="flex-1 min-w-0 flex items-center gap-2 px-3 py-2 text-left"
                    >
                      <span className="w-5 h-5 shrink-0 rounded-full bg-cyan/15 text-cyan text-[10px] font-black
                                       flex items-center justify-center tabular-nums">{i + 1}</span>
                      <span className="text-xs font-bold text-ink">{describeTrigger(node.trigger)}</span>
                      <span className="text-[10px] text-dim truncate">→ {describeActions(node.actions)}</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); removeNode(node.id); }}
                      className="shrink-0 w-6 h-6 rounded-full bg-red/15 text-red text-xs
                                 flex items-center justify-center hover:bg-red/30 active:scale-90"
                      aria-label="Remove node"
                    >✕</button>
                  </div>

                  {isEditing && (
                    <div className="px-3 pb-3 flex flex-col gap-3 border-t border-white/5 pt-3">
                      {/* Trigger */}
                      <div>
                        <span className="stat-label">When</span>
                        <div className="mt-1 grid grid-cols-3 gap-1">
                          {TRIGGER_TYPES.map((t) => (
                            <button key={t}
                              onClick={() => updateTrigger(node.id, {
                                type: t,
                                targetBodyId: TARGET_TRIGGERS.includes(t) ? (otherBodies[0]?.id) : undefined,
                              })}
                              className={`text-[9px] rounded-md py-1.5 px-1 border tracking-wide
                                ${node.trigger.type === t
                                  ? 'border-cyan/60 bg-cyan/15 text-cyan'
                                  : 'border-white/10 bg-white/[0.03] text-dim'}`}>
                              {TRIGGER_LABELS[t]}
                            </button>
                          ))}
                        </div>

                        {VALUE_TRIGGERS.includes(node.trigger.type) && (
                          <label className="mt-2 flex items-center gap-2 text-[10px] text-dim">
                            {valueLabel(node.trigger.type)}
                            <input
                              type="number"
                              value={node.trigger.value ?? 0}
                              onChange={(e) => updateTrigger(node.id, { value: Number(e.target.value) })}
                              className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-ink tabular-nums"
                            />
                          </label>
                        )}

                        {TARGET_TRIGGERS.includes(node.trigger.type) && (
                          <select
                            value={node.trigger.targetBodyId ?? ''}
                            onChange={(e) => updateTrigger(node.id, { targetBodyId: e.target.value })}
                            className="mt-2 w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-[11px] text-ink"
                          >
                            {otherBodies.length === 0 && <option value="">No other bodies</option>}
                            {otherBodies.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                          </select>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex flex-col gap-2">
                        <span className="stat-label">Do</span>

                        <Slider
                          label="Aim"
                          enabled={node.actions.heading !== undefined}
                          onToggle={(on) => updateActions(node.id, { heading: on ? (node.actions.heading ?? 45) : undefined })}
                          value={node.actions.heading ?? 0}
                          min={-90} max={90} step={1} suffix="°"
                          onChange={(v) => updateActions(node.id, { heading: v })}
                        />
                        <Slider
                          label="Throttle"
                          enabled={node.actions.throttle !== undefined}
                          onToggle={(on) => updateActions(node.id, { throttle: on ? (node.actions.throttle ?? 1) : undefined })}
                          value={Math.round((node.actions.throttle ?? 0) * 100)}
                          min={0} max={100} step={1} suffix="%"
                          onChange={(v) => updateActions(node.id, { throttle: v / 100 })}
                        />

                        <div className="flex flex-wrap gap-1.5">
                          {(['manual', 'prograde', 'retrograde'] as const).map((a) => {
                            const on = (node.actions.attitude ?? 'manual') === a;
                            return (
                              <button key={a}
                                onClick={() => updateActions(node.id, { attitude: a === 'manual' ? undefined : a })}
                                className={`text-[10px] rounded-md py-1.5 px-2.5 border tracking-wide
                                  ${on ? 'border-cyan/60 bg-cyan/15 text-cyan' : 'border-white/10 bg-white/[0.03] text-dim'}`}>
                                {a === 'manual' ? 'Aim' : a}
                              </button>
                            );
                          })}
                        </div>

                        <div className="flex flex-wrap gap-1.5">
                          <Toggle label="Stage" on={!!node.actions.jettisonStage}
                                  onClick={() => updateActions(node.id, { jettisonStage: !node.actions.jettisonStage })} />
                          {hasLander && (
                            <Toggle label="Deploy lander" on={!!node.actions.deployLander}
                                    onClick={() => updateActions(node.id, { deployLander: !node.actions.deployLander })} />
                          )}
                          <Toggle label="Parachute" on={!!node.actions.deployParachute}
                                  onClick={() => updateActions(node.id, { deployParachute: !node.actions.deployParachute })} />
                          <Toggle label="Descend" on={!!node.actions.descend}
                                  onClick={() => updateActions(node.id, { descend: !node.actions.descend })} />
                          <Toggle label="Ascend" on={!!node.actions.ascend}
                                  onClick={() => updateActions(node.id, { ascend: !node.actions.ascend })} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            <button onClick={addNode}
              className="mt-1 w-full rounded-lg border border-dashed border-cyan/40 bg-cyan/[0.06]
                         text-cyan text-xs font-bold py-2 hover:bg-cyan/15 active:scale-[0.98]">
              ＋ Add stage point
            </button>
          </div>
        )}

        {/* Play */}
        <div className="shrink-0 px-3 pb-3 pt-1 border-t border-white/10">
          {dvShort && (
            <div className="mb-1.5 rounded-md border border-red/50 bg-red/15 px-2 py-1
                            text-center text-[10px] font-black tracking-wide text-red">
              Δv too short — need {dvShortfall} m/s more. Build a bigger rocket.
            </div>
          )}
          <button
            onClick={onPlay}
            disabled={dvShort}
            className={`btn w-full py-3.5 ${dvShort
              ? 'border-2 border-red/60 bg-red/20 text-red cursor-not-allowed'
              : 'btn-primary'}`}
            style={{ fontSize: 13 }}
          >{dvShort ? '🔒 Δv TOO SHORT' : '▶ LAUNCH'}</button>
        </div>
      </div>
    </div>
  );

  function Slider({
    label, enabled, onToggle, value, min, max, step, suffix, onChange,
  }: {
    label: string; enabled: boolean; onToggle: (on: boolean) => void;
    value: number; min: number; max: number; step: number; suffix: string;
    onChange: (v: number) => void;
  }) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={() => onToggle(!enabled)}
          className={`w-16 shrink-0 text-[10px] rounded-md py-1 border tracking-wide
            ${enabled ? 'border-cyan/60 bg-cyan/15 text-cyan' : 'border-white/10 bg-white/[0.03] text-dim'}`}
        >{label}</button>
        <input
          type="range" min={min} max={max} step={step} value={value}
          disabled={!enabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className="range-fluid flex-1"
        />
        <span className="w-10 text-right text-[10px] tabular-nums text-ink">{value}{suffix}</span>
      </div>
    );
  }
}

function Dropdown({
  value, options, onChange,
}: {
  value: string;
  options: { id: string; name: string }[];
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.id === value);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-md border-2 border-cyan/45
                   bg-cyan/[0.07] px-3 py-2 text-left transition hover:border-cyan/70 active:scale-[0.99]"
      >
        <span className="truncate text-[12px] font-black text-ink">{current?.name ?? 'Select…'}</span>
        <span className={`shrink-0 text-cyan transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && (
        <>
          <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="fixed inset-0 z-40" />
          <div
            role="listbox"
            className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 max-h-[40vh] overflow-y-auto
                       rounded-md border-2 border-cyan/40 bg-bg/95 p-1 shadow-2xl backdrop-blur-xl"
          >
            {options.map((o) => (
              <button
                key={o.id}
                type="button"
                role="option"
                aria-selected={o.id === value}
                onClick={() => { onChange(o.id); setOpen(false); }}
                className={`flex w-full items-center justify-between rounded px-2.5 py-2 text-left text-[12px] font-bold transition
                  ${o.id === value ? 'bg-cyan/15 text-cyan' : 'text-ink hover:bg-cyan/10'}`}
              >
                {o.name}
                {o.id === value && <span className="text-[10px] text-cyan">✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`text-[10px] rounded-md py-1.5 px-2.5 border tracking-wide
        ${on ? 'border-green/60 bg-green/15 text-green' : 'border-white/10 bg-white/[0.03] text-dim'}`}>
      {label}
    </button>
  );
}
