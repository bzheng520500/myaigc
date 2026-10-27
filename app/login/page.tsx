import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { signIn, auth } from "@/lib/auth";
import { sanitizeReturnUrl } from "@/lib/return-url";

export const dynamic = "force-dynamic";

/**
 * 登录页：邮箱魔法链接（Task 4）
 *
 * 纯服务端实现（无 client 组件）：
 * - 已登录用户直接 redirect 回 returnUrl（默认首页），不再显示登录表单
 * - 表单 POST → server action requestLogin → signIn("email", { redirect: false })
 * - 成功：302 到 /login?sent=1&returnUrl=…（显示「链接已发送」）
 * - 失败：302 到 /login?error=…（显示中文提示）
 * - returnUrl 只允许站内相对路径，随 signIn 的 redirectTo 传入，
 *   用户点击邮件链接验证成功后即落回目标页。
 */

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const ERROR_MESSAGES: Record<string, string> = {
  invalid: "请输入有效的邮箱地址",
  ratelimit: "发送过于频繁，请 1 分钟后再试",
  email: "邮件发送失败，请稍后再试",
};

/** searchParams 值可能是数组，取第一个 */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function requestLogin(formData: FormData) {
  "use server";

  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const returnUrl = sanitizeReturnUrl(
    String(formData.get("returnUrl") ?? "/"),
  );

  if (!EMAIL_RE.test(email)) {
    redirect(`/login?error=invalid&returnUrl=${encodeURIComponent(returnUrl)}`);
  }

  try {
    // redirect: false —— 不触发跳转；邮件内链接的 callbackUrl 即 returnUrl
    await signIn("email", { email, redirectTo: returnUrl, redirect: false });
  } catch (error) {
    // NEXT_REDIRECT 等 Next 内部控制流错误必须原样抛出，只有 AuthError 才是登录失败
    if (error instanceof AuthError) {
      const kind = error.type === "AccessDenied" ? "ratelimit" : "email";
      redirect(`/login?error=${kind}&returnUrl=${encodeURIComponent(returnUrl)}`);
    }
    throw error;
  }

  redirect(`/login?sent=1&returnUrl=${encodeURIComponent(returnUrl)}`);
}

export default function LoginPage({ searchParams }: LoginPageProps) {
  // await searchParams 必须在 <Suspense> 内（Task 14 fix）
  return (
    <Suspense
      fallback={
        <main className="flex flex-1 flex-col items-center justify-center px-4 py-16">
          <div className="w-full max-w-sm" aria-busy="true" />
        </main>
      }
    >
      <LoginCard searchParams={searchParams} />
    </Suspense>
  );
}

async function LoginCard({ searchParams }: LoginPageProps) {
  const sp = await searchParams;
  const returnUrl = sanitizeReturnUrl(first(sp.returnUrl));

  // 已登录用户不再展示登录表单：直接跳回 returnUrl（默认首页）。
  // auth() 读 session 属 request-time API，本组件已在 <Suspense> 内；
  // 异常（无库 / 无绑定环境）按未登录处理，不阻断页面渲染。
  let session = null;
  try {
    session = await auth();
  } catch {
    session = null;
  }
  if (session?.user?.id) {
    redirect(returnUrl);
  }

  const sent = first(sp.sent) === "1";
  const errorCode = first(sp.error);
  const errorMessage = errorCode
    ? (ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.email)
    : undefined;

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-16">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="font-serif-display text-xl">
            登录 AI影视工坊
          </CardTitle>
          <CardDescription>
            输入邮箱，我们将给你发送一个登录链接
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <p className="text-sm leading-relaxed text-fg-muted">
              登录链接已发送到你的邮箱，请在 15 分钟内点击。
              <br />
              没有收到？请检查垃圾邮件文件夹，或 1 分钟后重试。
            </p>
          ) : (
            <form action={requestLogin} className="flex flex-col gap-3">
              <input type="hidden" name="returnUrl" value={returnUrl} />
              {errorMessage && (
                <p className="text-sm text-destructive" role="alert">
                  {errorMessage}
                </p>
              )}
              <label htmlFor="email" className="text-sm text-fg-muted">
                邮箱地址
              </label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
              />
              <Button type="submit" className="mt-1 w-full">
                发送登录链接
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
