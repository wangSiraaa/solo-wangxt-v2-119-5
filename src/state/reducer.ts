import type { MeshData, MeshStats } from '../core/types';
import { analyzeMesh } from '../core/metrics';
import type { UnwrapSummary } from '../core/preview';

export interface Notice {
  kind: 'info' | 'error' | 'success';
  text: string;
}

/**
 * 展开候选的预览状态。
 *
 * 不变量：
 *  - 只要 preview 非空，state.mesh / state.history 就仍是“展开前”的内容，
 *    导出、存工程、撤销历史全部看不到候选；
 *  - 候选只在 2D 视图与确认面板里临时展示；
 *  - “采用”时才做一次 replace（旧 mesh 正常入撤销栈）；“放弃”仅清掉本状态。
 */
export interface PreviewState {
  candidate: MeshData;
  candidateStats: MeshStats;
  /** 展开前指标快照（采用前的正式视图数字）。 */
  beforeStats: MeshStats;
  beforeSummary: UnwrapSummary;
  afterSummary: UnwrapSummary;
  chartCount: number;
  utilization: number;
}

export interface AppState {
  mesh: MeshData | null;
  stats: MeshStats | null;
  objText: string;
  fileName: string;
  projectId: string | null;
  selectedFaceIds: Set<number>;
  checkerOn: boolean;
  checkerScale: number;
  showFlipped: boolean;
  showOverlap: boolean;
  unwrapping: boolean;
  notice: Notice | null;
  history: MeshData[];
  preview: PreviewState | null;
}

export type Action =
  | { type: 'load'; mesh: MeshData; stats: MeshStats; objText: string; fileName: string; projectId: string | null }
  | { type: 'replace-mesh'; mesh: MeshData; stats: MeshStats; notice?: Notice }
  | { type: 'select'; faceIds: Set<number> }
  | { type: 'toggle-face'; faceId: number }
  | { type: 'set-checker'; on: boolean; scale?: number }
  | { type: 'toggle-flag'; key: 'showFlipped' | 'showOverlap' }
  | { type: 'unwrapping'; on: boolean }
  | { type: 'notice'; notice: Notice | null }
  | { type: 'project-id'; id: string | null }
  | { type: 'undo' }
  | { type: 'preview-set'; preview: PreviewState }
  | { type: 'preview-clear'; notice?: Notice }
  | { type: 'preview-accept' };

export function initialState(): AppState {
  return {
    mesh: null,
    stats: null,
    objText: '',
    fileName: '',
    projectId: null,
    selectedFaceIds: new Set<number>(),
    checkerOn: true,
    checkerScale: 8,
    showFlipped: true,
    showOverlap: true,
    unwrapping: false,
    notice: null,
    history: [],
    preview: null,
  };
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'load':
      return {
        ...state,
        mesh: action.mesh,
        stats: action.stats,
        objText: action.objText,
        fileName: action.fileName,
        projectId: action.projectId,
        selectedFaceIds: new Set(),
        unwrapping: false,
        history: [],
        preview: null,
        notice: null,
      };
    case 'replace-mesh':
      return {
        ...state,
        mesh: action.mesh,
        stats: action.stats,
        history: state.mesh ? [...state.history, state.mesh].slice(-10) : state.history,
        notice: action.notice ?? state.notice,
      };
    case 'select':
      return { ...state, selectedFaceIds: action.faceIds };
    case 'toggle-face': {
      const next = new Set(state.selectedFaceIds);
      if (next.has(action.faceId)) next.delete(action.faceId);
      else next.add(action.faceId);
      return { ...state, selectedFaceIds: next };
    }
    case 'set-checker':
      return {
        ...state,
        checkerOn: action.on,
        checkerScale: action.scale ?? state.checkerScale,
      };
    case 'toggle-flag':
      return { ...state, [action.key]: !state[action.key] };
    case 'unwrapping':
      return { ...state, unwrapping: action.on };
    case 'notice':
      return { ...state, notice: action.notice };
    case 'project-id':
      return { ...state, projectId: action.id };
    case 'undo': {
      // 预览待确认时撤销被禁用：候选从未入栈，历史属于当前网格。
      if (state.preview || state.history.length === 0) return state;
      const prev = state.history[state.history.length - 1];
      return {
        ...state,
        mesh: prev,
        stats: analyzeMesh(prev),
        history: state.history.slice(0, -1),
        notice: { kind: 'info', text: '已撤销上一次 UV 替换' },
      };
    }
    case 'preview-set':
      // 只登记候选；mesh / stats / history 一律不动。
      return { ...state, preview: action.preview };
    case 'preview-clear':
      // 放弃：候选被丢弃，当前网格与撤销历史原样保留。
      return { ...state, preview: null, notice: action.notice ?? state.notice };
    case 'preview-accept': {
      // 采用：唯一一次真正的替换，旧 mesh 正常进入撤销栈。
      const p = state.preview;
      if (!p) return state;
      return {
        ...state,
        mesh: p.candidate,
        stats: p.candidateStats,
        history: state.mesh ? [...state.history, state.mesh].slice(-10) : state.history,
        preview: null,
        notice: {
          kind: 'success',
          text: `已采用自动展开：${p.chartCount} 个图，利用率 ${(p.utilization * 100).toFixed(0)}%（可撤销）`,
        },
      };
    }
    default:
      return state;
  }
}
