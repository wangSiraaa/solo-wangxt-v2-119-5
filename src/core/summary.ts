import type { MeshStats } from './types';

/**
 * 预览-确认用的指标摘要。口径与 StatsPanel 完全一致（同一份 MeshStats
 * 派生），保证「预览摘要 ↔ 采用后的正式视图」数字相同。
 */
export interface StatsSummary {
  /** UV 岛数。 */
  islands: number;
  /** 含翻转三角形的镜像岛数。 */
  mirroredIslands: number;
  /** 翻转三角形数。 */
  flipped: number;
  /** 岛间重叠三角形数。 */
  overlapTris: number;
  /** 退化（3D 或 UV）三角形数。 */
  degenerate: number;
  /** 面积畸变比率最小/最大值（null = 全部退化）。 */
  minRatio: number | null;
  maxRatio: number | null;
  /** 最大角度畸变（度，null = 全部退化）。 */
  maxAngle: number | null;
}

export function summarizeStats(stats: MeshStats): StatsSummary {
  let flipped = 0;
  let degenerate = 0;
  let overlapTris = 0;
  let minR = Infinity;
  let maxR = -Infinity;
  let maxAngle = 0;
  let hasAngle = false;

  for (const m of stats.metrics) {
    if (m.flipped) flipped++;
    if (m.degenerate3d || m.degenerateUv) degenerate++;
    if (m.areaRatio !== null) {
      minR = Math.min(minR, m.areaRatio);
      maxR = Math.max(maxR, m.areaRatio);
    }
    if (m.angleDistortion !== null) {
      hasAngle = true;
      maxAngle = Math.max(maxAngle, m.angleDistortion);
    }
  }
  for (let i = 0; i < stats.overlap.length; i++) if (stats.overlap[i]) overlapTris++;

  let mirroredIslands = 0;
  for (const isl of stats.islands) if (isl.mirrored) mirroredIslands++;

  return {
    islands: stats.islands.length,
    mirroredIslands,
    flipped,
    overlapTris,
    degenerate,
    minRatio: minR === Infinity ? null : minR,
    maxRatio: maxR === -Infinity ? null : maxR,
    maxAngle: hasAngle ? maxAngle : null,
  };
}
