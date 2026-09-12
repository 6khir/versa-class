'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AutomationManager,
  PIPELINE_STEPS, EDITABLE_PIPELINE, MAZE_PIPELINE, getPipelineSteps,
  STEP_DEPENDENCIES,
  readStepStatus
} = require('../src/automation-manager.cjs');

// Every step either pipeline can run, so a stub runner map covers both.
const ALL_STEPS = [...new Set([...PIPELINE_STEPS, ...EDITABLE_PIPELINE, ...MAZE_PIPELINE])];

function createStore({ projects = [], settings = {}, pendingSteps = [], statuses = {} } = {}) {
  const stepStatus = new Map();
  const events = [];
  const statusKey = (step) => `step${step.split('_').map(s=>s.charAt(0).toUpperCase()+s.slice(1)).join('')}Status`;

  for (const [key, value] of Object.entries(statuses)) {
    stepStatus.set(key, value);
  }

  const decorate = (project) => {
    const out = { ...project };
    for (const step of ALL_STEPS) {
      const key = statusKey(step);
      out[key] = stepStatus.get(`${project.id}:${step}`)
        ?? (pendingSteps.includes(step) ? 'pending' : 'completed');
    }
    // Characters must never be required by the standard pipeline decorate path.
    out.stepCharactersStatus = stepStatus.get(`${project.id}:characters`) ?? 'pending';
    return out;
  };

  return {
    events,
    stepStatus,
    listProjectsForAutomation: () => projects.map(decorate),
    getProject: (id) => {
      const found = projects.find((project) => project.id === id);
      return found ? decorate(found) : null;
    },
    getAutomationSettings: () => {
      const all = {};
      for (const step of ALL_STEPS) all[step] = settings[step] ?? 'always';
      all.characters = settings.characters ?? 'always';
      return all;
    },
    updateProjectStepStatus: (projectId, step, status) => {
      stepStatus.set(`${projectId}:${step}`, status);
    },
    appendEvent: (event) => {
      events.push(event);
    }
  };
}

const FAST_TIMING = {
  stepTimeouts: Object.fromEntries(
    PIPELINE_STEPS.map((step) => [step, { idleMs: 5_000, hardCapMs: 5_000 }])
  ),
  watchdogTickMs: 20,
  orphanSettleGraceMs: 50,
  retryDelaysMs: [1, 1, 1]
};

test('PIPELINE_STEPS is the authoritative FULL PIPELINE order with export last', () => {
  assert.deepEqual(PIPELINE_STEPS, [
    'overview',
    'interior',
    'thumbnails',
    'preview',
    'export'
  ]);
  assert.equal(PIPELINE_STEPS.at(-1), 'export');
  assert.ok(!PIPELINE_STEPS.includes('characters'));
  // The SEO/listing stage was removed from the product; nothing may reintroduce it
  // silently between preview and export.
  assert.ok(!PIPELINE_STEPS.includes('listing'));
  assert.deepEqual(STEP_DEPENDENCIES.preview, ['thumbnails']);
  assert.deepEqual(STEP_DEPENDENCIES.export, ['preview']);
});

test('FULL PIPELINE executes stages in order and never runs characters', async () => {
  const store = createStore({
    projects: [{ id: 'p1', name: 'Ordered Book', productFormat: 'editable' }],
    pendingSteps: [...EDITABLE_PIPELINE]
  });
  const ran = [];
  const manager = new AutomationManager({
    store,
    broadcast: async () => {},
    ...FAST_TIMING,
    stepRunners: Object.fromEntries(
      [...ALL_STEPS, 'characters'].map((step) => [
        step,
        async (_projectId, onProgress) => {
          ran.push(step);
          onProgress(100);
        }
      ])
    ),
    stepVerifiers: Object.fromEntries(PIPELINE_STEPS.map((step) => [step, async () => {}]))
  });

  await manager.start();
  await manager._loopPromise;

  assert.deepEqual(ran, EDITABLE_PIPELINE);
  assert.ok(!ran.includes('characters'));
  assert.equal(store.stepStatus.get('p1:export'), 'completed');
  assert.equal(store.stepStatus.get('p1:characters'), undefined);
});

test('preview cannot start before thumbnails completion', async () => {
  const store = createStore({
    projects: [{ id: 'p1', name: 'Mockups Gate' }],
    pendingSteps: ['thumbnails', 'preview', 'export'],
    settings: { thumbnails: 'manual' }
  });
  const ran = [];
  const manager = new AutomationManager({
    store,
    broadcast: async () => {},
    ...FAST_TIMING,
    stepRunners: {
      thumbnails: async () => { ran.push('thumbnails'); },
      preview: async () => { ran.push('preview'); },
      export: async () => { ran.push('export'); }
    }
  });
  await manager.start();
  await manager._loopPromise;
  assert.deepEqual(ran, []);
  assert.equal(store.stepStatus.get('p1:thumbnails'), 'awaiting_input');
  assert.equal(store.stepStatus.get('p1:preview'), undefined);
});

