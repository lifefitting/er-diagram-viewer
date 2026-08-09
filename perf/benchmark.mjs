import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { PERF_SCENARIOS, generateSql } from './fixtures.mjs';

const VIEWPORT = Object.freeze({ width: 1440, height: 1000 });
const ITERATIONS = positiveInteger('PERF_ITERATIONS', 7);
const WARMUPS = nonNegativeInteger('PERF_WARMUPS', 1);
const MOVE_STEPS = positiveInteger('PERF_MOVE_STEPS', 72);
const STEP_DELAY_MS = nonNegativeInteger('PERF_STEP_DELAY_MS', 16);
const SETTLE_MS = nonNegativeInteger('PERF_SETTLE_MS', 250);
const TARGETS = parseTargets(process.env.PERF_TARGETS ?? 'worktree=http://127.0.0.1:4173');
const SCENARIOS = parseScenarios(process.env.PERF_SCENARIOS ?? 'small,medium');
const RUN_ID = process.env.PERF_RUN_ID ?? new Date().toISOString().replaceAll(':', '-');
const OUTPUT_DIR = resolve(process.env.PERF_OUTPUT_DIR ?? 'perf-results', RUN_ID);
const OUTPUT_PATH = resolve(OUTPUT_DIR, 'baseline.json');

mkdirSync(OUTPUT_DIR, { recursive: true });

function positiveInteger(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function nonNegativeInteger(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

function parseTargets(raw) {
  return raw.split(',').map((entry) => {
    const separator = entry.indexOf('=');
    if (separator <= 0) throw new Error(`Invalid PERF_TARGETS entry: ${entry}`);
    return {
      name: entry.slice(0, separator).trim(),
      url: new URL(entry.slice(separator + 1).trim()).toString(),
    };
  });
}

function parseScenarios(raw) {
  return raw.split(',').map((name) => {
    const scenario = PERF_SCENARIOS[name.trim()];
    if (!scenario) {
      throw new Error(
        `Unknown scenario ${name}; expected one of ${Object.keys(PERF_SCENARIOS).join(', ')}`,
      );
    }
    return scenario;
  });
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function distribution(values) {
  const finite = values.filter(Number.isFinite);
  const center = median(finite);
  return {
    samples: finite.length,
    median: center,
    p95: percentile(finite, 0.95),
    mad: center === null ? null : median(finite.map((value) => Math.abs(value - center))),
    min: finite.length ? Math.min(...finite) : null,
    max: finite.length ? Math.max(...finite) : null,
  };
}

function hashSeed(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function shuffledActions(seedText) {
  const actions = ['pan', 'table-drag'];
  let state = hashSeed(seedText);
  const random = () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  if (random() < 0.5) actions.reverse();
  return actions;
}

function metricMap(metrics) {
  return Object.fromEntries(metrics.metrics.map(({ name, value }) => [name, value]));
}

function metricDelta(before, after) {
  const result = {};
  for (const name of ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration']) {
    result[`${name}Ms`] = ((after[name] ?? 0) - (before[name] ?? 0)) * 1000;
  }
  for (const name of ['LayoutCount', 'RecalcStyleCount']) {
    result[name] = (after[name] ?? 0) - (before[name] ?? 0);
  }
  result.Nodes = after.Nodes ?? null;
  result.JSHeapUsedMB = after.JSHeapUsedSize == null ? null : after.JSHeapUsedSize / 1024 / 1024;
  return result;
}

function summarizeFrames(frameIntervals, longTasks, frameBudgetMs) {
  const frames = frameIntervals.filter((value) => value > 0 && value < 1000);
  const mean = frames.length
    ? frames.reduce((total, value) => total + value, 0) / frames.length
    : 0;
  return {
    samples: frames.length,
    frameBudgetMs,
    meanFrameMs: mean,
    p95FrameMs: percentile(frames, 0.95) ?? 0,
    p99FrameMs: percentile(frames, 0.99) ?? 0,
    estimatedFps: mean ? 1000 / mean : 0,
    framesOverBudget: frames.filter((value) => value > frameBudgetMs * 1.25).length,
    framesOverDoubleBudget: frames.filter((value) => value > frameBudgetMs * 2).length,
    maxFrameMs: frames.length ? Math.max(...frames) : 0,
    longTaskCount: longTasks.length,
    longTaskTotalMs: longTasks.reduce((total, value) => total + value, 0),
    maxLongTaskMs: longTasks.length ? Math.max(...longTasks) : 0,
  };
}

async function calibrateFrameBudget(page) {
  return page.evaluate(
    () =>
      new Promise((resolveBudget) => {
        const intervals = [];
        let previous = null;
        const sample = (timestamp) => {
          if (previous !== null) intervals.push(timestamp - previous);
          previous = timestamp;
          if (intervals.length < 30) requestAnimationFrame(sample);
          else {
            intervals.sort((left, right) => left - right);
            resolveBudget(intervals[Math.floor(intervals.length / 2)]);
          }
        };
        requestAnimationFrame(sample);
      }),
  );
}

async function startPageObservers(page) {
  await page.evaluate(() => {
    const state = {
      active: true,
      startedAt: performance.now(),
      previousFrame: null,
      frameIntervals: [],
      longTasks: [],
      observer: null,
    };
    const onFrame = (timestamp) => {
      if (!state.active) return;
      if (state.previousFrame !== null) state.frameIntervals.push(timestamp - state.previousFrame);
      state.previousFrame = timestamp;
      requestAnimationFrame(onFrame);
    };
    requestAnimationFrame(onFrame);

    if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      state.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.startTime >= state.startedAt) state.longTasks.push(entry.duration);
        }
      });
      state.observer.observe({ type: 'longtask' });
    }
    window.__erPerfSample = state;
  });
}

