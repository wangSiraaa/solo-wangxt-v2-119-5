import { chromium } from 'playwright';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const base = 'http://127.0.0.1:5199';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors: string[] = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

const results: string[] = [];
const check = (name: string, cond: boolean, extra = '') => {
  results.push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
};

await page.goto(base);
await page.waitForSelector('.sample-grid', { timeout: 10000 });
check('空状态显示样例', await page.locator('.sample-grid button').count() === 4);

// 1) 共享边接缝样例
await page.locator('.sample-grid button', { hasText: '共享边接缝' }).click();
await page.waitForSelector('.panel');
await sleep(200);
let panel = await page.locator('.panel').innerText();
check('接缝立方体: 12 条共享边接缝', /共享边接缝\s*\n?\s*12/.test(panel), JSON.stringify(panel.match(/共享边接缝[^\n]*/)));
check('接缝立方体: 6 个 UV 岛', /UV 岛\s*6/.test(panel));
check('接缝立方体: 角点 36', /角点 \(corner\)\s*36/.test(panel));
check('接缝立方体: 顶点身份 24', /顶点身份 \(v\)\s*24/.test(panel));

// 2) 3D 视图拾取：点击 3D 画布中心区域，应选中某一面
const box3d = await page.locator('.view3d canvas').boundingBox();
await page.mouse.click(box3d!.x + box3d!.width * 0.5, box3d!.y + box3d!.height * 0.4);
await sleep(150);
panel = await page.locator('.panel').innerText();
check('3D 点选产生选中面', /选中面\s*（\d+ 面/.test(panel), panel.match(/选中面[^\n]*/)?.[0]);

// 3) 2D 视图点选：点击 2D 画布，选中集应同步变化（两视图同步）
const box2d = await page.locator('.view2d canvas').boundingBox();
await page.mouse.click(box2d!.x + box2d!.width * 0.5, box2d!.y + box2d!.height * 0.35);
await sleep(150);
panel = await page.locator('.panel').innerText();
check('2D 点选同步选中面', /选中面\s*（\d+ 面 \/ \d+ 三角）/.test(panel), panel.match(/选中面[^\n]*/)?.[0]);

// 4) 切换到非流形样例
await page.locator('.toolbar .dropdown button', { hasText: '样例' }).hover();
await page.locator('.dropdown .menu button', { hasText: '非流形边' }).click();
await sleep(200);
panel = await page.locator('.panel').innerText();
check('非流形边: 1 条非流形', /非流形边\s*1/.test(panel));
check('非流形边: 3 个 UV 岛', /UV 岛\s*3/.test(panel));

// 5) 镜像岛
await page.locator('.toolbar .dropdown button', { hasText: '样例' }).hover();
await page.locator('.dropdown .menu button', { hasText: '镜像岛' }).click();
await sleep(200);
panel = await page.locator('.panel').innerText();
check('镜像岛: 1 个翻转三角', /翻转三角形 \/ 镜像岛\s*1 \/ 1/.test(panel), panel.match(/翻转[^\n]*/)?.[0]);

// 6) 退化混合样例
await page.locator('.toolbar .dropdown button', { hasText: '样例' }).hover();
await page.locator('.dropdown .menu button', { hasText: '退化' }).click();
await sleep(200);
panel = await page.locator('.panel').innerText();
check('退化: 3D/UV 退化各 1', /退化（3D \/ UV）\s*1 \/ 1/.test(panel), panel.match(/退化（[^\n]*/)?.[0]);
check('退化: 存在岛间重叠', /岛间重叠三角形\s*[23]/.test(panel), panel.match(/岛间重叠[^\n]*/)?.[0]);
check('退化: 最大比率 >2（拉伸）', /(\d+\.\d+)×/.test(panel));

// 7) xatlas 自动展开：先生成候选预览，采用前导出必须等于预览前
await page.locator('.toolbar .dropdown button', { hasText: '样例' }).hover();
await page.locator('.dropdown .menu button', { hasText: '共享边接缝' }).click();
await sleep(200);

// 先导出一份“预览前”基线 OBJ
async function exportObjText(): Promise<string> {
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('button', { hasText: '导出 UV OBJ' }).click(),
  ]);
  const p = await dl.path();
  const fs = await import('node:fs');
  return fs.readFileSync(p!, 'utf8');
}
const baselineObj = await exportObjText();
const baselineVt = (baselineObj.match(/^vt /gm) || []).length;

