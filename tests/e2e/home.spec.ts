import { test, expect } from "@playwright/test";
test("首页渲染：标题与导航", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "AI影视工坊" })).toBeVisible();
  for (const nav of ["Skill库", "提示词库", "教程", "论坛"]) {
    await expect(page.getByRole("navigation").getByText(nav)).toBeVisible();
  }
});
