# Генератор доски K (wireflow). Запуск: python3 mockups/ui/K/build.py  -> mockups/ui/K/index.html
import os, html
W, H = 4000, 2600
PW, PH = 150, 300
out = []
def E(s): return html.escape(str(s), quote=True)
def add(s): out.append(s)

def text(x, y, s, size=14, anchor="start", weight="normal", fill="#222", cls=""):
    lines = s.split("\n") if isinstance(s, str) else s
    t = f'<text x="{x}" y="{y}" font-size="{size}" text-anchor="{anchor}" font-weight="{weight}" fill="{fill}"{(" class=%s" % cls) if cls else ""}>'
    for i, l in enumerate(lines):
        l = l or '\u00a0'
        t += f'<tspan x="{x}" dy="{0 if i == 0 else size*1.22:.1f}">{E(l)}</tspan>'
    return t + "</text>"

def label(x, y, s, size=14, fill="#111", bg="#fff", stroke="none"):
    lines = s.split("\n")
    w = max(len(l) for l in lines) * size * 0.56 + 12
    h = len(lines) * size * 1.22 + 6
    r = f'<rect x="{x-w/2:.0f}" y="{y-size-2:.0f}" width="{w:.0f}" height="{h:.0f}" rx="5" fill="{bg}" stroke="{stroke}" opacity="0.96"/>'
    return r + text(x, y, s, size, "middle", "600", fill)

STY = {"act": ("#1d1d1f", "", "a-act"), "auto": ("#7a7a7a", "8 6", "a-auto"),
       "back": ("#d9730d", "", "a-back"), "later": ("#7a7a7a", "3 5", "a-auto")}
def arrow(pts, kind="act", lab=None, lp=None, ls=14):
    col, dash, mk = STY[kind]
    d = "M" + " L".join(f"{x},{y}" for x, y in pts)
    add(f'<path d="{d}" fill="none" stroke="{col}" stroke-width="{3 if kind=="act" else 2.6}" '
        f'{"stroke-dasharray=%s" % chr(34)+dash+chr(34) if dash else ""} marker-end="url(#{mk})"/>')
    if lab:
        add(label(lp[0], lp[1], lab, ls, fill=col if kind != "act" else "#111"))

def conn(x, y, tid, kind="act"):
    col = STY[kind][0]
    add(f'<circle cx="{x}" cy="{y}" r="27" fill="#fff" stroke="{col}" stroke-width="3"/>')
    add(text(x, y + 6, "→" + tid, 15, "middle", "700", col))

def q(x, y, n):
    add(f'<circle cx="{x}" cy="{y}" r="19" fill="#d7263d"/>' + text(x, y + 7, f"?{n}", 18, "middle", "800", "#fff"))

def section(x, y, w, h, title, fill):
    add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="22" fill="{fill}" stroke="#cfcfcf"/>')
    add(text(x + 18, y + 30, title, 22, "start", "700", "#333"))

# ---------- wireframe primitives (локальные координаты телефона 150x300)
G = "#9a9a9a"; L = "#d6d6d6"; D = "#555"
def r(x, y, w, h, f=L, s="none", rx=4, dash=None, sw=1.5):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{f}" stroke="{s}" stroke-width="{sw}"{(" stroke-dasharray=%s" % chr(34)+dash+chr(34)) if dash else ""}/>'
def c(x, y, rr, f=L, s="none", sw=1.5, dash=None):
    return f'<circle cx="{x}" cy="{y}" r="{rr}" fill="{f}" stroke="{s}" stroke-width="{sw}"{(" stroke-dasharray=%s" % chr(34)+dash+chr(34)) if dash else ""}/>'
def t(x, y, s, size=11, a="middle", w="normal", f=D): return text(x, y, s, size, a, w, f)
def ln(x1, y1, x2, y2, s=D, sw=1.5, dash=None):
    return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{s}" stroke-width="{sw}"{(" stroke-dasharray=%s" % chr(34)+dash+chr(34)) if dash else ""}/>'
def pth(d, s=D, sw=1.6, f="none", dash=None, mk=True):
    return f'<path d="{d}" fill="{f}" stroke="{s}" stroke-width="{sw}"{(" stroke-dasharray=%s" % chr(34)+dash+chr(34)) if dash else ""}{" marker-end=%s" % chr(34)+"url(#tiny)"+chr(34) if mk else ""}/>'
def person(x, y, s=1.0, f=G):
    return c(x, y, 9 * s, f) + f'<path d="M{x-14*s},{y+34*s} Q{x-13*s},{y+11*s} {x},{y+11*s} Q{x+13*s},{y+11*s} {x+14*s},{y+34*s} Z" fill="{f}"/>'
def finger(x, y): return c(x, y, 7, "#ffcf99", "#d9730d", 1.5)
def balls(y=262, n=4, x0=28):
    return "".join(c(x0 + i * 22, y, 8, "#efe3c8", "#b9a77f") for i in range(n))
def scene(sky="#e3e3e3", lab="место"):
    return r(6, 22, 138, 92, sky, rx=6) + t(75, 72, lab, 11, w="600")
