"""Recompose the PaperReader poster as a 1600 x 800 GitHub README banner."""

from functools import lru_cache
from pathlib import Path
import math

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).resolve().parent
S = 2
W, H = 1600, 800
PAPER, GREEN, INK = '#FAFBF6', '#294F40', '#314839'
MUTED, LINE, GOLD = '#75816F', '#DFE5D9', '#D9B94F'
FONT_DIR = Path.home() / 'AppData/Local/Microsoft/Windows/Fonts'
im = Image.new('RGB', (W * S, H * S), PAPER)
d = ImageDraw.Draw(im)


def box(values):
    return tuple(round(v * S) for v in values)


@lru_cache(maxsize=64)
def font(size, weight='Regular'):
    path = ('C:/Windows/Fonts/segoeuib.ttf' if weight == 'Brand'
            else str(FONT_DIR / f'NotoSansTC-{weight}.ttf'))
    return ImageFont.truetype(path, round(size * S))


def txt(x, y, value, size=20, fill=INK, weight='Regular', anchor='lt'):
    d.text(box((x, y)), value, font=font(size, weight), fill=fill, anchor=anchor)


def line(points, fill=LINE, stroke=1):
    d.line([box(p) for p in points], fill=fill, width=max(1, round(stroke * S)), joint='curve')


def rr(rect, radius=12, fill='white', outline=None, stroke=1):
    d.rounded_rectangle(box(rect), round(radius * S), fill=fill,
                        outline=outline, width=round(stroke * S))


def circle(x, y, radius, fill):
    d.ellipse(box((x-radius, y-radius, x+radius, y+radius)), fill=fill)


def arrow(points, fill='#A3B299', stroke=2, tip=6):
    line(points, fill, stroke)
    a, b = points[-2:]
    angle = math.atan2(b[1]-a[1], b[0]-a[0])
    for offset in (-.52, .52):
        end = (b[0]-tip*math.cos(angle+offset), b[1]-tip*math.sin(angle+offset))
        line([b, end], fill, stroke)


def shadow(rect, radius=18, opacity=25, blur=15, offset=9):
    mask = Image.new('RGBA', im.size)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle(box((rect[0], rect[1]+offset, rect[2], rect[3]+offset)),
                         round(radius*S), fill=(32, 58, 41, opacity))
    mask = mask.filter(ImageFilter.GaussianBlur(blur*S))
    im.paste(mask, (0, 0), mask)


def icon(kind, x, y):
    def il(points):
        line([(x+a, y+b) for a, b in points], GREEN, 1.8)
    if kind == 'highlight':
        il([(2, 19), (14, 7), (21, 14), (9, 26), (2, 26), (2, 19)])
        il([(11, 10), (18, 17)])
        il([(1, 30), (26, 30)])
    elif kind == 'ai':
        il([(14, 2), (17, 11), (26, 14), (17, 18), (14, 27),
            (10, 18), (1, 14), (10, 11), (14, 2)])
        il([(27, 1), (27, 8)])
        il([(23.5, 4.5), (30.5, 4.5)])
    elif kind == 'connect':
        il([(8, 8), (23, 23)])
        il([(23, 8), (8, 23)])
        for a, b in ((5, 5), (26, 5), (5, 26), (26, 26)):
            rr((x+a-3, y+b-3, x+a+3, y+b+3), 1, PAPER, GREEN, 1.7)
    else:
        il([(2, 7), (11, 7), (15, 11), (29, 11), (29, 29), (2, 29), (2, 7)])
        il([(16, 15), (16, 25)])
        il([(11, 20), (16, 25), (21, 20)])


# Keep the original poster's product signature and palette.
rr((54, 36, 98, 80), 11, GREEN)
d.polygon([box(p) for p in ((67, 46), (79, 46), (87, 54), (87, 69), (67, 69))], fill=PAPER)
line([(79, 46), (79, 54), (87, 54)], '#A9BDA3', 1.5)
line([(71, 59), (81, 59)], GREEN, 1.5)
line([(71, 64), (79, 64)], GREEN, 1.5)
txt(113, 36, 'PaperReader', 32, GREEN, 'Brand')
txt(1546, 47, '繁體中文 PDF 研究閱讀器', 18, GREEN, 'Medium', 'rt')
line([(54, 103), (1546, 103)])

# Main message gets more room than the original poster's fine print.
rr((56, 142, 84, 147), 2, GOLD)
txt(98, 134, '從閱讀，到研究洞見', 18, GREEN, 'Medium')
txt(51, 185, '把論文讀成', 67, GREEN, 'Black')
rr((57, 329, 392, 348), 5, '#E9DA92')
txt(51, 269, '自己的知識。', 67, GREEN, 'Black')
txt(57, 377, '標記重點、理解內容、連結想法，', 22)
txt(57, 415, '讓每一次閱讀，都成為研究的累積。', 22)
flow = [('讀 PDF', 57), ('留重點', 203), ('連觀點', 349), ('帶走研究', 495)]
for i, (label, x) in enumerate(flow):
    txt(x, 486, f'0{i+1}', 12, MUTED, 'Medium')
    txt(x, 510, label, 19, GREEN, 'Bold')
    if i < 3:
        arrow([(x+91, 522), (x+122, 522)], '#AAB59F', 1.5, 5)

