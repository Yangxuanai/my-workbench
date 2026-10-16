# -*- coding: utf-8 -*-
"""生成 PWA 图标：深绿渐变底 + 白色「羊」字，另出一版 maskable（留安全边距）。"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))      # web/scripts
WEB = os.path.dirname(HERE)                            # web
OUT = os.path.join(WEB, "icons")
os.makedirs(OUT, exist_ok=True)
print("输出目录:", OUT)

C1 = (18, 33, 28)     # #12211c
C2 = (34, 73, 58)     # #22493a
GREEN = (127, 209, 168)

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
    r"C:\Windows\Fonts\arialbd.ttf",
]


def load_font(size):
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()


def gradient(size):
    """对角线渐变底"""
    img = Image.new("RGB", (size, size), C1)
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x / size * 0.35 + y / size * 0.65)
            r = int(C1[0] + (C2[0] - C1[0]) * t)
            g = int(C1[1] + (C2[1] - C1[1]) * t)
            b = int(C1[2] + (C2[2] - C1[2]) * t)
            px[x, y] = (r, g, b)
    return img


def draw_icon(size, maskable=False):
    img = gradient(size).convert("RGBA")
    d = ImageDraw.Draw(img)

    # maskable 需要把内容收进中间 ~78% 的安全区
    # 字号要留出底部柱状图的位置，否则会重叠
    scale = 0.50 if maskable else 0.62

    font = load_font(int(size * scale))
    text = "羊"
    box = d.textbbox((0, 0), text, font=font)
    tw, th = box[2] - box[0], box[3] - box[1]
    tx = (size - tw) / 2 - box[0]
    # 整体上移，把下半部分让给柱状图
    ty = (size - th) / 2 - box[1] - size * 0.16
    d.text((tx, ty), text, font=font, fill=(255, 255, 255, 255))

    # 底部三根向上的小柱（暗示行情）
    bar_w = max(4, int(size * 0.042))
    gap = max(4, int(size * 0.028))
    heights = [0.055, 0.095, 0.140]
    base_y = size * (0.845 if not maskable else 0.775)
    total_w = bar_w * 3 + gap * 2
    start_x = (size - total_w) / 2
    for i, h in enumerate(heights):
        x0 = start_x + i * (bar_w + gap)
        y0 = base_y - size * h
        d.rounded_rectangle(
            [x0, y0, x0 + bar_w, base_y],
            radius=bar_w / 2,
            fill=GREEN + (255,),
        )

    return img


for s in (192, 512):
    draw_icon(s).convert("RGB").save(os.path.join(OUT, f"icon-{s}.png"), "PNG")
    print(f"生成 icon-{s}.png")

draw_icon(512, maskable=True).convert("RGB").save(
    os.path.join(OUT, "icon-maskable-512.png"), "PNG"
)
print("生成 icon-maskable-512.png")
