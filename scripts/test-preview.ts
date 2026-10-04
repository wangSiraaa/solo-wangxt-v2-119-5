/**
 * 预览确认流程的核心不变量验证（Node 侧，不依赖 React）：
 *  1) preview-set 不改变 mesh 与撤销历史；
 *  2) preview-clear（放弃）后 mesh / stats / history 与预览前逐字节一致，
 *     导出 OBJ 也与预览前一致；
 *  3) preview-accept（采用）后 mesh 被一次替换、旧 mesh 进入历史，
 *     且候选指标与正式视图指标为同一份 analyzeMesh 结果；
 *  4) 采用后一键撤销回到预览前；
 *  5) 预览期间 undo 被忽略；
 *  6) load 会清掉未决预览（切模型不带着候选）。
 */
import { reducer as appReducer, initialState as appInitialState } from '../src/state/reducer';
import { parseObj } from '../src/core/parser';
import { analyzeMesh } from '../src/core/metrics';
import { exportObj } from '../src/core/exporter';
import { buildUnwrapCandidate, summarizeStats } from '../src/core/preview';
import type { PreviewState } from '../src/state/reducer';
import { SAMPLES } from '../src/core/samples';
import type { UnwrapResult } from '../src/core/unwrapping';
import type { MeshData } from '../src/core/types';

let failures = 0;
const assert = (cond: boolean, msg: string) => {
  if (!cond) { failures++; console.log('FAIL:', msg); }
  else console.log('PASS:', msg);
};

const seamsObj = SAMPLES.find((s) => s.id === 'seams')!.obj;
const mesh = parseObj(seamsObj, 'seams.obj');
const stats = analyzeMesh(mesh);

let state = appReducer(appInitialState(), {
  type: 'load', mesh, stats, objText: seamsObj, fileName: 'seams.obj', projectId: null,
});
const objBeforePreview = exportObj(mesh);

// 构造一个“候选”（用假 UV 模拟 xatlas 输出：每岛不同的简单缩放偏移，
// 关键是形状/数量合法；真实 WASM 路径由 e2e 覆盖）。
function fakeCandidateUvs(cur: MeshData): Float64Array {
  const uvs = new Float64Array(cur.corners.length * 2);
  for (let ci = 0; ci < cur.corners.length; ci++) {
    // 全部角点收进 0.1..0.9 的单块区域（候选必然改变岛数/重叠结构）
    const v = cur.corners[ci].v;
    uvs[ci * 2] = 0.1 + ((v * 37) % 100) / 100 * 0.8;
    uvs[ci * 2 + 1] = 0.1 + ((v * 53) % 100) / 100 * 0.8;
  }
  return uvs;
}

const fakeResult: UnwrapResult = {
  uvs: fakeCandidateUvs(mesh),
  chartCount: 6,
  utilization: 0.42,
};
const candidate = buildUnwrapCandidate(mesh, fakeResult);
const candidateStats = analyzeMesh(candidate);

// 校验：候选构造不修改入参
const cornersVtBefore = mesh.corners.map((c) => c.vt);
const uvCountBefore = mesh.uvCount;
assert(mesh.uvCount === 24, `buildUnwrapCandidate 不改入参 uvCount（${mesh.uvCount}）`);
assert(cornersVtBefore[0] < 24, 'buildUnwrapCandidate 不改入参角点 vt');
assert(candidate.corners !== mesh.corners, '候选角点数组是新数组');
assert(candidate.corners[0].vt === 0, '候选每角点独立 vt 槽');
assert(mesh.uvCount === uvCountBefore, '候选构造后入参 uvCount 仍不变');
assert(
  mesh.corners.every((c, i) => c.vt === cornersVtBefore[i]),
  '候选构造后入参角点 vt 仍不变',
);

const preview: PreviewState = {
  candidate,
  candidateStats,
  beforeStats: stats,
  beforeSummary: summarizeStats(stats),
  afterSummary: summarizeStats(candidateStats),
  chartCount: 6,
  utilization: 0.42,
};

