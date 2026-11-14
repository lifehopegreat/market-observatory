import { test, expect } from '@playwright/test';

for (const theme of ['dark', 'light']) {
  test(`${theme} 主题的所有下拉选项都有实色背景与可读文字`, async ({ page, request }) => {
    await page.addInitScript(value => localStorage.setItem('guanlan-theme', value), theme);
    const response = await request.post('/api/import', {
      headers: { 'X-Observatory-Request': '1' },
      data: { name: '自动化测试夹具 · 下拉主题', unit: '人', source_name: '隔离测试', source_url: 'https://example.com', csv_text: 'date,value\n2023,100\n2024,110' }
    });
    expect(response.ok()).toBeTruthy();
    const datasetId = (await response.json()).id;

    const checkOptions = async () => {
      const colors = await page.getByRole('combobox').evaluateAll(selects => selects.flatMap(select =>
        Array.from((select as HTMLSelectElement).options).map(option => {
          const style = getComputedStyle(option);
          return { text: option.textContent, foreground: style.color, background: style.backgroundColor };
        })
      ));
      expect(colors.length).toBeGreaterThan(0);
      const luminance = (color: string) => {
        const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(v => {
          const s = v / 255;
          return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4;
        });
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
      };
      for (const color of colors) {
        expect(color.background, `${color.text} 不能依赖原生白色菜单底色`).not.toBe('rgba(0, 0, 0, 0)');
        const fg = luminance(color.foreground), bg = luminance(color.background);
        expect((Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05), `${color.text} 对比度`).toBeGreaterThanOrEqual(4.5);
      }
    };

    for (const path of ['overview', 'industry', 'lab', 'evidence', 'settings']) {
      await page.goto(`/#${path}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      if (path === 'lab') await page.getByLabel('分析数据集').selectOption(datasetId);
      await checkOptions();
    }
    await page.getByRole('button', { name: '导入 CSV', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await checkOptions();
    await page.getByRole('button', { name: '关闭对话框' }).click();

    await page.getByRole('button', { name: '七维证据库', exact: true }).click();
    await page.getByRole('button', { name: '记录证据', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await checkOptions();
    await page.getByRole('button', { name: '关闭对话框' }).click();

    await page.getByRole('button', { name: '研究室', exact: true }).click();
    await page.getByRole('button', { name: '创建研究', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await checkOptions();
    await page.getByRole('button', { name: '关闭对话框' }).click();

    await page.getByRole('button', { name: '图表实验室', exact: true }).click();
    const dataset = page.getByLabel('分析数据集');
    await dataset.focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    await expect(dataset).toHaveValue('wb:CHN:cpi');
  });
}
