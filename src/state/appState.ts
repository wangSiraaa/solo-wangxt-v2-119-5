import type { MeshData, MeshStats } from '../core/types';
import { analyzeMesh } from '../core/metrics';

export interface Notice {
  kind: 'info' | 'error' | 'success';
  text: string;
}

/**
 * xatlas 候选 UV 预览。
 *
 * 只存在于内存（React state），采用前当前网格、撤销历史、已存工程全部
 * 保持原状；没有持久化的修订图 —— 放弃即丢弃，采用才一次性替换。
 */
export interface UnwrapPreview {
  mesh: MeshData;
  stats: MeshStats;
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
  /** 非空表示有待确认的 xatlas 候选 UV（2D 视图此时显示预览）。 */
  preview: UnwrapPreview | null;
  notice: Notice | null;
  history: MeshData[];
}

export type Action =
  | { type: 'load'; mesh: MeshData; stats: MeshStats; objText: string; fileName: string; projectId: string | null }
  | { type: 'preview-set'; preview: UnwrapPreview; notice?: Notice }
  | { type: 'preview-clear'; notice?: Notice }
  | { type: 'adopt-preview'; notice?: Notice }
  | { type: 'select'; faceIds: Set<number> }
  | { type: 'toggle-face'; faceId: number }
  | { type: 'set-checker'; on: boolean; scale?: number }
  | { type: 'toggle-flag'; key: 'showFlipped' | 'showOverlap' }
  | { type: 'unwrapping'; on: boolean }
  | { type: 'notice'; notice: Notice | null }
  | { type: 'project-id'; id: string | null }
  | { type: 'undo' };

export function createInitialState(): AppState {
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
    preview: null,
    notice: null,
    history: [],
  };
}

export function appReducer(state: AppState, action: Action): AppState {
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
        preview: null,
        history: [],
        notice: null,
      };
    case 'preview-set':
      // 关键：只挂预览，当前 mesh / history 一律不动
      return { ...state, preview: action.preview, notice: action.notice ?? state.notice };
    case 'preview-clear':
      return { ...state, preview: null, notice: action.notice ?? state.notice };
    case 'adopt-preview': {
      if (!state.preview) return state;
      // 采用 = 唯一的一次性替换点，旧网格此刻才进入撤销历史
      return {
        ...state,
        mesh: state.preview.mesh,
        stats: state.preview.stats,
        history: state.mesh ? [...state.history, state.mesh].slice(-10) : state.history,
        preview: null,
        notice: action.notice ?? state.notice,
      };
    }
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
      // 预览待确认期间禁止撤销（UI 同步禁用，这里兜底）
      if (state.preview) return state;
      if (state.history.length === 0) return state;
      const prev = state.history[state.history.length - 1];
      return {
        ...state,
        mesh: prev,
        stats: analyzeMesh(prev),
        history: state.history.slice(0, -1),
        notice: { kind: 'info', text: '已撤销上一次 UV 替换' },
      };
    }
    default:
      return state;
  }
}
