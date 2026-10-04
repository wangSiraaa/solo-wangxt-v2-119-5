/**
 * 真实状态机集成测试（jsdom + react-dom/client + 真实 xatlas WASM）：
 * 不挂载 Three 视图（jsdom 无 WebGL），但挂载真实 AppProvider，
 * 通过 context 探针驱动 loadObjText / runUnwrap / discard / accept / undo，
 * 验证：
 *  - WASM 成功后进入【预览】而非直接替换；
 *  - 放弃后 mesh 引用不变、撤销历史不变；
 *  - 采用后一次替换、可一键撤销回展开前；
 *  - 预览期间摘要与采用后正式 stats 一致；
 *  - 保存（导出当前 mesh 文本）后重新载入看到的是已采用版本。
 *
 * 注意：context value 每次渲染都会换对象，必须在断言时重新读取最新
 * value，不能把首次渲染的 value 缓存到常量。
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
});
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).navigator = dom.window.navigator;
(globalThis as any).HTMLElement = dom.window.HTMLElement;
(globalThis as any).Element = dom.window.Element;
(globalThis as any).Event = dom.window.Event;
(globalThis as any).KeyboardEvent = dom.window.KeyboardEvent;
(globalThis as any).requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0);
(globalThis as any).cancelAnimationFrame = (h: unknown) => clearTimeout(h as number);
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider, useApp } from '../src/state/AppContext';
import type { AppContextValue } from '../src/state/AppContext';
import { exportObj } from '../src/core/exporter';
import { cornerUv } from '../src/core/parser';
import { analyzeMesh } from '../src/core/metrics';
import { summarizeStats } from '../src/core/preview';
import { SAMPLES } from '../src/core/samples';

let failures = 0;
const assert = (cond: boolean, msg: string) => {
  if (!cond) { failures++; console.log('FAIL:', msg); }
  else console.log('PASS:', msg);
};

let latest: AppContextValue | null = null;
function Probe() {
  latest = useApp();
  return null;
}
/** 每次都拿到最近一次渲染的 context value（含最新 state）。 */
const cur = (): AppContextValue => {
  if (!latest) throw new Error('probe not ready');
  return latest;
};

const container = document.getElementById('root')!;
const root = createRoot(container);
await act(async () => {
  root.render(
    <AppProvider>
      <Probe />
    </AppProvider>,
  );
});

// 载入接缝立方体
const seamsObj = SAMPLES.find((s) => s.id === 'seams')!.obj;
await act(async () => { cur().loadObjText(seamsObj, 'seams.obj'); });
if (!cur().state.mesh) throw new Error('load 后 mesh 仍为空');
const meshBefore = cur().state.mesh;
const objBefore = exportObj(meshBefore);
assert(cur().state.stats!.islands.length === 6, '载入后 6 个 UV 岛');

// 触发真实 xatlas WASM 展开
await act(async () => {
  await cur().runUnwrap();
});
assert(cur().state.preview !== null, 'WASM 成功后出现候选预览（未直接替换）');
assert(cur().state.mesh === meshBefore, '预览期间 mesh 引用不变');
assert(cur().state.history.length === 0, '预览不入撤销历史');
assert(exportObj(cur().state.mesh!) === objBefore, '预览期间导出 OBJ == 预览前');
assert(cur().state.preview!.afterSummary.islands === 6, '候选摘要：xatlas 产出 6 岛');
assert(
  cur().state.preview!.chartCount === 6,
  `候选图数 6（实际 ${cur().state.preview!.chartCount}）`,
);
// 注意：该样例的顶点是每面独立副本，xatlas 焊接后按角点分发 UV，
// 部分面相对本应用翻转判据会显示为翻转（fixWinding:false 既有配置）。
// 这正是预览要暴露给模型师决定的信息；流程测试不断言“无翻转”，
// 而断言采用后正式视图与候选摘要逐字段一致（见下）。
assert(cur().state.preview!.afterSummary.overlapTri === 0, '候选无岛间重叠');

// 放弃
await act(async () => { cur().discardPreview(); });
assert(cur().state.preview === null, '放弃后预览清空');
assert(cur().state.mesh === meshBefore, '放弃后 mesh 仍是原对象');
assert(cur().state.history.length === 0, '放弃后历史仍为空');
assert(exportObj(cur().state.mesh!) === objBefore, '放弃后导出 OBJ 与预览前逐字节一致');

