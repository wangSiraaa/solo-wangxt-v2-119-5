/**
 * 预览-确认流程的 Node 侧验证（状态机 + 真实 xatlas 展开）：
 *  - 预览生成 / 放弃都不触碰当前网格与撤销历史；
 *  - 放弃后导出的 OBJ 与预览前逐字节一致；
 *  - 采用才一次性替换，stats 与预览同源（正式视图指标一致），可一键撤销；
 *  - 采用后的导出文本重新解析 = 持久化重开看到的版本；
 *  - 失败路径只发 notice，不留任何预览/历史残留。
 */
import { parseObj } from '../src/core/parser';
import { analyzeMesh } from '../src/core/metrics';
import { exportObj } from '../src/core/exporter';
import { buildUnwrappedMesh, unwrapWithXAtlas } from '../src/core/unwrapping';
import { summarizeStats } from '../src/core/summary';
import { appReducer as reducer, createInitialState } from '../src/state/appState';
import type { AppState, UnwrapPreview } from '../src/state/appState';
import { SAMPLES } from '../src/core/samples';

let failures = 0;
const assert = (c: boolean, m: string) => {
  if (!c) { failures++; console.log('FAIL:', m); }
  else console.log('PASS:', m);
};

const sample = SAMPLES.find((s) => s.id === 'seams')!;
const mesh = parseObj(sample.obj, 'seams.obj');
const stats = analyzeMesh(mesh);

let state: AppState = createInitialState();
state = reducer(state, {
  type: 'load', mesh, stats, objText: sample.obj, fileName: 'seams.obj', projectId: null,
});

const exportBefore = exportObj(state.mesh!);

// ── 1) 生成候选预览（与 runUnwrap 成功路径完全相同的构造） ──
const result = await unwrapWithXAtlas(mesh);
assert(Number.isFinite(result.utilization), 'xatlas 展开成功（前置条件）');
const candidate = buildUnwrappedMesh(mesh, result);
const candidateStats = analyzeMesh(candidate);
const preview: UnwrapPreview = {
  mesh: candidate,
  stats: candidateStats,
  chartCount: result.chartCount,
  utilization: result.utilization,
};
state = reducer(state, { type: 'preview-set', preview });

assert(state.preview !== null, '预览已挂载');
assert(state.mesh === mesh, '预览期间当前网格未被替换（引用不变）');
assert(state.stats === stats, '预览期间正式指标仍是当前网格的');
assert(state.history.length === 0, '预览期间撤销历史为空');
assert(exportObj(state.mesh!) === exportBefore, '预览期间导出 OBJ 与预览前一致');

// 预览摘要与候选 stats 同源：采用后正式视图看到的应是同一组数字
const sumBefore = summarizeStats(stats);
const sumAfter = summarizeStats(candidateStats);
assert(sumBefore.islands === 6 && sumAfter.islands === 6,
  `摘要：岛数 当前 ${sumBefore.islands} → 预览 ${sumAfter.islands}`);

// ── 2) 放弃：网格 / 历史 / 导出全部原状 ──
state = reducer(state, { type: 'preview-clear', notice: { kind: 'info', text: '已放弃' } });
assert(state.preview === null, '放弃后预览清空');
assert(state.mesh === mesh && state.history.length === 0, '放弃后网格与撤销历史原状');
assert(exportObj(state.mesh!) === exportBefore, '放弃后导出 OBJ 与预览前逐字节一致');

// ── 3) 采用：唯一的一次性替换点 ──
state = reducer(state, { type: 'preview-set', preview });
state = reducer(state, { type: 'adopt-preview' });
assert(state.preview === null, '采用后预览清空');
assert(state.mesh === candidate, '采用后网格一次性替换为候选');
assert(state.stats === candidateStats, '采用后正式指标与预览同源（同一 MeshStats）');
assert(state.history.length === 1 && state.history[0] === mesh, '采用保留撤销历史（旧网格入栈）');
assert(state.mesh!.uvCount === mesh.corners.length, '采用后每角点一个 vt 槽');
const sumAdopted = summarizeStats(state.stats!);
assert(
  sumAdopted.islands === sumAfter.islands &&
    sumAdopted.flipped === sumAfter.flipped &&
    sumAdopted.overlapTris === sumAfter.overlapTris &&
    sumAdopted.maxAngle === sumAfter.maxAngle,
  '采用后摘要与预览摘要逐项一致',
);

// ── 4) 持久化往返：存工程文本重开 = 已采用版本 ──
const savedText = exportObj(state.mesh!);
const restored = parseObj(savedText, 'seams.obj');
const restoredStats = analyzeMesh(restored);
// 导出器会合并数值相同的 vt 行（设计如此），因此 vt 槽数可能变少；
// 持久化语义是「每个角点的 UV 坐标」不变 —— 这才是重开看到的版本。
let uvDrift = 0;
for (const t0 of state.mesh!.triangles) {
  const t1 = restored.triangles[t0.id];
  for (let k = 0; k < 3; k++) {
    const c0 = state.mesh!.corners[t0.corners[k]];
    const c1 = restored.corners[t1.corners[k]];
    if (
      Math.abs(state.mesh!.uvs[c0.vt * 2] - restored.uvs[c1.vt * 2]) > 1e-5 ||
      Math.abs(state.mesh!.uvs[c0.vt * 2 + 1] - restored.uvs[c1.vt * 2 + 1]) > 1e-5
    ) {
      uvDrift++;
    }
  }
}
assert(uvDrift === 0, `重开后每角点 UV 与采用版本一致（漂移角点 ${uvDrift}）`);
assert(restoredStats.islands.length === candidateStats.islands.length, '重开后岛数与采用版本一致');
assert(summarizeStats(restoredStats).flipped === sumAfter.flipped, '重开后翻转数与采用版本一致');

// ── 5) 一键撤销回到展开前 ──
state = reducer(state, { type: 'undo' });
assert(state.mesh === mesh, '撤销回到展开前网格');
assert(state.history.length === 0, '撤销后历史清空');
assert(exportObj(state.mesh!) === exportBefore, '撤销后导出与最初一致');

// ── 6) 预览待确认期间 undo 被忽略（UI 同步禁用，状态机兜底） ──
state = reducer(state, { type: 'preview-set', preview });
const frozen = state;
state = reducer(state, { type: 'undo' });
assert(state === frozen, '预览期间 undo 不改变任何状态');
state = reducer(state, { type: 'preview-clear' });

// ── 7) 失败路径：只发 notice，不留预览/历史残留 ──
// （适配器抛错由 test-unwrap-fail.ts 覆盖；这里验证状态机契约）
const beforeFail = state;
state = reducer(state, { type: 'unwrapping', on: true });
state = reducer(state, {
  type: 'notice',
  notice: { kind: 'error', text: '自动展开失败，已保留原模型' },
});
state = reducer(state, { type: 'unwrapping', on: false });
assert(
  state.mesh === beforeFail.mesh && state.preview === null && state.history.length === 0,
  '失败路径仅更新 notice，网格/预览/历史无残留',
);
assert(exportObj(state.mesh!) === exportBefore, '失败后导出仍与最初一致');

console.log(failures === 0 ? '\nPREVIEW-CONFIRM TESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures ? 1 : 0);
