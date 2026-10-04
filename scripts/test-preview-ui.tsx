/**
 * 组件层冒烟（Node + react-dom/server）：
 * 用真实 AppContext.Provider 注入桩状态，验证 PreviewBar / Toolbar
 * 在预览态与正常态下的 DOM 结构与禁用规则。
 * 完整浏览器交互（WASM、下载、IndexedDB、键盘事件）由 scripts/e2e.ts 覆盖。
 */
import React from 'react';
import { renderToString } from 'react-dom/server';
import { reducer, initialState } from '../src/state/reducer';
import { AppContext } from '../src/state/AppContext';
import type { AppContextValue } from '../src/state/AppContext';
import { PreviewBar } from '../src/components/PreviewBar';
import { Toolbar } from '../src/components/Toolbar';
import { parseObj } from '../src/core/parser';
import { analyzeMesh } from '../src/core/metrics';
import { buildUnwrapCandidate, summarizeStats } from '../src/core/preview';
import { SAMPLES } from '../src/core/samples';
import type { UnwrapResult } from '../src/core/unwrapping';

let failures = 0;
const assert = (cond: boolean, msg: string) => {
  if (!cond) { failures++; console.log('FAIL:', msg); }
  else console.log('PASS:', msg);
};

const mesh = parseObj(SAMPLES.find((s) => s.id === 'seams')!.obj, 'seams.obj');
const stats = analyzeMesh(mesh);
const fakeResult: UnwrapResult = {
  uvs: (() => {
    const u = new Float64Array(mesh.corners.length * 2);
    for (let i = 0; i < u.length; i++) u[i] = 0.1 + ((i * 37) % 100) / 100 * 0.8;
    return u;
  })(),
  chartCount: 6,
  utilization: 0.42,
};
const candidate = buildUnwrapCandidate(mesh, fakeResult);
const candidateStats = analyzeMesh(candidate);

let state = reducer(initialState(), {
  type: 'load', mesh, stats, objText: '', fileName: 'seams.obj', projectId: null,
});
state = reducer(state, {
  type: 'preview-set',
  preview: {
    candidate,
    candidateStats,
    beforeStats: stats,
    beforeSummary: summarizeStats(stats),
    afterSummary: summarizeStats(candidateStats),
    chartCount: 6,
    utilization: 0.42,
  },
});

function makeValue(s: typeof state): AppContextValue {
  return {
    state: s,
    loadObjText: () => {}, selectFaces: () => {}, toggleFace: () => {},
    setChecker: () => {}, toggleFlag: () => {},
    runUnwrap: async () => {}, acceptPreview: () => {}, discardPreview: () => {},
    exportCurrent: () => {}, saveCurrent: async () => {},
    projects: [], refreshProjects: async () => {},
    openProject: async () => {}, removeProject: async () => {},
    notify: () => {}, undo: () => {},
  };
}

function render(s: typeof state, el: React.ReactElement): string {
  return renderToString(
    <AppContext.Provider value={makeValue(s)}>{el}</AppContext.Provider>,
  );
}

function buttons(html: string): Array<{ text: string; disabled: boolean }> {
  const re = /<button[^>]*>[\s\S]*?<\/button>/g;
  const out: Array<{ text: string; disabled: boolean }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const tagEnd = m[0].indexOf('>');
    const tag = m[0].slice(0, tagEnd);
    const text = m[0]
      .slice(tagEnd + 1, -'</button>'.length)
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    out.push({ text, disabled: /\bdisabled\b/.test(tag) });
  }
  return out;
}
const findBtn = (html: string, t: string) => buttons(html).find((b) => b.text.includes(t));

/** SSR 会在表达式插槽两侧插入 <!-- --> 占位，断言文本时先剥掉。 */
const plain = (html: string) => html.replace(/<!--[^>]*-->/g, '');

// --- 预览态：PreviewBar ---
{
  const html = plain(render(state, <PreviewBar />));
  assert(/候选展开预览/.test(html), '预览条渲染标题');
  assert(/展开前/.test(html) && /<th[^>]*>候选<\/th>/.test(html), '预览条含展开前/候选列');
  assert(/UV 岛数/.test(html), '预览条含岛数');
  assert(/翻转三角 \/ 镜像岛/.test(html), '预览条含翻转/镜像摘要');
  assert(/岛间重叠三角/.test(html), '预览条含重叠摘要');
  assert(/面积比率/.test(html) && /最大角度畸变/.test(html), '预览条含畸变摘要');
  assert(/6 个图\s*·\s*利用率\s*42%/.test(html), '预览条含图数与利用率');
  assert(/Enter 采用 \/ Esc 放弃/.test(html), '预览条提示快捷键');
  const adopt = findBtn(html, '采用');
  const discard = findBtn(html, '放弃');
  assert(!!adopt && !adopt.disabled, '采用按钮可点');
  assert(!!discard && !discard.disabled, '放弃按钮可点');
}

// --- 预览态：Toolbar 禁用规则 ---
{
  const html = render(state, <Toolbar />);
  assert(findBtn(html, '导出 UV OBJ')?.disabled === true, '预览期间导出禁用');
  assert(findBtn(html, '存工程')?.disabled === true, '预览期间存工程禁用');
  assert(findBtn(html, '撤销')?.disabled === true, '预览期间撤销禁用');
  assert(findBtn(html, 'xatlas 自动展开')?.disabled === true, '预览期间展开禁用');
  assert(findBtn(html, '载入 OBJ')?.disabled !== true, '预览期间仍可载入其他模型');
}

// --- 正常态 ---
const cleared = reducer(state, { type: 'preview-clear' });
{
  assert(render(cleared, <PreviewBar />) === '', '无预览时 PreviewBar 不渲染');
  const html = render(cleared, <Toolbar />);
  assert(findBtn(html, '导出 UV OBJ')?.disabled !== true, '正常态导出可用');
  assert(findBtn(html, '存工程')?.disabled !== true, '正常态存工程可用');
  assert(findBtn(html, 'xatlas 自动展开')?.disabled !== true, '正常态展开可用');
  assert(findBtn(html, '撤销')?.disabled === true, '无历史时撤销禁用');
}

// --- 采用后：撤销计数变为可用 ---
const accepted = reducer(state, { type: 'preview-accept' });
{
  const html = render(accepted, <Toolbar />);
  const undo = findBtn(html, '撤销');
  assert(!!undo && !undo.disabled && /\(1\)/.test(undo.text), `采用后撤销可用且计数 1（${undo?.text}）`);
  assert(findBtn(html, '导出 UV OBJ')?.disabled !== true, '采用后导出恢复可用');
}

console.log(failures === 0 ? '\nPREVIEW UI SMOKE PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures ? 1 : 0);