test('export cannot start before preview completion', async () => {
  const store = createStore({
    projects: [{ id: 'p1', name: 'Video Gate' }],
    pendingSteps: ['preview', 'export'],
    settings: { preview: 'manual' }
  });
  const ran = [];
  const manager = new AutomationManager({
    store,
    broadcast: async () => {},
    ...FAST_TIMING,
    stepRunners: {
      preview: async () => { ran.push('preview'); },
      export: async () => { ran.push('export'); }
    }
  });
  await manager.start();
  await manager._loopPromise;
  assert.deepEqual(ran, []);
  assert.equal(store.stepStatus.get('p1:preview'), 'awaiting_input');
  assert.ok(!ran.includes('export'));
});

test('export cannot start before preview has completed', async () => {
  const store = createStore({
    projects: [{ id: 'p1', name: 'Preview Gate' }],
    pendingSteps: ['preview', 'export']
  });
  const ran = [];
  let previewAttempts = 0;
  const manager = new AutomationManager({
    store,
    broadcast: async () => {},
    ...FAST_TIMING,
    stepRunners: {
      preview: async () => {
        previewAttempts += 1;
        throw Object.assign(new Error('preview failed on purpose'), { code: 'PREVIEW_FAIL' });
      },
      export: async () => { ran.push('export'); }
    }
  });
  await manager.start();
  await manager._loopPromise;
  assert.ok(previewAttempts >= 1);
  assert.ok(!ran.includes('export'));
  assert.equal(store.stepStatus.get('p1:preview'), 'failed');
});

test('export remains the final executed stage on a healthy run', async () => {
  const store = createStore({
    projects: [{ id: 'p1', name: 'Final Export' }],
    pendingSteps: ['preview', 'export']
  });
  const ran = [];
  const manager = new AutomationManager({
    store,
    broadcast: async () => {},
    ...FAST_TIMING,
    stepRunners: {
      preview: async (_id, onProgress) => { ran.push('preview'); onProgress(100); },
      export: async (_id, onProgress) => { ran.push('export'); onProgress(100); }
    }
  });
  await manager.start();
  await manager._loopPromise;
  assert.deepEqual(ran, ['preview', 'export']);
  assert.equal(ran.at(-1), 'export');
});

test('static products never invoke editable generation', async () => {
  const store = createStore({
    projects: [{ id: 'p1', name: 'Static Book', productFormat: 'static' }],
    pendingSteps: ['editable', 'thumbnails', 'preview', 'export']
  });
  const ran = [];
  const manager = new AutomationManager({
    store,
    broadcast: async () => {},
    ...FAST_TIMING,
    stepRunners: {
      editable: async (projectId, onProgress) => {
        const project = store.getProject(projectId);
        if (project.productFormat !== 'editable') {
          ran.push('editable-skipped');
          onProgress(100);
          return;
        }
        ran.push('editable-native');
        onProgress(100);
      },
      thumbnails: async (_id, onProgress) => { ran.push('thumbnails'); onProgress(100); },
      preview: async (_id, onProgress) => { ran.push('preview'); onProgress(100); },
      export: async (_id, onProgress) => { ran.push('export'); onProgress(100); }
    }
  });
  await manager.start();
  await manager._loopPromise;
  assert.deepEqual(ran, [
    'thumbnails',
    'preview',
    'export'
  ]);
  assert.ok(!ran.includes('editable-native'));
});

test('dependency gate reports unsatisfied preview before export', () => {
  const store = createStore({
    projects: [{ id: 'p1', name: 'Blocked Export' }]
  });
  store.stepStatus.set('p1:preview', 'pending');
  store.stepStatus.set('p1:export', 'pending');
  store.stepStatus.set('p1:thumbnails', 'pending');
  const manager = new AutomationManager({
    store,
    broadcast: async () => {},
    ...FAST_TIMING,
    stepRunners: {}
  });
  assert.deepEqual(manager._unsatisfiedDependency('p1', 'export'), {
    step: 'preview',
    status: 'pending'
  });
  assert.deepEqual(manager._unsatisfiedDependency('p1', 'preview'), {
    step: 'thumbnails',
    status: 'pending'
  });
  store.stepStatus.set('p1:thumbnails', 'completed');
  assert.equal(manager._unsatisfiedDependency('p1', 'preview'), null);
  assert.equal(manager._unsatisfiedDependency('p1', 'overview'), null);
});

test('failed predecessor does not allow later stages to bypass order', async () => {
  const store = createStore({
    projects: [{ id: 'p1', name: 'Fail Forward' }],
    pendingSteps: ['thumbnails', 'preview', 'export']
  });
  const ran = [];
  const manager = new AutomationManager({
    store,
    broadcast: async () => {},
    ...FAST_TIMING,
    stepRunners: {
      thumbnails: async () => {
        ran.push('thumbnails');
        throw Object.assign(new Error('mockups failed'), { code: 'MOCKUPS_FAIL' });
      },
      preview: async () => { ran.push('preview'); },
      export: async () => { ran.push('export'); }
    }
  });
  await manager.start();
  await manager._loopPromise;
  assert.deepEqual(ran, ['thumbnails', 'thumbnails', 'thumbnails', 'thumbnails']);
  assert.ok(!ran.includes('preview'));
  assert.ok(!ran.includes('export'));
});

