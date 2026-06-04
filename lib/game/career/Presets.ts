import { RocketBuild } from '../types';

/**
 * Pre-crafted rockets the player can quick-select in the builder, then tweak or
 * launch as-is. Presets that reference not-yet-unlocked parts are shown locked
 * until career progress unlocks the parts they need.
 */
export type RocketPreset = {
  id: string;
  name: string;
  icon: string;
  description: string;
  build: RocketBuild;
};

export const ROUTE_PROVER_BUILD: RocketBuild = {
  engineId: 'engine-heavy',
  tankIds: ['tank-xl', 'tank-xl'],
  noseId: 'capsule-crew',
  utilityIds: ['parachute', 'landing-legs'],
  boosterIds: ['booster-liquid', 'booster-liquid'],
  landerId: 'lander-heavy',
  stages: [
    { engineId: 'engine-heavy', tankIds: ['tank-xl', 'tank-xl', 'tank-xl'] },
    { engineId: 'engine-heavy', tankIds: ['tank-xl', 'tank-xl'] },
    { engineId: 'engine-vacuum', tankIds: ['tank-large', 'tank-large'] },
  ],
};

export const ROCKET_PRESETS: RocketPreset[] = [
  {
    id: 'sounding',
    name: 'Sounding Rocket',
    icon: '🎆',
    description: 'Single stage hop — perfect for first flights and suborbital tests.',
    build: {
      engineId: 'engine-basic',
      tankIds: ['tank-basic'],
      noseId: 'nose-cone',
      utilityIds: [],
      boosterIds: [],
      stages: [{ engineId: 'engine-basic', tankIds: ['tank-basic'] }],
    },
  },
  {
    id: 'orbiter',
    name: 'Orbiter',
    icon: '🛰',
    description: 'Booster-assisted two-stage lifter that reaches a stable low orbit.',
    build: {
      engineId: 'engine-basic',
      tankIds: ['tank-basic', 'tank-basic'],
      noseId: 'nose-cone',
      utilityIds: [],
      boosterIds: ['booster-solid', 'booster-solid'],
      stages: [
        { engineId: 'engine-basic', tankIds: ['tank-basic', 'tank-basic'] },
        { engineId: 'engine-basic', tankIds: ['tank-basic'] },
      ],
    },
  },
  {
    id: 'moon-lander',
    name: 'Moon Lander',
    icon: '🌙',
    description: 'Two-stage heavy stack with a dedicated lander to touch down on the Moon.',
    build: {
      engineId: 'engine-heavy',
      tankIds: ['tank-large', 'tank-large', 'tank-large'],
      noseId: 'capsule-crew',
      utilityIds: ['landing-legs'],
      boosterIds: ['booster-liquid', 'booster-liquid'],
      landerId: 'lander-heavy',
      stages: [
        { engineId: 'engine-heavy', tankIds: ['tank-large', 'tank-large', 'tank-large'] },
        { engineId: 'engine-vacuum', tankIds: ['tank-large', 'tank-large'] },
      ],
    },
  },
  {
    id: 'interplanetary',
    name: 'Interplanetary',
    icon: '🚀',
    description: 'Heavy three-stage cruiser with a big lander, chute and shield for return trips.',
    build: {
      engineId: 'engine-heavy',
      tankIds: ['tank-xl', 'tank-xl'],
      noseId: 'capsule-crew',
      utilityIds: ['parachute', 'landing-legs', 'heat-shield'],
      boosterIds: ['booster-liquid', 'booster-liquid'],
      landerId: 'lander-heavy',
      stages: [
        { engineId: 'engine-heavy', tankIds: ['tank-xl', 'tank-xl'] },
        { engineId: 'engine-heavy', tankIds: ['tank-large'] },
        { engineId: 'engine-vacuum', tankIds: ['tank-large'] },
      ],
    },
  },
  {
    id: 'heavy-orbiter',
    name: 'Heavy Orbiter',
    icon: '🛰',
    description: 'Booster-assisted two-stage lifter with plenty of margin for a comfortable Earth orbit.',
    build: {
      engineId: 'engine-heavy',
      tankIds: ['tank-large', 'tank-large'],
      noseId: 'capsule-crew',
      utilityIds: ['parachute', 'landing-legs'],
      boosterIds: ['booster-liquid', 'booster-liquid'],
      stages: [
        { engineId: 'engine-heavy', tankIds: ['tank-large', 'tank-large', 'tank-large'] },
        { engineId: 'engine-vacuum', tankIds: ['tank-large', 'tank-large'] },
      ],
    },
  },
  {
    id: 'lunar-express',
    name: 'Lunar Express',
    icon: '🌙',
    description: 'Three-stage stack tuned to orbit the Moon and fly all the way back home.',
    build: {
      engineId: 'engine-heavy',
      tankIds: ['tank-xl', 'tank-xl'],
      noseId: 'capsule-crew',
      utilityIds: ['parachute', 'landing-legs', 'heat-shield'],
      boosterIds: ['booster-liquid', 'booster-liquid'],
      landerId: 'lander-heavy',
      stages: [
        { engineId: 'engine-heavy', tankIds: ['tank-xl', 'tank-xl', 'tank-xl'] },
        { engineId: 'engine-heavy', tankIds: ['tank-xl', 'tank-xl'] },
        { engineId: 'engine-vacuum', tankIds: ['tank-large', 'tank-large'] },
      ],
    },
  },
  {
    id: 'mars-pioneer',
    name: 'Mars Pioneer',
    icon: '🔴',
    description: 'Heavy lander cruiser with a chute and shield — sets down on Mars (or the Moon).',
    build: {
      engineId: 'engine-heavy',
      tankIds: ['tank-xl', 'tank-xl'],
      noseId: 'capsule-crew',
      utilityIds: ['parachute', 'landing-legs', 'heat-shield'],
      boosterIds: ['booster-liquid', 'booster-liquid'],
      landerId: 'lander-heavy',
      stages: [
        { engineId: 'engine-heavy', tankIds: ['tank-xl', 'tank-xl', 'tank-xl'] },
        { engineId: 'engine-vacuum', tankIds: ['tank-large', 'tank-large'] },
      ],
    },
  },
  {
    id: 'grand-voyager',
    name: 'Grand Voyager',
    icon: '🪐',
    description: 'Big four-tank workhorse with the reach to orbit the far gas giants.',
    build: {
      engineId: 'engine-heavy',
      tankIds: ['tank-xl', 'tank-xl', 'tank-xl'],
      noseId: 'capsule-crew',
      utilityIds: ['parachute', 'landing-legs'],
      boosterIds: ['booster-liquid', 'booster-liquid'],
      landerId: 'lander-heavy',
      stages: [
        { engineId: 'engine-heavy', tankIds: ['tank-xl', 'tank-xl', 'tank-xl', 'tank-xl'] },
        { engineId: 'engine-heavy', tankIds: ['tank-xl', 'tank-xl'] },
        { engineId: 'engine-vacuum', tankIds: ['tank-large', 'tank-large'] },
      ],
    },
  },
  {
    id: 'outer-cruiser',
    name: 'Outer Cruiser',
    icon: '🛰',
    description: 'Four-stage super-heavy on station-grade hardware — carries the delta-v to orbit the ice giants.',
    build: {
      engineId: 'engine-mammoth',
      tankIds: ['tank-mega'],
      noseId: 'capsule-crew',
      utilityIds: ['parachute', 'landing-legs'],
      boosterIds: ['booster-liquid-xl', 'booster-liquid-xl'],
      landerId: 'lander-heavy',
      stages: [
        { engineId: 'engine-mammoth', tankIds: ['tank-mega', 'tank-mega', 'tank-mega'] },
        { engineId: 'engine-heavy',   tankIds: ['tank-xl', 'tank-xl', 'tank-xl'] },
        { engineId: 'engine-vacuum',  tankIds: ['tank-xl', 'tank-xl'] },
        { engineId: 'engine-plasma',  tankIds: ['tank-large', 'tank-large'] },
      ],
    },
  },
  {
    id: 'route-prover',
    name: 'Route Prover',
    icon: '✅',
    description: 'Regression-tested stack used to prove orbit, landing and return auto-plans.',
    build: ROUTE_PROVER_BUILD,
  },
];