async function stopPageObservers(page) {
  return page.evaluate(() => {
    const state = window.__erPerfSample;
    state.active = false;
    state.observer?.disconnect();
    return { frameIntervals: state.frameIntervals, longTasks: state.longTasks };
  });
}

async function waitForPaint(page) {
  await page.evaluate(
    () =>
      new Promise((resolvePaint) =>
        requestAnimationFrame(() => requestAnimationFrame(resolvePaint)),
      ),
  );
}

async function importFixture(page, scenario) {
  if (scenario.useDefault) {
    // v0.3.6 and older auto-load the 14-table sample. Newer builds expose it
    // explicitly from the empty workspace so cold startup stays representative
    // of a real first visit. Support both paths to keep cross-version reports
    // comparable.
    const sampleLauncher = page.getByRole('button', {
      name: '查看示例 ER 图',
      exact: true,
    });
    if ((await sampleLauncher.count()) > 0) await sampleLauncher.click();
  } else {
    await page.getByRole('button', { name: '导入', exact: true }).click();
    const textarea = page.locator('textarea').first();
    await textarea.waitFor({ state: 'visible' });
    await textarea.fill(generateSql(scenario.tables, scenario.columns, scenario.topology));
    await page.evaluate(() => performance.clearMeasures());
    await page.getByRole('button', { name: /更新图表|解析并绘制/ }).click();
    await textarea.waitFor({ state: 'detached', timeout: 120_000 });
  }

  await page.locator('.cy-container canvas').first().waitFor({ state: 'visible' });
  await page.waitForFunction(
    (expected) => document.querySelectorAll('[data-node-id]').length === expected,
    scenario.tables,
    { timeout: 120_000 },
  );
  await waitForPaint(page);
}

async function collectRuntimeMeasures(page) {
  return page.evaluate(() => {
    const grouped = {};
    for (const entry of performance.getEntriesByType('measure')) {
      if (!entry.name.startsWith('er:')) continue;
      const current = grouped[entry.name] ?? { count: 0, totalMs: 0, maxMs: 0, lastMs: 0 };
      current.count += 1;
      current.totalMs += entry.duration;
      current.maxMs = Math.max(current.maxMs, entry.duration);
      current.lastMs = entry.duration;
      grouped[entry.name] = current;
    }
    return grouped;
  });
}

async function clickMode(page, text) {
  await page.locator('button').filter({ hasText: text }).first().click();
  await waitForPaint(page);
}