def table(y=180): return r(6, y, 138, 300 - y - 14, "#ece6da", rx=6)
def tava(x=75, y=150, rr=52): return c(x, y, rr, "#cfcfcf", "#888", 2) + c(x, y, rr - 6, "#dadada")
def bubble(x, y, inner):
    return f'<path d="M{x-30},{y-18} h60 a6,6 0 0 1 6,6 v26 a6,6 0 0 1 -6,6 h-24 l-8,9 l-2,-9 h-26 a6,6 0 0 1 -6,-6 v-26 a6,6 0 0 1 6,-6 z" fill="#fff" stroke="{D}" stroke-width="1.3"/>' + inner
def banana(x, y): return f'<path d="M{x-9},{y} Q{x},{y+9} {x+9},{y-3}" stroke="#e0b800" stroke-width="5" fill="none" stroke-linecap="round"/>'
def egg(x, y): return f'<ellipse cx="{x}" cy="{y}" rx="7" ry="9" fill="#fff" stroke="{D}"/>' + c(x, y + 1, 3.5, "#f3c33c")
def icons_bottom():  # тетрадь слева внизу, колокольчик справа внизу — зона большого пальца
    return (r(10, 274, 26, 18, "#fff", D, 3) + ln(23, 274, 23, 292) +
            f'<path d="M121,290 h18 l-3,-4 v-7 a6,6 0 0 0 -12,0 v7 z" fill="#fff" stroke="{D}" stroke-width="1.4"/>')
def gear(): return c(134, 30, 7, "#fff", D, 2.2, "3 2")
def hearts(x, y, n=3):
    return "".join(f'<path d="M{x+i*16},{y+4} l-6,-6 a3.6,3.6 0 0 1 6,-4 a3.6,3.6 0 0 1 6,4 z" fill="#e2557a"/>' for i in range(n))
def roti_sq(x, y, s=46, cut=False):
    g = r(x - s/2, y - s/2, s, s, "#e8c27a", "#a27b2c", 6)
    if cut:
        for k in (1, 2):
            g += ln(x - s/2 + k*s/3, y - s/2, x - s/2 + k*s/3, y + s/2, "#7a5a1c", 1.4) + ln(x - s/2, y - s/2 + k*s/3, x + s/2, y - s/2 + k*s/3, "#7a5a1c", 1.4)
    return g
def card(x, y, w=110, h=140):
    return (r(x, y, w, h, "#fff", D, 8) + roti_sq(x + w/2, y + 42, 40, True) + person(x + 25, y + 78, 0.6) +
            c(x + 82, y + 86, 8, "#f3d27a") + r(x + 12, y + 118, w - 24, 6, L) + r(x + 12, y + 128, w - 44, 6, L))

# ---------- phone frame
def phone(pid, x, y, title, inner, status="decided", badge=None, notes=None, w=PW, h=PH, tsize=17):
    dash = ' stroke-dasharray="10 7"' if status == "idea" else ""
    sc = "#2f2f2f" if status != "idea" else "#6b6b6b"
    add(f'<g transform="translate({x},{y})">')
    add(f'<rect x="-4" y="-4" width="{w+8}" height="{h+8}" rx="22" fill="#fff" stroke="{sc}" stroke-width="3"{dash}/>')
    add(f'<g transform="scale({w/PW:.4f},{h/PH:.4f})">' + r(0, 0, PW, PH, "#fafafa", rx=18) +
        r(55, 7, 40, 7, "#cfcfcf", rx=3.5) + inner + "</g>")
    if status == "done":
        add(f'<circle cx="{w-2}" cy="{h-2}" r="14" fill="#2e9e5b"/>' + text(w - 2, h + 4, "✓", 17, "middle", "700", "#fff"))
    if badge:
        bw = len(badge) * 8.6 + 14
        add(f'<rect x="{w-bw+8}" y="-16" width="{bw}" height="24" rx="12" fill="#fff4d6" stroke="#c99a12" stroke-width="1.5"/>')
        add(text(w - bw/2 + 8, 1, badge, 14, "middle", "700", "#8a6500"))
    add("</g>")
    idw = len(pid) * 9.5 + 12 if pid else -6
    if pid: add(f'<rect x="{x}" y="{y-36}" width="{idw}" height="22" rx="5" fill="#333"/>' + text(x + idw/2, y - 20, pid, 14, "middle", "700", "#fff"))
    add(text(x + idw + 6, y - 19, title, tsize, "start", "700", "#1d1d1f"))
    if notes:
        add(text(x, y + h + 26, notes, 13, "start", "normal", "#444"))

def diamond(cx, cy, s, kind_idea=False, w=78, h=62):
    add(f'<path d="M{cx},{cy-h} L{cx+w},{cy} L{cx},{cy+h} L{cx-w},{cy} Z" fill="#fff" stroke="#2f2f2f" stroke-width="3"/>')
    add(text(cx, cy - 6, s, 15, "middle", "700"))

