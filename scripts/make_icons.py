"""
自绘 BiLens 扩展图标。

设计：圆角方形蓝底 + 双语对照图形
  - 左侧：两条粗块（原文）
  - 右侧：两条细块（译文）
  - 中间一道竖线分隔，16px 下仍能看出「两栏对照」
块数刻意少、间距刻意大，保证小尺寸不糊成一团。
纯代码生成，不依赖任何外部素材。4 倍超采样抗锯齿。
"""
from PIL import Image, ImageDraw
import os

BLUE = (47, 111, 237, 255)      # #2f6fed 主色
WHITE = (255, 255, 255, 255)
WHITE_DIM = (255, 255, 255, 190)

SS = 8  # 超采样倍率


def draw_icon(size):
    S = size * SS
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 背景：圆角方形，蓝色
    radius = size * 0.22
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=radius * SS, fill=BLUE)

    # 版面参数：只有两行，间距大，小尺寸也清晰
    pad = S * 0.18
    left_x0, left_x1 = pad, S * 0.435
    right_x0, right_x1 = S * 0.565, S - pad

    thick = S * 0.105           # 左侧块高
    thin = S * 0.075            # 右侧块高
    gap = S * 0.30              # 行间距（大）
    top = S * 0.335

    # 左侧：两条粗块
    for i in range(2):
        y = top + i * gap
        d.rounded_rectangle([left_x0, y, left_x1, y + thick],
                            radius=thick / 2, fill=WHITE)

    # 右侧：两条细块（稍暗，体现「译文」）
    for i in range(2):
        y = top + i * gap + (thick - thin) / 2
        d.rounded_rectangle([right_x0, y, right_x1, y + thin],
                            radius=thin / 2, fill=WHITE_DIM)

    # 中间竖线
    mid = S * 0.5
    d.rounded_rectangle(
        [mid - S * 0.018, top - S * 0.06, mid + S * 0.018, top + gap + thick + S * 0.06],
        radius=S * 0.018, fill=(255, 255, 255, 150))

    # 降采样抗锯齿
    return img.resize((size, size), Image.LANCZOS)


os.makedirs('public/icon', exist_ok=True)
for s in (16, 32, 48, 128):
    ic = draw_icon(s)
    p = f'public/icon/{s}.png'
    ic.save(p)
    print(f'  {p}  {os.path.getsize(p)} bytes  {ic.size}')
