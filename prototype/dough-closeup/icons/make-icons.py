#!/usr/bin/env python3
"""Icons for the home screen (v0 step 1): a plain roti on the tava, flat shapes in the stand palette.
   /usr/bin/python3 prototype/dough-closeup/icons/make-icons.py   (needs Pillow)"""
import os
from PIL import Image, ImageDraw
HERE = os.path.dirname(os.path.abspath(__file__))
def icon(n, ss=4):
    s = n * ss
    im = Image.new("RGB", (s, s), "#2b2016")            # table
    d = ImageDraw.Draw(im)
    def disc(r, fill, cx=0.5, cy=0.5):
        d.ellipse([s*(cx-r), s*(cy-r), s*(cx+r), s*(cy+r)], fill=fill)
    disc(0.40, "#2a2622"); disc(0.37, "#4b4338")        # tava: rim and plate (inside the maskable safe zone)
    disc(0.29, "#e0b866")                               # roti
    for cx, cy, r in [(0.42, 0.40, 0.045), (0.60, 0.46, 0.035), (0.47, 0.60, 0.05), (0.62, 0.63, 0.028), (0.36, 0.54, 0.025)]:
        disc(r, "#b9823a", cx, cy)                      # toasted spots
    return im.resize((n, n), Image.LANCZOS)
for n in (180, 192, 512):
    icon(n).save(os.path.join(HERE, f"icon-{n}.png"), optimize=True)
    print("icon", n)