async function visibleOverlay(page, { requiresDragHit = false } = {}) {
  const overlays = page.locator('[data-node-id]');
  const count = await overlays.count();
  for (let index = 0; index < count; index += 1) {
    const overlay = overlays.nth(index);
    const box = await overlay.boundingBox();
    if (
      box &&
      box.width > 10 &&
      box.height >= 2 &&
      box.x > 5 &&
      box.y > 55 &&
      box.x + box.width < VIEWPORT.width - 330 &&
      box.y + box.height < VIEWPORT.height - 60
    ) {
      if (requiresDragHit) {
        const handle = overlay.locator('[data-table-drag-handle]');
        const handleBox = await handle.boundingBox();
        if (!handleBox) continue;
        const point = {
          x: handleBox.x + handleBox.width * 0.62,
          y: handleBox.y + handleBox.height / 2,
        };
        const receivesPointer = await handle.evaluate((element, coordinates) => {
          const hit = document.elementFromPoint(coordinates.x, coordinates.y);
          return hit === element || (hit instanceof Node && element.contains(hit));
        }, point);
        if (!receivesPointer) continue;
      }
      return { overlay, box };
    }
  }
  throw new Error(`No visible table overlay found among ${count} candidates`);
}

async function performPan(page, direction) {
  const anchor = await visibleOverlay(page);
  const canvas = await page.locator('.cy-container').boundingBox();
  if (!canvas) throw new Error('Canvas container has no bounding box');
  const start = { x: canvas.x + canvas.width * 0.42, y: canvas.y + canvas.height * 0.56 };
  const delta = { x: 210 * direction, y: 120 * direction };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down({ button: 'left' });
  for (let step = 1; step <= MOVE_STEPS; step += 1) {
    const ratio = step / MOVE_STEPS;
    const eased = 0.5 - Math.cos(Math.PI * ratio) / 2;
    await page.mouse.move(start.x + delta.x * eased, start.y + delta.y * eased);
    if (STEP_DELAY_MS) await page.waitForTimeout(STEP_DELAY_MS);
  }
  const releaseStarted = performance.now();
  await page.mouse.up({ button: 'left' });
  const after = await anchor.overlay.boundingBox();
  return {
    releaseMs: performance.now() - releaseStarted,
    movedPixels: after ? Math.hypot(after.x - anchor.box.x, after.y - anchor.box.y) : null,
  };
}

async function performTableDrag(page, direction) {
  const candidate = await visibleOverlay(page, { requiresDragHit: true });
  const handle = candidate.overlay.locator('[data-table-drag-handle]');
  const before = await handle.boundingBox();
  if (!before) throw new Error('Visible table drag handle has no bounding box');
  const start = {
    x: before.x + Math.min(before.width * 0.62, Math.max(3, before.width - 3)),
    y: before.y + before.height / 2,
  };
  const delta = { x: 170 * direction, y: 90 * direction };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down({ button: 'left' });
  for (let step = 1; step <= MOVE_STEPS; step += 1) {
    const ratio = step / MOVE_STEPS;
    const eased = 0.5 - Math.cos(Math.PI * ratio) / 2;
    await page.mouse.move(start.x + delta.x * eased, start.y + delta.y * eased);
    if (STEP_DELAY_MS) await page.waitForTimeout(STEP_DELAY_MS);
  }
  const releaseStarted = performance.now();
  await page.mouse.up({ button: 'left' });
  const after = await handle.boundingBox();
  return {
    releaseMs: performance.now() - releaseStarted,
    movedPixels: after ? Math.hypot(after.x - before.x, after.y - before.y) : null,
  };
}

async function collectPageStats(page) {
  await page.mouse.move(5, 5);
  await page.waitForTimeout(500);
  return page.evaluate(() => {
    const running = document
      .getAnimations()
      .filter((animation) => animation.playState === 'running');
    const targetOf = (animation) => animation.effect?.target;
    return {
      domNodes: document.querySelectorAll('*').length,
      runningAnimations: running.length,
      runningControlAnimations: running.filter(
        (animation) =>
          'animationName' in animation && animation.animationName === 'field-control-pulse',
      ).length,
      runningAnimationDetails: running.map((animation) => {
        const target = targetOf(animation);
        const timing = animation.effect?.getComputedTiming();
        return {
          animationName: 'animationName' in animation ? animation.animationName : null,
          target:
            target instanceof Element
              ? `${target.tagName.toLowerCase()}.${[...target.classList].join('.')}`
              : null,
          duration: timing?.duration ?? null,
          iterations: timing?.iterations ?? null,
        };
      }),
      reorderButtons: document.querySelectorAll('.column-reorder-hit').length,
      connectButtons: document.querySelectorAll('.connect-dot-hit').length,
      tableOverlays: document.querySelectorAll('[data-node-id]').length,
    };
  });
}

