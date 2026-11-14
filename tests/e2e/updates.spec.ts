import { test, expect } from '@playwright/test';
const headers = { 'X-Observatory-Request': '1' };

test('AI更新入口说明费用、缺配置时不发起任务', async ({ page, request }) => {
  await page.goto('/#evidence');
  await expect(page.getByRole('heading', { name: 'AI 更新资料', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '立即 AI 更新', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '开启每日更新' })).toBeDisabled();
  await expect(page.getByText('每日更新未开启', { exact: true })).toBeVisible();
  await expect(page.getByText(/每轮最多6次检索与6次模型整理/)).toBeVisible();
  await expect(page.getByRole('button', { name: '记录证据', exact: true })).toBeEnabled();
  const state = await (await request.get('/api/updates')).json();
  expect(state.runs).toEqual([]);
});

test('每日计划通过真实API保存、重载可见且可以关闭', async ({ page, request }) => {
  const old = await (await request.get('/api/settings')).json();
  expect(old.tavily_key).toBe(false);
  try {
    const configured = await request.put('/api/settings', { headers, data: { model_base_url: 'http://127.0.0.1:9999/v1', model: 'test-only-no-call', tavily_key: 'TEST-ONLY-NO-NETWORK-CALL' } });
    expect(configured.ok()).toBeTruthy();
    await page.goto('/#evidence');
    await page.getByLabel('AI更新主题').fill('测试专用主题');
    await page.getByLabel('AI更新时间范围').selectOption('30');
    await page.getByRole('button', { name: '开启每日更新' }).click();
    await expect(page.getByText('每日更新已开启', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('AI更新主题')).toHaveValue('测试专用主题');
    await expect(page.getByLabel('AI更新时间范围')).toHaveValue('30');
    const state = await (await request.get('/api/updates')).json();
    expect(state.plan.enabled).toBe(true);
    expect(state.plan.next_run_at).toBeTruthy();
    expect(state.runs).toEqual([]);
    await page.getByLabel('AI更新主题').fill('');
    await page.getByRole('button', { name: '关闭每日更新' }).click();
    await expect(page.getByText('每日更新未开启', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText('每日更新未开启', { exact: true })).toBeVisible();
    await expect(page.getByLabel('AI更新主题')).toHaveValue('测试专用主题');
  } finally {
    await request.put('/api/updates/plan', { headers, data: { enabled: false } });
    await request.put('/api/settings', { headers, data: { model_base_url: old.model_base_url, model: old.model, trust_proxy: old.trust_proxy, tavily_key: '' } });
  }
});
