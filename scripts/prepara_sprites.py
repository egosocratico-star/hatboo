"""Empaqueta los sprites nuevos de Hatboo para la app.

Cada PNG de entrada viene suelto, recortado contra un lienzo grande y con
adornos sueltos (destellos, «!», líneas de velocidad). Si se reducen tal cual,
el cuerpo sale a tamaños distintos según la pose y los adornos descentran al
fantasma. Lo que hace este script:

  1. aísla el bloque mayor de píxeles opacos = el cuerpo;
  2. rellena el RGB de lo transparente con el color medio del cuerpo, para que
     al reducir no aparezca un borde negro (un PNG con alpha=0 trae RGB basura);
  3. escala para que el cuerpo mida siempre 200 px y lo centra en un lienzo
     cuadrado de 256, de modo que las nueve poses se ven idénticas de tamaño.

Escribe en _sprites_nuevas/ y no toca el repositorio. Las dos rutas de abajo son
locales: se ajustan y se vuelve a correr cuando lleguen más poses sueltas.
"""

import os
from collections import deque
from statistics import median

from PIL import Image

SRC = r"C:\Users\User\Downloads\ghost_sprites\ghost_sprites"
OUT = r"C:\Users\User\Documents\Qoder\2026-09-19\a1ea06ec\_sprites_nuevas"

# nombre en la app  <-  archivo nuevo
MAP = {
    "idle.png": "10_happy_alt.png",
    "coding.png": "13_coding_alt.png",
    "run.png": "17_run_alt.png",
    "sleeping.png": "15_sleeping_alt.png",
    "walk.png": "11_sunglasses.png",
    "confused.png": "16_confused_alt.png",
    "happy.png": "12_happy_sparkle.png",
    "surprised.png": "14_surprised_alt.png",
}

CUADRADO = 256
CUERPO = 200
UMBRAL = 8
PASO = 4  # resolución de la máscara al buscar el bloque mayor
MARGEN = 4

# El único adorno despegado del cuerpo: la chispa de las gafas de sol, separada
# por 290 px de aire. Dejarla dentro obligaría a centrar el lienzo en ella y el
# fantasma saldría descentrado en todas las poses, así que se corta antes.
RECORTES = {"11_sunglasses.png": (0, 0, 800, None)}


def bbox(mask):
    return mask.getbbox()


def bloque_mayor(alpha, w, h):
    """Caja del conjunto de píxeles opacos más grande, en coordenadas reales."""
    mw, mh = w // PASO + 1, h // PASO + 1
    rejilla = [[False] * mw for _ in range(mh)]
    for y in range(mh):
        for x in range(mw):
            if alpha.getpixel((min(x * PASO, w - 1), min(y * PASO, h - 1))) > UMBRAL:
                rejilla[y][x] = True
    mejor = None
    visto = [[False] * mw for _ in range(mh)]
    for iy in range(mh):
        for ix in range(mw):
            if not rejilla[iy][ix] or visto[iy][ix]:
                continue
            cola = deque([(ix, iy)])
            visto[iy][ix] = True
            celdas = []
            while cola:
                cx, cy = cola.popleft()
                celdas.append((cx, cy))
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = cx + dx, cy + dy
                    if 0 <= nx < mw and 0 <= ny < mh and rejilla[ny][nx] and not visto[ny][nx]:
                        visto[ny][nx] = True
                        cola.append((nx, ny))
            if mejor is None or len(celdas) > len(mejor):
                mejor = celdas
    xs = [c[0] for c in mejor]
    ys = [c[1] for c in mejor]
    return (max(min(xs) * PASO - PASO, 0), max(min(ys) * PASO - PASO, 0),
            min(max(xs) * PASO + PASO * 2, w), min(max(ys) * PASO + PASO * 2, h))


def procesar(destino, origen):
    im = Image.open(origen).convert("RGBA")
    recorte = RECORTES.get(os.path.basename(origen))
    if recorte:
        x0, y0, x1, y1 = recorte
        im = im.crop((x0, y0, x1 if x1 is not None else im.size[0],
                      y1 if y1 is not None else im.size[1]))
    w, h = im.size
    alpha = im.split()[3]
    total = bbox(alpha)
    cuerpo = bloque_mayor(alpha, w, h)

    rgb = im.split()[:3]
    opacos = [im.getpixel((x, y)) for y in range(0, h, 7) for x in range(0, w, 7)
              if alpha.getpixel((x, y)) > 200]
    relleno = tuple(int(median(c[i] for c in opacos)) for i in range(3))
    solido = alpha.point(lambda v: 255 if v > UMBRAL else 0)
    fondo = Image.new("RGB", im.size, relleno)
    rgb_final = Image.merge("RGB", tuple(
        Image.composite(rgb[i], fondo.split()[i], solido) for i in range(3)))
    rellena = Image.merge("RGBA", (*rgb_final.split(), alpha))

    recortado = rellena.crop(total)
    alto_cuerpo = cuerpo[3] - cuerpo[1]
    escala = CUERPO / alto_cuerpo
    # si los adornos se salieran del lienzo, se reduce un poco más
    utile = CUADRADO - 2 * MARGEN
    cabe = min(utile / (recortado.size[0] * escala),
               utile / (recortado.size[1] * escala), 1.0)
    escala *= cabe
    nuevo = recortado.resize((max(1, round(recortado.size[0] * escala)),
                              max(1, round(recortado.size[1] * escala))), Image.LANCZOS)

    cx = ((cuerpo[0] + cuerpo[2]) / 2 - total[0]) * escala
    cy = ((cuerpo[1] + cuerpo[3]) / 2 - total[1]) * escala
    lienzo = Image.new("RGBA", (CUADRADO, CUADRADO), (0, 0, 0, 0))
    # El cuerpo va al centro; si un adorno se sale, se desplace el conjunto lo
    # justo para que entre (nunca más de lo que ocupa el propio margen).
    px = min(max(round(CUADRADO / 2 - cx), MARGEN), CUADRADO - MARGEN - nuevo.size[0])
    py = min(max(round(CUADRADO / 2 - cy), MARGEN), CUADRADO - MARGEN - nuevo.size[1])
    lienzo.paste(nuevo, (px, py), nuevo)
    ruta = os.path.join(OUT, destino)
    lienzo.save(ruta, optimize=True)
    # centro del cuerpo dentro del lienzo (debe salir ~128,128) y su altura
    print(f"{destino:<14} <- {os.path.basename(origen):<20} cuerpo {alto_cuerpo*escala:.0f}px "
          f"en ({px + cx:.0f},{py + cy:.0f})  bulto {nuevo.size[0]}x{nuevo.size[1]}  "
          f"{os.path.getsize(ruta) / 1024:.1f} kB")


os.makedirs(OUT, exist_ok=True)
for destino, origen in MAP.items():
    procesar(destino, os.path.join(SRC, origen))
