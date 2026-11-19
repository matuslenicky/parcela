# Kempingové vybavenie v Blenderi: stany, strešné stany, altánok, markíza, predstan, plachta, stôl so stoličkami, grily, bicykle, bazén, ležadlá, hojdacia sieť.
#   blender -b --factory-startup -P kempy/models/gear.py -- <spec.json> <out dir> [--only id,id]
# spec.json (mm): {"id", "cat": tent23|tentfam|rooftent|gazebo|awning|awningtent|tarp|tableset|grill|bike|pool|relax, "L", "W", "H", "shape", "parts": {…}}
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

# ---------------------------------------------------------------- pomocná geometria pre drobné vybavenie
def matn(name, hexc, rough=.6, metal=0.0, coat=0.0): return M(name, hexc, rough=rough, metal=metal, coat=coat).name

def rod(D, a, b, r, mat, n=6):
    """Rovná tyč medzi dvoma bodmi (aj zvislá)."""
    a, b = Vector(a), Vector(b); t = b - a
    if t.length < 1e-6: return
    t.normalize(); u = t.cross(Vector((0, 0, 1)))
    if u.length < 1e-3: u = t.cross(Vector((1, 0, 0)))
    u.normalize(); v = t.cross(u); m = D.mi(mat)
    ring_ = lambda p: [D.bm.verts.new(p + (u * math.cos(2 * math.pi * k / n) + v * math.sin(2 * math.pi * k / n)) * r) for k in range(n)]
    ra, rb = ring_(a), ring_(b)
    for k in range(n):
        f = D.bm.faces.new((ra[k], ra[(k + 1) % n], rb[(k + 1) % n], rb[k])); f.material_index = m; f.smooth = True
    for rr in (ra[::-1], rb):
        f = D.bm.faces.new(rr); f.material_index = m

def path(D, pts, r, mat, n=6):
    for a, b in zip(pts, pts[1:]): rod(D, a, b, r, mat, n)

def cyl(D, c, r, depth, mat, axis='z', r2=None, seg=18):
    rot = {'z': Matrix.Identity(4), 'y': Matrix.Rotation(math.pi / 2, 4, 'X'), 'x': Matrix.Rotation(math.pi / 2, 4, 'Y')}[axis]
    g = bmesh.ops.create_cone(D.bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=depth, matrix=Matrix.Translation(c) @ rot)
    m = D.mi(mat)
    for f in {f for v in g['verts'] for f in v.link_faces}: f.material_index = m; f.smooth = len(f.verts) == 4

def lathe(D, prof, mat, c=(0, 0, 0), seg=28):
    """Profil [(polomer, z)] otočený okolo zvislej osi; mat = názov alebo funkcia(i) pre pás medzi bodmi i a i + 1."""
    rows = [[D.bm.verts.new((c[0] + max(r, .0005) * math.cos(2 * math.pi * k / seg), c[1] + max(r, .0005) * math.sin(2 * math.pi * k / seg), c[2] + z)) for k in range(seg)] for r, z in prof]
    for i in range(len(prof) - 1):
        m = D.mi(mat(i) if callable(mat) else mat)
        for k in range(seg):
            f = D.bm.faces.new((rows[i][k], rows[i][(k + 1) % seg], rows[i + 1][(k + 1) % seg], rows[i + 1][k])); f.material_index = m; f.smooth = True

def ring(D, c, R, r, mat, axis='y', seg=28, n=8):
    """Prstenec (pneumatika bicykla, nafukovací lem bazéna): stred c, polomer R, polomer prierezu r."""
    m = D.mi(mat); rows = []
    for i in range(seg):
        a = 2 * math.pi * i / seg; row = []
        for j in range(n):
            b = 2 * math.pi * j / n; rr = R + r * math.cos(b); h = r * math.sin(b)
            row.append(D.bm.verts.new(Vector(c) + Vector((rr * math.cos(a), h, rr * math.sin(a)) if axis == 'y' else (rr * math.cos(a), rr * math.sin(a), h))))
        rows.append(row)
    for i in range(seg):
        for j in range(n):
            f = D.bm.faces.new((rows[i][j], rows[i][(j + 1) % n], rows[(i + 1) % seg][(j + 1) % n], rows[(i + 1) % seg][j])); f.material_index = m; f.smooth = True

def poly(D, pts, mat):
    try: f = D.bm.faces.new([D.bm.verts.new(p) for p in pts]); f.material_index = D.mi(mat)
    except ValueError: pass