# ================= BOARD
add(text(40, 54, "Roti Stand — карта экранов (wireflow)", 34, "start", "800", "#111"))
add(text(720, 54, "портрет, одной рукой · всё нужное пальцу — в нижних двух третях · каркасы, не арт · 23.11.2026 · доска K", 19, "start", "normal", "#555"))

section(20, 80, 1650, 860, "1 · Вход и место (место выбирает настоящий час телефона)", "#f4f6f8")
section(1690, 80, 1310, 860, "Боковые ветки: тетрадь · места · настройки", "#f6f4f9")
section(3020, 80, 960, 860, "Легенда и где поток неясен", "#ffffff")
section(20, 960, 3960, 560, "2 · Готовка — ОДНА непрерывная сцена: камера едет стол → тава → стол (полоса состояний, не отдельные экраны)", "#fbf6ec")
section(20, 1555, 3960, 1025, "3 · Подача, показ миру, конец вечера и возвращение в другой час", "#f2f7f2")

# --- entry
add(f'<g transform="translate(36,170)">' + c(14, 14, 13, "#2e9e5b") + text(14, 20, "▶", 14, "middle", "700", "#fff") + "</g>")
add(text(66, 190, "вход", 15, "start", "700", "#2e9e5b"))
phone("S01", 80, 240, "Запуск", scene("#e9e9e9", "") + r(35, 60, 80, 30, "#fff", D, 6) + t(75, 80, "ROTI", 14, w="700") +
      r(40, 150, 70, 46, G, rx=6) + c(52, 200, 7, D) + c(98, 200, 7, D) + t(75, 245, "тап — начать", 11), "decided")
phone("S02", 330, 240, "Выбор героя", t(75, 40, "за кого играть", 11) + person(45, 110, 1.6, "#9fb7cf") + person(105, 110, 1.6, "#cf9fb0") +
      t(45, 190, "брат", 13, w="700") + t(105, 190, "сестра", 13, w="700") + r(20, 215, 50, 50, "none", "#2e9e5b", 8, "4 3", 2) +
      finger(45, 240), "decided", "#98",
      notes="только первый запуск;\nсмена героя — #107")
arrow([(230, 330), (330, 330)], "act", "первый\nзапуск", (280, 300), 13)
arrow([(155, 540), (155, 660), (502, 660)], "act", "не первый запуск", (320, 660))
arrow([(480, 390), (580, 390), (580, 588)], "act", "тап по герою", (580, 470))
diamond(580, 660, "час на\nтелефоне")
add(text(580, 752, "фаза дня — по часам\nигрока (решение 23.11)", 13, "middle", "normal", "#555"))

# places box
add(f'<rect x="690" y="140" width="330" height="780" rx="16" fill="#fff" stroke="#888" stroke-width="2"/>')
add(text(705, 166, "Прибытие: место = фаза дня", 16, "start", "700"))
arrow([(658, 660), (688, 660)], "auto")
def place_inner(sky, sun_y, lab, crowd):
    g = r(6, 22, 138, 150, sky, rx=6) + c(110, sun_y, 12, "#fff6c4") + t(75, 125, lab, 13, w="700", f="#fff" if sky == "#3c4a66" else D)
    g += r(35, 170, 80, 50, G, rx=6) + c(48, 224, 7, D) + c(102, 224, 7, D)
    for i in range(crowd): g += person(22 + i * 26, 236, 0.7)
    return g
pl = [("утро", 705, 215, "#dbe9f5", 70, "школа", 4, "школьники"), ("полдень", 860, 215, "#d4f0ff", 40, "пристань", 2, "рыбаки"),
      ("вечер", 705, 545, "#f6d9b8", 110, "канал", 3, "соседи"), ("ночь", 860, 545, "#3c4a66", 60, "рынок", 3, "ночной рынок")]
for ph, px, py, sky, sy, lab, n, who in pl:
    phone("", px, py, ph, place_inner(sky, sy, lab, n), "decided", w=140, h=280, tsize=15)
add(text(705, 852, "кто придёт — по месту × фазе (#63);\nчасы фаз не назначены", 13, "start", "normal", "#444"))
q(985, 860, 1)
add(text(705, 902, "утро дома (замес, #39) и глубокая ночь — ?", 13, "start", "600", "#d7263d"))

phone("S04", 1110, 300, "Тележка на месте", scene("#dbe9f5", "место по часу") + gear() + r(10, 118, 130, 50, G, rx=6) + table(176) +
      balls(232, 5) + icons_bottom() + t(75, 200, "шарики = тесто", 10), "decided",
      notes="шарики на столе — и есть\nзапас теста, без счётчика;\nтап по фону — мир\nотвечает (#103, идея)")
arrow([(1022, 450), (1104, 450)], "auto", "сама", (1063, 430), 13)
phone("S05", 1420, 300, "Гость заказывает", scene("#dbe9f5", "") + person(75, 50, 1.4) + person(124, 70, 0.9, "#c7b8d8") +
      t(124, 114, "Сом", 10, w="700") + bubble(40, 50, banana(32, 46) + egg(52, 46)) + r(10, 118, 130, 50, G, rx=6) + table(176) +
      balls(232, 4) + finger(28, 232), "decided",
      notes="заказ без слов — картинкой;\nСом рядом, смотрит\n(первый гость проверки)")