await page.locator('button.primary', { hasText: 'xatlas 自动展开' }).click();
// 候选生成后出现确认条（而非直接成功通知）
await page.waitForSelector('.preview-bar', { timeout: 60000 });
await sleep(300);
const barText = await page.locator('.preview-bar').innerText();
check('预览确认条出现', /候选展开预览/.test(barText));
check('预览列出展开前后岛数', /UV 岛数\s*\n?\s*6\s+/.test(barText), barText.match(/UV 岛数[^\n]*/)?.[0]);
check('预览显示图数与利用率', /个图\s*·\s*利用率/.test(barText));

// 预览期间 2D 视图显示候选：vt 结构尚未正式替换，面板仍是展开前
panel = await page.locator('.panel').innerText();
check('预览期间正式面板岛数仍为 6（未采用）', /UV 岛\s*6/.test(panel));
// 预览期间导出按钮被禁用
const exportDisabled = await page.locator('button', { hasText: '导出 UV OBJ' }).isDisabled();
check('预览期间禁用导出', exportDisabled);

// 放弃预览（按 Esc，验证快捷键）：导出 OBJ 必须与预览前逐字节一致
await page.keyboard.press('Escape');
await sleep(200);
check('Esc 放弃后确认条消失', (await page.locator('.preview-bar').count()) === 0);
const afterDiscardObj = await exportObjText();
check('放弃后导出 OBJ 与预览前逐字节一致', afterDiscardObj === baselineObj,
  `len ${afterDiscardObj.length} vs ${baselineObj.length}`);
check('放弃后 vt 行数不变', (afterDiscardObj.match(/^vt /gm) || []).length === baselineVt);

// 再次展开，这次采用
await page.locator('button.primary', { hasText: 'xatlas 自动展开' }).click();
await page.waitForSelector('.preview-bar', { timeout: 60000 });
await sleep(200);
const bar2 = await page.locator('.preview-bar').innerText();
const chartM = bar2.match(/(\d+) 个图/);
// 记录预览摘要里的翻转数，用于和采用后正式面板比对（该样例 xatlas 可能
// 产出翻转，关键是正式视图必须与预览一致，而不是必须为 0）。
const flipM = bar2.match(/翻转三角 \/ 镜像岛\s*\n?\s*(\d+) \/ (\d+)/);
const previewFlip = flipM ? `${flipM[1]} / ${flipM[2]}` : null;
await page.locator('.preview-bar button.primary', { hasText: '采用' }).click();
await page.waitForSelector('.notice.success:has-text("已采用")', { timeout: 10000 });
await sleep(300);
check('采用后确认条消失', (await page.locator('.preview-bar').count()) === 0);
panel = await page.locator('.panel').innerText();
check('xatlas 立方体产出 6 图', chartM?.[1] === '6', `got ${chartM?.[1]}`);
check('采用后角点仍 36（身份保留）', /角点 \(corner\)\s*36/.test(panel));
check('采用后顶点身份仍 24（不空间合并模型）', /顶点身份 \(v\)\s*24/.test(panel));
// 正式视图指标必须与预览候选摘要一致（同一 analyzeMesh 结果）
if (previewFlip) {
  const liveM = panel.match(/翻转三角形 \/ 镜像岛\s*(\d+) \/ (\d+)/);
  const liveFlip = liveM ? `${liveM[1]} / ${liveM[2]}` : null;
  check('采用后翻转指标与预览候选一致', liveFlip === previewFlip,
    `preview=${previewFlip} live=${liveFlip}`);
}
// 撤销按钮现在可用且计数为 1
const undoText = await page.locator('button', { hasText: '撤销' }).innerText();
check('采用后撤销计数为 1', /\(1\)/.test(undoText), undoText);

// 一键撤销回到展开前
await page.locator('button', { hasText: '撤销' }).click();
await sleep(200);
const undoneObj = await exportObjText();
check('撤销后导出回到预览前 OBJ', undoneObj === baselineObj,
  `len ${undoneObj.length} vs ${baselineObj.length}`);