# A shorter, less dense version of the same PDF-to-whiteboard illustration.
window = (650, 146, 1546, 554)
shadow(window)
rr(window, 20, '#FFFFFF', '#DCE4D6')
rr((651, 147, 1545, 188), 19, '#EDF1E7')
d.rectangle(box((651, 166, 1545, 188)), fill='#EDF1E7')
for x, fill in ((669, '#A6B79A'), (684, '#BECAB4'), (699, '#D2DACB')):
    circle(x, 168, 3.5, fill)
txt(721, 156, 'PaperReader', 16, GREEN, 'Brand')
txt(1524, 158, '功能示意', 12, MUTED, anchor='rt')
line([(651, 188), (1545, 188)])
line([(953, 199), (953, 532)])
txt(675, 205, '文獻閱讀', 15, GREEN, 'Medium')
txt(976, 205, '知識白板', 15, GREEN, 'Medium')
rr((674, 236, 931, 514), 6, '#FFFFFF', LINE)
rr((691, 251, 729, 272), 4, '#EEF2E8')
txt(699, 255, 'PDF', 11, GREEN, 'Brand')
txt(692, 291, '閱讀與知識建構', 20, GREEN, 'Bold')
txt(692, 325, '從文獻重點，走向研究觀點', 13, MUTED)
line([(692, 353), (914, 353)])
rr((689, 372, 917, 397), 2, '#F5E9AC')
rr((689, 406, 896, 431), 2, '#F5E9AC')
txt(694, 377, '理解主張、證據與限制', 17)
txt(694, 411, '保留原文脈絡與來源', 17)
txt(692, 478, '點選便條，回到原文', 13, GREEN, 'Medium')
txt(913, 480, 'p. 1', 11, MUTED, anchor='rt')

for x in range(977, 1528, 18):
    for y in range(239, 533, 18):
        circle(x, y, .65, '#E3E9DC')
arrow([(919, 385), (966, 385), (966, 298), (982, 298)], '#C5B15C', 2)
arrow([(1098, 355), (1098, 401)], '#9CA98B', 2)
arrow([(1215, 293), (1385, 293), (1385, 326)], '#B6A5C3', 2)
arrow([(1215, 458), (1251, 458)], '#B6A5C3', 2)
rr((1261, 279, 1310, 303), 6, PAPER)
txt(1272, 282, '整合', 12, '#866B98', 'Medium')
rr((1108, 367, 1157, 391), 6, PAPER)
txt(1119, 370, '對比', 12, MUTED, 'Medium')


def note(rect, tint, title, rows, footer):
    x1, y1, x2, y2 = rect
    shadow(rect, 10, 14, 6, 4)
    rr(rect, 10, '#FFFFFF', '#DCE3D5')
    rr((x1+1, y1+1, x2-1, y1+9), 8, tint)
    d.rectangle(box((x1+1, y1+5, x2-1, y1+9)), fill=tint)
    txt(x1+16, y1+19, title, 21, GREEN, 'Bold')
    for i, row in enumerate(rows):
        txt(x1+16, y1+53+i*24, row, 15)
    txt(x1+16, y2-22, footer, 11.5, MUTED)
    txt(x2-13, y2-24, '↗', 16, '#8E70A5', 'Bold', 'rt')


note((982, 242, 1215, 355), '#EBD47F', '研究發現',
     ['選字留下重點與筆記'], '來源 p. 1')
note((982, 401, 1215, 514), '#B8C9A5', '方法與限制',
     ['跨文獻比較不同觀點'], '來源 p. 3')
note((1251, 326, 1520, 473), '#D7C5E8', '關聯摘要',
     ['把相連便條交給 AI 整理，', '掌握共同主題與觀點差異。'], '保留來源，方便回查')

# A compact feature strip remains legible when GitHub scales the image down.
line([(54, 592), (1546, 592)])
benefits = [
    ('highlight', '重點一劃，來源不丟', '四色標記 · 截圖便條 · 原文回查'),
    ('ai', 'AI 協助，讀得更懂', '段落翻譯 · 全文摘要 · 關聯摘要'),
    ('connect', '文獻一連，觀點成形', '跨 PDF 白板 · 自由排列與連線'),
    ('pack', '研究累積，隨時帶走', '本機保存 · 離線閱讀 · 封裝備份'),
]
for i, (kind, title, desc) in enumerate(benefits):
    x = 57 + i*380
    icon(kind, x, 617)
    txt(x+45, 623, f'0{i+1}', 13, '#98A18E', 'Medium')
    txt(x, 663, title, 23, GREEN, 'Bold')
    txt(x, 704, desc, 16.5, MUTED)
    if i < 3:
        line([(x+352, 620), (x+352, 728)])

d.rectangle(box((0, 756, 1600, 800)), fill=GREEN)
txt(56, 769, '免登入 · 先試讀一篇範例', 17, '#FFFFFF', 'Medium')
txt(585, 771, 'AI 需連網、自備 API 金鑰，依供應商計費', 13, '#CAD7C4')
txt(1545, 768, 'educatres.github.io/PaperReader/', 18, '#FFFFFF', 'Brand', 'rt')

target = OUT / 'PaperReader_GitHub展示圖_2x1.png'
im.resize((W, H), Image.Resampling.LANCZOS).save(target, optimize=True)
with Image.open(target) as result:
    assert result.size == (1600, 800)
    print(f'Saved GitHub banner: {result.width} x {result.height}, 2:1')