arrow([(1266, 430), (1414, 430)], "act", "тап по\nколокольчику", (1340, 400), 13)
add(text(1340, 470, "или гость\nподходит сам", 12, "middle", "normal", "#777"))
# to cooking band
arrow([(1574, 520), (1630, 520), (1630, 948), (100, 948), (100, 1210), (126, 1210)], "act", "тап по шарику теста — начать роти", (860, 948))
# side branches routes from S04
arrow([(1106, 370), (1075, 370), (1075, 175), (1735, 175), (1735, 430), (1766, 430)], "act", "тап по тетради (внизу слева)", (1460, 175))
arrow([(1106, 330), (1050, 330), (1050, 135), (2765, 135), (2765, 700), (2806, 700)], "act", "тап по шестерёнке", (2140, 135))

# notebook
phone("S20", 1770, 330, "Тетрадь", r(10, 24, 130, 256, "#fffdf6", D, 6) + ln(75, 24, 75, 280) +
      "".join(r(140, 40 + i * 40, 8, 30, ["#e2557a", "#7fb2e5", "#9ccf8f", "#f0c060"][i], rx=2) for i in range(4)) +
      roti_sq(42, 80, 34) + person(108, 72, 0.7) + r(18, 130, 48, 6) + r(18, 142, 40, 6) + r(84, 130, 48, 6) + r(84, 142, 36, 6) +
      pth("M40,240 Q75,220 110,240"), "decided",
      notes="одна книга на тележке\n(«Каталог и память»);\nлистать — мах пальцем")
arrow([(1924, 480), (1960, 480), (1960, 520), (2610, 520)], "act")
for xx in (2065, 2265, 2465): arrow([(xx, 520), (xx, 498)], "act")
add(label(2265, 553, "тап по закладке", 14))
kids = [("S21", 1990, "Следы роти", "idea", "#109", r(10, 30, 60, 76, "#fff", D, 5) + roti_sq(40, 56, 28) + r(80, 30, 60, 76, "#fff", D, 5) + roti_sq(110, 56, 28, True) +
         r(10, 116, 60, 76, "#fff", D, 5) + roti_sq(40, 142, 28, True) + r(80, 116, 60, 76, L, rx=5) + t(110, 160, "?", 20, w="700") + t(75, 230, "дневник: узнаваемое\nблюдо, не рецепт", 10)),
        ("S22", 2190, "Рецепты", "idea", "#71", r(16, 30, 118, 200, "#fffdf6", D, 6) + roti_sq(75, 70, 36) + banana(55, 125) + egg(95, 122) +
         r(30, 150, 90, 6) + r(30, 164, 70, 6) + t(75, 210, "книга Мали", 11)),
        ("S23", 2390, "Обещания", "decided", None, "".join(person(30, 34 + i * 62, 0.7) + pth(f"M50,{50+i*62} h20", mk=True) + roti_sq(98, 52 + i * 62, 22) + t(128, 56 + i * 62, "×2", 11) for i in range(3)) +
         t(75, 250, "не квесты — долги\nи договорённости", 10)),
        ("S24", 2590, "Места по часам", "idea", "#100 #63", c(75, 92, 58, "#fff", D, 2) + "".join(
            f'<path d="M75,92 L{75+58*__import__("math").cos(a)},{92+58*__import__("math").sin(a)}" stroke="{D}"/>' for a in (-1.57, 0, 1.57, 3.14)) +
         t(110, 75, "школа", 9) + t(110, 120, "пристань", 9) + t(42, 120, "канал", 9) + t(42, 75, "рынок", 9) + r(14, 170, 122, 90, "#e3eedc", rx=6) +
         c(40, 200, 6, "#d7263d") + c(100, 230, 6, G) + t(75, 280, "карта или сцены?", 10))]
for pid, kx, ttl, st, bd, inner in kids:
    phone(pid, kx, 200, ttl, inner, st, bd, w=150, h=300, tsize=15)
add(text(1990, 610, "Из любой вкладки:", 15, "start", "700", "#d9730d"))
arrow([(2140, 640), (2000, 640)], "back", None)
add(text(2155, 645, "назад → тетрадь;  ещё назад / смахнуть", 14, "start", "600", "#d9730d"))
add(text(2155, 665, "вниз → S04 (туда, откуда открыли)", 14, "start", "600", "#d9730d"))
add(text(1990, 712, "S24 «Места по часам» — только справка: место\nвсё равно выбирает час (❓1). Личный мир —\n#110, идея, экрана пока нет.", 14, "start", "normal", "#444"))
add(f'<rect x="1990" y="790" width="330" height="120" rx="12" fill="none" stroke="#6b6b6b" stroke-width="2" stroke-dasharray="10 7"/>')
add(text(2005, 815, "#109 · #71 · #100 — экраны-идеи:\nпунктир, решения ещё нет", 14, "start", "600", "#555"))
add(text(2005, 870, "обещания — в действующем\nдизайн-доке, без экрана", 13, "start", "normal", "#555"))

