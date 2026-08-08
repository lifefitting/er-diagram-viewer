import { readFileSync } from 'node:fs';

const reportPath = process.env.PERF_REPORT ?? process.argv[2];
if (!reportPath) throw new Error('Pass PERF_REPORT or a report path');
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
if (report.status !== 'complete') throw new Error(`Performance report is ${report.status}`);

const failures = [];
const median = (result, path) => {
  let value = result.summary;
  for (const part of path.split('.')) value = value?.[part];
  return value?.median;
};
const byScenario = new Map();
for (const result of report.results) {
  let targets = byScenario.get(result.scenario);
  if (!targets) {
    targets = new Map();
    byScenario.set(result.scenario, targets);
  }
  targets.set(result.target, result);
  if (median(result, 'runningAnimations') !== 0) {
    failures.push(`${result.target}/${result.scenario}: idle animations must be 0`);
  }
  for (const action of ['pan', 'table-drag']) {
    const p95 = median(result, `actions.${action}.p95FrameMs`);
    if (Number.isFinite(p95) && p95 > 34) {
      failures.push(`${result.target}/${result.scenario}/${action}: p95 ${p95.toFixed(1)}ms > 34ms`);
    }
  }
}

const beforeName = process.env.PERF_BEFORE ?? 'before';
const afterName = process.env.PERF_AFTER ?? 'after';
for (const [scenario, targets] of byScenario) {
  const before = targets.get(beforeName);
  const after = targets.get(afterName);
  if (!before || !after) continue;
  const comparisons = [
    ['importMs', 1.1, 50],
    ['domNodes', 1.02, 100],
    ['actions.pan.p95FrameMs', 1.15, 2],
    ['actions.pan.taskDurationMs', 1.1, 50],
    ['actions.table-drag.p95FrameMs', 1.15, 2],
    ['actions.table-drag.taskDurationMs', 1.1, 50],
  ];
  for (const [path, ratio, allowance] of comparisons) {
    const base = median(before, path);
    const next = median(after, path);
    if (!Number.isFinite(base) || !Number.isFinite(next)) continue;
    if (next > base * ratio && next - base > allowance) {
      failures.push(
        `${scenario}/${path}: ${next.toFixed(1)} regressed from ${base.toFixed(1)} ` +
          `(>${Math.round((ratio - 1) * 100)}% and +${allowance})`,
      );
    }
  }
}

if (failures.length) {
  console.error(`Performance gate failed:\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`Performance gate passed: ${report.results.length} result(s)`);
}
