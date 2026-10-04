# 低模 UV 检查器（Low-poly UV Inspector）

纯本地运行的低模 UV 检查工具：React + TypeScript + Three.js，`xatlas` 的
WASM 构建负责**可选**自动展开，工程存浏览器 IndexedDB，**无后端**。

## 运行

```bash
npm install
npm run dev        # 开发
npm run build      # 类型检查 + 生产构建（dist/）
npm run preview    # 预览构建产物
```

Node 侧核心测试、预览流程测试与无头浏览器端到端测试：

```bash
npx esbuild scripts/test-core.ts --bundle --format=esm --platform=node \
  --outfile=/tmp/t.mjs && node /tmp/t.mjs
npx esbuild scripts/test-unwrap-fail.ts --bundle --format=esm --platform=node \
  --outfile=/tmp/u.mjs && node /tmp/u.mjs
npx esbuild scripts/test-preview.ts --bundle --format=esm --platform=node \
  --outfile=/tmp/p.mjs && node /tmp/p.mjs
node --import tsx scripts/test-preview-ui.tsx

npm run build && npx vite preview --port 5199
# 另一个终端：
node --import tsx scripts/e2e.ts
```

## 功能对照

| 需求 | 实现 |
| --- | --- |
| React + TS + Three.js，模型与二维 UV 同屏 | `src/components/View3D.tsx` / `View2D.tsx` 上下双视图 |
| xatlas WASM 可选自动展开 | `src/core/unwrapping.ts`，懒加载 `xatlas-wasm`（wasm 内联在单个 ESM） |
| IndexedDB 存工程，无后端 | `src/core/storage.ts` |
| 稳定顶点与面身份的 OBJ 子集 | `src/core/parser.ts`：`v/vt/vn/f`、负索引、n 边形扇形三角化 |
| 接缝两侧可有不同 UV，不按空间位置合并顶点 | 角点（corner）模型 + 全程非索引渲染，见下 |
| 选中面两视图同步 | 选择集是 **faceId** 集合；两视图拾取都映射回 `tri.faceId` |
| 棋盘纹理辅助判断 | 程序化 Canvas 棋盘，可开关、可选 4/8/16/32 格 |
| 面积畸变 / 角度畸变分别显示 | `src/core/metrics.ts`，面板分区显示 |
| 退化面不参与普通比率计算 | 薄片（sliver）判据，比率与角度为 `null` |
| 镜像岛、共享边接缝、非流形边样例 | 「样例」菜单四个内置模型 |
| 自动展开失败保留原模型 | `runUnwrap` 只在成功时生成候选；入参不被修改，失败不进预览 |
| 展开先预览、采用后才替换 | WASM 候选先在 2D 视图展示 + 前后指标对比（`PreviewBar`），「采用」才一次替换并入撤销栈，「放弃」候选直接丢弃 |
| 预览期间网格/历史不动 | `state.preview` 与 `state.mesh/history` 分离；预览中禁用导出/存工程/撤销，放弃后导出 OBJ 与预览前逐字节一致 |
| 导出 UV 可被标准工具重载验证 | 非索引 `v/vt` OBJ；e2e 已做导出→重载往返断言 |

## 身份模型（关键设计）

OBJ 的每个 `v` 行是一个**稳定顶点身份**；面的每一项是一个**角点**
（`v/vt/vn` 引用）。接缝两侧的角点可以：

- 引用同一个 `v` 但带不同 `vt`（硬边/接缝常见）；
- 或直接是两个坐标完全相同的独立 `v`（显式切开）。

因此：

- 解析**不焊接、不按坐标去重**；
- 3D/UV 渲染几何全部按角点**非索引展开**（`geometry.ts`）；
- 三角形按解析顺序稳定，每个三角形带 `faceId`，n 边形扇形三角化后仍归属原面。

拓扑统计（边界/共享/非流形/接缝）需要识别“空间上同一条边”，这时才用
**相对包围盒尺度的近邻阈值**配对，仅用于分析，绝不改变模型身份。
接缝判定优先看顶点身份是否已被作者切开，其次比较两侧 UV。

UV 岛的连通要求**同时**满足 3D 共享边且该边两端 UV 一致——仅 UV
坐标重合（镜像岛、刻意叠放的不同岛）不会被错误并岛。

## 指标定义

- **翻转 / 镜像岛**：以每个三角形自身平面的规范基表达时 3D 绕序恒正，
  UV 有向面积为负即翻转；岛内出现任意翻转三角即标记镜像岛。
- **面积畸变比率**：`sqrt((3D面积/UV面积) / 中位数尺度)`，中位归一。
  `1×` 与整体纹素密度一致，`0.5×` 偏稀、`2×` 偏密。
- **角度畸变**：3D 与 UV 三个对应内角的最大差值（度），`0°` 为保角。
- **退化**：最短高/最长边（sliver）低于阈值，或有两点重合。退化面
  比率/角度为 `—`，也不参与岛间重叠检测。
- **岛间重叠**：包围盒分桶 + Sutherland–Hodgman 求交面积，跨岛且
  交叠面积显著非零才标记。

## xatlas 身份映射

`unwrapping.ts` 仅给 xatlas 构造一份按角点位置焊接的输入，并记录
`角点 → 焊接点`。xatlas 输出三角形顺序与输入一致，输出顶点带 `xref`
指回焊接点；再按输出三角形角点把新 UV **分发回每一个稳定角点**，
接缝两侧自然得到不同 UV。像素 UV 按 atlas 宽高归一化。任何异常都
抛出，UI 捕获后不进入预览，原模型原封不动。

## 预览确认流程（采用/放弃）

自动展开不再直接替换当前 UV：

1. WASM 返回后，`buildUnwrapCandidate` 在**不触碰当前 mesh** 的前提下
   构造候选网格（每角点一个独立 vt 槽），NaN / 数量不符一律抛错；
2. 对候选网格跑同一份 `analyzeMesh`，与展开前的摘要并排显示
   （岛数、翻转/镜像岛、岛间重叠、退化、面积/角度畸变），候选 UV
   只临时画在 **2D 视图**里（3D 视图与右侧面板仍是当前网格）；
3. 候选挂在独立的 `state.preview` 上 —— `mesh / stats / history`
   全部保持展开前内容，预览期间禁用导出、存工程与撤销；
4. **放弃**：仅清掉 `state.preview`，当前网格与撤销历史零变化
   （测试断言导出 OBJ 与预览前逐字节一致）；
5. **采用**：reducer 里一次性把候选写入 `mesh/stats`，旧 mesh 进入
   撤销栈（最多 10 步），随后可一键撤销回到展开前；
6. 存工程/导出只读取已采用的 `state.mesh`，保存重开看到的永远是
   已采用版本；载入其他模型会丢弃未决预览。不建立任何持久化修订图。

## 导出验证

导出为逐角点的非索引 OBJ（每角点一行 `v`，数值相同的 `vt` 合并），
不依赖任何工具的自动焊接策略，Blender / Maya / 任意 OBJ 加载器都能
读回一致的三角网格与 UV。端到端测试覆盖了导出文件被本应用重新载入
后的面数、顶点数与非流形边一致性。
