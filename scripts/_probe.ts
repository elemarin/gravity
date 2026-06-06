import { Simulator } from '../lib/game/plan/Simulator';
import { autoPlan } from '../lib/game/plan/AutoPlan';
import { ROCKET_PRESETS } from '../lib/game/career/Presets';
import { buildFlightSimSetup } from '../lib/game/SimSetup';
import { bodyDef, destinationTargetId } from '../lib/game/bodies';

const presetId=process.argv[2], dest=process.argv[3], kind=process.argv[4] as any;
const build = ROCKET_PRESETS.find(p=>p.id===presetId)!.build;
const plan = autoPlan('earth',dest,{kind});
console.log('targetId=', destinationTargetId(dest,'earth'), 'plan nodes:', plan.nodes.map(n=>n.trigger.type+(n.trigger.targetBodyId?`(${n.trigger.targetBodyId})`:'')).join(' -> '));
const setup = buildFlightSimSetup(build, plan);
const sim = new Simulator(setup.config, plan);
sim.reset();
const DT=1/60;
const tgt=destinationTargetId(dest,'earth')!;
for (let i=0;i<4_000_000;i++){
  sim.step(DT);
  const s=sim.state;
  if (i % 30000 === 0 || sim.finished){
    const b=sim.body();
    console.log(`t=${s.elapsed.toFixed(0)} phase=${s.phase} body=${b.id} stg=${s.activeStage} fuel=[${s.stageFuel.map(f=>f.toFixed(0)).join(',')}] xfer=${s.transferAssist} cap=${(s as any).captureAssist} reached=[${Array.from(s.reachedBodyIds).join(',')}]`);
  }
  if (sim.finished) break;
}
console.log('END finished?',sim.finished,'phase',sim.state.phase,'body',sim.body().id);
