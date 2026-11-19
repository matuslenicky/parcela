# Kempingové vybavenie v Blenderi: stany (kupolové, tunelové, samorozkladacie), altánok, markíza, stôl so stoličkami.
#   blender -b --factory-startup -P kempy/models/gear.py -- <spec.json> <out dir> [--only id,id]
# spec.json (mm): {"id", "cat": tent23|tentfam|gazebo|awning|tableset, "L", "W", "H", "shape": dome|tunnel|popup, "parts": {…}}
# Výstup: <out>/<id>.glb v metroch, dlhší rozmer v smere X, stred pôdorysu v počiatku, na zemi (z = 0). Pôdorys a výška podľa výrobcu.
import bpy, json, math, os, sys
from mathutils import Vector, Matrix
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shell import *

FABRICS = ['#5f8a57', '#3f7fa6', '#d9822b', '#8e9aa0', '#b5463a', '#cbb98f']
def fabric(hexc): return M('latka ' + hexc, hexc, rough=.82).name
def shade_hex(hexc, k): h = hexc.lstrip('#'); return '#%02x%02x%02x' % tuple(min(255, int(int(h[i:i + 2], 16) * k)) for i in (0, 2, 4))
def pw(v, e): return math.copysign(abs(v) ** (2 / e), v)

def surface(D, fn, nu, nv, mat_fn):
    """Plocha z mriežky bodov fn(u, v), u a v od 0 po 1."""
    nu = max(4, int(nu * max(.6, SET['q']))); nv = max(4, int(nv * max(.6, SET['q'])))
    rows = [[D.bm.verts.new(fn(i / nu, j / nv)) for j in range(nv + 1)] for i in range(nu + 1)]
    for i in range(nu):
        for j in range(nv):
            try: f = D.bm.faces.new((rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j])); f.material_index = D.mi(mat_fn((i + .5) / nu, (j + .5) / nv)); f.smooth = True
            except ValueError: pass

def tube(D, pts, r, mat):
    D.sweep([Vector(p) for p in pts], [(-r, -r), (-r, r), (r, r), (r, -r)], mat, cap=False)

def dome(D, c, col):
    """Kupolový alebo samorozkladací stan: vrchol nad spálňou, predsienka vpredu (+X) ako dlhší sklon."""
    L, W, H = c['L'] / 1000, c['W'] / 1000, c['H'] / 1000 - .036; p = c.get('parts', {})   # tyče idú nad plátnom, výška s nimi sedí
    x0 = -(L - (p.get('innerL') or c['L'] * .8) / 1000) / 2 if c.get('shape') != 'popup' else -L * .08
    e = 2.3 if c.get('shape') == 'popup' else 2.7; main, dark, door = fabric(col), fabric(shade_hex(col, .7)), fabric(shade_hex(col, 1.25))
    def pt(u, v):                                           # u: 0 vrchol … 1 zem, v: okolo
        th = 2 * math.pi * v; t = u * math.pi / 2; ct, st_ = math.cos(th), math.sin(th)
        ax = (L / 2 - x0) if ct > 0 else (L / 2 + x0); f = math.sin(t) ** .85
        return (x0 + ax * pw(ct, e) * f, W / 2 * pw(st_, e) * f, H * math.cos(t) ** .9)
    def mat(u, v):
        if u > .86: return dark
        a = min(v, 1 - v)                                   # uhol od predku
        return door if a < .075 and u > .3 else main
    surface(D, pt, 9, 28, mat)
    for a in (.125, .375):                                  # dve krížené tyče
        tube(D, [Vector(pt(abs(k), a if k < 0 else a + .5)) * 1.012 + Vector((0, 0, .012)) for k in [i / 8 for i in range(-8, 9)]], .009, 'ram')

def tunnel(D, c, col):
    """Tunelový rodinný stan: obývacia časť vpredu (+X), spálne vzadu, oblúky z tyčí."""
    L, W, H = c['L'] / 1000, c['W'] / 1000, c['H'] / 1000; n = (c.get('parts', {}).get('poles') or 3)
    main, dark, win = fabric(col), fabric(shade_hex(col, .7)), 'sklo svetle'
    hx = lambda x: H * sup((x + L / 2) / (L * .22), 2.0) * sup((L / 2 - x) / (L * .10), 2.4)
    wx = lambda x: W / 2 * sup((x + L / 2) / (L * .16), 2.6) * sup((L / 2 - x) / (L * .08), 2.8)
    hoops = [lerp(-L / 2 + L * .2, L / 2 - L * .1, k / (n - 1)) for k in range(n)]
    def pt(u, v):
        x = lerp(-L / 2, L / 2, u); ph = math.pi * v
        return (x, wx(x) * pw(math.cos(ph), 2.6), hx(x) * abs(math.sin(ph)) ** (2 / 2.4))
    def mat(u, v):
        x = lerp(-L / 2, L / 2, u); side = min(v, 1 - v)
        if side < .07: return dark
        if any(abs(x - h) < .05 for h in hoops): return dark
        if u > .58 and u < .86 and .14 < side < .30: return win
        if u > .93 and .32 < v < .68: return dark            # vchod
        return main
    surface(D, pt, 44, 16, mat)

