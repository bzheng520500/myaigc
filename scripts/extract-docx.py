#!/usr/bin/env python3
"""提取 content-source/docs/ 下的运镜文档为 Markdown + 图片。

- *.docx：mammoth 转 Markdown，图片存 extracted/images/<文档名>-N.<ext>
- *.doc：先读文件头探测真实格式
  - PK 头 -> 实为 docx，按 docx 处理
  - D0 CF 11 E0 (OLE2) -> 老 doc：先尝试 soffice 转 docx；
    无 soffice 则用内置 OLE2 piece-table 纯文本提取（无图片）；
    再失败则记入 extracted/SKIPPED.txt，不中断整体提取。
"""
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import mammoth

ROOT = Path(__file__).resolve().parent.parent
DOCS_DIR = ROOT / "content-source" / "docs"
OUT_DIR = ROOT / "content-source" / "extracted"
IMAGES_DIR = OUT_DIR / "images"
SKIPPED_TXT = OUT_DIR / "SKIPPED.txt"

OLE2_MAGIC = bytes.fromhex("D0CF11E0")


def sniff_image_ext(data: str | bytes, content_type: str | None) -> str:
    """按魔数/Content-Type 判断图片扩展名。"""
    if isinstance(data, str):
        data = data.encode("utf-8", errors="ignore")
    if data.startswith(b"\x89PNG"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data.startswith(b"GIF8"):
        return "gif"
    if data.startswith(b"\x00\x00\x01\x00"):
        return "ico"
    if data.startswith(b"Uf\x00\x00") or data.startswith(b"\x01\x00\x00\x01"):
        return "emf"
    if data.startswith(b"\xd7\xcd\xc6\x9a"):
        return "wmf"
    if content_type and "/" in content_type:
        sub = content_type.split("/")[-1]
        return {"jpeg": "jpg", "x-emf": "emf", "x-wmf": "wmf"}.get(sub, sub)
    return "bin"


def extract_docx(path: Path) -> dict:
    """mammoth 提取 docx -> markdown + 图片文件。"""
    stem = path.stem
    counter = {"n": 0}
    saved_images: list[str] = []

    def image_handler(image):
        counter["n"] += 1
        with image.open() as f:
            data = f.read()
        ext = sniff_image_ext(data, image.content_type)
        fname = f"{stem}-{counter['n']}.{ext}"
        IMAGES_DIR.mkdir(parents=True, exist_ok=True)
        (IMAGES_DIR / fname).write_bytes(data)
        saved_images.append(fname)
        return {"src": f"images/{fname}"}

    with open(path, "rb") as f:
        result = mammoth.convert_to_markdown(
            f, convert_image=mammoth.images.img_element(image_handler)
        )
    md = result.value
    warnings = [m.message for m in result.messages]
    # 将 mammoth 输出的 <img src="images/x.png" /> 规整为 markdown 图片语法
    md = re.sub(r'<img\s+src="([^"]+)"\s*/?>', r"![](\1)", md)
    return {"markdown": md, "images": saved_images, "warnings": warnings}


def try_soffice_convert(path: Path) -> Path | None:
    """尝试用 soffice 将 doc 转为 docx；返回转换后路径或 None。"""
    soffice = shutil.which("soffice")
    if not soffice:
        return None
    tmp = OUT_DIR / "_tmp_convert"
    tmp.mkdir(parents=True, exist_ok=True)
    try:
        subprocess.run(
            [soffice, "--headless", "--convert-to", "docx", "--outdir", str(tmp), str(path)],
            capture_output=True,
            timeout=120,
            check=True,
        )
        out = tmp / (path.stem + ".docx")
        return out if out.exists() else None
    except Exception:
        return None


def extract_doc97_text(path: Path) -> str:
    """纯 Python 解析 Word 97 (OLE2) piece table，提取正文文本（无图片）。"""
    import olefile

    ole = olefile.OleFileIO(str(path))
    try:
        data = ole.openstream("WordDocument").read()
        flags2 = int.from_bytes(data[0x0A:0x0C], "little")
        table = ole.openstream("1Table" if (flags2 >> 9) & 1 else "0Table").read()
        fc_clx = int.from_bytes(data[0x01A2:0x01A6], "little")
        lcb_clx = int.from_bytes(data[0x01A6:0x01AA], "little")
        clx = table[fc_clx : fc_clx + lcb_clx]
        pos, plcpcd = 0, None
        while pos < len(clx):
            tag = clx[pos]
            if tag == 0x01:  # Prc
                pos += 3 + int.from_bytes(clx[pos + 1 : pos + 3], "little")
            elif tag == 0x02:  # Pcdt
                lcb = int.from_bytes(clx[pos + 1 : pos + 5], "little")
                plcpcd = clx[pos + 5 : pos + 5 + lcb]
                break
            else:
                break
        if plcpcd is None:
            raise ValueError("Pcdt not found in CLX")
        n = (len(plcpcd) - 4) // 12
        cps = [int.from_bytes(plcpcd[i * 4 : i * 4 + 4], "little") for i in range(n + 1)]
        parts = []
        for i in range(n):
            pcd_off = (n + 1) * 4 + i * 8
            fc = int.from_bytes(plcpcd[pcd_off + 2 : pcd_off + 6], "little")
            cch = cps[i + 1] - cps[i]
            if fc & 0x40000000:  # compressed (cp1252)
                off = (fc & 0x3FFFFFFF) // 2
                parts.append(data[off : off + cch].decode("cp1252", errors="replace"))
            else:  # utf-16-le
                parts.append(data[fc : fc + cch * 2].decode("utf-16-le", errors="replace"))
        text = "".join(parts)
    finally:
        ole.close()

    # 清理 Word 控制字符：\r 段落符、\x07 单元格/行尾、\x0b 手动换行
    text = text.replace("\r", "\n").replace("\x07", "\n").replace("\x0b", "\n")
    text = re.sub(r"[\x00-\x06\x08\x0e-\x1f]", "", text)
    # fast-saved 文档可能整段重复两遍：若后半与前半完全相同则截断
    half = len(text) // 2
    if len(text) % 2 == 0 and text[:half] == text[half:]:
        text = text[:half]
    return text.strip() + "\n"


# ---------------------------------------------------------------------------
# Step 3: 提示词拆解 -> extracted/prompts.json
# ---------------------------------------------------------------------------

CATEGORY_ZUHE = "组合运镜"
CATEGORY_TEJI = "特效运镜"
CATEGORY_DIANYYING = "电影级组合"
CATEGORY_JICHU = "基础运镜"

SRC_DOCS = {
    "组合运镜": "组合运镜.docx",
    "组合运镜2": "组合运镜2.docx",
    "特效运镜": "特效运镜.docx",
    "20组电影级组合运镜提示词": "20组电影级组合运镜提示词.docx",
    "运镜提示词": "运镜提示词.doc",
}


def unmd(s: str) -> str:
    """去掉 mammoth markdown 输出中的转义反斜杠与多余空白。"""
    s = re.sub(r"\\([\\`*_{}\[\]()#+\-.!<>|~])", r"\1", s)
    s = s.replace("__", "")
    return " ".join(s.split()).strip()


def descape(s: str) -> str:
    """仅去掉 markdown 转义反斜杠，不折叠空白（用于 url 等）。"""
    return re.sub(r"\\(.)", r"\1", s)


def strip_html(s: str) -> str:
    """去掉 mammoth 输出的 HTML 标签残留（如 Word 书签锚点 <a id="..."></a>）。"""
    return re.sub(r"<[^>]+>", "", s).strip()


def _zh_line(line: str) -> str | None:
    """匹配整行 '(中文对照)' 或 '*(中文对照)*'，返回内部中文文本。"""
    m = re.match(r"^\*?\\\((.+)\\\)\*?\s*$", line.strip())
    return unmd(m.group(1)).strip() if m else None


def parse_zuhe(md: str) -> list[dict]:
    """组合运镜.docx：文生图 5 条（编号+英文+中文括号行）、图生视频 5 条（(输入：..)+英文+中文括号行）。"""
    names_t2i = [
        "仰拍英雄战士·中景",
        "特写持玫瑰的苍老之手",
        "荷兰角未来都市夜景",
        "俯拍棋盘·无形之手",
        "远景悬崖孤影眺海",
    ]
    names_i2v = [
        "推近战士坚毅面庞",
        "拉出老妇凝视玫瑰",
        "上摇未来都市摩天楼",
        "特写落子瞬间",
        "环绕悬崖人物观怒海",
    ]
    entries = []
    # 章节切分
    t2i_part, _, i2v_part = md.partition("图生视频")
    lines = t2i_part.splitlines()
    idx = 0
    for line in lines:
        m = re.match(r"^(\d+)\.\s+(.*)$", line.strip())
        if m and not line.strip().startswith("1. __"):
            # 文生图条目首行 = 英文全文
            en = unmd(m.group(2))
            entries.append((en, None, names_t2i[idx] if idx < len(names_t2i) else f"文生图{idx+1}",
                            "文生图（Text-to-Image）：生成静态画面"))
            idx += 1
        else:
            zh = _zh_line(line)
            if zh and entries:
                en, _, name, note = entries[-1]
                entries[-1] = (en, zh, name, note)
    # 图生视频：`1. __(输入：xx)__ English...` 一行 + 中文括号行
    idx = 0
    for line in i2v_part.splitlines():
        m = re.match(r"^(\d+)\.\s+__\\\((.+)\\\)__\s+(.*)$", line.strip())
        if m:
            inp = unmd(m.group(2))
            inp = re.sub(r"^输入：", "", inp)
            en = unmd(m.group(3))
            entries.append((en, None, names_i2v[idx] if idx < len(names_i2v) else f"图生视频{idx+1}",
                            f"图生视频（Image-to-Video），输入图：{inp}"))
            idx += 1
        else:
            zh = _zh_line(line)
            if zh and entries and entries[-1][1] is None and "图生视频" in (entries[-1][3] or ""):
                en, _, name, note = entries[-1]
                entries[-1] = (en, zh, name, note)
    return [
        {"name": name, "prompt_en": en, "prompt_zh": zh or "", "notes": note, "image_url": None}
        for en, zh, name, note in entries
    ]


def parse_zuhe2(md: str) -> list[dict]:
    """组合运镜2.docx：三个章节，条目 = `1. __标题：__` + 英文段 + *中文对照*。

    逐行扫描：章节行（以 文生图/图生视频/更复杂的动态组合 开头的独立行）更新 section；
    条目正文行若以 `(起始图：...)` 开头，括号内中文进 notes、行剩余英文进 prompt_en。
    """
    entries: list[dict] = []
    section = ""
    anchors = [
        ("文生图", "文生图（Text-to-Image）：创造富有动感和张力的静态画面"),
        ("图生视频", "图生视频（Image-to-Video）：基于输入图片描述动态演变"),
        ("更复杂的动态组合", "更复杂的动态组合（图生视频为主）"),
    ]
    cur = None  # 当前条目 {title, en_lines, zh, extras[]}
    for line in md.splitlines():
        s = line.strip()
        if not s:
            continue
        # 章节行：以锚点词开头且不是编号条目；出现即结束上一条目
        if not re.match(r"^\d+\.\s", s):
            for key, label in anchors:
                if s.startswith(key):
                    if cur is not None:
                        entries.append(_finish_zuhe2(cur, section))
                        cur = None
                    section = label
                    break
        # 新条目起点：`1. __标题__`
        m = re.match(r"^(\d+)\.\s+__(.+?)__\s*$", s)
        if m:
            if cur is not None:
                entries.append(_finish_zuhe2(cur, section))
            cur = {"title": unmd(m.group(2)), "en_lines": [], "zh": None, "extras": []}
            continue
        if cur is None:
            continue
        # `(起始图：...)` 前缀行：括号内为中文起始图说明，剩余为英文
        pm = re.match(r"^\\\((起始图：.+?)\\\)\s*(.*)$", s)
        if pm:
            cur["extras"].append(unmd(pm.group(1)))
            if pm.group(2):
                cur["en_lines"].append(pm.group(2))
            continue
        # 斜体行：`*(中文对照)*` -> zh；`*(注：...)*` -> extras
        im = re.match(r"^\*\\\((.+?)\\\)\*(.*)$", s)
        if im:
            inner = unmd(im.group(1))
            if cur["zh"] is None and not inner.startswith("注："):
                cur["zh"] = inner
            elif inner:
                cur["extras"].append(inner)
            if im.group(2).strip():
                cur["en_lines"].append(im.group(2))
            continue
        nm = re.match(r"^\*(注：.+?)\*\s*$", s)
        if nm:
            cur["extras"].append(unmd(nm.group(1)))
            continue
        if s.startswith("*") and s.endswith("*"):
            cur["extras"].append(unmd(s.strip("*")))
            continue
        cur["en_lines"].append(s)
    if cur is not None:
        entries.append(_finish_zuhe2(cur, section))
    return entries


def _finish_zuhe2(cur: dict, section: str) -> dict:
    title = cur["title"]
    name, note = title, section or None
    m2 = re.match(r"^【输入：(.+?)】$", title)
    if m2:
        name = m2.group(1)
        note = "；".join(x for x in [section or "图生视频（Image-to-Video）", f"输入图：{name}"] if x)
    elif name.endswith("："):
        name = name.rstrip("：")
    notes = "；".join(x for x in ([note] if note else []) + cur["extras"]) or None
    return {
        "name": name,
        "prompt_en": unmd(" ".join(cur["en_lines"])),
        "prompt_zh": cur["zh"] or "",
        "notes": notes,
        "image_url": None,
    }


def parse_teji(md: str) -> list[dict]:
    """特效运镜.docx：## 小节标题 + ## 提示词 + 正文 + 图片。共 9 节，每节 1 图。"""
    entries = []
    # 去掉文档首行「特效运镜」标题
    body = md.split("\n", 1)[1] if md.startswith("特效运镜") else md
    # 按图片引用分节
    parts = re.split(r"!\[\]\(images/特效运镜[^)]*\)\s*", body)
    img_names = re.findall(r"!\[\]\((images/特效运镜[^)]+)\)", body)
    for i, part in enumerate(parts[:-1] if len(parts) > len(img_names) else parts):
        if i >= len(img_names):
            break
        secs = re.findall(r"^#{1,2}\s+(.+?)\s*$", part, flags=re.M)
        # 标题 = 最后一个非「提示词」的节标题
        title = None
        for s in secs:
            if s.strip() != "提示词":
                title = unmd(s)
        # 正文 = 「## 提示词」之后的内容
        m = re.search(r"#{1,2}\s+提示词\s*\n(.*)$", part, flags=re.S | re.M)
        content = m.group(1) if m else part
        lines = []
        for ln in content.splitlines():
            s = ln.strip()
            if not s or s.startswith("#"):
                continue
            if title and s == title:
                continue  # 去掉与标题重复的残留行
            lines.append(s)
        entries.append(
            {"name": title or f"特效运镜{i+1}", "prompt_en": "", "prompt_zh": unmd(
                " ".join(" ".join(lines).split())), "notes": "中文提示词（原文无英文对照）",
             "image_url": descape(img_names[i])}
        )
    return entries


def parse_20zu(md: str) -> list[dict]:
    """20组电影级组合运镜提示词.docx：__章节__ + `1. __标题__` + 描述 + *斜体说明*。"""
    entries = []
    section = ""
    section_notes = {
        "文生图组合提示": "文生图组合提示（静态画面）",
        "图生视频动态提示": "图生视频动态提示（基于输入图演化）",
        "高级动态组合技": "高级动态组合技（单镜头长调度）",
        "特殊效果融合提示": "特殊效果融合提示",
        "情感叙事组合包": "情感叙事组合包",
    }
    lines = md.splitlines()
    i = 0
    while i < len(lines):
        s = lines[i].strip()
        sec_m = re.match(r"^__(.+?)__\s*$", s)
        item_m = re.match(r"^(\d+)\.\s+__(.+?)__\s*$", s)
        if sec_m and not item_m and not s.startswith("1."):
            key = sec_m.group(1)
            section = next((v for k, v in section_notes.items() if key.startswith(k) or k in key), key)
            i += 1
            continue
        if item_m:
            title = unmd(item_m.group(2)).rstrip("：:").strip()
            # 收集描述行直到下一个条目/章节/图片
            desc, notes_lines = [], []
            j = i + 1
            while j < len(lines):
                t = lines[j].strip()
                if (re.match(r"^(\d+)\.\s", t) or re.match(r"^__.+?__\s*$", t)
                        or t.startswith("![]")):
                    break
                if t.startswith("*") and t.endswith("*"):
                    notes_lines.append(t.strip("*"))
                elif t:
                    desc.append(t)
                j += 1
            entry_note = "；".join([section] + [unmd(x) for x in notes_lines if unmd(x)])
            entries.append(
                {"name": title, "prompt_en": "", "prompt_zh": unmd(" ".join(desc)),
                 "notes": entry_note, "image_url": None}
            )
            i = j
            continue
        i += 1
    # 大图（AI 示例图）归属于第一条「危机逼近」
    for e in entries:
        if e["name"].startswith("危机逼近"):
            e["image_url"] = "images/20组电影级组合运镜提示词-1.png"
            e["notes"] += "；附文生图示例图"
            break
    return entries


def parse_jichu(md: str) -> list[dict]:
    """运镜提示词.doc（OLE2 文本）：类别行（X类）+ 条目行（名称：描述）。"""
    entries = []
    category = None
    for line in md.splitlines():
        s = line.strip()
        if not s:
            continue
        if re.match(r"^.+类$", s):  # 类别行
            category = s
            continue
        m = re.match(r"^(.+?)[:：](.+)$", s)
        if m and category:
            name, desc = m.group(1).strip(), m.group(2).strip()
            entries.append(
                {"name": name, "prompt_en": "", "prompt_zh": desc,
                 "notes": f"服装/人物展示运镜 · {category}", "image_url": None}
            )
    return entries


def build_prompts() -> list[dict]:
    parsers = [
        ("组合运镜", CATEGORY_ZUHE, parse_zuhe),
        ("组合运镜2", CATEGORY_ZUHE, parse_zuhe2),
        ("特效运镜", CATEGORY_TEJI, parse_teji),
        ("20组电影级组合运镜提示词", CATEGORY_DIANYYING, parse_20zu),
        ("运镜提示词", CATEGORY_JICHU, parse_jichu),
    ]
    all_entries = []
    order = 0
    for stem, category, parser in parsers:
        md_path = OUT_DIR / f"{stem}.md"
        md = md_path.read_text(encoding="utf-8")
        items = parser(md)
        for it in items:
            order += 1
            all_entries.append({
                "name": strip_html(it["name"]),
                "category": category,
                "prompt_en": strip_html(it["prompt_en"]),
                "prompt_zh": strip_html(it["prompt_zh"]),
                "notes": strip_html(it["notes"] or "") or None,
                "image_url": it["image_url"],
                "source_doc": SRC_DOCS[stem],
                "sort_order": order,
            })
        print(f"[prompts] {SRC_DOCS[stem]} -> {len(items)} entries ({category})")
    out = OUT_DIR / "prompts.json"
    out.write_text(json.dumps(all_entries, ensure_ascii=False, indent=2), encoding="utf-8")
    # 分类统计
    stat: dict[str, int] = {}
    for e in all_entries:
        stat[e["category"]] = stat.get(e["category"], 0) + 1
    print(f"[prompts] total {len(all_entries)} -> {out.relative_to(ROOT)}")
    for k, v in stat.items():
        print(f"  {k}: {v}")
    return all_entries


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    doc_files = sorted(
        [p for p in DOCS_DIR.iterdir() if p.suffix.lower() in (".docx", ".doc")],
        key=lambda p: p.name,
    )
    if not doc_files:
        print(f"[ERROR] no docs found in {DOCS_DIR}")
        return 1

    skipped: list[str] = []
    stats = []

    for path in doc_files:
        stem, suffix = path.stem, path.suffix.lower()
        print(f"\n=== {path.name} ({path.stat().st_size} bytes) ===")
        md_text, images, note = "", [], ""

        if suffix == ".docx":
            r = extract_docx(path)
            md_text, images = r["markdown"], r["images"]
        else:  # .doc：探测真实格式
            with open(path, "rb") as f:
                head = f.read(4)
            if head[:2] == b"PK":  # 实为 docx
                print("  [probe] PK header -> real docx, extracting as docx")
                r = extract_docx(path)
                md_text, images = r["markdown"], r["images"]
                note = "（探测为 docx 内容，扩展名 .doc）"
            elif head == OLE2_MAGIC[:4]:
                print("  [probe] OLE2 header -> legacy Word 97 doc")
                converted = try_soffice_convert(path)
                if converted is not None:
                    print("  [soffice] converted to docx")
                    r = extract_docx(converted)
                    md_text, images = r["markdown"], r["images"]
                    note = "（soffice 转换自 .doc）"
                    converted.unlink()
                else:
                    print("  [warn] soffice unavailable -> fallback OLE2 text-only extraction")
                    try:
                        md_text = extract_doc97_text(path)
                        note = "（OLE2 老 doc 纯文本提取：无图片，无样式结构）"
                        skipped.append((path.name, "部分提取：OLE2 老格式且本机无 soffice，仅得纯文本，图片未提取"))
                    except Exception as e:
                        print(f"  [SKIP] OLE2 fallback failed: {e}")
                        skipped.append(f"{path.name}\tOLE2 解析失败: {e}")
                        continue
            else:
                print(f"  [SKIP] unknown format header {head.hex()}")
                skipped.append(f"{path.name}\t未知格式头 {head.hex()}")
                continue

        out_md = OUT_DIR / f"{stem}.md"
        header = f"<!-- 提取自 content-source/docs/{path.name} -->\n"
        if note:
            header += f"<!-- {note} -->\n"
        out_md.write_text(header + md_text, encoding="utf-8")
        print(f"  -> {out_md.relative_to(ROOT)}  text={len(md_text)} chars, images={len(images)}")
        stats.append((path.name, len(md_text), len(images)))

    if skipped:
        SKIPPED_TXT.write_text(
            "\n".join(f"{name}\t{reason}" for name, reason in skipped) + "\n",
            encoding="utf-8",
        )
        print(f"\n[SKIPPED/PARTIAL] {len(skipped)} record(s) -> {SKIPPED_TXT.relative_to(ROOT)}")

    shutil.rmtree(OUT_DIR / "_tmp_convert", ignore_errors=True)
    print("\n===== 提取统计 =====")
    for name, chars, imgs in stats:
        print(f"  {name}: {chars} chars, {imgs} images")
    print(f"total: {len(stats)} extracted, {len(skipped)} skipped")

    print("\n===== Step 3: 提示词拆解 =====")
    build_prompts()
    return 0


if __name__ == "__main__":
    sys.exit(main())