// 再次展开 -> 采用
await act(async () => { await cur().runUnwrap(); });
const previewAfter = cur().state.preview!;
const candidateSummary = previewAfter.afterSummary;
await act(async () => { cur().acceptPreview(); });
assert(cur().state.preview === null, '采用后预览清空');
assert(cur().state.mesh === previewAfter.candidate, '采用后 mesh === 候选网格');
assert(cur().state.history.length === 1, '采用后撤销历史为 1');
assert(cur().state.history[0] === meshBefore, '栈顶为展开前 mesh');
assert(
  JSON.stringify(summarizeStats(cur().state.stats!)) === JSON.stringify(candidateSummary),
  '采用后正式 stats 摘要与候选摘要一致',
);
const adoptedObj = exportObj(cur().state.mesh!);
assert(adoptedObj !== objBefore, '采用后导出 OBJ 已变化');
assert(cur().state.mesh!.uvCount === 36, '采用后每角点独立 vt（36）');

// 一键撤销
await act(async () => { cur().undo(); });
assert(cur().state.mesh === meshBefore, '撤销后回到预览前 mesh');
assert(cur().state.history.length === 0, '撤销后栈清空');
assert(exportObj(cur().state.mesh!) === objBefore, '撤销后导出 OBJ 再次一致');

// 采用后“保存”（saveCurrent 存的就是 exportObj(state.mesh)），再重新载入：
// 重开看到的必须是已采用版本，且没有任何未决预览。
// 注意导出器会合并数值相同的 vt（36 角点 -> 每面 4 个 = 24 vt），
// 所以“已采用”不能用 vt 槽数判断，要用 UV 几何内容与基线不同来判断。
await act(async () => { await cur().runUnwrap(); });
await act(async () => { cur().acceptPreview(); });
const savedMesh = cur().state.mesh!;
const savedText = exportObj(savedMesh);
await act(async () => { cur().loadObjText(savedText, 'seams.obj', 'p_test'); });
assert(cur().state.preview === null, '重开后无待确认预览');
assert(cur().state.history.length === 0, '重开后撤销栈重置（符合 load 语义）');
assert(exportObj(cur().state.mesh!) === savedText, '重开后导出 == 保存的采用版本');
assert(exportObj(cur().state.mesh!) !== objBefore, '重开版本不是预览前基线（确为采用版）');
// 重开后每角点 UV 与采用候选零漂移（合并 vt 不改几何）
{
  const re = cur().state.mesh!;
  let drift = 0;
  for (const t of savedMesh.triangles) {
    for (let k = 0; k < 3; k++) {
      const ci0 = t.corners[k];
      const ci1 = re.triangles[t.id].corners[k];
      const [u0, v0] = cornerUv(savedMesh, ci0);
      const [u1, v1] = cornerUv(re, ci1);
      if (Math.abs(u0 - u1) > 1e-5 || Math.abs(v0 - v1) > 1e-5) drift++;
    }
  }
  assert(drift === 0, `保存重开后 UV 零漂移（漂移角点 ${drift}）`);
  const reStats = analyzeMesh(re);
  assert(reStats.islands.length === 6, '保存重开后仍是 6 个岛（采用版布局）');
  assert(
    summarizeStats(reStats).flippedTri === summarizeStats(analyzeMesh(savedMesh)).flippedTri,
    '保存重开后翻转指标与采用版一致',
  );
}

// 展开失败路径：非流形样例（鳍片共享边）xatlas addMesh 会拒绝。
await act(async () => {
  cur().loadObjText(SAMPLES.find((s) => s.id === 'nonmanifold')!.obj, 'nm.obj');
});
const nmMesh = cur().state.mesh!;
const nmHistory = cur().state.history.length;
await act(async () => { await cur().runUnwrap(); });
if (cur().state.preview) {
  assert(cur().state.mesh === nmMesh, '（非流形若成功）预览期间当前 mesh 仍不动');
  await act(async () => { cur().discardPreview(); });
  assert(cur().state.mesh === nmMesh, '放弃后 mesh 不变');
} else {
  assert(
    cur().state.mesh === nmMesh && cur().state.history.length === nmHistory,
    '（非流形展开失败）无预览且 mesh/历史不变',
  );
  assert(/失败/.test(cur().state.notice?.text ?? ''), '失败有错误通知: ' + cur().state.notice?.text);
}

console.log(failures === 0 ? '\nPREVIEW INTEGRATION TESTS PASSED' : `\n${failures} FAILURE(S)`);
root.unmount();
process.exit(failures ? 1 : 0);
