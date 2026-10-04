import { useMemo } from 'react';
import { useApp } from '../state/AppContext';
import { summarizeStats } from '../core/summary';

function fmtRatio(r: number | null): string {
  return r === null ? '—' : `${r.toFixed(2)}×`;
}
function fmtAngle(a: number | null): string {
  return a === null ? '—' : `${a.toFixed(1)}°`;
}

/**
 * 自动展开预览确认条：叠加在 2D 视图（此时显示候选 UV）之上。
 * 列出展开前后的岛数 / 重叠 / 翻转 / 畸变摘要，由用户决定采用或放弃。
 * 采用前当前网格、撤销历史、导出与存工程全部不受影响。
 */
export function PreviewBar() {
  const { state, adoptPreview, discardPreview } = useApp();
  const preview = state.preview;

  const before = useMemo(
    () => (state.stats ? summarizeStats(state.stats) : null),
    [state.stats],
  );
  const after = useMemo(
    () => (preview ? summarizeStats(preview.stats) : null),
    [preview],
  );

  if (!preview || !before || !after) return null;

  return (
    <div className="preview-bar">
      <h3>自动展开预览（未采用）</h3>
      <p className="sub">
        xatlas：{preview.chartCount} 个图 · 利用率 {(preview.utilization * 100).toFixed(0)}%
        — 2D 视图正在显示候选 UV
      </p>
      <table>
        <thead>
          <tr>
            <th>指标</th>
            <th>当前</th>
            <th>预览</th>
          </tr>
        </thead>
        <tbody>
          <Row label="UV 岛数" a={before.islands} b={after.islands} />
          <Row label="翻转三角形" a={before.flipped} b={after.flipped} lowerBetter />
          <Row label="镜像岛" a={before.mirroredIslands} b={after.mirroredIslands} lowerBetter />
          <Row label="岛间重叠三角形" a={before.overlapTris} b={after.overlapTris} lowerBetter />
          <Row
            label="最大面积畸变"
            a={fmtRatio(before.maxRatio)}
            b={fmtRatio(after.maxRatio)}
          />
          <Row
            label="最大角度畸变"
            a={fmtAngle(before.maxAngle)}
            b={fmtAngle(after.maxAngle)}
          />
          <Row label="退化三角形" a={before.degenerate} b={after.degenerate} />
        </tbody>
      </table>
      <div className="actions">
        <button className="primary" onClick={adoptPreview} title="用候选 UV 一次性替换当前 UV；旧 UV 进入撤销历史">
          采用（替换当前 UV）
        </button>
        <button onClick={discardPreview} title="丢弃候选 UV，当前模型与撤销历史保持原状">
          放弃
        </button>
      </div>
      <p className="hint">采用前，导出 / 存工程 / 撤销仍作用于当前 UV。</p>
    </div>
  );
}

function Row({
  label,
  a,
  b,
  lowerBetter = false,
}: {
  label: string;
  a: string | number;
  b: string | number;
  lowerBetter?: boolean;
}) {
  let cls = '';
  if (lowerBetter && typeof a === 'number' && typeof b === 'number' && a !== b) {
    cls = b < a ? 'better' : 'worse';
  }
  return (
    <tr>
      <td>{label}</td>
      <td>{a}</td>
      <td className={cls}>{b}</td>
    </tr>
  );
}