phone("S25", 2810, 560, "Настройки", '<rect x="0" y="0" width="150" height="300" rx="18" fill="#000" opacity="0.25"/>' +
      r(6, 110, 138, 184, "#fff", D, 12) + t(20, 140, "звук", 12, "start", "700") + r(98, 128, 36, 18, L, rx=9) + c(107, 137, 7, "#fff", D) + t(112, 160, "выкл", 9) +
      t(20, 185, "левая рука", 11, "start") + r(98, 173, 36, 18, L, rx=9) + c(107, 182, 7, "#fff", D) +
      t(20, 225, "герой", 11, "start") + person(115, 210, 0.5) + r(40, 256, 70, 24, "#fff", D, 12) + t(75, 272, "закрыть", 11, w="600"), "decided", None,
      w=150, h=300, tsize=15)
add(text(2810, 892, "звук выкл. по умолч.\n(17.11); левая рука —\n#28; герой — #107", 12, "start", "normal", "#444"))
arrow([(2962, 610), (2982, 610), (2982, 470), (2972, 470)], "back")
add(text(2790, 455, "закрыть /\nтап мимо", 13, "start", "600", "#d9730d"))
conn(2940, 470, "S04", "back")

# ---------- legend
LX, LY = 3045, 140
lg = [("act", "действие игрока — подпись: жест или тап"), ("auto", "происходит само: время, условие, переход"),
      ("back", "назад / закрыть"), ("later", "позже, в реальном времени")]
for i, (k, s) in enumerate(lg):
    yy = LY + 20 + i * 36
    arrow([(LX, yy), (LX + 70, yy)], k)
    add(text(LX + 85, yy + 5, s, 16))
yy = LY + 175
add(f'<rect x="{LX}" y="{yy}" width="50" height="34" rx="8" fill="#fff" stroke="#2f2f2f" stroke-width="3"/>' + text(LX + 65, yy + 23, "экран или состояние — решено (в доке / в решениях)", 16))
add(f'<rect x="{LX}" y="{yy+46}" width="50" height="34" rx="8" fill="#fff" stroke="#6b6b6b" stroke-width="3" stroke-dasharray="10 7"/>' + text(LX + 65, yy + 69, "только идея — номер issue на жёлтой метке", 16))
add(f'<circle cx="{LX+25}" cy="{yy+110}" r="14" fill="#2e9e5b"/>' + text(LX + 25, yy + 116, "✓", 17, "middle", "700", "#fff") + text(LX + 65, yy + 116, "уже работает на стенде", 16))
conn(LX + 25, yy + 160, "S05")
add(text(LX + 65, yy + 166, "переход к экрану с этим номером (без длинной стрелки)", 16))
add(f'<path d="M{LX+25},{yy+190} l26,22 l-26,22 l-26,-22 z" fill="#fff" stroke="#2f2f2f" stroke-width="2.5"/>' + text(LX + 65, yy + 218, "развилка по условию", 16))
q(LX + 25, yy + 262, "")
add(text(LX + 65, yy + 268, "место, где поток неясен — нужно решение", 16, "start", "700", "#d7263d"))
UQ = [("❓1  Выбирает ли игрок место?", "Час жёстко ставит место (23.11) — тогда карта S24 лишь\nсправка; или на карте выбор из открытых сейчас (#100, #63).\nИ где «утро дома» с замесом (#39) — свой экран или его нет."),
      ("❓2  Чем кончается вечер — тестом или часом?", "Игрок у канала, а часы перешли в «ночь»: сцена меняется\nсразу, после текущего роти или вечер доигрывается до S16?"),
      ("❓3  Тесто кончилось, а вход в другой час", "Новое место есть, шариков нет (восполнение — реальное\nвремя, #67): тележка закрыта, или можно смотреть, листать\nтетрадь, ловить сердечки? Что видно на S18?")]
yy2 = yy + 315
for h1, body in UQ:
    add(text(LX, yy2, h1, 17, "start", "700", "#d7263d"))
    add(text(LX, yy2 + 23, body, 14.5, "start", "normal", "#333"))
    yy2 += 23 + body.count("\n") * 17.7 + 40