def grid(D, xs, ys, fn, mat_fn):
    """Plocha z bodov fn(x, y) na mriežke daných staníc; materiál podľa stredu políčka."""
    rows = [[D.bm.verts.new(fn(x, y)) for y in ys] for x in xs]
    for i in range(len(xs) - 1):
        for j in range(len(ys) - 1):
            m = mat_fn((xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2)
            if m is None: continue
            f = D.bm.faces.new((rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j])); f.material_index = D.mi(m); f.smooth = True


# ---------------------------------------------------------------- strešný stan
def folds_long(c):
    """Stan, ktorý sa rozkladá v smere dĺžky (zatvorený je polovičný na dĺžku), nie do šírky."""
    p = c.get('parts', {}); return (p.get('openL') or 0) > (p.get('closedL') or 1e9) * 1.3

def ladder(D, top, out, drop, w=.42):
    """Rebrík zo strešného stanu na zem: top = horný stred, out = vodorovný smer von, drop = výška nad zemou."""
    top, out = Vector(top), Vector(out); side = Vector((-out.y, out.x, 0)); foot = top + out * (drop * .3) - Vector((0, 0, drop + top.z))
    for s in (-1, 1): rod(D, top + side * s * w / 2, foot + side * s * w / 2, .017, 'hlinik', 4)
    n = max(3, int(drop / .3))
    for k in range(1, n + 1):
        q = top.lerp(foot, k / (n + .6)); rod(D, q - side * w / 2, q + side * w / 2, .012, 'hlinik', 4)

def rooftent(D, c, col, drop=1.75):
    """Rozložený strešný stan. z = 0 je spodok podlahy; pod ňou sú priečniky nosiča (0,04 m), drop = výška podlahy nad zemou (dĺžka rebríka).
    Pevná polovica leží na streche, vyklopená trčí do −Y (Foothill, Skycamp) alebo do +X (Kukenam)."""
    L, W, H = c['L'] / 1000, c['W'] / 1000, c['H'] / 1000; p = c.get('parts', {})
    main, fly, mesh = fabric(col), fabric(shade_hex(col, .6)), 'sklo svetle'
    if 'skycamp' in c['id'] or p.get('hardshell'):            # pevná škrupina: veko sa zdvihne na pánte, podlaha sa vyklopí
        cw = (p.get('closedW') or c['W'] * .7) / 1000; yh = W / 2; yo = -W / 2; sh = matn('skrupina', '#23272b', .32, 0, .7)
        D.box((0, yh - cw / 2, .06), (L, cw, .12), sh, bevel=.03)
        D.box((0, (yo + yh - cw) / 2, .085), (L - .04, yh - cw - yo, .05), 'hlinik', bevel=.008)
        lo, hi = 0.0, math.pi / 2                              # uhol veka tak, aby jeho horná hrana bola presne vo výške H
        for _ in range(30):
            ang = (lo + hi) / 2
            if .12 + cw * math.sin(ang) + .11 * math.cos(ang) < H: lo = ang
            else: hi = ang
        R = Matrix.Rotation(-ang, 4, 'X')
        D.box((0, yh, .12), (L, cw, .11), sh, rot=R @ Matrix.Translation((0, -cw / 2, .055)), bevel=.03)
        E = Vector((0, yh - cw * math.cos(ang) + .02, .12 + cw * math.sin(ang) - .01)); O = Vector((0, yo + .02, .11)); xe = L / 2 - .035
        def front(x, t): q = O.lerp(E, t); return (x, q.y - .05 * math.sin(math.pi * t), q.z)
        grid(D, [-xe, -L * .27, L * .27, xe], [0, .2, .72, 1], front, lambda x, t: mesh if abs(x) < L * .27 and .2 < t < .72 else main)
        for s in (-1, 1):
            poly(D, [(s * xe, yh - .03, .13), (s * xe, E.y, E.z), (s * xe, O.y, O.z)], main)
            poly(D, [(s * (xe + .004), lerp(yh - .03, O.y, .42), .3), (s * (xe + .004), lerp(E.y, O.y, .25), lerp(E.z, .3, .45)), (s * (xe + .004), lerp(E.y, O.y, .7), .3)], mesh)
        ladder(D.lad, (L * .18, yo + .01, .07), (0, -1, 0), drop); D.lad_top = Vector((L * .18, yo + .01, .07))
        cs, cdir = yh - cw / 2, 'y'
    else:
        fx = folds_long(c); a, b = (L / 2, W / 2) if fx else (W / 2, L / 2)     # a = pol rozmeru v smere rozkladania, b = pozdĺž pántu
        P3 = (lambda s, t, z: (s, t, z)) if fx else (lambda s, t, z: (t, -s, z))  # s = smer rozkladania (+ = vyklopená polovica), t = pozdĺž pántu
        D.box((0, 0, .04), (L, W, .08), 'ram', bevel=.01)
        hw = H * .56; top = H; tb = b - .025
        for _ in range(3):                                     # zaoblenie hrebeňa uberá z výšky: vrchol sa posunie, kým stan nemá výšku H
            prof = fillet([(-a + .02, .08), (-a + .06, hw, .08), (0, top, .3), (a - .06, hw, .08), (a - .02, .08)], 3, [3, 5, 5, 3]); top += H - max(q[1] for q in prof)
        rows = [[D.bm.verts.new(P3(s, t, z)) for t in (-tb, -tb * .5, tb * .5, tb)] for s, z in prof]
        for i in range(len(prof) - 1):
            zm = (prof[i][1] + prof[i + 1][1]) / 2; sm = (prof[i][0] + prof[i + 1][0]) / 2
            for j in range(3):
                m = fly if zm > hw + .04 else (mesh if j == 1 and hw * .42 < zm < hw * .9 and sm > 0 else main)   # okno na vyklopenej strane
                f = D.bm.faces.new((rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j])); f.material_index = D.mi(m); f.smooth = True
        for t in (-tb, tb):                                    # štíty so sieťovým oknom
            poly(D, [P3(s, t, z) for s, z in prof], main)
            poly(D, [P3(s * .55, t + math.copysign(.004, t), .08 + (z - .08) * .55 + H * .14) for s, z in prof], mesh)
        ladder(D.lad, P3(a - .01, 0, .07), P3(1, 0, 0), drop); D.lad_top = Vector(P3(a - .01, 0, .07))
        cs, cdir = -a / 2, 'x' if fx else 'y'
        if not fx: cs = a / 2                                  # P3 otáča smer: pevná polovica je na strane +Y
    for k in (-1, 1):                                          # priečniky strešného nosiča pod pevnou polovicou
        if cdir == 'y': D.box((k * min(.42, L * .3), cs, -.02), (.05, 1.08, .04), 'ram', bevel=.006)
        else: D.box((cs, k * min(.42, W * .3), -.02), (1.08, .05, .04), 'ram', bevel=.006)

