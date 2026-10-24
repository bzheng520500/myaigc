import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import type { Session } from "next-auth";
import { SkillCard } from "@/components/skill-card";
import { ThreadRow } from "@/components/thread-row";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { getProfile, PROFILE_LIST_LIMIT } from "@/lib/queries/profile";

/**
 * 用户主页（Phase 3 Task 3，server 动态页）。
 *
 * - getProfile null（无库 / 非法 id / 用户不存在）→ notFound()
 * - 三页签（帖子 / 上传 / 收藏）：链接式 Tab，server 端按 ?tab= 切换
 *   （同板块页排序切换模式，非 client Tabs）
 * - 本人视角额外「编辑资料」按钮：auth() 在 <Suspense> 内的异步
 *   内容组件中调用（cacheComponents 下读 cookies 必须在边界内）
 * - 个人数据禁缓存（getProfile 无 "use cache"），每次请求真实查询
 * - 分页不做（YAGNI）：每列表固定最近 20 条，页签区注明
 */

type ProfilePageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] | undefined }>;
};

/** searchParams 值可能是数组，取第一个（与板块页 first() 同模式） */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

type ProfileTab = "threads" | "skills" | "favorites";

/** 解析页签参数：仅 skills / favorites 合法，其余（含缺省）归 threads */
function parseTab(raw: string | undefined): ProfileTab {
  return raw === "skills" || raw === "favorites" ? raw : "threads";
}

/** 页签链接：默认 threads 不带 tab 参数（同板块页 sortHref 模式） */
function tabHref(userId: string, tab: ProfileTab): string {
  return tab === "threads" ? `/u/${userId}` : `/u/${userId}?tab=${tab}`;
}

const tabLinkClass =
  "rounded-full px-3 py-1.5 text-sm text-fg-muted transition-colors hover:bg-accent-soft hover:text-accent-soft-fg";

const tabLinkActiveClass =
  "rounded-full bg-accent-soft px-3 py-1.5 text-sm font-medium text-accent-soft-fg";

const TAB_LABELS: Record<ProfileTab, string> = {
  threads: "帖子",
  skills: "上传",
  favorites: "收藏",
};

export default function ProfilePage(props: ProfilePageProps) {
  // cacheComponents 下 await params / searchParams 必须在 <Suspense> 内
  return (
    <Suspense
      fallback={<main className="mx-auto w-full max-w-4xl flex-1" aria-busy="true" />}
    >
      <ProfileContent {...props} />
    </Suspense>
  );
}

async function ProfileContent({ params, searchParams }: ProfilePageProps) {
  const { id } = await params;
  const tab = parseTab(first((await searchParams).tab));

  const profile = await getProfile(id);
  if (!profile) notFound();

  // 本人视角判定（Suspense 内 auth()，与 upload / notifications 页同模式）
  let session: Session | null = null;
  try {
    session = await auth();
  } catch {
    session = null;
  }
  const sessionUserId = (session?.user as { id?: string } | undefined)?.id;
  const isSelf = sessionUserId === profile.user.id;

  // 展示名：昵称为空（魔法链接新用户）回退邮箱前缀
  const displayName =
    profile.user.name ?? (profile.user.email.split("@")[0] || "匿名用户");
  const initial = Array.from(displayName)[0]?.toUpperCase() ?? "?";
  const joinedAt = profile.user.createdAt;
  const joinedLabel = `${joinedAt.getFullYear()}年${joinedAt.getMonth() + 1}月`;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-4">
      {/* 资料头 */}
      <section className="flex flex-wrap items-center gap-5 pb-8 pt-12">
        {profile.user.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- 外链头像域名不可枚举，next/image 需改 next.config（本任务不动，同 prompt-card 先例）
          <img
            src={profile.user.image}
            alt={`${displayName} 的头像`}
            referrerPolicy="no-referrer"
            className="size-16 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex size-16 shrink-0 items-center justify-center rounded-full bg-accent-soft font-serif-display text-2xl text-accent-soft-fg"
          >
            {initial}
          </span>
        )}
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-serif-display text-3xl">{displayName}</h1>
          <p className="text-sm text-fg-muted">加入于 {joinedLabel}</p>
        </div>
        {isSelf && (
          <Link
            href="/settings"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            编辑资料
          </Link>
        )}
      </section>

      {/* 页签切换（链接式）+ 条数说明 */}
      <nav
        aria-label="主页内容页签"
        className="flex flex-wrap items-center gap-1 border-b border-border pb-3"
      >
        {(Object.keys(TAB_LABELS) as ProfileTab[]).map((key) => (
          <Link
            key={key}
            href={tabHref(id, key)}
            aria-current={tab === key ? "true" : undefined}
            className={tab === key ? tabLinkActiveClass : tabLinkClass}
          >
            {TAB_LABELS[key]}
          </Link>
        ))}
        <span className="ml-auto text-xs text-fg-muted">
          最近 {PROFILE_LIST_LIMIT} 条
        </span>
      </nav>

      {/* 当前页签内容 */}
      <section aria-label="主页内容" className="pb-16 pt-8">
        {tab === "threads" &&
          (profile.threads.length > 0 ? (
            <ul className="flex flex-col">
              {profile.threads.map((thread) => (
                <ThreadRow key={thread.id} thread={thread} />
              ))}
            </ul>
          ) : (
            <EmptyHint text={isSelf ? "还没有发布过帖子，去论坛发第一帖吧" : "还没有发布过帖子"} />
          ))}

        {tab === "skills" &&
          (profile.skills.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {profile.skills.map((skill) => (
                <SkillCard
                  key={skill.id}
                  name={skill.name}
                  description={skill.description}
                  category={skill.category}
                  slug={skill.slug}
                />
              ))}
            </div>
          ) : (
            <EmptyHint text={isSelf ? "还没有上传过 Skill，去分享一篇吧" : "还没有上传过 Skill"} />
          ))}

        {tab === "favorites" && (
          <div className="flex flex-col gap-10">
            <div>
              <h2 className="mb-4 font-serif-display text-xl">收藏的 Skill</h2>
              {profile.favorites.skills.length > 0 ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {profile.favorites.skills.map((skill) => (
                    <SkillCard
                      key={skill.id}
                      name={skill.name}
                      description={skill.description}
                      category={skill.category}
                      slug={skill.slug}
                    />
                  ))}
                </div>
              ) : (
                <EmptyHint text="还没有收藏 Skill" />
              )}
            </div>
            <div>
              <h2 className="mb-2 font-serif-display text-xl">收藏的帖子</h2>
              {profile.favorites.threads.length > 0 ? (
                <ul className="flex flex-col">
                  {profile.favorites.threads.map((thread) => (
                    <ThreadRow key={thread.id} thread={thread} />
                  ))}
                </ul>
              ) : (
                <EmptyHint text="还没有收藏帖子" />
              )}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

/** 列表空态（与板块页 / 通知页的虚线卡片同风格） */
function EmptyHint({ text }: { text: string }) {
  return (
    <Card className="border border-dashed border-border bg-transparent ring-0">
      <CardContent className="flex w-full items-center justify-center py-10">
        <p className="text-sm text-fg-muted">{text}</p>
      </CardContent>
    </Card>
  );
}