# ---------- cooking band
CS = [("C1", "Шарик → диск", "стол", lambda: table(40) + c(75, 150, 30, "#efe3c8", "#b9a77f") + c(75, 150, 46, "none", "#b9a77f", 1.3, "4 3") + finger(75, 150) + t(75, 260, "прижать — плющить", 10)),
      ("C2", "Растянуть", "стол", lambda: table(40) + r(30, 100, 90, 90, "none", "#888", 14, "5 4") + r(42, 112, 66, 66, "#f3e8cf", "#b9a77f", 14) + finger(118, 150) + pth("M108,150 h22") + t(75, 260, "до квадрата (пунктир)", 10)),
      ("C3", "На таву", "стол → тава", lambda: tava(75, 90, 52) + table(170) + r(45, 185, 60, 50, "#f3e8cf", "#b9a77f", 10) + finger(75, 210) + pth("M75,200 Q60,170 72,140", sw=2)),
      ("C4", "Начинка", "тава", lambda: tava(75, 150, 62) + r(35, 110, 80, 80, "#f3e8cf", "#b9a77f", 10) + banana(60, 140) + banana(88, 160) + egg(76, 128) + finger(98, 236) + pth("M98,226 L90,180") + r(20, 246, 30, 18, "#fff6c4", D) + r(60, 246, 30, 18, "#fff", D) + t(75, 280, "миски — у пальца", 10)),
      ("C5", "Конверт", "тава", lambda: tava(75, 150, 62) + r(40, 120, 70, 60, "#ecd9a8", "#a27b2c", 6) + ln(40, 150, 110, 150, "#a27b2c", 1.2, "4 3") + finger(120, 150) + pth("M118,150 h-22") + t(75, 255, "×2 прямоуг.\n×4 квадрат", 10)),
      ("C6", "Жарить, перевернуть", "тава", lambda: tava(75, 150, 62) + roti_sq(75, 150, 56) + pth("M60,200 Q75,250 115,210", sw=2.2) + finger(60, 200) + r(25, 32, 100, 8, L, rx=4) + r(25, 32, 60, 8, "#e0a030", rx=4) + t(75, 262, "3 ступени · 3 мин", 10)),
      ("C7", "Снять на стол", "тава → стол", lambda: tava(75, 70, 44) + table(150) + roti_sq(75, 205, 54) + finger(75, 205) + pth("M75,120 L75,170", dash="4 3")),
      ("C8", "Нарезать", "стол", lambda: table(40) + roti_sq(75, 140, 84, True) + finger(118, 110) + pth("M120,100 L40,180", dash="5 4", s="#d7263d") + t(75, 250, "куски разводятся", 10)),
      ("C9", "Полить", "стол", lambda: table(40) + roti_sq(75, 140, 84, True) + f'<path d="M40,120 q10,-14 20,0 t20,0 t20,0 t20,0" stroke="#f5f0e0" stroke-width="5" fill="none"/>' + f'<path d="M40,120 q10,-14 20,0 t20,0 t20,0 t20,0" stroke="#b9a77f" stroke-width="1" fill="none"/>' + finger(118, 120) + t(75, 250, "сгущёнка", 10))]
GEST = ["прижать пальцем\n— плющить", "шлепок / тяга\nот края", "взять за\nсередину — нести", "пальцем — банан,\nяйцо на лист", "штрих к середине\n— сложить", "мах наружу —\nперевернуть", "в руке —\nснять на стол", "провести —\nрезы 3×3"]
for i, (pid, ttl, cam, fn) in enumerate(CS):
    x = 130 + i * 420
    phone(pid, x, 1065, ttl, fn(), "done", notes=f"камера: {cam}", tsize=16)
    if i < 8:
        arrow([(x + 158, 1210), (x + 414, 1210)], "act", GEST[i], (x + 286, 1180), 14)
add(text(3720, 1085, "Внутри сцены, всегда:", 15, "start", "700"))
add(text(3720, 1110, "«отменить» — шаг назад\n«заново» — новый шарик\nфон тава/стол не меняется,\nкамера едет сама\n\nдва пальца:\n— развести куски (C8)\n— повернуть роти\n\nпервое роти — обучение\nповтором (#93, идея)\nфигура в кусках — #105", 14, "start", "normal", "#333"))
add(text(130, 1480, "C1–C9: шаги 1–7 канона («Готовка: семь шагов»); всё уже на стенде (сборки до 102), жесты — решение 17.11. Перед C1 гость из S05 остаётся вверху кадра и смотрит.", 15, "start", "normal", "#555"))
# exit band
arrow([(3640, 1210), (3700, 1210), (3700, 1538), (60, 1538), (60, 1760), (126, 1760)], "act", "вести пальцем — полить, потом подвинуть роти к гостю", (1900, 1538))

# ---------- row D
RY = 1640
phone("S10", 130, RY, "Подать", scene("#dbe9f5", "") + person(75, 46, 1.4) + table(130) + r(35, 170, 80, 50, "#fff", D, 25) + roti_sq(75, 195, 36, True) + finger(75, 240) + pth("M75,232 L75,140", sw=2.2) + t(75, 280, "смахнуть вверх", 10), "idea", "#53",
      notes="«подать» снят со стенда\n20.09; финал роти — #53")
phone("S11", 550, RY, "Ответ гостя", scene("#dbe9f5", "") + person(75, 46, 1.4) + c(70, 44, 2, D) + c(80, 44, 2, D) + pth("M68,52 Q75,57 82,52", mk=False) +
      table(130) + r(50, 160, 50, 40, "#cfe3c4", D, 6) + t(75, 185, "дар", 11, w="700") + finger(75, 230) + t(75, 270, "тап — принять", 10), "decided",
      notes="без слов, мимикой; платит не\nденьгами: еда, слух, предмет")