def mount_rooftent(c, car):
    """Poloha strešného stanu v súradniciach auta: (x, y, z, otočenie okolo z). Vyklopená polovica s rebríkom je nad ľavým bokom auta (−Y)."""
    p = c.get('parts', {}); L, W = c['L'] / 1000, c['W'] / 1000; Wc, Hc = car['W'] / 1000, car['H'] / 1000; x = -car['L'] / 1000 * .07
    if folds_long(c): return (x, -L / 4, Hc + .04, -math.pi / 2)
    cw = (p.get('closedW') or c['W'] * .6) / 1000
    return (x, -(W / 2 - cw / 2) if cw > 1.0 else -(Wc / 2 - .3), Hc + .04, 0.0)


# ---------------------------------------------------------------- predstan a plachta
def awningtent(D, c, col, zwall=2.45, y0=0.0):
    """Nafukovací predstan ku karavanu: stena vozidla je v rovine y = y0, predstan ide do −Y. zwall = výška lišty na stene vozidla."""
    L, W = c['L'] / 1000, c['W'] / 1000; p = c.get('parts', {}); zf = (p.get('frontHeight') or 1850) / 1000; nb = p.get('airBeams') or 3
    main, dark, door, win = fabric('#cbcfcc'), fabric('#4a5256'), fabric('#b3b9b6'), 'sklo svetle'
    prof = fillet([(y0, zwall), (y0 - W * .5, zwall - (zwall - zf) * .3, .5), (y0 - W + .02, zf + .05, .3), (y0 - W, zf - .35)], 4, [3, 3, 2])
    beams = [lerp(-L / 2 + .09, L / 2 - .09, k / (nb - 1)) for k in range(nb)]
    xs = sorted(set([-L / 2, L / 2] + [round(b + d, 4) for b in beams for d in (-.07, .07)] + [round(b + d, 4) for b in beams[:-1] for d in (.26,)] + [round(b - .26, 4) for b in beams[1:]]))
    beam = lambda x: any(abs(x - b) < .07 for b in beams); bay = lambda x: all(abs(x - b) > .26 for b in beams)
    grid(D, xs, list(range(len(prof))), lambda x, i: (x, prof[int(i)][0], prof[int(i)][1]), lambda x, i: dark if beam(x) else main)          # strecha
    zs = [0, .22, .8, 1.48, prof[-1][1]]
    grid(D, xs, zs, lambda x, z: (x, y0 - W, z), lambda x, z: dark if beam(x) or z < .22 else (win if bay(x) and .8 < z < 1.48 else main))   # predná stena s oknami
    zb = [0, .22, .9, 1.6, 9]
    for s in (-1, 1):                                          # bočné steny: vpredu okno, pri vozidle dvere
        for i in range(len(prof) - 1):
            (ya, za), (yb, zb_) = prof[i], prof[i + 1]; ym = (ya + yb) / 2 - y0
            for k in range(4):
                la, ha, lb, hb = min(zb[k], za), min(zb[k + 1], za), min(zb[k], zb_), min(zb[k + 1], zb_)
                if ha - la < 1e-4 and hb - lb < 1e-4: continue
                m = dark if k == 0 else (win if k == 2 and ym < -W * .58 else (door if ym > -W * .5 and k < 3 else main))
                poly(D, [(s * L / 2, ya, la), (s * L / 2, yb, lb), (s * L / 2, yb, hb), (s * L / 2, ya, ha)], m)