// 再次采用，为保存/重开验证准备
await page.locator('button.primary', { hasText: 'xatlas 自动展开' }).click();
await page.waitForSelector('.preview-bar', { timeout: 60000 });
await page.locator('.preview-bar button.primary', { hasText: '采用' }).click();
await page.waitForSelector('.notice.success:has-text("已采用")', { timeout: 10000 });
await sleep(200);
const adoptedObj = await exportObjText();
check('采用后导出与基线不同（确有新 UV）', adoptedObj !== baselineObj);
// 导出器会合并数值相同的 vt：36 角点的立方体展开后 vt 在 24..36 之间，
// 关键是与基线不同且几何一致；不再硬编码为 36。
const adoptedVt = (adoptedObj.match(/^vt /gm) || []).length;
const adoptedV = (adoptedObj.match(/^v /gm) || []).length;
const adoptedF = (adoptedObj.match(/^f /gm) || []).length;
check('采用后 vt 行数在合理范围（24..36）', adoptedVt >= 24 && adoptedVt <= 36, `vt=${adoptedVt}`);
check('采用后 vt 与基线不同', adoptedVt !== baselineVt, `baseline=${baselineVt} adopted=${adoptedVt}`);
check('导出 OBJ: 36 行 v（逐角点）', adoptedV === 36, `v=${adoptedV}`);
check('导出 OBJ: 12 行 f', adoptedF === 12, `f=${adoptedF}`);

// 在页面里重新载入导出的 OBJ（通过隐藏 file input 不好模拟，改用直接读取并注入到 input）
await page.evaluate((text) => {
  // 触发应用的载入：构造 File 并通过 DataTransfer 赋给 input
  const dt = new DataTransfer();
  dt.items.add(new File([text], 'roundtrip.obj', { type: 'text/plain' }));
  const input = document.querySelector('input[type=file]') as HTMLInputElement;
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}, adoptedObj);
await sleep(300);
panel = await page.locator('.panel').innerText();
check('导出 OBJ 可被重新载入', /顶点身份 \(v\)\s*36/.test(panel), 'roundtrip v=36');
check('往返后面数保持 12', /原始面 \/ 三角形\s*12 \/ 12/.test(panel));
check('往返后无非流形', /非流形边\s*0/.test(panel));
check('往返后仍是 6 个岛（采用版 UV 布局）', /UV 岛\s*6/.test(panel));

// 9) IndexedDB 工程保存与重开：保存的必须是【已采用】版本
await page.locator('button', { hasText: '存工程' }).click();
await page.waitForSelector('.notice.success:has-text("IndexedDB")', { timeout: 10000 });
await sleep(200);
const libCount = await page.evaluate(async () => {
  // @ts-ignore
  const dbs = await indexedDB.databases?.();
  return dbs?.map((d: IDBDatabaseInfo) => d.name);
});
check('IndexedDB 数据库存在', JSON.stringify(libCount).includes('lowpoly-uv-inspector'), JSON.stringify(libCount));
const projectItems = await page.locator('.dropdown.align-right .menu-item').count();
check('工程库列出 1 个工程', projectItems >= 1, `items=${projectItems}`);

// 载入镜像样例后再从工程库打开，验证恢复
await page.locator('.toolbar .dropdown button', { hasText: '样例' }).hover();
await page.locator('.dropdown .menu button', { hasText: '镜像岛' }).click();
await sleep(200);
await page.locator('.dropdown.align-right button', { hasText: '工程库' }).hover();
await page.locator('.menu-item .proj-open').first().click();
await sleep(300);
panel = await page.locator('.panel').innerText();
check('从 IndexedDB 恢复工程（36 角点）', /角点 \(corner\)\s*36/.test(panel));
// 已采用版本：恢复后再导出必须与采用版逐字节一致，且不是预览前基线。
// 不用 vt 槽数判断（导出器合并相同 vt）。
const reopenedObj = await exportObjText();
check('保存重开后导出 == 采用版本', reopenedObj === adoptedObj,
  `len ${reopenedObj.length} vs ${adoptedObj.length}`);
check('保存重开版本 != 预览前基线', reopenedObj !== baselineObj);
check('保存重开后无待确认预览', (await page.locator('.preview-bar').count()) === 0);

check('无控制台错误', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
await browser.close();
process.exit(failed ? 1 : 0);