phone("S12", 970, RY, "Показать миру?", '<rect x="0" y="0" width="150" height="300" rx="18" fill="#000" opacity="0.25"/>' + r(10, 60, 130, 200, "#fff", D, 14) +
      roti_sq(75, 118, 56, True) + c(45, 215, 22, "#e3f0ff", D) + t(45, 220, "🌏", 16) + c(105, 215, 22, "#fff", D) + t(105, 220, "✕", 15) + finger(45, 238), "decided", "#108",
      notes="решение 23.11: можно показать\nсвоё роти игрокам; не обязательно")
arrow([(288, 1790), (544, 1790)], "act", "смахнуть\nк гостю", (416, 1760))
arrow([(708, 1790), (964, 1790)], "act", "тап по дару", (836, 1770))
phone("S13", 1390, RY, "Карточка роти", card(20, 60) + t(75, 240, "что, кому, погода,\nместо", 10), "idea", "#109",
      notes="след блюда → тетрадь S21\n(«Карточка следа — черновик»)")
arrow([(1128, 1745), (1384, 1745)], "act", "тап 🌏 — показать", (1256, 1726))
arrow([(1128, 1840), (1384, 1840)], "act", "тап ✕ — оставить себе", (1256, 1868), 13)
diamond(1880, 1790, "шарики\nостались?", w=88, h=66)
arrow([(1546, 1790), (1790, 1790)], "act", "закрыть\nкарточку", (1668, 1760))
arrow([(1880, 1722), (1880, 1660)], "auto", None)
conn(1880, 1632, "S05", "auto")
add(text(1918, 1640, "да — следующий гость", 15, "start", "700", "#7a7a7a"))
q(1980, 1872, 2)
phone("S15", 2230, RY, "Тесто кончилось", scene("#f6d9b8", "") + table(130) + c(75, 200, 34, "#fff", D) + c(75, 200, 22, "none", D) + ln(75, 200, 75, 186) + ln(75, 200, 86, 205) + t(75, 262, "шариков нет", 11) + icons_bottom(), "decided", "#67",
      notes="предел дня — тесто; новое\nотдыхает реальное время;\nкакие часы — #67")
arrow([(1970, 1790), (2224, 1790)], "auto", "нет — пусто\nна столе", (2097, 1760))
q(2420, 1700, 3)
phone("S16", 2650, RY, "Итог вечера", scene("#f6d9b8", "") + "".join(person(28 + i * 32, 140, 0.6) for i in range(4)) +
      "".join(r(14 + i * 32, 185, 26, 20, "#cfe3c4", D, 4) for i in range(4)) + t(75, 230, "кто был · что принесли\n· что на завтра", 10) + r(40, 262, 70, 22, "#fff", D, 11) + t(75, 277, "ок", 11), "decided",
      notes="«Закрытие» из дизайн-дока;\nкогда показывать — ❓2")
arrow([(2388, 1790), (2644, 1790)], "auto", "сама,\nчерез миг", (2516, 1760))
phone("S17", 3070, RY, "Тележка закрыта", scene("#3c4a66", "") + r(35, 120, 80, 60, G, rx=6) + "".join(ln(35, 126 + i * 10, 115, 126 + i * 10, "#fff") for i in range(6)) +
      t(75, 225, "можно выйти\nили листать тетрадь", 10) + icons_bottom(), "decided",
      notes="игра не просит ждать;\nтетрадь открыта")
arrow([(2808, 1790), (3064, 1790)], "act", "тап «ок»", (2936, 1770))
arrow([(3224, 1790), (3300, 1790), (3300, 1700)], "act")
conn(3300, 1672, "S20")
add(text(3340, 1680, "тап по тетради", 15, "start", "700"))
# row E
phone("S14", 1390, 2200, "Сердечки", card(20, 50) + hearts(42, 214, 4) + t(75, 250, "просто тепло,\nничего не открывают", 10), "decided", "#108",
      notes="ни валюты, ни рейтинга (23.11);\nсервер, модерация — #108")
arrow([(1465, 2016), (1465, 2156)], "later", "позже: люди\nсмотрят", (1550, 2080), 13)
phone("S18", 3070, 2200, "Вход в другой час", scene("#d4f0ff", "новое место") + r(35, 120, 80, 50, G, rx=6) + table(176) + 
      hearts(98, 140, 2) + c(40, 232, 8, "none", "#b9a77f", 1.5, "3 2") + c(62, 232, 8, "none", "#b9a77f", 1.5, "3 2") + t(92, 237, "? ❓3", 11, "start", "700", "#d7263d") + icons_bottom(), "decided",
      notes="та же точка входа S01;\nместо — по новому часу")
arrow([(3145, 1996), (3145, 2156)], "later", "выйти; вернуться\nчерез часы", (3145, 2080), 14)
arrow([(3224, 2340), (3360, 2340), (3360, 2180)], "auto")
conn(3360, 2152, "S01", "auto")
add(text(3400, 2160, "место по новому часу,\nдальше как S04", 15, "start", "600", "#555"))
arrow([(3064, 2360), (1546, 2360)], "auto", "сердечки пришли — видны на карточке и в тетради", (2300, 2360))
add(text(130, 2230, "Поток вечера:\nS04 → гость S05 → готовка C1–C9\n→ подача S10 → ответ S11 → показ S12\n→ карточка S13 → снова гость, пока\nесть шарики → S15 → итог S16 → S17.\n\nВозврат в любой час — S18 → S01;\nпервый запуск — только раз.", 18, "start", "normal", "#333"))

