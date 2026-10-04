import type { MeshData, MeshStats } from './types';
import type { UnwrapResult } from './unwrapping';
/**
 * 预览阶段所需的指标摘要：展开前后各算一份，供确认面板对比。
 * 全部来自 analyzeMesh 的结果，与右侧正式统计面板口径一致 ——
 * “采用”后正式视图显示的数字就是 after 这份，不存在两套算法。
 */
export interface UnwrapSummary {
  /** UV 岛数。 */
  islands: number;
  /** 翻转三角形数。 */
  flippedTri: number;
  /** 含翻转三角的镜像岛数。 */
  mirroredIslands: number;
  /** 与其他岛重叠的三角形数。 */
  overlapTri: number;
  /** 3D 退化三角形数。 */
  degenerate3d: number;
  /** UV 退化三角形数。 */
  degenerateUv: number;
  /** 最小面积畸变比率（null = 无有效面）。 */
  minAreaRatio: number | null;
  /** 最大面积畸变比率。 */
  maxAreaRatio: number | null;
  /** 最大角度畸变（度）。 */
  maxAngle: number | null;
}

export function summarizeStats(stats: MeshStats): UnwrapSummary {
  let flippedTri = 0;
  let degenerate3d = 0;
  let degenerateUv = 0;
  let minAreaRatio = Infinity;
  let maxAreaRatio = -Infinity;
  let maxAngle: number | null = null;
  for (const m of stats.metrics) {
    if (m.flipped) flippedTri++;
    if (m.degenerate3d) degenerate3d++;
    if (m.degenerateUv) degenerateUv++;
    if (m.areaRatio !== null) {
      minAreaRatio = Math.min(minAreaRatio, m.areaRatio);
      maxAreaRatio = Math.max(maxAreaRatio, m.areaRatio);
    }
    if (m.angleDistortion !== null) {
      maxAngle = maxAngle === null ? m.angleDistortion : Math.max(maxAngle, m.angleDistortion);
    }
  }
  let overlapTri = 0;
  for (let i = 0; i < stats.overlap.length; i++) if (stats.overlap[i]) overlapTri++;
  return {
    islands: stats.islands.length,
    flippedTri,
    mirroredIslands: stats.islands.filter((i) => i.mirrored).length,
    overlapTri,
    degenerate3d,
    degenerateUv,
    minAreaRatio: minAreaRatio === Infinity ? null : minAreaRatio,
    maxAreaRatio: maxAreaRatio === -Infinity ? null : maxAreaRatio,
    maxAngle,
  };
}

/**
 * 把 xatlas 输出构造成“候选网格”，但绝不触碰当前网格。
 *
 * 与旧 runUnwrap 内联逻辑相同的身份映射约定：
 * 每个角点占一个独立 vt 槽（vt = cornerIndex），UV 已由 unwrapping.ts
 * 按角点身份分发，接缝两侧自然不同。
 *
 * 结果不完整（NaN / UV 数量与角点不符）一律抛错 —— 调用方捕获后
 * 不进入预览，当前网格与撤销历史保持原状。
 */
export function buildUnwrapCandidate(
  cur: MeshData,
  result: UnwrapResult,
): MeshData {
  if (
    !Number.isFinite(result.utilization) ||
    result.uvs.length !== cur.corners.length * 2
  ) {
    throw new Error('xatlas 返回结果不完整');
  }
  for (let i = 0; i < result.uvs.length; i++) {
    if (!Number.isFinite(result.uvs[i])) throw new Error('xatlas 返回了非有限 UV');
  }
  return {
    ...cur,
    uvs: result.uvs,
    uvCount: result.uvs.length / 2,
    hasUv: true,
    uvOrigin: 'obj',
    // 每个角点一个独立 vt 槽（接缝分裂后本来就不同）
    corners: cur.corners.map((c, ci) => ({ ...c, vt: ci })),
  };
}
