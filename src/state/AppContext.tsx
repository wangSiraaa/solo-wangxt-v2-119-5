import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';
import type { ReactNode } from 'react';
import type { ProjectRecord } from '../core/types';
import { parseObj } from '../core/parser';
import { analyzeMesh } from '../core/metrics';
import { exportObj } from '../core/exporter';
import { unwrapWithXAtlas } from '../core/unwrapping';
import { buildUnwrapCandidate, summarizeStats } from '../core/preview';
import {
  deleteProject,
  listProjects,
  loadProject,
  makeProjectId,
  saveProject,
} from '../core/storage';
import {
  initialState,
  reducer,
} from './reducer';
import type { AppState, Notice, PreviewState } from './reducer';

export type { AppState, Notice } from './reducer';

export interface AppContextValue {
  state: AppState;
  loadObjText: (text: string, fileName: string, projectId?: string | null) => void;
  selectFaces: (faceIds: Set<number>) => void;
  toggleFace: (faceId: number) => void;
  setChecker: (on: boolean, scale?: number) => void;
  toggleFlag: (key: 'showFlipped' | 'showOverlap') => void;
  runUnwrap: () => Promise<void>;
  acceptPreview: () => void;
  discardPreview: () => void;
  exportCurrent: () => void;
  saveCurrent: () => Promise<void>;
  projects: ProjectRecord[];
  refreshProjects: () => Promise<void>;
  openProject: (id: string) => Promise<void>;
  removeProject: (id: string) => Promise<void>;
  notify: (n: Notice | null) => void;
  undo: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

/** 导出 Context 实例，供测试/高阶集成直接注入状态。 */
export { AppContext };

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);

  const stateRef = useRef(state);
  stateRef.current = state;

  const [projects, setProjects] = useReducer(
    (_: ProjectRecord[], next: ProjectRecord[]) => next,
    [],
  );

  const refreshProjects = useCallback(async () => {
    try {
      setProjects(await listProjects());
    } catch {
      // IndexedDB 不可用时静默
    }
  }, []);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  const notify = useCallback((n: Notice | null) => {
    dispatch({ type: 'notice', notice: n });
  }, []);

  const loadObjText = useCallback(
    (text: string, fileName: string, projectId: string | null = null) => {
      try {
        const mesh = parseObj(text, fileName);
        const stats = analyzeMesh(mesh);
        dispatch({
          type: 'load',
          mesh,
          stats,
          objText: text,
          fileName,
          projectId,
        });
      } catch (e) {
        dispatch({
          type: 'notice',
          notice: {
            kind: 'error',
            text: `解析失败：${e instanceof Error ? e.message : String(e)}`,
          },
        });
      }
    },
    [],
  );

  const selectFaces = useCallback((faceIds: Set<number>) => {
    dispatch({ type: 'select', faceIds });
  }, []);
  const toggleFace = useCallback((faceId: number) => {
    dispatch({ type: 'toggle-face', faceId });
  }, []);
  const setChecker = useCallback((on: boolean, scale?: number) => {
    dispatch({ type: 'set-checker', on, scale });
  }, []);
  const toggleFlag = useCallback((key: 'showFlipped' | 'showOverlap') => {
    dispatch({ type: 'toggle-flag', key });
  }, []);

  const runUnwrap = useCallback(async () => {
    const cur = stateRef.current;
    const mesh = cur.mesh;
    // 已在展开中，或正有待确认预览时，不重复发起
    if (!mesh || cur.unwrapping || cur.preview) return;
    dispatch({ type: 'unwrapping', on: true });
    dispatch({
      type: 'notice',
      notice: { kind: 'info', text: 'xatlas WASM 展开中…' },
    });
    try {
      const result = await unwrapWithXAtlas(mesh);
      // 展开期间用户可能已切换模型（load 会清场）：候选属于旧网格，
      // 此时 state.mesh 已不是发起时的对象，静默丢弃结果，不挂预览。
      if (stateRef.current.mesh !== mesh) {
        dispatch({ type: 'notice', notice: null });
        return;
      }
      // 构造候选网格并完整校验；任何异常都走 catch —— 不产生预览，
      // 当前网格与撤销历史原封不动。
      const candidate = buildUnwrapCandidate(mesh, result);
      const candidateStats = analyzeMesh(candidate);
      const preview: PreviewState = {
        candidate,
        candidateStats,
        beforeStats: cur.stats!,
        beforeSummary: summarizeStats(cur.stats!),
        afterSummary: summarizeStats(candidateStats),
        chartCount: result.chartCount,
        utilization: result.utilization,
      };
      dispatch({ type: 'preview-set', preview });
      dispatch({
        type: 'notice',
        notice: {
          kind: 'info',
          text: `候选展开已生成（${result.chartCount} 个图），请在 2D 视图确认后采用或放弃`,
        },
      });
    } catch (e) {
      // 关键承诺：自动展开失败时原模型与原 UV 原封不动
      dispatch({
        type: 'notice',
        notice: {
          kind: 'error',
          text: `自动展开失败，已保留原模型：${e instanceof Error ? e.message : String(e)}`,
        },
      });
    } finally {
      dispatch({ type: 'unwrapping', on: false });
    }
  }, []);

  const acceptPreview = useCallback(() => {
    // 采用：reducer 中一次完成替换并入撤销栈
    dispatch({ type: 'preview-accept' });
  }, []);

  const discardPreview = useCallback(() => {
    dispatch({
      type: 'preview-clear',
      notice: { kind: 'info', text: '已放弃候选展开，当前 UV 与撤销历史保持不变' },
    });
  }, []);

  const exportCurrent = useCallback(() => {
    const cur = stateRef.current.mesh;
    if (!cur) return;
    const obj = exportObj(cur);
    const blob = new Blob([obj], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = cur.fileName.replace(/\.obj$/i, '') + '_uv.obj';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    dispatch({
      type: 'notice',
      notice: { kind: 'success', text: '已导出 OBJ，可用 Blender/Maya 等重新载入验证' },
    });
  }, []);

  const saveCurrent = useCallback(async () => {
    const cur = stateRef.current.mesh;
    if (!cur) return;
    const id = stateRef.current.projectId ?? makeProjectId();
    const text = exportObj(cur);
    const rec: ProjectRecord = {
      id,
      name: cur.fileName,
      updatedAt: Date.now(),
      objText: text,
      fileName: cur.fileName,
    };
    try {
      await saveProject(rec);
      dispatch({ type: 'project-id', id });
      dispatch({
        type: 'notice',
        notice: { kind: 'success', text: `工程已存入 IndexedDB（${id}）` },
      });
      await refreshProjects();
    } catch (e) {
      dispatch({
        type: 'notice',
        notice: { kind: 'error', text: `保存失败：${e instanceof Error ? e.message : String(e)}` },
      });
    }
  }, [refreshProjects]);

  const openProject = useCallback(async (id: string) => {
    try {
      const rec = await loadProject(id);
      if (!rec) return;
      loadObjText(rec.objText, rec.fileName, id);
    } catch (e) {
      dispatch({
        type: 'notice',
        notice: { kind: 'error', text: `打开工程失败：${e instanceof Error ? e.message : String(e)}` },
      });
    }
  }, [loadObjText]);

  const removeProject = useCallback(async (id: string) => {
    await deleteProject(id);
    if (stateRef.current.projectId === id) dispatch({ type: 'project-id', id: null });
    await refreshProjects();
  }, [refreshProjects]);

  const undo = useCallback(() => dispatch({ type: 'undo' }), []);

  const value = useMemo<AppContextValue>(
    () => ({
      state,
      loadObjText,
      selectFaces,
      toggleFace,
      setChecker,
      toggleFlag,
      runUnwrap,
      acceptPreview,
      discardPreview,
      exportCurrent,
      saveCurrent,
      projects,
      refreshProjects,
      openProject,
      removeProject,
      notify,
      undo,
    }),
    [state, projects, loadObjText, selectFaces, toggleFace, setChecker,
      toggleFlag, runUnwrap, acceptPreview, discardPreview, exportCurrent,
      saveCurrent, refreshProjects, openProject, removeProject, notify, undo],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