svg = (f'<svg id="b" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" font-family="-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif">'
       '<defs>'
       '<marker id="a-act" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#1d1d1f"/></marker>'
       '<marker id="a-auto" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#7a7a7a"/></marker>'
       '<marker id="a-back" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#d9730d"/></marker>'
       '<marker id="tiny" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#555"/></marker>'
       '</defs>'
       f'<rect width="{W}" height="{H}" fill="#fff"/>' + "".join(out) + "</svg>")

page = """<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<title>Roti Stand — карта экранов (K)</title>
<style>html,body{margin:0;height:100%;overflow:hidden;background:#e9e9ec;font-family:-apple-system,Helvetica,Arial,sans-serif}
#v{position:fixed;inset:0;touch-action:none;cursor:grab}#v svg{width:100%;height:100%;display:block}
#z{position:fixed;right:max(14px,env(safe-area-inset-right));bottom:max(14px,env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:10px}
#z button{width:52px;height:52px;border-radius:26px;border:1px solid #999;background:#fff;font-size:24px;box-shadow:0 2px 6px #0003}
#h{position:fixed;left:12px;bottom:max(12px,env(safe-area-inset-bottom));font-size:13px;color:#444;background:#fffd;padding:6px 10px;border-radius:8px;max-width:calc(100% - 110px);box-sizing:border-box}
.png #z,.png #h{display:none}</style></head><body><div id="v">SVG</div>
<div id="z"><button id="zi" aria-label="ближе">+</button><button id="zo" aria-label="дальше">−</button><button id="zf" aria-label="вся доска">⤢</button></div>
<div id="h">двумя пальцами — ближе/дальше, одним — двигать; двойной тап — ближе</div>
<script>
const W=WW,H=HH,s=document.getElementById('b'),v=document.getElementById('v');let b={x:0,y:0,w:W,h:H};
if(location.search.includes('png'))document.body.classList.add('png');
function ap(){s.setAttribute('viewBox',b.x+' '+b.y+' '+b.w+' '+b.h)}
function fit(){const cw=v.clientWidth,ch=v.clientHeight,m=20;let w=W+2*m,h=w*ch/cw;if(h<H+2*m){h=H+2*m;w=h*cw/ch}b={x:W/2-w/2,y:H/2-h/2,w,h};ap()}
function k(){return b.w/v.clientWidth}
function zoom(f,cx,cy){const nw=Math.min(Math.max(b.w*f,300),W*3);const r=nw/b.w,px=b.x+cx*k(),py=b.y+cy*k();b.w=nw;b.h=b.h*r;b.x=px-(px-b.x)*r;b.y=py-(py-b.y)*r;ap()}
const P=new Map();let last=null,lastTap=0;
v.addEventListener('pointerdown',e=>{h.style.display='none';try{v.setPointerCapture(e.pointerId)}catch(_){}P.set(e.pointerId,{x:e.clientX,y:e.clientY});last=null;
 const n=Date.now();if(P.size==1&&n-lastTap<300)zoom(0.5,e.clientX,e.clientY);lastTap=n});
v.addEventListener('pointermove',e=>{if(!P.has(e.pointerId))return;const o=P.get(e.pointerId);
 if(P.size==1){b.x-=(e.clientX-o.x)*k();b.y-=(e.clientY-o.y)*k();ap();P.set(e.pointerId,{x:e.clientX,y:e.clientY});return}
 P.set(e.pointerId,{x:e.clientX,y:e.clientY});const [a,c]=[...P.values()];const d=Math.hypot(a.x-c.x,a.y-c.y),mx=(a.x+c.x)/2,my=(a.y+c.y)/2;
 if(last){zoom(last.d/d,mx,my);b.x-=(mx-last.mx)*k();b.y-=(my-last.my)*k();ap()}last={d,mx,my}});
function up(e){P.delete(e.pointerId);last=null}
v.addEventListener('pointerup',up);v.addEventListener('pointercancel',up);
v.addEventListener('wheel',e=>{e.preventDefault();zoom(Math.exp(e.deltaY*(e.ctrlKey?0.01:0.0015)),e.clientX,e.clientY)},{passive:false});
document.addEventListener('gesturestart',e=>e.preventDefault());
zi.onclick=()=>zoom(0.6,v.clientWidth/2,v.clientHeight/2);zo.onclick=()=>zoom(1.6,v.clientWidth/2,v.clientHeight/2);zf.onclick=fit;
addEventListener('resize',fit);fit();
</script></body></html>"""
page = page.replace("WW", str(W)).replace("HH", str(H)).replace(">SVG<", ">"+svg+"<", 1)
p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "index.html")
open(p, "w", encoding="utf-8").write(page)
print(p, len(page.encode()))