def tarp(D, c, col):
    """Plachta na dvoch tyčiach s hrebeňom v smere X, rohy vypnuté šnúrami ku kolíkom."""
    L, W, H = c['L'] / 1000, c['W'] / 1000, c['H'] / 1000; eh = (c.get('parts', {}).get('edgeHeight') or 1200) / 1000
    main = fabric(col); cord = matn('snura', '#e9e4d2', .8); hs = math.sqrt(max(.2, (W / 2) ** 2 - (H - eh) ** 2))   # plátno má na šírku presne W
    def pt(u, v):
        s = 2 * v - 1; k = 1 - (2 * u - 1) ** 2
        return (lerp(-L / 2, L / 2, u), s * hs * (1 - .06 * k * abs(s)), lerp(H - .03 - .07 * k, eh - .1 * k, abs(s) ** 1.15))
    surface(D, pt, 10, 12, lambda u, v: main)
    for s in (-1, 1):
        rod(D, (s * L / 2, 0, 0), (s * L / 2, 0, H), .014, 'hlinik')
        rod(D, (s * L / 2, 0, H - .02), (s * (L / 2 + H * .7), 0, 0), .005, cord, 3)
        for t in (-1, 1): rod(D, (s * L / 2, t * hs, eh), (s * (L / 2 + eh * .55), t * (hs + eh * .65), 0), .005, cord, 3)


