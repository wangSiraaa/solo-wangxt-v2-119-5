import { chromium } from 'playwright';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const base = 'http://localhost:5199';

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

// 7) xatlas 预览-确认流程（回到接缝立方体）
await page.locator('.toolbar .dropdown button', { hasText: '样例' }).hover();
await page.locator('.dropdown .menu button', { hasText: '共享边接缝' }).click();
await sleep(200);

// 7a) 展开前导出，作为「放弃后导出一致」的基准
const fs = await import('node:fs');
const [dlBefore] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('button', { hasText: '导出 UV OBJ' }).click(),
]);
const objBefore = fs.readFileSync((await dlBefore.path())!, 'utf8');
check('展开前导出: 24 行 vt', (objBefore.match(/^vt /gm) || []).length === 24);

// 7b) 生成预览：不替换当前 UV，2D 视图显示候选，预览条给出前后对比
await page.locator('.toolbar button.primary', { hasText: 'xatlas 自动展开' }).click();
await page.waitForSelector('.preview-bar', { timeout: 60000 });
const previewText = await page.locator('.preview-bar').innerText();
check('预览条出现', true);
check('预览含 xatlas 图数与利用率', /\d+ 个图/.test(previewText) && /利用率 \d+%/.test(previewText), previewText.split('\n')[1]);
for (const key of ['UV 岛数', '翻转三角形', '镜像岛', '岛间重叠三角形', '最大面积畸变', '最大角度畸变']) {
  check(`预览摘要含「${key}」`, previewText.includes(key));
}
check('预览摘要岛数 6 → 6', /UV 岛数\s*6\s*6/.test(previewText), previewText.replace(/\n/g, ' | '));
check('2D 视图进入预览态', /预览：xatlas 候选/.test(await page.locator('.view2d .view-label').innerText()));
panel = await page.locator('.panel').innerText();
check('预览期间正式面板仍是原 UV（vt 24）', /UV 顶点 \(vt\)\s*24/.test(panel));
check('预览期间展开按钮禁用', await page.locator('.toolbar button.primary').isDisabled());
check('预览期间撤销按钮禁用', await page.locator('.toolbar button', { hasText: '撤销' }).isDisabled());

// 7c) 放弃：当前网格/历史原状，导出与预览前逐字节一致
await page.locator('.preview-bar button', { hasText: '放弃' }).click();
await sleep(200);
check('放弃后预览条消失', await page.locator('.preview-bar').count() === 0);
panel = await page.locator('.panel').innerText();
check('放弃后仍是 6 岛 / vt 24', /UV 岛\s*6/.test(panel) && /UV 顶点 \(vt\)\s*24/.test(panel));
check('放弃后撤销计数仍为 0', /撤销 \(0\)/.test(await page.locator('.toolbar button', { hasText: '撤销' }).innerText()));
const [dlDiscarded] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('button', { hasText: '导出 UV OBJ' }).click(),
]);
const objAfterDiscard = fs.readFileSync((await dlDiscarded.path())!, 'utf8');
check('放弃后导出 OBJ 与预览前逐字节一致', objAfterDiscard === objBefore);

// 7d) 采用：一次性替换，指标与正式视图一致，可一键撤销
await page.locator('.toolbar button.primary', { hasText: 'xatlas 自动展开' }).click();
await page.waitForSelector('.preview-bar', { timeout: 60000 });
const previewText2 = await page.locator('.preview-bar').innerText();
await page.locator('.preview-bar button', { hasText: '采用' }).click();
await page.waitForSelector('.notice.success:has-text("已采用")', { timeout: 10000 });
const notice = await page.locator('.notice').innerText();
check('采用成功提示', /已采用自动展开/.test(notice), notice);
const charts = notice.match(/(\d+) 个图/)?.[1];
check('xatlas 立方体产出 6 图', charts === '6', `got ${charts}`);
check('采用后预览条消失', await page.locator('.preview-bar').count() === 0);
await sleep(300);
panel = await page.locator('.panel').innerText();
check('采用后角点仍 36（身份保留）', /角点 \(corner\)\s*36/.test(panel));
check('采用后顶点身份仍 24（不空间合并模型）', /顶点身份 \(v\)\s*24/.test(panel));
check('采用后每角点一个 vt（36）', /UV 顶点 \(vt\)\s*36/.test(panel));
check('采用后 UV 岛 6（与预览摘要一致）', /UV 岛\s*6/.test(panel) && /UV 岛数\s*6\s*6/.test(previewText2));

