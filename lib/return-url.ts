/**
 * 登录回跳地址清洗（终审 F2，从 app/login/page.tsx 抽出便于单测）。
 *
 * 只放行以单个 "/" 开头的站内相对路径，拒绝：
 * - 空值 / 不以 "/" 开头（外部绝对 / 相对地址）
 * - "//" 开头：协议相对地址，浏览器可跳任意协议域名
 * - "/\" 开头：反斜杠变体，浏览器会规范化为 "//"，等价协议相对地址
 * 其余原样返回，作为魔法链接验证成功后的落点（callbackUrl）。
 */
export function sanitizeReturnUrl(value: string | undefined): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.startsWith("/\\")
  ) {
    return "/";
  }
  return value;
}
