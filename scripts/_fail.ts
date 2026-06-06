import { Simulator, SimPhase } from '../lib/game/plan/Simulator';
import { autoPlan } from '../lib/game/plan/AutoPlan';
import { ROCKET_PRESETS } from '../lib/game/career/Presets';
import { buildFlightSimSetup } from '../lib/game/SimSetup';

const DT = 1/60, MAX=4_000_000;
function run(label:string,dest:string,kind:any,presetId:string){
  const build=ROCKET_PRESETS.find(p=>p.id===presetId)!.build;
  const plan=autoPlan('earth',dest,{kind});
  const sim=new Simulator(buildFlightSimSetup(build,plan).config,plan); sim.reset();
  let touchdowns=0,prev=false,orbitSecs:Record<string,number>={};
  let steps=0;
  for(;steps<MAX;steps++){
    sim.step(DT); const s=sim.state; const b=sim.body();
    if(Number.isFinite(s.apoapsis)&&s.periapsis>0.5&&sim.altitude()>Math.max(2,b.radius*0.1)) orbitSecs[b.id]=(orbitSecs[b.id]??0)+DT;
    const l=s.phase==='landed'; if(l&&!prev)touchdowns++; prev=l;
    if(s.phase==='landed'&&plan.nodes.some(n=>n.trigger.type==='on-manual-relaunch'&&!s.firedNodeIds.has(n.id))) sim.manualRelaunch();
    if(sim.finished)break;
  }
  const s=sim.state;
  console.log(`${label.padEnd(22)} fin=${sim.finished?'Y':'N'} phase=${s.phase.padEnd(9)} body=${sim.body().id.padEnd(7)} land=${s.landedBodyId??'-'} td=${touchdowns} reached=[${Array.from(s.reachedBodyIds).join(',')}] orbit=${JSON.stringify(orbitSecs[dest]?Math.round(orbitSecs[dest]):0)} t=${(steps*DT).toFixed(0)}`);
}
const which=process.argv[2]??'all';
if(which==='mars'||which==='all') run('Mars Pioneer land','mars','land','mars-pioneer');
if(which==='phobos'||which==='all') run('Phobos orbit','phobos','orbit','grand-voyager');
if(which==='ceres'||which==='all'){run('Ceres orbit','ceres','orbit','grand-voyager');run('Ceres land','ceres','land','grand-voyager');}
if(which==='titan'||which==='all') run('Titan land','titan','land','grand-voyager');
