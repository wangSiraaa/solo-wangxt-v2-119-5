import { useEffect } from 'react';
import { useApp } from '../state/AppContext';

function fmtRatio(n: number | null): string {
  if (n === null) return '—';
  return `${n.toFixed(3)}×`;
}
function fmtAngle(n: number | null): string {
  if (n === null) return '—';
  return `${n.toFixed(1)}°`;
}

type Trend = 'better' | 'worse' | 'same' | 'neutral';

/**
 * 候选展开的确认条：嵌在 2D 视图内，并排展示展开前后指标。
 * 指标全部由 analyzeMesh 对候选网格重新计算，采用后右侧面板
 * 与 3D 视图看到的就是同一份数字。
 */
export function PreviewBar() {
  const { state, acceptPreview, discardPreview } = useApp();
  const p = state.preview;

  // Enter 采用 / Esc 放弃
  useEffect(() => {
    if (!p) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        acceptPreview();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        discardPreview();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [p, acceptPreview, discardPreview]);

  if (!p) return null;
  const b = p.beforeSummary;
  const a = p.afterSummary;

  // “越少越好”指标的变化着色
  const lowerBetter = (cur: number, prev: number): Trend => {
    if (cur === prev) return 'same';
    return cur < prev ? 'better' : 'worse';
  };
  const numDiff = (cur: number, prev: number): string => {
    const d = cur - prev;
    return d === 0 ? '±0' : `${d > 0 ? '+' : ''}${d}`;
  };

  const flipTrend: Trend =
    a.flippedTri === b.flippedTri && a.mirroredIslands === b.mirroredIslands
      ? 'same'
      : lowerBetter(a.flippedTri, b.flippedTri);
  const overlapTrend = lowerBetter(a.overlapTri, b.overlapTri);
  const degUvTrend = lowerBetter(a.degenerateUv, b.degenerateUv);
  const angleTrend = lowerBetter(a.maxAngle ?? 0, b.maxAngle ?? 0);

  return (
    <div className="preview-bar" role="dialog" aria-label="自动展开预览确认">
      <div className="preview-head">
        <b>候选展开预览</b>
        <span className="preview-meta">
          {p.chartCount} 个图 · 利用率 {(p.utilization * 100).toFixed(0)}%
        </span>
        <span className="preview-hint">候选尚未写入当前网格 · Enter 采用 / Esc 放弃</span>
      </div>
      <table className="preview-table">
        <thead>
          <tr>
            <th>指标</th>
            <th>展开前</th>
            <th>候选</th>
            <th>变化</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="m-name">UV 岛数</td>
            <td>{b.islands}</td>
            <td>{a.islands}</td>
            <td className="m-diff neutral">{numDiff(a.islands, b.islands)}</td>
          </tr>
          <tr>
            <td className="m-name">翻转三角 / 镜像岛</td>
            <td>{b.flippedTri} / {b.mirroredIslands}</td>
            <td>{a.flippedTri} / {a.mirroredIslands}</td>
            <td className={`m-diff ${flipTrend}`}>
              {flipTrend === 'same' ? '相同' : flipTrend === 'better' ? '改善' : '变差'}
            </td>
          </tr>
          <tr>
            <td className="m-name">岛间重叠三角</td>
            <td>{b.overlapTri}</td>
            <td>{a.overlapTri}</td>
            <td className={`m-diff ${overlapTrend}`}>
              {overlapTrend === 'same' ? '±0' : numDiff(a.overlapTri, b.overlapTri)}
            </td>
          </tr>
          <tr>
            <td className="m-name">退化（3D / UV）</td>
            <td>{b.degenerate3d} / {b.degenerateUv}</td>
            <td>{a.degenerate3d} / {a.degenerateUv}</td>
            <td className={`m-diff ${degUvTrend}`}>
              {degUvTrend === 'same'
                ? '相同'
                : numDiff(a.degenerateUv, b.degenerateUv)}
            </td>
          </tr>
          <tr>
            <td className="m-name">面积比率 min / max</td>
            <td>{fmtRatio(b.minAreaRatio)} / {fmtRatio(b.maxAreaRatio)}</td>
            <td>{fmtRatio(a.minAreaRatio)} / {fmtRatio(a.maxAreaRatio)}</td>
            <td className="m-diff neutral" />
          </tr>
          <tr>
            <td className="m-name">最大角度畸变</td>
            <td>{fmtAngle(b.maxAngle)}</td>
            <td>{fmtAngle(a.maxAngle)}</td>
            <td className={`m-diff ${angleTrend}`}>
              {angleTrend === 'same'
                ? '相同'
                : `${(a.maxAngle! - b.maxAngle!).toFixed(1)}°`}
            </td>
          </tr>
        </tbody>
      </table>
      <div className="preview-actions">
        <button className="primary" onClick={acceptPreview} autoFocus>
          采用（替换并记入撤销）
        </button>
        <button onClick={discardPreview}>放弃（保持当前 UV）</button>
      </div>
    </div>
  );
}