async function collectModeStats(page) {
  await clickMode(page, '阅读');
  const read = await collectPageStats(page);
  await clickMode(page, '编辑');
  const edit = await collectPageStats(page);
  return { ...edit, modes: { read, edit } };
}

async function measureAction({ page, cdp, actionName, direction, frameBudgetMs }) {
  if (actionName === 'pan') await clickMode(page, '阅读');
  else await clickMode(page, '编辑');

  const before = metricMap(await cdp.send('Performance.getMetrics'));
  await startPageObservers(page);
  const started = performance.now();
  const actionResult =
    actionName === 'pan'
      ? await performPan(page, direction)
      : await performTableDrag(page, direction);
  if (SETTLE_MS) await page.waitForTimeout(SETTLE_MS);
  const wallMs = performance.now() - started;
  const observerData = await stopPageObservers(page);
  const after = metricMap(await cdp.send('Performance.getMetrics'));
  const result = {
    action: actionName,
    wallMs,
    ...actionResult,
    frames: summarizeFrames(observerData.frameIntervals, observerData.longTasks, frameBudgetMs),
    cdp: metricDelta(before, after),
  };

  if (result.movedPixels === null || result.movedPixels < 20) {
    throw new Error(
      `${actionName} sample is invalid: expected at least 20px movement, got ${result.movedPixels}`,
    );
  }
  return result;
}

function summarizeScenario(rounds) {
  const formal = rounds.filter((round) => !round.warmup);
  const actionSummary = {};
  for (const actionName of ['pan', 'table-drag']) {
    const actions = formal
      .flatMap((round) => round.actions)
      .filter((item) => item.action === actionName);
    actionSummary[actionName] = {
      wallMs: distribution(actions.map((item) => item.wallMs)),
      releaseMs: distribution(actions.map((item) => item.releaseMs)),
      movedPixels: distribution(actions.map((item) => item.movedPixels)),
      estimatedFps: distribution(actions.map((item) => item.frames.estimatedFps)),
      p95FrameMs: distribution(actions.map((item) => item.frames.p95FrameMs)),
      framesOverBudget: distribution(actions.map((item) => item.frames.framesOverBudget)),
      longTaskTotalMs: distribution(actions.map((item) => item.frames.longTaskTotalMs)),
      taskDurationMs: distribution(actions.map((item) => item.cdp.TaskDurationMs)),
      scriptDurationMs: distribution(actions.map((item) => item.cdp.ScriptDurationMs)),
      layoutDurationMs: distribution(actions.map((item) => item.cdp.LayoutDurationMs)),
      recalcStyleDurationMs: distribution(actions.map((item) => item.cdp.RecalcStyleDurationMs)),
    };
  }
  return {
    importMs: distribution(formal.map((round) => round.importMs)),
    incrementalUpdateMs: distribution(
      formal.map((round) => round.incrementalUpdateMs).filter(Number.isFinite),
    ),
    domNodes: distribution(formal.map((round) => round.pageStats.domNodes)),
    readModeDomNodes: distribution(formal.map((round) => round.pageStats.modes.read.domNodes)),
    editModeDomNodes: distribution(formal.map((round) => round.pageStats.modes.edit.domNodes)),
    runningAnimations: distribution(formal.map((round) => round.pageStats.runningAnimations)),
    runningControlAnimations: distribution(
      formal.map((round) => round.pageStats.runningControlAnimations),
    ),
    runtimeStages: Object.fromEntries(
      ['er:pipeline:parse-merge', 'er:pipeline:derive', 'er:layout:arrange', 'er:routing:full'].map(
        (name) => [
          name,
          distribution(
            formal.map((round) => round.runtimeMeasures?.[name]?.totalMs).filter(Number.isFinite),
          ),
        ],
      ),
    ),
    actions: actionSummary,
  };
}

async function measureIncrementalUpdate(page, scenario) {
  if (!scenario.incremental) return null;
  await page.getByRole('button', { name: '导入', exact: true }).click();
  const textarea = page.locator('textarea').first();
  await textarea.waitFor({ state: 'visible' });
  await textarea.fill(generateSql(scenario.tables + 1, scenario.columns, scenario.topology));
  const started = performance.now();
  await page.getByRole('button', { name: /更新图表/ }).click();
  await page.waitForFunction(
    (expected) => document.querySelectorAll('[data-node-id]').length === expected,
    scenario.tables + 1,
    { timeout: 120_000 },
  );
  await waitForPaint(page);
  return performance.now() - started;
}