# ---------------------------------------------------------------- gril
def grill(D, c, col):
    L, W, H = c['L'] / 1000, c['W'] / 1000, c['H'] / 1000; p = c.get('parts', {}); en = 'lesk cierny'
    if p.get('lidDiameter'):                                   # guľový gril na trojnožke s dvoma kolieskami
        R = p['lidDiameter'] / 2000; zr = H - .06 - R * .62; zb = zr - R * .78
        lathe(D, [(0, zb), (R * .55, zb + R * .1), (R * .88, zr - R * .36), (R, zr), (R - .012, zr + .012), (R * .9, zr + R * .34), (R * .58, zr + R * .56), (0, zr + R * .62)], en)
        for s in (-1, 1): rod(D, (s * .06, 0, zr + R * .6), (s * .06, 0, H - .02), .008, 'hlinik', 4)
        D.box((0, 0, H - .018), (.17, .032, .036), 'plast', bevel=.01)
        cyl(D, (0, 0, zb - .08), .095, .13, 'hlinik'); wr = .1
        legs = [((R * .62, 0, zr - R * .55), (L / 2 - .014, 0, 0))] + [((-R * .34, s * R * .52, zr - R * .55), (-L / 2 + wr, s * (W / 2 - .06), wr)) for s in (-1, 1)]
        for a, b in legs: rod(D, a, b, .013, 'hlinik')
        for s in (-1, 1): cyl(D, (-L / 2 + wr, s * (W / 2 - .02), wr), wr, .04, 'plast', 'y')
        rod(D, (-L / 2 + wr, -(W / 2 - .04), wr), (-L / 2 + wr, W / 2 - .04, wr), .008, 'hlinik', 4)
        tri = [Vector(a).lerp(Vector(b), .68) for a, b in legs]
        for i in range(3): rod(D, tri[i], tri[(i + 1) % 3], .006, 'hlinik', 4)
    elif H < .5:                                               # kufríkový gril na drôtených nohách
        bw = (p.get('cookingAreaL') or c['L'] * .8) / 1000 + .03; bd = W - .02; zl = H - .029
        D.box((0, 0, zl - .145), (bw, bd, .11), en, bevel=.028); D.box((0, 0, zl - .045), (bw, bd, .09), en, bevel=.03)
        D.box((0, 0, H - .014), (.15, .026, .028), 'plast', bevel=.008)
        for s in (-1, 1):
            D.box((s * (L / 2 - .02), 0, zl - .1), (.04, .12, .02), 'plast', bevel=.006)
            path(D, [(s * bw * .36, -bd * .4, zl - .2), (s * bw * .36, -(bd / 2 - .006), .006), (s * bw * .36, bd / 2 - .006, .006), (s * bw * .36, bd * .4, zl - .2)], .006, 'hlinik', 4)
    else:                                                      # plynový gril na vozíku s dvoma stolíkmi
        bw = (p.get('cookingAreaL') or 600) / 1000 + .1; bd = W - .045; yc = .0225; zt = H - .25; tw = (L - bw) / 2
        for sx in (-1, 1):
            for sy in (-1, 1):
                z0 = .0 if sx < 0 else .09; D.box((sx * (bw / 2 - .03), yc + sy * (bd / 2 - .05), (zt - .15 + z0) / 2), (.045, .045, zt - .15 - z0), 'plast')
            D.box((sx * (bw / 2 + tw / 2), yc, zt - .015), (tw, bd - .1, .03), 'plast svetly', bevel=.008)
        for sy in (-1, 1): cyl(D, (bw / 2 - .03, yc + sy * (bd / 2 - .025), .09), .09, .035, 'plast', 'y')
        D.box((0, yc, .17), (bw - .06, bd - .1, .02), 'plast svetly')
        cyl(D, (-.08, yc + .03, .18 + .2), .14, .4, matn('propan', '#7d8a94', .45, .3))
        D.box((0, yc, zt - .08), (bw, bd, .16), en, bevel=.02)
        D.box((0, yc - bd / 2 - .012, zt - .09), (bw - .02, .03, .1), 'hlinik', bevel=.006)
        for k in (-1, 0, 1): cyl(D, (k * bw * .28, yc - bd / 2 - .035, zt - .09), .022, .03, 'plast', 'y', seg=12)
        D.blob((0, yc + .01, zt), (bw / 2, bd / 2 - .01, H - zt), en, e=3.2, seg=18, rings=10, zmin=0)
        path(D, [(-bw * .36, yc - bd / 2 + .03, zt + .1), (-bw * .36, yc - bd / 2 - .028, zt + .1), (bw * .36, yc - bd / 2 - .028, zt + .1), (bw * .36, yc - bd / 2 + .03, zt + .1)], .012, 'hlinik')


# ---------------------------------------------------------------- bicykel
def bike_wheel(D, x, R, rt, spokes=14):
    ring(D, (x, 0, R), R - rt, rt, 'guma', 'y', 32, 6); ring(D, (x, 0, R), R - rt * 2 - .008, .011, 'hlinik', 'y', 32, 4)
    cyl(D, (x, 0, R), .022, .1, 'hlinik', 'y', seg=8)
    for k in range(spokes):
        a = 2 * math.pi * k / spokes; s = 1 if k % 2 else -1; rr = R - rt * 2 - .012
        rod(D, (x, s * .03, R), (x + rr * math.cos(a), 0, R + rr * math.sin(a)), .0022, 'hlinik', 3)

