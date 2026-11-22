#!/usr/bin/env python3
"""Сборка шрифтов книги (I5) из пакетов @fontsource → public/fonts/*.ttf.

Запуск (нужны node_modules и fonttools: pip install fonttools brotli):
    python3 lib/book/pdf/build-fonts.py

Зачем: @react-pdf/renderer нужен один TTF на начертание, а @fontsource отдаёт шрифт кусками
по unicode-range. Склеиваем нужные куски и обрезаем до подмножества:
  - NotoSerif-{Regular,Bold,Italic}.ttf — латиница + кириллица (русский текст);
  - NotoSerifKR-{Regular,Bold}.ttf — 2 350 слогов KS X 1001 + все слоги из текстов репозитория,
    чамо, знаки CJK, ASCII. Все 11 172 слога весят 7,4 МБ на начертание — слишком много для функции;
    редкий слог вне набора lib/book/pdf/fonts.ts находит заранее (missingKorean) и пишет в лог сборки.
    Ханча не берём — в переводах её нет.
В PDF react-pdf всё равно встраивает только использованные глифы — книга весит сотни КБ.
Шрифты — SIL Open Font License 1.1 (см. public/fonts/OFL.txt).
"""
import json
import os
import re
import sys
import tempfile

from fontTools.merge import Merger, Options as MergeOptions
from fontTools.subset import Options as SubsetOptions, Subsetter
from fontTools.ttLib import TTFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
FS = os.path.join(ROOT, "node_modules", "@fontsource")
OUT = os.path.join(ROOT, "public", "fonts")

DROP = ["GPOS", "GSUB", "GDEF", "BASE", "STAT", "vhea", "vmtx", "VORG", "gasp"]


def ranges(spec):
    out = []
    for part in spec.split(","):
        p = part.strip().lower().replace("u+", "")
        if not p:
            continue
        if "-" in p:
            a, b = p.split("-")
            out.append((int(a, 16), int(b, 16)))
        elif "?" in p:
            out.append((int(p.replace("?", "0"), 16), int(p.replace("?", "f"), 16)))
        else:
            out.append((int(p, 16), int(p, 16)))
    return out


def intersects(rs, want):
    return any(a <= wb and wa <= b for a, b in rs for wa, wb in want)


def codepoints(want):
    s = set()
    for a, b in want:
        s.update(range(a, b + 1))
    return s


def build(pkg, prefix, weight, style, want, out_name, keep_layout):
    meta = json.load(open(os.path.join(FS, pkg, "unicode.json")))
    files = []
    for key, spec in meta.items():
        if not intersects(ranges(spec), want):
            continue
        slice_name = key.strip("[]")
        path = os.path.join(FS, pkg, "files", f"{prefix}-{slice_name}-{weight}-{style}.woff")
        if os.path.exists(path):
            files.append(path)
    if not files:
        sys.exit(f"нет файлов для {out_name}")

    tmp = tempfile.mkdtemp()
    ttfs = []
    for i, path in enumerate(sorted(files)):
        f = TTFont(path)
        f.flavor = None
        if not keep_layout:
            for t in DROP:
                if t in f:
                    del f[t]
        p = os.path.join(tmp, f"{i}.ttf")
        f.save(p)
        ttfs.append(p)

    if len(ttfs) == 1:
        merged = TTFont(ttfs[0])
    else:
        merged = Merger(options=MergeOptions(drop_tables=DROP if not keep_layout else [])).merge(ttfs)

    opts = SubsetOptions()
    opts.layout_features = ["kern", "liga", "ccmp", "locl", "mark", "mkmk"] if keep_layout else []
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    opts.glyph_names = False
    opts.hinting = False  # для печати хинтинг не нужен, −30% веса
    sub = Subsetter(options=opts)
    sub.populate(unicodes=codepoints(want))
    sub.subset(merged)
    merged.flavor = None
    dst = os.path.join(OUT, out_name)
    merged.save(dst)
    cmap = merged.getBestCmap()
    n = len(cmap)
    if out_name == "NotoSerifKR-Regular.ttf":
        # Список слогов в шрифте — по нему fonts.ts заранее находит слоги, которых нет (missingKorean)
        syl = "".join(chr(c) for c in sorted(cmap) if 0xAC00 <= c <= 0xD7A3)
        open(os.path.join(OUT, "NotoSerifKR.syllables.txt"), "w", encoding="utf-8").write(syl)
    print(f"{out_name}: {len(files)} кусков → {n} символов, {os.path.getsize(dst) // 1024} КБ")


ASCII = [(0x20, 0x7E), (0xA0, 0xFF), (0x2010, 0x2027), (0x2030, 0x203A), (0x20AC, 0x20AC), (0x2116, 0x2116), (0x20B8, 0x20B8)]
CYR = [(0x400, 0x45F), (0x490, 0x4FF)]  # русский + казахские буквы
def ksx1001_syllables():
    """2 350 слогов KS X 1001 (EUC-KR) — покрывают почти весь современный текст."""
    out = []
    for hi in range(0xB0, 0xC9):
        for lo in range(0xA1, 0xFF):
            try:
                c = bytes([hi, lo]).decode("euc_kr")
            except UnicodeDecodeError:
                continue
            if 0xAC00 <= ord(c) <= 0xD7A3:
                out.append((ord(c), ord(c)))
    return out


def repo_syllables():
    """Слоги из текстов репозитория (банк вопросов, фикстуры ИИ, персонажи) — их точно встретим в демо."""
    found = set()
    for d in ("content", "fixtures", "eval", "prompts", "app", "components", "lib"):
        for base, _, names in os.walk(os.path.join(ROOT, d)):
            for n in names:
                if n.endswith((".ts", ".tsx", ".json", ".md", ".txt")):
                    try:
                        text = open(os.path.join(base, n), encoding="utf-8").read()
                    except (UnicodeDecodeError, OSError):
                        continue
                    found.update(ord(c) for c in text if 0xAC00 <= ord(c) <= 0xD7A3)
    return [(c, c) for c in sorted(found)]


HANGUL = ksx1001_syllables() + repo_syllables() + [
    (0x1100, 0x11FF),  # чамо
    (0x3130, 0x318F),  # совместимые чамо
    (0x3000, 0x303F),  # знаки CJK: 「」、。
    (0xFF01, 0xFF5E),  # полноширинные
    (0x00B7, 0x00B7),
]

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    ru = ASCII + CYR
    build("noto-serif", "noto-serif", 400, "normal", ru, "NotoSerif-Regular.ttf", True)
    build("noto-serif", "noto-serif", 700, "normal", ru, "NotoSerif-Bold.ttf", True)
    build("noto-serif", "noto-serif", 400, "italic", ru, "NotoSerif-Italic.ttf", True)
    kr = HANGUL + [(0x20, 0x7E), (0x2018, 0x201D), (0x2026, 0x2026)]
    build("noto-serif-kr", "noto-serif-kr", 400, "normal", kr, "NotoSerifKR-Regular.ttf", False)
    build("noto-serif-kr", "noto-serif-kr", 700, "normal", kr, "NotoSerifKR-Bold.ttf", False)
