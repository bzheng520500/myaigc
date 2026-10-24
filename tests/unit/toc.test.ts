import { describe, expect, it } from "vitest";
import { createHeadingIdDeduper, extractToc, slugifyHeading } from "@/lib/toc";

/**
 * 教程目录提取（Task 9）
 *
 * 锚点一致性是本模块的核心约束：extractToc 生成的 id 必须与
 * MarkdownView 渲染 h2/h3 时注入的 id 完全一致——两侧共用
 * slugifyHeading + createHeadingIdDeduper（lib/toc.ts 唯一实现），
 * 本文件同时直接锁定这两个工具函数的行为。
 */

describe("extractToc 基本提取", () => {
  it("## A / ### B / ## C → 3 项，depth 2/3/2，id 正确", () => {
    const md = "## A\n\n### B\n\n## C";
    expect(extractToc(md)).toEqual([
      { depth: 2, text: "A", id: "a" },
      { depth: 3, text: "B", id: "b" },
      { depth: 2, text: "C", id: "c" },
    ]);
  });

  it("h1 与 h4+ 不进目录", () => {
    const md = "# 大标题\n\n## 二级\n\n#### 四级\n\n### 三级";
    expect(extractToc(md).map((t) => t.text)).toEqual(["二级", "三级"]);
  });
});

describe("extractToc 跳过代码块", () => {
  it("``` 包裹的 ## 假标题 不提取", () => {
    const md = "## 真标题\n\n```\n## 假标题\n```\n\n### 又一个真标题";
    expect(extractToc(md).map((t) => t.text)).toEqual([
      "真标题",
      "又一个真标题",
    ]);
  });

  it("带语言标注的代码块内的 ### 同样不提取", () => {
    const md = "```md\n### 代码里的三级\n```";
    expect(extractToc(md)).toEqual([]);
  });
});

describe("extractToc 同名标题去重", () => {
  it("同名追加 -2 / -3 后缀", () => {
    const md = "## 推镜头\n\n## 推镜头\n\n## 推镜头";
    const toc = extractToc(md);
    expect(toc.map((t) => t.id)).toEqual(["推镜头", "推镜头-2", "推镜头-3"]);
  });

  it("不同名互不影响", () => {
    const md = "## A\n\n## B\n\n## A";
    expect(extractToc(md).map((t) => t.id)).toEqual(["a", "b", "a-2"]);
  });
});

describe("extractToc 行内格式取纯文本（与渲染侧 children 文本一致）", () => {
  it("## **基础**运镜 → text 为「基础运镜」", () => {
    expect(extractToc("## **基础**运镜")[0]).toEqual({
      depth: 2,
      text: "基础运镜",
      id: "基础运镜",
    });
  });

  it("## 推 `pull` 镜头 → text 为「推 pull 镜头」", () => {
    expect(extractToc("## 推 `pull` 镜头")[0]?.text).toBe("推 pull 镜头");
  });
});

describe("slugifyHeading", () => {
  it("小写 + 空格转连字符：Hello World → hello-world", () => {
    expect(slugifyHeading("Hello World")).toBe("hello-world");
  });

  it("中文保留：基础运镜 → 基础运镜", () => {
    expect(slugifyHeading("基础运镜")).toBe("基础运镜");
  });

  it("中文标点等特殊字符去除", () => {
    expect(slugifyHeading("推、拉、摇、移！")).toBe("推拉摇移");
  });

  it("多个空格压缩为单个连字符并去首尾连字符", () => {
    expect(slugifyHeading("  Hello   World  ")).toBe("hello-world");
  });
});

describe("createHeadingIdDeduper（MarkdownView 渲染侧共用）", () => {
  it("按调用顺序去重，与 extractToc 的 id 分配一致", () => {
    const nextId = createHeadingIdDeduper();
    expect(nextId("推镜头")).toBe("推镜头");
    expect(nextId("推镜头")).toBe("推镜头-2");
    expect(nextId("其他")).toBe("其他");
    expect(nextId("推镜头")).toBe("推镜头-3");
  });
});