def bike(D, c, col):
    """Bicykel v rovine XZ, predné koleso v smere +X. Dĺžka = rázvor + priemer pneumatiky, šírka = riadidlá."""
    L, W = c['L'] / 1000, c['W'] / 1000; p = c.get('parts', {}); fr = matn('ram bicykla ' + col, col, .4, .3, .6); bl = 'plast'
    if not p.get('wheelbase'): return cargo_bike(D, c, col, fr)
    wb = p['wheelbase'] / 1000; R = p['tyreOuterDiameter'] / 2000; big = R > .3; rt = .0285 if big else .0185
    A, F = Vector((-wb / 2, 0, R)), Vector((wb / 2, 0, R)); zbb = R - (.06 if big else .02); cs = wb * .374
    BB = Vector((A.x + math.sqrt(cs * cs - (R - zbb) ** 2), 0, zbb)); sa, ha = math.radians(73.5), math.radians(68 if big else 69)
    up = lambda ang, d: Vector((-math.cos(ang) * d, 0, math.sin(ang) * d))
    S = BB + up(sa, wb * .40); C = F + up(ha, R * 1.38); T = C + up(ha, .11); hz = (c['H'] / 1000 - .011) if c.get('H') else T.z + .07
    Bp = Vector((T.x + .05, 0, hz)); P = S + up(sa, .2 if big else .08); tr = .021 if big else .016
    bike_wheel(D, A.x, R, rt); bike_wheel(D, F.x, R, rt)
    rod(D, BB, S, tr * .85, fr); rod(D, BB, C + up(ha, .02), tr, fr); rod(D, S - up(sa, .05), T - up(ha, .02), tr * .8, fr); rod(D, C, T, tr * 1.1, fr)
    for s in (-1, 1):
        y = Vector((0, s * .062, 0))
        rod(D, A + y, BB + y * .5, .009, fr); rod(D, A + y, S - up(sa, .04) + y * .25, .008, fr)
        rod(D, F + y, C + y, .016, bl); rod(D, BB + Vector((0, s * .07, 0)), BB + Vector((s * .09, s * .07, -s * .14)), .008, bl, 4)
        D.box(BB + Vector((s * .09, s * .11, -s * .14)), (.09, .07, .018), bl)
        D.box((Bp.x, s * (W / 2 - .06), hz), (.03, .12, .03), bl, bevel=.008)
    D.box(C + Vector((0, 0, .0)), (.05, .15, .04), bl, bevel=.01); rod(D, BB - Vector((0, .075, 0)), BB + Vector((0, .075, 0)), .02, 'hlinik')
    cyl(D, BB + Vector((0, .05, 0)), .085 if big else .07, .005, 'hlinik', 'y', seg=20)
    rod(D, T, Vector((T.x, 0, hz)), .014, bl); rod(D, Vector((T.x, 0, hz)), Bp, .014, bl); rod(D, (Bp.x, -W / 2 + .12, hz), (Bp.x, W / 2 - .12, hz), .011, 'hlinik')
    rod(D, S, P, .013, bl); D.blob(P + Vector((-.02, 0, .02)), (.13, .065, .022), bl, e=2.2, seg=10, rings=6)
    rod(D, BB + Vector((-.06, -.08, 0)), (BB.x - .16, -.2, 0), .006, bl, 4)                        # stojan