test('detector selects distinct queues',()=>{assert.deepEqual(getPipelineSteps({productFormat:'editable'}),EDITABLE_PIPELINE);assert.deepEqual(getPipelineSteps({productFormat:'static'}),PIPELINE_STEPS);assert.deepEqual(getPipelineSteps({productFormat:'maze'}),MAZE_PIPELINE);assert.throws(()=>getPipelineSteps({productFormat:'unknown'}));});

test('classification produced by overview selects the immediately following generation step',async()=>{
 const project={id:'p1',name:'Late classification',productFormat:'static'};
 const store=createStore({projects:[project],pendingSteps:ALL_STEPS});
 const ran=[];let locked=false;
 store.lockProductEngine=()=>{assert.deepEqual(ran,['overview']);locked=true;};
 const runners=Object.fromEntries(ALL_STEPS.map(step=>[step,async()=>{ran.push(step);if(step==='overview')project.productFormat='editable';else assert.ok(locked);} ]));
 const manager=new AutomationManager({store,broadcast:async()=>{},...FAST_TIMING,stepRunners:runners});
 await manager.start();await manager._loopPromise;assert.deepEqual(ran,EDITABLE_PIPELINE);
});
test('missing native runner fails closed before downstream work',async()=>{
 const store=createStore({projects:[{id:'p1',productFormat:'editable'}],pendingSteps:['interior_artwork','thumbnails']});let called=false;
 const manager=new AutomationManager({store,broadcast:async()=>{},...FAST_TIMING,stepRunners:{thumbnails:async()=>{called=true;}}});
 await manager.start();await manager._loopPromise;assert.equal(called,false);assert.equal(store.stepStatus.get('p1:interior_artwork'),'failed');
});
test('normal pipeline executes its exact sequence',async()=>{
 const store=createStore({projects:[{id:'p1',productFormat:'static'}],pendingSteps:PIPELINE_STEPS});const ran=[];
 const manager=new AutomationManager({store,broadcast:async()=>{},...FAST_TIMING,stepRunners:Object.fromEntries(ALL_STEPS.map(step=>[step,async()=>ran.push(step)]))});
 await manager.start();await manager._loopPromise;assert.deepEqual(ran,PIPELINE_STEPS);
});
test('editable automation reads shared store columns when camelCase keys are missing', () => {
  const project = {
    id: 'p1',
    productFormat: 'editable',
    stepOverviewStatus: 'completed',
    stepInteriorStatus: 'completed',
    stepEditableStatus: 'pending',
    stepEditableGenerationStatus: 'pending'
  };
  const store = {
    getProject: () => project,
    updateProjectStepStatus() {},
    appendEvent() {}
  };
  const manager = new AutomationManager({ store, broadcast: async () => {}, ...FAST_TIMING, stepRunners: {} });
  assert.equal(readStepStatus(project, 'interior_artwork'), 'completed');
  assert.equal(manager._unsatisfiedDependency('p1', 'interior_text'), null);
});

test('maze pipeline executes its exact sequence and never runs editable stages', async () => {
  const store = createStore({ projects: [{ id: 'p1', productFormat: 'maze' }], pendingSteps: MAZE_PIPELINE });
  const ran = [];
  const manager = new AutomationManager({
    store,
    broadcast: async () => {},
    ...FAST_TIMING,
    stepRunners: Object.fromEntries(
      [...ALL_STEPS, 'interior_artwork', 'interior_text', 'editable_ppt'].map((step) => [
        step,
        async () => { ran.push(step); }
      ])
    )
  });
  await manager.start();
  await manager._loopPromise;
  assert.deepEqual(ran, MAZE_PIPELINE);
  assert.ok(!ran.includes('interior'));
  assert.ok(!ran.includes('interior_artwork'));
  assert.ok(!ran.includes('editable_ppt'));
});

test('missing maze runner fails closed before downstream work', async () => {
  const store = createStore({
    projects: [{ id: 'p1', productFormat: 'maze' }],
    pendingSteps: ['maze', 'thumbnails']
  });
  let called = false;
  const manager = new AutomationManager({
    store,
    broadcast: async () => {},
    ...FAST_TIMING,
    stepRunners: { thumbnails: async () => { called = true; } }
  });
  await manager.start();
  await manager._loopPromise;
  assert.equal(called, false);
  assert.equal(store.stepStatus.get('p1:maze'), 'failed');
});

test('native generation does not stop for legacy ask settings',async()=>{
 const store=createStore({projects:[{id:'p1',productFormat:'editable'}],pendingSteps:['interior_artwork','thumbnails'],settings:{editable_generation:'ask'}});let called=false;
 const manager=new AutomationManager({store,broadcast:async()=>{},...FAST_TIMING,stepRunners:{interior_artwork:async()=>{called=true;},thumbnails:async()=>{called=true;}}});
 manager.on('ask_required',()=>setImmediate(()=>manager.resolveAsk('skip')));
 await manager.start();await manager._loopPromise;assert.equal(called,true);assert.equal(store.stepStatus.get('p1:interior_artwork'),'completed');
});
