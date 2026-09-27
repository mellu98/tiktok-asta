#!/usr/bin/env python3
"""Genera l'icona sorgente 1024x1024 dell'app (scripts/app-icon.png).

Design: squircle scuro (stile macOS), schermo di un device con riflesso
ciano e pallino di stato verde. Serve Pillow: `pip3 install pillow`.
"""

from PIL import Image, ImageDraw

SIZE = 1024
CANVAS = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(CANVAS)

# Squircle di sfondo (stile macOS: ~80% dell'area, centrato)
BG = "#0b0f14"
MARGIN = 100
BOX = (MARGIN, MARGIN, SIZE - MARGIN, SIZE - MARGIN)
draw.rounded_rectangle(BOX, radius=180, fill=BG)
# sottile bordo
draw.rounded_rectangle(BOX, radius=180, outline="#1e2836", width=8)

# Device (rettangolo con angoli arrotondati) centrato
phone_w, phone_h = 420, 640
px0 = (SIZE - phone_w) // 2
py0 = (SIZE - phone_h) // 2
phone = (px0, py0, px0 + phone_w, py0 + phone_h)
draw.rounded_rectangle(phone, radius=56, fill="#121821", outline="#22d3ee", width=10)

# Notch / speaker
draw.rounded_rectangle(
    (px0 + phone_w // 2 - 60, py0 + 34, px0 + phone_w // 2 + 60, py0 + 52),
    radius=9,
    fill="#2c3d52",
)

# Schermo (riflesso ciano in diagonale)
screen = (px0 + 34, py0 + 92, px0 + phone_w - 34, py0 + phone_h - 120)
draw.rounded_rectangle(screen, radius=20, fill="#0c3a44")
# trapezio di luce ciano
light = [
    (screen[0] + 30, screen[3] - 30),
    (screen[2] - 20, screen[1] + 20),
    (screen[2] - 20, screen[1] + 150),
    (screen[0] + 30, screen[3] - 30),
]
draw.polygon(light, fill="#155e75")
draw.rounded_rectangle(screen, radius=20, outline="#22d3ee", width=6)

# Pallino di stato ONLINE
dot_r = 34
dot_cx = px0 + phone_w // 2
dot_cy = py0 + phone_h - 62
draw.ellipse(
    (dot_cx - dot_r, dot_cy - dot_r, dot_cx + dot_r, dot_cy + dot_r),
    fill="#34d399",
)

CANVAS.save("scripts/app-icon.png")
print("scripts/app-icon.png generata")