function printAction(label, result) {
  console.log(
    `${label}: fps=${result.frames.estimatedFps.toFixed(1)} ` +
      `p95=${result.frames.p95FrameMs.toFixed(1)}ms ` +
      `over=${result.frames.framesOverBudget} ` +
      `task=${result.cdp.TaskDurationMs.toFixed(1)}ms ` +
      `script=${result.cdp.ScriptDurationMs.toFixed(1)}ms ` +
      `moved=${result.movedPixels.toFixed(1)}px`,
  );
}

const launchOptions = { headless: true, args: ['--enable-precise-memory-info'] };
if (process.env.PERF_CHROME) launchOptions.executablePath = process.env.PERF_CHROME;
const browser = await chromium.launch(launchOptions);
const report = {
  generatedAt: new Date().toISOString(),
  status: 'running',
  environment: {
    browser: await browser.version(),
    viewport: VIEWPORT,
    moveSteps: MOVE_STEPS,
    stepDelayMs: STEP_DELAY_MS,
    settleMs: SETTLE_MS,
    iterations: ITERATIONS,
    warmups: WARMUPS,
    targets: TARGETS,
    scenarios: SCENARIOS.map(({ name, tables, columns, topology, incremental }) => ({
      name,
      tables,
      columns,
      topology: topology ?? 'chain',
      incremental: Boolean(incremental),
    })),
  },
  results: [],
};

function writeReport() {
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
}

try {
  for (const target of TARGETS) {
    for (const scenario of SCENARIOS) {
      console.log(`\n${target.name} / ${scenario.name}`);
      const scenarioResult = {
        target: target.name,
        scenario: scenario.name,
        rounds: [],
        summary: null,
      };
      report.results.push(scenarioResult);

      for (let roundIndex = -WARMUPS; roundIndex < ITERATIONS; roundIndex += 1) {
        const warmup = roundIndex < 0;
        const iteration = warmup ? roundIndex + WARMUPS + 1 : roundIndex + 1;
        const roundLabel = warmup ? `warmup-${iteration}` : `sample-${iteration}`;
        const context = await browser.newContext({
          viewport: VIEWPORT,
          deviceScaleFactor: 1,
          reducedMotion: 'no-preference',
        });
        try {
          const page = await context.newPage();
          await page.goto(target.url, { waitUntil: 'domcontentloaded' });
          const importStarted = performance.now();
          await importFixture(page, scenario);
          const importMs = performance.now() - importStarted;
          const runtimeMeasures = await collectRuntimeMeasures(page);
          const pageStats = await collectModeStats(page);
          const frameBudgetMs = await calibrateFrameBudget(page);
          const cdp = await context.newCDPSession(page);
          await cdp.send('Performance.enable');
          const direction = iteration % 2 === 0 ? -1 : 1;
          const actionOrder = shuffledActions(`${target.name}/${scenario.name}/${roundLabel}`);
          const actions = [];

          console.log(
            `${roundLabel}: import=${importMs.toFixed(1)}ms ` +
              `DOM(read/edit)=${pageStats.modes.read.domNodes}/${pageStats.modes.edit.domNodes} ` +
              `idleAnimations=${pageStats.runningAnimations} order=${actionOrder.join('→')}`,
          );
          for (const actionName of actionOrder) {
            const result = await measureAction({
              page,
              cdp,
              actionName,
              direction,
              frameBudgetMs,
            });
            actions.push(result);
            printAction(`${roundLabel}/${actionName}`, result);
          }
          const incrementalUpdateMs = await measureIncrementalUpdate(page, scenario);
          if (incrementalUpdateMs !== null) {
            console.log(`${roundLabel}/incremental-update: ${incrementalUpdateMs.toFixed(1)}ms`);
          }
          scenarioResult.rounds.push({
            warmup,
            iteration,
            importMs,
            frameBudgetMs,
            pageStats,
            actionOrder,
            actions,
            incrementalUpdateMs,
            runtimeMeasures,
          });
          scenarioResult.summary = summarizeScenario(scenarioResult.rounds);
          writeReport();
        } finally {
          await context.close();
        }
      }
    }
  }
  report.status = 'complete';
} catch (error) {
  report.status = 'failed';
  report.error = error instanceof Error ? error.stack : String(error);
  throw error;
} finally {
  writeReport();
  await browser.close();
}

console.log(`\nPerformance report written to ${OUTPUT_PATH}`);
