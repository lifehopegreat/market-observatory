import { test, expect } from '@playwright/test';
const headers = { 'X-Observatory-Request': '1' };
const fixture = { name: '自动化测试夹具 · 年度序列', unit: '人', frequency: 'annual', kind: 'timeseries', semantic: 'level', region: 'CHN', sector: '测试', source_name: '自动化测试专用合成数据', source_url: 'https://example.com', csv_text: 'date,value\n2022,100\n2023,110\n2024,121' };

test('真实应用导航与日夜主题可持久化', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '看见趋势，更看清依据。' })).toBeVisible();
  await page.getByRole('button', { name: '切换夜间模式' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: '行业研究', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: '理解一个行业的来路与去向。' })).toBeVisible();
  await page.getByRole('button', { name: '方法与使用边界' }).click();
  await expect(page.getByRole('heading', { name: '不是预测一切，而是理解变化。' })).toBeVisible();
});

test('序列语义约束、图表切换、均线与数据表', async ({ page, request }) => {
  const r = await request.post('/api/import', { headers, data: fixture });
  expect(r.ok()).toBeTruthy(); const id = (await r.json()).id;
  await page.goto('/#lab');
  await page.getByLabel('分析数据集').selectOption(id);
  await expect(page.getByRole('button', { name: 'K线图', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '饼状图', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '柱状图', exact: true }).click();
  await page.getByLabel('移动平均').selectOption('3');
  await page.getByRole('button', { name: '统计拟合', exact: true }).click();
  await page.getByRole('button', { name: '框选区间统计' }).click();
  const plot = page.getByRole('img', { name: /自动化测试夹具 · 年度序列/ }).first();
  await plot.scrollIntoViewIfNeeded();
  const box = await plot.boundingBox();
  if (!box) throw new Error('The chart has no visible bounds');
  await page.mouse.move(box.x + box.width * .2, box.y + box.height * .45);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .7, box.y + box.height * .45, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByText('区间均值', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '查看数据表' }).click();
  await expect(page.getByRole('cell', { name: '121.00', exact: true })).toBeVisible();
  await page.getByLabel('数值口径').selectOption('yoy');
  await expect(page.getByRole('cell', { name: '10.00', exact: true }).first()).toBeVisible();
  const exportCsv = await request.get(`/api/datasets/${id}/csv`);
  expect(await exportCsv.text()).toContain('source_url');
});

test('通过 UI 导入真实格式 OHLC，并启用 K线而非饼图', async ({ page }) => {
  await page.goto('/#lab');
  await page.getByRole('button', { name: '导入数据', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('数据集名称').fill('自动化测试夹具 · OHLC');
  await dialog.getByLabel('数据结构').selectOption('ohlc');
  await dialog.getByLabel('单位', { exact: true }).fill('元');
  await dialog.getByLabel('来源机构').fill('自动化测试专用合成数据');
  await dialog.getByLabel('来源链接').fill('https://example.com');
  await dialog.getByLabel('CSV 内容').fill('date,open,high,low,close,volume\n2024-01-02,10,12,8,11,100\n2024-01-03,11,14,10,13,200');
  await dialog.getByRole('button', { name: '验证并导入' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('heading', { name: '自动化测试夹具 · OHLC', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'K线图', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '饼状图', exact: true })).toBeDisabled();
});

test('构成数据允许饼图但拒绝 K线', async ({ page, request }) => {
  const r = await request.post('/api/import', { headers, data: { ...fixture, name: '自动化测试夹具 · 构成', kind: 'composition', frequency: 'snapshot', semantic: 'share', mutually_exclusive: true, csv_text: 'date,category,value\n2024-01-01,A,30\n2024-01-01,B,70' } });
  expect(r.ok()).toBeTruthy();
  await page.goto('/#lab');
  await page.getByLabel('分析数据集').selectOption((await r.json()).id);
  await expect(page.getByRole('button', { name: '饼状图', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'K线图', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '柱状图', exact: true }).click();
  await page.getByRole('button', { name: '查看数据表' }).click();
  await expect(page.getByRole('cell', { name: 'A', exact: true })).toBeVisible();
});

test('证据入库、重载持久化与本地简报完整流程', async ({ page, request }) => {
  await request.post('/api/import', { headers, data: fixture });
  await page.goto('/#evidence');
  await page.getByRole('button', { name: '记录证据', exact: true }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('材料标题').fill('自动化测试专用政策材料');
  await d.getByLabel('来源名称').fill('测试来源');
  await d.getByLabel('原文链接').fill('https://example.com/policy');
  await d.getByLabel('摘录与摘要').fill('本条仅用于隔离的浏览器测试，不是实际政策。');
  await d.getByLabel('政策阶段').selectOption('实施');
  await d.getByRole('button', { name: '保存证据' }).click();
  await expect(d).not.toBeVisible();
  await expect(page.getByRole('heading', { name: '自动化测试专用政策材料' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '自动化测试专用政策材料' })).toBeVisible();
  await page.getByRole('button', { name: '研究室', exact: true }).click();
  await page.getByRole('button', { name: '创建研究', exact: true }).click();
  await page.getByRole('dialog').getByLabel('研究问题').fill('这些测试材料是否可以被追溯和保存？');
  await page.getByRole('button', { name: '生成证据简报', exact: true }).click();
  await expect(page.getByRole('heading', { name: '这些测试材料是否可以被追溯和保存？' })).toBeVisible();
  await expect(page.getByText('资料整理不等于趋势预测。', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '导出 Markdown' })).toBeVisible();
});

test('凭据无回显、错误不被伪装为成功', async ({ page }) => {
  await page.goto('/#settings');
  await expect(page.getByRole('heading', { name: '研究模型', exact: true })).toBeVisible();
  const response = await page.request.get('/api/settings');
  const cfg = await response.json();
  expect(typeof cfg.model_key).toBe('boolean');
  await page.getByRole('button', { name: '七维证据库', exact: true }).click();
  await page.getByLabel('检索关键词').fill('测试检索');
  await page.getByRole('button', { name: '检索材料', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('请配置');
});

test('手机布局无横向溢出、导航可打开与关闭', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '看见趋势，更看清依据。' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.getByRole('button', { name: '展开导航' }).click();
  await page.getByRole('button', { name: '数据与 API', exact: true }).click();
  await expect(page.getByRole('heading', { name: '好的研究，始于可信的连接。' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('常用页面不出现 JavaScript 异常', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  for (const path of ['/', '/#industry', '/#lab', '/#evidence', '/#research', '/#settings']) {
    await page.goto(path); await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }
  expect(errors).toEqual([]);
});
