# 性能基准

这套脚本把最初放在 `/tmp` 的 v0.3.3–v0.3.5 对比流程收进仓库，默认测量 `small`、`medium` 两档的导入、画布平移和表拖拽。

## 运行

先启动待测版本：

```bash
bun run dev -- --host 127.0.0.1 --port 4173
```

再运行完整本地基准（1 次预热 + 7 个正式样本）：

```bash
bun run perf:baseline
```

快速验证脚本和动作是否有效：

```bash
bun run perf:smoke
```

结果写入 `perf-results/<timestamp>/baseline.json`。原始轮次和 median / p95 / MAD 汇总会同时保留。

## 对比两个版本

分别在不同端口启动两个版本，再显式传入目标：

```bash
PERF_TARGETS='before=http://127.0.0.1:4173,after=http://127.0.0.1:4174' \
  PERF_SCENARIOS='small,medium,large' \
  bun run perf:baseline
```

常用环境变量：

- `PERF_TARGETS`：逗号分隔的 `name=url`。
- `PERF_SCENARIOS`：`small`、`medium`、`large` 的逗号分隔列表。
- `PERF_ITERATIONS`：正式样本数，默认 `7`。
- `PERF_WARMUPS`：预热轮数，默认 `1`。
- `PERF_MOVE_STEPS` / `PERF_STEP_DELAY_MS`：手势采样步数与步间隔。
- `PERF_RUN_ID` / `PERF_OUTPUT_DIR`：结果目录名称与根目录。
- `PERF_CHROME`：可选的 Chromium/Chrome 可执行文件；默认使用 Playwright Chromium。

## 采样约束

- 每个目标、场景和轮次使用新的浏览器 context，避免版本/样本状态串扰。
- 两个手势每轮随机换序，方向交替；预热数据不进入正式汇总。
- Long Task observer 不读取历史 buffer，只统计当前动作窗口。
- 平移和表拖拽必须让稳定锚点移动至少 20px，否则整个运行失败，防止“空动作”污染数据。
- 屏幕刷新预算由每轮 30 个 `requestAnimationFrame` 间隔校准，不硬编码 60Hz。
- 导入完成以预期表节点数量和连续两帧绘制为准，不再使用固定 1200ms 等待。

场景包括确定性 FK 链（small / medium / large）、宽表（wide）、中心枢纽（hub）、
稠密关系（dense）和保留现有工作区的小步 SQL 更新（incremental）。

## 性能门禁

对单目标 smoke 报告执行绝对预算（空闲动画必须为 0、手势 p95 帧时间不超过
34ms）：

```bash
PERF_REPORT=perf-results/ci/baseline.json bun run perf:check
```

同一报告包含 `before` / `after` 两个目标时，还会检查导入、DOM、平移和拖表的
相对回退；只有同时超过百分比阈值和绝对噪声带才失败。可用
`PERF_BEFORE` / `PERF_AFTER` 改目标名。PR 工作流运行 small smoke 并上传原始 JSON；
本地或定时任务可运行 medium / large / wide / hub / dense / incremental 完整矩阵。