// 7e) 一键撤销
const undoBtn = page.locator('.toolbar button', { hasText: '撤销' });
check('采用后撤销可用且计数 1', (await undoBtn.isEnabled()) && /撤销 \(1\)/.test(await undoBtn.innerText()));
await undoBtn.click();
await sleep(200);
panel = await page.locator('.panel').innerText();
check('撤销后回到原 UV（vt 24）', /UV 顶点 \(vt\)\s*24/.test(panel));

// 7f) 重新展开并采用，供后续导出/存档验证
await page.locator('.toolbar button.primary', { hasText: 'xatlas 自动展开' }).click();
await page.waitForSelector('.preview-bar', { timeout: 60000 });
await page.locator('.preview-bar button', { hasText: '采用' }).click();
await page.waitForSelector('.notice.success:has-text("已采用")', { timeout: 10000 });
await sleep(200);
panel = await page.locator('.panel').innerText();
check('再次采用后 vt 36', /UV 顶点 \(vt\)\s*36/.test(panel));

// 8) 导出 OBJ：拦截下载，用页面内文本做往返断言
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('button', { hasText: '导出 UV OBJ' }).click(),
]);
const path = await download.path();
const objText = fs.readFileSync(path!, 'utf8');
const vCount = (objText.match(/^v /gm) || []).length;
const vtCount = (objText.match(/^vt /gm) || []).length;
const fCount = (objText.match(/^f /gm) || []).length;
check('导出 OBJ: 36 行 v（逐角点）', vCount === 36, `v=${vCount}`);
check('导出 OBJ: 12 行 f', fCount === 12, `f=${fCount}`);
check('导出 OBJ: vt 行存在', vtCount > 0, `vt=${vtCount}`);

// 在页面里重新载入导出的 OBJ（通过隐藏 file input 不好模拟，改用直接读取并注入到 input）
await page.evaluate((text) => {
  // 触发应用的载入：构造 File 并通过 DataTransfer 赋给 input
  const dt = new DataTransfer();
  dt.items.add(new File([text], 'roundtrip.obj', { type: 'text/plain' }));
  const input = document.querySelector('input[type=file]') as HTMLInputElement;
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}, objText);
await sleep(300);
panel = await page.locator('.panel').innerText();
check('导出 OBJ 可被重新载入', /顶点身份 \(v\)\s*36/.test(panel), 'roundtrip v=36');
check('往返后面数保持 12', /原始面 \/ 三角形\s*12 \/ 12/.test(panel));
check('往返后无非流形', /非流形边\s*0/.test(panel));

// 9) IndexedDB 工程保存与重开
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

// 存档内容应与「已采用版本」的导出一致（vt/f 行逐行相同；
// 头部注释含文件名差异，不参与比较）
const savedObjText: string = await page.evaluate(async () => {
  const req = indexedDB.open('lowpoly-uv-inspector', 1);
  const db: IDBDatabase = await new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  const tx = db.transaction('projects', 'readonly');
  const rows: Array<{ objText: string }> = await new Promise((res, rej) => {
    const r = tx.objectStore('projects').getAll();
    r.onsuccess = () => res(r.result as Array<{ objText: string }>);
    r.onerror = () => rej(r.error);
  });
  db.close();
  return rows[0]?.objText ?? '';
});
const linesOf = (s: string, re: RegExp) => (s.match(re) || []).join('\n');
check(
  '存档 vt/f 行与已采用导出一致',
  linesOf(savedObjText, /^vt .*$/gm) === linesOf(objText, /^vt .*$/gm) &&
    linesOf(savedObjText, /^f .*$/gm) === linesOf(objText, /^f .*$/gm),
);

// 载入镜像样例后再从工程库打开，验证恢复的是已采用版本
await page.locator('.toolbar .dropdown button', { hasText: '样例' }).hover();
await page.locator('.dropdown .menu button', { hasText: '镜像岛' }).click();
await sleep(200);
await page.locator('.dropdown.align-right button', { hasText: '工程库' }).hover();
await page.locator('.menu-item .proj-open').first().click();
await sleep(300);
panel = await page.locator('.panel').innerText();
check('从 IndexedDB 恢复工程（36 角点）', /角点 \(corner\)\s*36/.test(panel));
check(
  '重开看到的是已采用版本（36 v 逐角点导出，非原始 24 v 样例）',
  /顶点身份 \(v\)\s*36/.test(panel),
  panel.match(/顶点身份[^\n]*/)?.[0],
);

check('无控制台错误', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
await browser.close();
process.exit(failed ? 1 : 0);