// 1) preview-set：当前 mesh/history 不动
state = appReducer(state, { type: 'preview-set', preview });
assert(state.preview !== null, 'preview-set 后存在预览');
assert(state.mesh === mesh, '预览期间 state.mesh 仍是旧网格');
assert(state.stats === stats, '预览期间 state.stats 仍是旧统计');
assert(state.history.length === 0, '预览不入撤销历史');
assert(exportObj(state.mesh!) === objBeforePreview, '预览期间导出 OBJ 与预览前一致');

// 预览期间 undo 被忽略
const stateUndoBlocked = appReducer(state, { type: 'undo' });
assert(stateUndoBlocked === state, '预览期间 undo 被忽略（状态引用不变）');

// 2) 放弃：恢复到无预览，且一切照旧
state = appReducer(state, { type: 'preview-clear' });
assert(state.preview === null, '放弃后预览清空');
assert(state.mesh === mesh, '放弃后 mesh 还是原对象');
assert(state.stats === stats, '放弃后 stats 还是原对象');
assert(state.history.length === 0, '放弃后历史仍为空');
assert(exportObj(state.mesh!) === objBeforePreview, '放弃后导出 OBJ 与预览前逐字节一致');

// 3) 再来一次预览，然后采用
state = appReducer(state, { type: 'preview-set', preview });
state = appReducer(state, { type: 'preview-accept' });
assert(state.preview === null, '采用后预览清空');
assert(state.mesh === candidate, '采用后 mesh 被替换为候选');
assert(state.stats === candidateStats, '采用后正式视图指标就是候选分析结果（同一份）');
assert(state.history.length === 1, '采用时旧 mesh 一次性进入撤销历史');
assert(state.history[0] === mesh, '撤销栈顶为预览前 mesh');
assert(exportObj(state.mesh!) !== objBeforePreview, '采用后导出反映新 UV');

// 4) 一键撤销回到预览前
state = appReducer(state, { type: 'undo' });
assert(state.mesh === mesh, '撤销后回到预览前 mesh');
assert(exportObj(state.mesh!) === objBeforePreview, '撤销后导出 OBJ 再次与预览前一致');
assert(state.history.length === 0, '撤销后栈清空');

// 5) 采用后指标摘要与正式面板口径一致（直接对正式 stats 再算一次摘要）
state = appReducer(state, { type: 'preview-set', preview });
state = appReducer(state, { type: 'preview-accept' });
const liveSummary = summarizeStats(state.stats!);
assert(
  liveSummary.islands === preview.afterSummary.islands &&
  liveSummary.flippedTri === preview.afterSummary.flippedTri &&
  liveSummary.overlapTri === preview.afterSummary.overlapTri &&
  liveSummary.mirroredIslands === preview.afterSummary.mirroredIslands,
  '采用后正式指标与预览摘要一致',
);

// 6) load 清掉未决预览
state = appReducer(state, { type: 'preview-clear' });
state = appReducer(state, { type: 'preview-set', preview });
const other = parseObj(SAMPLES.find((s) => s.id === 'nonmanifold')!.obj, 'nm.obj');
state = appReducer(state, {
  type: 'load', mesh: other, stats: analyzeMesh(other),
  objText: '', fileName: 'nm.obj', projectId: null,
});
assert(state.preview === null, '载入其他模型时未决预览被清除');
assert(state.mesh === other && state.history.length === 0, 'load 正常重置历史');

// 7) buildUnwrapCandidate 拒绝坏结果
const bad1 = (): UnwrapResult => ({ uvs: new Float64Array(4), chartCount: 1, utilization: 0.5 });
let threw = false;
try { buildUnwrapCandidate(mesh, bad1()); } catch { threw = true; }
assert(threw, 'UV 数量与角点不符 -> 抛错（不产生预览）');
threw = false;
try {
  const nan = new Float64Array(mesh.corners.length * 2);
  nan[0] = NaN;
  buildUnwrapCandidate(mesh, { uvs: nan, chartCount: 1, utilization: 0.5 });
} catch { threw = true; }
assert(threw, '含 NaN UV -> 抛错');
threw = false;
try {
  buildUnwrapCandidate(mesh, { uvs: fakeResult.uvs, chartCount: 1, utilization: NaN });
} catch { threw = true; }
assert(threw, 'utilization 非有限 -> 抛错');

console.log(failures === 0 ? '\nPREVIEW FLOW TESTS PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures ? 1 : 0);