def cargo_bike(D, c, col, fr):
    """Nákladný bicykel s korbou medzi jazdcom a malým predným kolesom."""
    L, W, H = c['L'] / 1000, c['W'] / 1000, c['H'] / 1000; Rr, Rf, bl = .345, .255, 'plast'
    A, F = Vector((-L / 2 + Rr, 0, Rr)), Vector((L / 2 - Rf, 0, Rf)); BB = Vector((A.x + .47, 0, .29)); S = BB + Vector((-.17, 0, .56)); P = S + Vector((-.05, 0, .16))
    Tc = Vector((BB.x + .46, 0, .52)); hz = H - .011
    bike_wheel(D, A.x, Rr, .026); bike_wheel(D, F.x, Rf, .028, 12)
    rod(D, BB, S, .02, fr); rod(D, BB, Tc, .03, fr); rod(D, S - Vector((-.02, 0, .08)), Tc + Vector((0, 0, .1)), .018, fr)
    rod(D, BB + Vector((.25, 0, -.07)), (F.x - Rf - .08, 0, .2), .032, fr); rod(D, (F.x - Rf - .08, 0, .2), (F.x - .04, 0, Rf + .26), .03, fr)
    for s in (-1, 1):
        y = Vector((0, s * .07, 0)); rod(D, A + y, BB + y * .5, .011, fr); rod(D, A + y, S - Vector((0, 0, .06)) + y * .3, .009, fr); rod(D, F + y, Vector((F.x - .04, s * .07, Rf + .26)), .016, bl)
        D.box((Tc.x - .06, s * .24, hz), (.03, .12, .03), bl, bevel=.008)
    rod(D, Tc, (Tc.x - .06, 0, hz), .016, bl); rod(D, (Tc.x - .06, -.3, hz), (Tc.x - .06, .3, hz), .011, 'hlinik')
    rod(D, S, P, .014, bl); D.blob(P + Vector((-.02, 0, .02)), (.14, .08, .026), bl, e=2.2, seg=10, rings=6)
    x0, x1 = Tc.x + .1, F.x - Rf - .1; foam = matn('pena korby', '#1c1e20', .9)
    D.blob(((x0 + x1) / 2, 0, .2), ((x1 - x0) / 2, W / 2, .5), foam, e=4.2, seg=20, rings=10, zmin=0.0)
    D.box(((x0 + x1) / 2, 0, .701), (x1 - x0 - .16, W - .14, .004), matn('lavica korby', '#34383b', .8))
    cyl(D, BB + Vector((0, .06, 0)), .09, .006, 'hlinik', 'y', seg=20); rod(D, BB - Vector((0, .08, 0)), BB + Vector((0, .08, 0)), .022, 'hlinik')
    for s in (-1, 1): rod(D, (BB.x + .3, s * .2, .2), (BB.x + .3, s * .26, 0), .01, bl, 4)             # dvojnohý stojan


# ---------------------------------------------------------------- bazén, ležadlá, hojdacia sieť
def pool(D, c, col):
    R, H = c['L'] / 2000, c['H'] / 1000; hw = H - .17; wall, top = matn('bazen stena', '#2b63a8', .5), matn('bazen lem', '#3f86d6', .45)
    lathe(D, [(R * .86, hw + .02)] + [(R * (.9 + .1 * math.sin(math.pi * k / 8)), hw * (1 - k / 8)) for k in range(9)] + [(0, 0)], wall)
    ring(D, (0, 0, H - .09), R * .86, .09, top, 'z', 36, 8)
    lathe(D, [(0, H * .8), (R * .9, H * .8)], matn('voda bazen', '#6cc4de', .06, 0, 1.0), seg=36)

def lounger_one(D, y, col, w=.71):
    seat = fabric(col); z = .35; segs = [((-.96, z - .02), (-.25, z)), ((-.25, z), (.25, z)), ((.25, z), (.96, .88))]
    for (xa, za), (xb, zb) in segs:
        ln = math.hypot(xb - xa, zb - za); ang = math.atan2(zb - za, xb - xa)
        D.box(((xa + xb) / 2, y, (za + zb) / 2 + .0), (ln - .01, w - .06, .045), seat, rot=Matrix.Rotation(-ang, 4, 'Y'), bevel=.016)
        for s in (-1, 1): rod(D, (xa, y + s * (w / 2 - .012), za - .02), (xb, y + s * (w / 2 - .012), zb - .02), .012, 'hlinik')
    for x in (-.62, .12):
        for s in (-1, 1): rod(D, (x, y + s * (w / 2 - .012), z - .02), (x + .14, y + s * (w / 2 - .012), .012), .012, 'hlinik')
        rod(D, (x + .14, y - (w / 2 - .012), .012), (x + .14, y + w / 2 - .012, .012), .012, 'hlinik')
    for s in (-1, 1): rod(D, (.25, y + s * (w / 2 - .012), z - .02), (.62, y + s * (w / 2 - .012), .012), .01, 'hlinik')