def gazebo(D, c, col):
    L, W, H = c['L'] / 1000, c['W'] / 1000, c['H'] / 1000; hs = (c.get('parts', {}).get('headroomSides') or c['H'] * .82) / 1000
    main = fabric(col); a, b = L / 2, W / 2
    def pt(u, v):
        x, y = lerp(-a, a, u), lerp(-b, b, v); d = max(abs(x) / a, abs(y) / b)
        return (x, y, hs + (H - hs) * (1 - d) ** .75)
    surface(D, pt, 10, 10, lambda u, v: main)
    for s1, s2, ax in ((-1, 1, 'x'), (1, -1, 'x'), (-1, 1, 'y'), (1, -1, 'y')):                     # lem okolo strechy
        p0, p1 = ((-a, s1 * b), (a, s1 * b)) if ax == 'x' else ((s1 * a, -b), (s1 * a, b))
        v = [D.bm.verts.new((p0[0], p0[1], hs)), D.bm.verts.new((p1[0], p1[1], hs)), D.bm.verts.new((p1[0], p1[1], hs - .2)), D.bm.verts.new((p0[0], p0[1], hs - .2))]
        f = D.bm.faces.new(v); f.material_index = D.mi(main)
    for sx in (-1, 1):
        for sy in (-1, 1): D.box((sx * (a - .03), sy * (b - .03), hs / 2), (.035, .035, hs), 'hlinik')

def tableset(D, c, col):
    p = c['parts']; tl, tw_, th = p['tableL'] / 1000, p['tableW'] / 1000, p['tableH'] / 1000; n = p.get('chairs', 4); seat = fabric(col)
    D.box((0, 0, th - .015), (tl, tw_, .03), 'plast biely', bevel=.008)
    for sx in (-1, 1):
        for sy in (-1, 1): D.box((sx * (tl / 2 - .06), sy * (tw_ / 2 - .06), (th - .03) / 2), (.025, .025, th - .03), 'hlinik')
    per = n // 2; cw = .52
    for sy in (-1, 1):
        for k in range(per):
            x = (k - (per - 1) / 2) * (tl / per if per > 1 else 0); y = sy * (tw_ / 2 + .27)
            D.box((x, y, .42), (cw, .46, .035), seat, bevel=.01)
            D.box((x, y + sy * .235, .615), (cw, .035, .40), seat, rot=Matrix.Rotation(sy * -.12, 4, 'X'), bevel=.01)
            for dx in (-1, 1):
                for dy in (-1, 1): D.box((x + dx * (cw / 2 - .02), y + dy * .2, .21), (.022, .022, .42), 'hlinik')
                D.box((x + dx * (cw / 2 - .01), y, .60), (.03, .44, .03), 'hlinik')

def awning(D, c, col, zwall=2.35, y0=0.0, kit=True):
    """Vysunutá markíza: stena vozidla je v rovine y = y0, plátno ide do −Y. zwall = výška kazety na stene."""
    p = c['parts']; ln = p['canopyLength'] / 1000; ext = p['extension'] / 1000; cl = p['caseLength'] / 1000; zf = zwall - .38; main = fabric(col)
    if kit: D.box((0, y0 - .045, zwall), (cl, .09, .12), 'hlinik', bevel=.02)
    def pt(u, v):
        return (lerp(-ln / 2, ln / 2, u), y0 - .06 - (ext - .06) * v, lerp(zwall - .03, zf, v) - .035 * math.sin(math.pi * v) * (1 - .6 * abs(2 * u - 1)))
    surface(D, pt, 8, 6, lambda u, v: main)
    D.box((0, y0 - ext, zf), (cl, .05, .06), 'hlinik', bevel=.012)
    for s in (-1, 1):
        x = s * (cl / 2 - .1)
        D.box((x, y0 - ext + .01, zf / 2), (.035, .035, zf), 'hlinik')
        tube(D, [(x, y0 - .05, zwall - .45), (x, y0 - ext + .02, zf - .02)], .014, 'hlinik')

BUILD = {'tent23': dome, 'tentfam': tunnel, 'gazebo': gazebo, 'tableset': tableset, 'awning': awning}

def build(c, color=None, name=None, **kw):
    D = Detail(None); col = color or c.get('color') or FABRICS[sum(map(ord, c['id'])) % len(FABRICS)]
    fn = dome if c.get('shape') in ('dome', 'popup') else BUILD[c['cat']]
    fn(D, c, col, **kw)
    ob = D.finish(name or c['id']); shade(ob.data, 50)
    return ob

if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:]
    SPEC = json.load(open(argv[0], encoding='utf-8')); OUT = os.path.abspath(argv[1]); os.makedirs(OUT, exist_ok=True)
    ONLY = argv[argv.index('--only') + 1].split(',') if '--only' in argv else None
    SPEC = SPEC if isinstance(SPEC, list) else list(SPEC.values())
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for c in SPEC:
        if (ONLY and c['id'] not in ONLY) or (c['cat'] not in BUILD): continue
        ob = build(c)
        bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True)
        bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, c['id'] + '.glb'), export_format='GLB', use_selection=True, export_apply=True)
        bb = [Vector(co) for co in ob.bound_box]
        print('MODEL %s  %.3f x %.3f x %.3f m  (zadané %s x %s x %s)' % (c['id'], max(v.x for v in bb) - min(v.x for v in bb), max(v.y for v in bb) - min(v.y for v in bb), max(v.z for v in bb), c['L'], c['W'], c['H']))
        ob.location.y += 100
    print('DONE')
