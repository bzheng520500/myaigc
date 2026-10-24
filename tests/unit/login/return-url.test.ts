import { describe, expect, it } from "vitest";
import { sanitizeReturnUrl } from "@/lib/return-url";

/**
 * 登录回跳地址清洗（终审 F2）。
 *
 * open redirect 防御：只放行单个 "/" 开头的站内相对路径，
 * 拒绝外链、协议相对地址（//）与其反斜杠变体（/\）。
 */
describe("sanitizeReturnUrl 纯函数", () => {
  it("站内相对路径原样放行", () => {
    expect(sanitizeReturnUrl("/skills")).toBe("/skills");
    expect(sanitizeReturnUrl("/forum/tech/abc?page=2")).toBe(
      "/forum/tech/abc?page=2",
    );
    expect(sanitizeReturnUrl("/u/6e3f8b52-0d41-4a7c-9b6e-2c3d4e5f6a7b")).toBe(
      "/u/6e3f8b52-0d41-4a7c-9b6e-2c3d4e5f6a7b",
    );
  });

  it("空值 / 非相对路径 → /", () => {
    expect(sanitizeReturnUrl(undefined)).toBe("/");
    expect(sanitizeReturnUrl("")).toBe("/");
    expect(sanitizeReturnUrl("skills")).toBe("/"); // 不以 / 开头
    expect(sanitizeReturnUrl("https://evil.com")).toBe("/");
    expect(sanitizeReturnUrl("http://evil.com/phish")).toBe("/");
  });

  it("协议相对地址 // → /", () => {
    expect(sanitizeReturnUrl("//evil.com")).toBe("/");
    expect(sanitizeReturnUrl("//evil.com/phish")).toBe("/");
  });

  it("反斜杠变体 /\\ → /（浏览器会规范化为 //，等价协议相对）", () => {
    expect(sanitizeReturnUrl("/\\evil.com")).toBe("/");
    expect(sanitizeReturnUrl("/\\/evil.com")).toBe("/");
  });

  it("合法多段路径中的反斜杠不受影响（仅前缀变体被拒）", () => {
    // 非 //、非 /\ 前缀的路径原样保留（与旧行为一致，不扩大拒绝面）
    expect(sanitizeReturnUrl("/a\\b")).toBe("/a\\b");
  });
});