def relax(D, c, col):
    L, W, H = c['L'] / 1000, c['W'] / 1000, c['H'] / 1000; p = c.get('parts', {})
    if p.get('standW'):                                        # hojdacia sieť v oceľovom stojane
        st = matn('stojan siete', '#2f3336', .45, .5); a = L / 2; hx = a - .55
        rod(D, (-a * .62, 0, .03), (a * .62, 0, .03), .03, st)
        for s in (-1, 1):
            rod(D, (s * a * .62, -W / 2, .03), (s * a * .62, W / 2, .03), .028, st); path(D, [(s * a * .62, 0, .03), (s * a * .9, 0, H * .62), (s * (a - .028), 0, H - .028)], .028, st)
            rod(D, (s * hx, -.4, H * .66), (s * hx, .4, H * .66), .016, matn('drevo', '#b0864e', .6))
            for k in range(-3, 4): rod(D, (s * (a - .04), 0, H - .04), (s * hx, k * .13, H * .66), .0035, matn('snura', '#e9e4d2', .8), 3)
        surface(D, lambda u, v: (lerp(-hx, hx, u), lerp(-.4, .4, v) * (1 - .12 * math.sin(math.pi * u)), H * .66 - .3 * math.sin(math.pi * u) ** .8 + .1 * (2 * v - 1) ** 2 * math.sin(math.pi * u)), 12, 6, lambda u, v: fabric(col))
    elif p.get('loungers'):
        lw = p['loungerW'] / 1000; tw, th = p['tableW'] / 1000, p['tableH'] / 1000
        for s in (-1, 1): lounger_one(D, s * (W / 2 - lw / 2), col, lw)
        D.box((.1, 0, th - .012), (tw, tw, .024), 'plast biely', bevel=.006)
        for sx in (-1, 1):
            for sy in (-1, 1): rod(D, (.1 + sx * (tw / 2 - .05), sy * (tw / 2 - .05), 0), (.1 + sx * (tw / 2 - .05), sy * (tw / 2 - .05), th - .02), .011, 'hlinik')
    else: lounger_one(D, 0, col, W)


BUILD = {'tent23': dome, 'tentfam': tunnel, 'gazebo': gazebo, 'tableset': tableset, 'awning': awning, 'rooftent': rooftent, 'awningtent': awningtent,
         'tarp': tarp, 'grill': grill, 'bike': bike, 'pool': pool, 'relax': relax}

def build(c, color=None, name=None, **kw):
    D = Detail(None); col = color or c.get('color') or FABRICS[sum(map(ord, c['id'])) % len(FABRICS)]
    fn = dome if c.get('shape') in ('dome', 'popup') else BUILD[c['cat']]
    if c['cat'] == 'rooftent': D.lad = Detail(None)          # rebrík je samostatný objekt s počiatkom hore: prehliadka ho predĺži podľa výšky auta
    fn(D, c, col, **kw)
    bmesh.ops.recalc_face_normals(D.bm, faces=D.bm.faces)
    ob = D.finish(name or c['id']); shade(ob.data, 50)
    if c['cat'] == 'rooftent':
        lad = D.lad.finish('rebrik'); lad.data.transform(Matrix.Translation(-D.lad_top)); lad.location = D.lad_top; lad.parent = ob; shade(lad.data, 50)
        ob['drop'] = kw.get('drop', 1.75)
    return ob

if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:]
    SPEC = json.load(open(argv[0], encoding='utf-8')); OUT = os.path.abspath(argv[1]); os.makedirs(OUT, exist_ok=True)
    ONLY = argv[argv.index('--only') + 1].split(',') if '--only' in argv else None
    ON = argv[argv.index('--on') + 1] if '--on' in argv else 'kodiaq'          # auto, na ktorom sa ukáže strešný stan
    BARE = '--bare' in argv                                                      # strešný stan bez auta (katalóg pre prehliadku)
    SPEC = SPEC if isinstance(SPEC, list) else list(SPEC.values())
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for c in SPEC:
        if (ONLY and c['id'] not in ONLY) or (c['cat'] not in BUILD): continue
        sel = []
        if c['cat'] == 'rooftent' and not BARE:                # strešný stan sa ukazuje na aute
            import car as carmod
            car = next(x for x in json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cars.json'), encoding='utf-8')) if x['id'] == ON)
            root, parts = carmod.build_car(car); x, y, z, rz = mount_rooftent(c, car)
            ob = build(c, drop=z); ob.location = (x, y, z); ob.rotation_euler = (0, 0, rz); sel = [root] + parts + list(ob.children)
        else: ob = build(c); sel = list(ob.children)
        bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True)
        for o in sel: o.select_set(True)
        bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, c['id'] + '.glb'), export_format='GLB', use_selection=True, export_apply=True)
        bb = [Vector(co) for co in ob.bound_box]
        print('MODEL %s  %.3f x %.3f x %.3f m  (zadané %s x %s x %s)' % (c['id'], max(v.x for v in bb) - min(v.x for v in bb), max(v.y for v in bb) - min(v.y for v in bb), max(v.z for v in bb), c['L'], c['W'], c['H']))
        for o in [ob] + sel: o.location.y += 100
    print('DONE')
