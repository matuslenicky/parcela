# Postaví 3D modely karavanov, dodávok, obytných dodávok a obytných áut v Blenderi z rozmerov výrobcu.
#   blender -b --factory-startup -P kempy/models/camper.py -- <spec.json> <out dir> [--only id,id]
# spec.json (mm): karavan {"id", "cat": "caravan", "Ltotal", "Lbody", "W", "H", "axles"};
#   dodávka / obytná dodávka / obytné auto {"id", "cat": van|minibus|campervan|motorhome, "L", "W", "H", "wb", "fo", "layout": semi-integrated|alcove|integrated, "feat": […]}
# Výstup: <out>/<id>.glb v metroch, predok (oje karavanu) v smere +X, stred pôdorysu v počiatku, kolesá na zemi.
# Celková dĺžka, šírka, výška, rázvor a predný previs sú podľa zadania. Výška kapoty, pásu okien a rozmer pneumatík výrobcovia
# nadstavieb neuvádzajú: berú sa podľa triedy podvozku (malá dodávka, stredná, veľká).
import bpy, json, math, os, sys
from mathutils import Vector, Matrix
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shell import *
from car import NC, NS, ROWS, lin

WHITE = '#f1f1ee'

def body_paint(hexc): return M('karoseria ' + hexc, hexc, rough=.42, metal=0.0, coat=.5).name

def box_ctrl(wf, top, bot, cab, belt, beltF=.955, roofF=.885):
    """Rez skrine: g = 1 kabína (boky sa nad pásom okien skláňajú), g = 0 hranatá nadstavba so zaoblenou hranou strechy."""
    def ctrl(x):
        w = wf(x); zt = top(x); zb = bot(x); g = cab(x)
        k = clamp((zt - zb) / .9); kw = clamp(w / .6); e = 1e-4
        zbl = min(belt(x), zt - .03 * k)
        p4b = (w, zt - .28 * k); p5b = (w - .004, zt - .012 * k)
        p4c = (w * beltF, zbl); p5c = (w * roofF, max(zt - .05, zbl + .008))
        p4 = (lerp(p4b[0], p4c[0], g), lerp(p4b[1], p4c[1], g)); p5 = (lerp(p5b[0], p5c[0], g), lerp(p5b[1], p5c[1], g))
        return [(0, zb), (max(0, w - .14 * kw), zb, .04 * k + e), (w - .025 * kw, zb + .11 * k, .04 * k + e), (w, zb + .45 * (p4[1] - zb), .10 * k + e), (w, zb + .80 * (p4[1] - zb), .05 * k + e),
                (p4[0], p4[1], .02 * k + e), (p5[0], p5[1], lerp(.10, .08, g) * k + e), (p5[0] * .5, zt - .006 * k, .3 * kw + e), (0, zt)]
    return ctrl

def stations(L, caps, keys=(), step=.075):
    cap = [0, .0006, .0025, .006, .012, .022, .037, .058, .085, .12, .165, .22, .29, .38, .5, .65, .82, 1]
    xs = set(keys)
    for D_, front in caps: xs |= {(D_ * t if front else L - D_ * t) for t in cap}
    n = int(L / step * SET['q']); xs |= {L * i / n for i in range(n + 1)}
    xs = sorted(x for x in xs if 0 <= x <= L); st = [xs[0]]
    for x in xs[1:]:
        if x - st[-1] > min(.012, max(.0004, min(x, L - x) * .3)): st.append(x)
    st[-1] = L
    return st

def window(D, kind, a0, b0, a1, b1, s=None, mirror=False, r=.05, frame='okno ram', glass='sklo', fw=.028):
    D.patch(kind, rect(a0, b0, a1, b1, r), .006, frame, s=s, mirror=mirror, skirt=.006, step=.12)
    D.patch(kind, rect(a0 + fw, b0 + fw, a1 - fw, b1 - fw, max(.01, r - fw)), .0095, glass, s=s, mirror=mirror, step=.12)

def plate(D, kind, z, w=.26):
    D.patch(kind, rect(-w, z - .056, w, z + .056, .012), .007, 'spz', skirt=.007, step=.08)
    sgn = 1 if kind == 'front' else -1
    D.patch(kind, rect(-w + .005, z - .051, -w + .048, z + .051, .008) if sgn > 0 else rect(w - .048, z - .051, w - .005, z + .051, .008), .0085, 'spz modra', step=.08)
    for k in range(7):
        D.patch(kind, rect(-.185 + k * .058, z - .03, -.185 + k * .058 + .036, z + .03, .004), .0085, 'spz text', step=.08)

def beam(D, p0, p1, wd, ht, mat):
    p0, p1 = Vector(p0), Vector(p1); d = p1 - p0
    D.box((p0 + p1) / 2, (d.length, wd, ht), mat, rot=Matrix.Rotation(math.atan2(d.y, d.x), 4, 'Z') @ Matrix.Rotation(-math.atan2(d.z, math.hypot(d.x, d.y)), 4, 'Y'))

def finish(c, body, D, wheels, shift=0.0, dims=None):
    det = D.finish(c['id'] + ' detaily'); shade(det.data, 45)
    bpy.ops.object.select_all(action='DESELECT'); det.select_set(True); body.select_set(True); bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    parts = [body]
    for wm, X, y, R in wheels:
        o = bpy.data.objects.new('koleso', wm); bpy.context.scene.collection.objects.link(o)
        o.location = (X, y, R); o.rotation_euler = (0, 0, 0 if y > 0 else math.pi); parts.append(o)
    root = bpy.data.objects.new(c['id'], None); bpy.context.scene.collection.objects.link(root)
    for p in parts: p.location.x += shift; p.parent = root
    root['nazov'] = c['name']
    bpy.context.view_layer.update()
    pts = [p.matrix_world @ Vector(co) for p in parts for co in p.bound_box]
    print('MODEL %s  %.3f x %.3f x %.3f m  (zadané %s)' % (c['id'], max(v.x for v in pts) - min(v.x for v in pts), max(v.y for v in pts) - min(v.y for v in pts), max(v.z for v in pts), dims))
    return root, parts


# ---------------------------------------------------------------- karavan
def build_caravan(c):
    Lt, Lbody, W, H = c['Ltotal'] / 1000, c['Lbody'] / 1000, c['W'] / 1000, c['H'] / 1000
    Lb = Lbody - .012; c2 = W / 2 - .01                               # skriňa o hrúbku svetiel a lemov menšia, celkové rozmery sedia
    axles = c.get('axles', 1); R, rim_r, tw = tyre_dims(c.get('tyre', '195/70 R14'))
    Hb = H - .05; zf = R + .13; zm = zf + (Hb - zf) * .30            # spodok skrine, najvystupujúcejšie miesto čela
    low = Hb < 2.4                                                   # nízky karavan (Eriba Touring): oblejšie čelo
    Dt = .75 if low else .55; Dp = .30 if low else .22; Db = .18; Dtr = .45 if low else .16; Dpr = .2 if low else .12
    top = lambda x: zm + (Hb - zm) * sup(x / Dt, 2.0) * sup((Lb - x) / Dtr, 2.2 if low else 2.6)
    bot = lambda x: zm - (zm - zf) * sup(x / Db, 2.2) * sup((Lb - x) / .12, 2.6)
    wf = lambda x: c2 * sup(x / Dp, 3.2) * sup((Lb - x) / Dpr, 3.4)
    ctrl = box_ctrl(wf, top, bot, lambda x: 0.0, lambda x: Hb)
    sh = Shell(Lb, ctrl, NC, NS)
    PAINT = body_paint(c.get('color', WHITE))
    def face_mat(h, x): return (1 if .16 < x < Lb - .1 else 0) if h < ROWS[1] + 2 else (2 if h < ROWS[2] + NC + 1 and .25 < x < Lb - .15 else 0)
    body = sh.build(c['id'], stations(Lb, [(Dt, True), (Dp, True), (Dtr, False), (Dpr, False)]), [M(PAINT), M('plast'), M('sokel')], face_mat)
    xa = Lb * .55; ax = [xa - .4, xa + .4] if axles > 1 else [xa]
    cut_cylinders(body, [(Lb / 2 - x, s * (c2 + .06 - (tw + .16) / 2), R, R + .06, tw + .16) for x in ax for s in (-1, 1)], M('podbeh'))
    shade(body.data, 40)
    D = Detail(sh)
    zw0 = zf + (.72 if low else .86); zw1 = min(zw0 + .56, Hb - .32)
    # čelo: veľké okno, veko skrinky na plyn, obrysové svetlá
    fz0 = max(zw0, zm + .22); fz1 = min(fz0 + .62, Hb - .42)
    window(D, 'front', -(c2 - .34), fz0, c2 - .34, fz1, r=.07)
    D.strip('front', rect(-(c2 - .3), zf + .1, c2 - .3, zm + .08, .05), .008, .003, 'skara', closed=True)
    D.patch('front', rect(c2 - .2, zm + .02, c2 - .1, zm + .06, .01), .006, 'svetlo sklo', mirror=True, step=.05)
    # boky: okná, dvere vpravo, pásy
    for s, wins in ((1, [(.07, .25), (.36, .58), (.70, .92)]), (-1, [(.07, .25), (.33, .50), (.80, .93)])):
        for a, b in wins: window(D, 'side', Lb * a, zw0, Lb * b, zw1, s=s)
    dx0 = Lb * .615; dx1 = dx0 + .60; dz1 = min(zf + 1.80, Hb - .22)
    D.strip('side', rect(dx0, zf + .04, dx1, dz1, .05), .008, .003, 'skara', s=-1, closed=True)
    window(D, 'side', dx0 + .11, zw0 + .08, dx1 - .11, zw1 - .02, s=-1, r=.04)
    D.patch('side', rect(dx0 + .05, zf + .95, dx0 + .085, zf + 1.09, .012), .01, 'lesk cierny', s=-1, skirt=.009, step=.05)
    zg = zf + (.42 if low else .52)
    D.strip('side', [(x, zg + .10 * sstep(Lb * .12, Lb * .5, x)) for x in lin(.32, Lb - .2, 24)], .05, .004, 'grafika', mirror=True)
    D.strip('side', [(x, zg + .075 + .10 * sstep(Lb * .12, Lb * .5, x)) for x in lin(.32, Lb - .2, 24)], .014, .004, 'grafika 2', mirror=True)
    D.strip('side', [(x, top(x) - .17) for x in lin(Dt * .9, Lb - Dtr - .05, 16)], .022, .006, 'hlinik', mirror=True)       # lišta na predstan
    for x in ax:
        ro = R + .11; ri = R + .054; a0 = math.asin(clamp((zf + .03 - R) / ro, -1, 1))
        ring = [(x + ro * math.cos(a), R + ro * math.sin(a)) for a in lin(a0, math.pi - a0, 24)] + [(x + ri * math.cos(a), R + ri * math.sin(a)) for a in lin(math.pi - a0, a0, 24)]
        D.patch('side', ring, .005, 'plast biely', mirror=True, skirt=.005, step=.06)
    # zadok
    window(D, 'rear', -(c2 - .5), zw0, c2 - .5, zw1, r=.06)
    D.patch('rear', rect(c2 - .26, zf + .22, c2 - .10, zf + .70, .03), .008, 'svetlo zadne', mirror=True, skirt=.008, step=.06)
    D.strip('rear', [(c2 - .18, zf + .62), (c2 - .18, zf + .44)], .05, .0115, 'led cervena', mirror=True)
    D.strip('rear', [(c2 - .18, zf + .36), (c2 - .18, zf + .29)], .05, .0115, 'led oranzova', mirror=True)
    plate(D, 'rear', zf + .34)
    D.strip('rear', [(-.16, Hb - .2), (.16, Hb - .2)], .025, .008, 'led cervena')
    # strecha: dve strešné okná (ich vrch je celková výška)
    for x in (Lb * .32, Lb * .68):
        D.box((Lb / 2 - x, 0, Hb + .005), (.52, .52, .09), 'plast biely', bevel=.03)
        D.box((Lb / 2 - x, 0, Hb + .035), (.4, .4, .03), 'sklo svetle', bevel=.01)
    # podvozok: oje, kĺb, oporné koliesko, nápravy, opery
    X0 = Lb / 2; tip = X0 + (Lt - Lbody); zc_ = zf - .06
    for s in (-1, 1): beam(D, (X0 - .5, s * .62, zc_), (tip - .22, s * .05, zc_), .06, .09, 'ram')
    D.box((tip - .13, 0, zc_ + .01), (.26, .09, .08), 'ram', bevel=.015)
    D.blob((tip - .06, 0, zc_ + .03), (.06, .05, .045), 'hlinik')
    D.box((tip - .34, 0, zc_ + .10), (.035, .035, .16), 'ram'); D.box((tip - .43, 0, zc_ + .18), (.2, .03, .03), 'lesk cierny')      # ručná brzda
    jx = tip - .62
    D.box((jx, .17, .30), (.05, .05, .44), 'hlinik'); D.blob((jx, .17, .10), (.10, .035, .10), 'guma', e=2.0); D.box((jx, .11, zc_), (.06, .14, .05), 'ram')
    D.box((X0 - .15, 0, zf + .06), (.34, min(1.5, W - .5), .22), 'plast biely', bevel=.04)                                           # kryt oja pod čelom
    for x in ax: D.box((Lb / 2 - x, 0, R), (.09, W - 2 * tw - .2, .09), 'ram')
    for dx in (.3, Lb - .3):
        for s in (-1, 1): D.box((Lb / 2 - dx, s * (c2 - .22), (zf - .03) / 2), (.045, .045, zf - .03), 'ram'); D.box((Lb / 2 - dx, s * (c2 - .22), .012), (.13, .13, .024), 'ram')
    wm = wheel_mesh('koleso karavan %d' % round(R * 1000), R, rim_r, tw, 6, False)
    wheels = [(wm, Lb / 2 - x, s * (c2 - tw / 2 - .035), R) for x in ax for s in (-1, 1)]
    return finish(c, body, D, wheels, shift=-(Lt - Lbody - .012) / 2, dims='%.3f x %.3f x %.3f' % (Lt, W, H))


# ---------------------------------------------------------------- dodávka, obytná dodávka, obytné auto
CLASS = {  # trieda podvozku: výška hrany kapoty, spodku čelného skla, pneumatiky, svetlosť
    'S': dict(zn=.92, zc=1.10, tyre='205/60 R16', gc=.16), 'M': dict(zn=1.03, zc=1.24, tyre='215/65 R16', gc=.18), 'L': dict(zn=1.20, zc=1.46, tyre='225/75 R16', gc=.19)}

def build_van(c):
    cat = c['cat']; lay = c.get('layout', ''); feat = c.get('feat', []); moto = cat == 'motorhome'; integ = moto and lay.startswith('int'); alcove = moto and lay.startswith('alc')
    Lreal, W, H = c['L'] / 1000, c['W'] / 1000, c['H'] / 1000; c2 = W / 2
    L = Lreal - .018; fo = c['fo'] / 1000 - .009; xra = fo + c['wb'] / 1000   # skriňa o hrúbku značiek a svetiel kratšia, celková dĺžka sedí
    K = CLASS['L' if moto else 'S' if L < 4.6 else 'M' if W < 1.95 else 'L']; zn, zc, gc = K['zn'], K['zc'], K['gc']
    R, rim_r, tw = tyre_dims(c.get('tyre', K['tyre']))
    wc = min(c2, 1.025) if moto and not integ else c2                 # polovičná šírka kabíny
    Hb = H - (.06 if moto else .013 if 'pop-top' in feat else 0)                                     # obytné auto: do výšky sa rátajú strešné okná
    xc = fo + (-.12 if K is CLASS['L'] else 0.0); xw = xc + .72; zw = min(Hb - .04, zc + .80)
    PAINT = body_paint(c.get('color', WHITE))
    if integ:
        prof = Curve([(0, Hb), (L, Hb)]); Dt = 1.15; nT = 1.75; zmf = .92; xc = .25; xw = 1.1
    else:
        pts = [(0, zn), (xc * .5, lerp(zn, zc, .5) + .02, .3), (xc, zc, .03), (xw, zw, .14)]
        rise = Hb - zw
        pts += [(xw + .5, Hb, .4), (L, Hb - .015)] if rise <= .08 else [(xw + .12, zw + .015, .08), (xw + .12 + max(.55, rise * (1.5 if alcove else 2.2)), Hb, .35), (L, Hb)]
        prof = profile(pts); lift = Hb - max(prof.y); prof.y = [z + lift * sstep(xw, xw + .6, x) for x, z in zip(prof.x, prof.y)]
        Dt = .10; nT = 2.2; zmf = zn * .56
    Dp = .34; Db = .2; Dtr = .10; Dpr = .13; zmr = Hb * .42
    zmid = lambda x: lerp(zmf, zmr, sstep(L * .3, L * .7, x))
    top = lambda x: zmid(x) + (prof(x) - zmid(x)) * sup(x / Dt, nT) * sup((L - x) / Dtr, 3.2)
    und = lambda x: gc + .02 + .05 * sstep(xra + R, L - .1, x)
    bot = lambda x: zmid(x) - (zmid(x) - und(x)) * sup(x / Db, 2.0) * sup((L - x) / .2, 2.2)
    xb = xw + .55                                                      # koniec kabíny (stĺpik za dverami)
    def wf(x):
        w = lerp(wc, c2, sstep(xb - .12, xb + .12, x)) if wc < c2 else c2
        return (w - .05 * (1 - sstep(.1, fo + .9, x))) * sup(x / Dp, 3.0) * sup((L - x) / Dpr, 3.6)
    gbox = 0.0 if moto else .4
    cab = (lambda x: 0.0) if integ else (lambda x: lerp(1.0, gbox, sstep(xb - .1, xb + .25, x)) * sstep(xc - .03, xc + .09, x))
    belt = lambda x: zc + .02
    ctrl = box_ctrl(wf, top, bot, cab, belt)
    sh = Shell(L, ctrl, NC, NS)
    body = sh.build(c['id'], stations(L, [(Dt, True), (Dp, True), (Dtr, False), (Dpr, False)], [xc - .03, xc, xc + .03, xc + .09, xw, xb]), [M(PAINT), M('plast')],
                    lambda h, x: 1 if h < ROWS[1] + 2 and Db * .75 < x < L - .15 else 0)
    twin = 'twin-rear-wheels' in feat; tandem = 'tandem-axle' in feat
    rear_ax = [xra, xra + .95] if tandem else [xra]
    yF = wc - tw / 2 - .04; yR = c2 - tw / 2 - (.06 if moto else .04)
    cuts = [(L / 2 - fo, s * (wc + .06 - (tw + .14) / 2), R, R + .075, tw + .14) for s in (-1, 1)]
    dR = tw * (2.1 if twin else 1) + .14
    cuts += [(L / 2 - x, s * (c2 + .06 - dR / 2), R, R + .075, dR) for x in rear_ax for s in (-1, 1)]
    cut_cylinders(body, cuts, M('podbeh'))
    shade(body.data, 40)
    D = Detail(sh)
    zre = lambda x: ctrl(x)[6][1]; hwg = lambda x: ctrl(x)[6][0] - .04
    gtop = lambda x: zre(x) - .075; gb = lambda x: belt(x) + .03
    zuf = und(.3); zur = und(L - .3)
    yedge = lambda z: sh.side_y(Dp * .8, z); yedge_r = lambda z: sh.side_y(L - Dpr * .8, z)

    # ---- kabína: čelné sklo, bočné okno, dvere, zrkadlá
    if integ:
        wz0 = 1.32; wz1 = min(Hb - .42, 2.42)
        D.patch('front', rect(-(c2 - .16), wz0 - .03, c2 - .16, wz1 + .03, .12), .004, 'lesk cierny', step=.1)
        D.patch('front', rect(-(c2 - .19), wz0, c2 - .19, wz1, .10), .009, 'sklo', step=.1)
        for a, b in ((-.5, -.04), (.04, .5)): D.strip('front', [(a * W * .8, wz0 + .05), (b * W * .8, wz0 + .09)], .02, .018, 'lesk cierny')
        window(D, 'side', .62, 1.36, 1.5, 2.02, mirror=True, r=.06, frame='lesk cierny')
        xA = .62; xd0 = 1.6; xB = 2.35
    else:
        x0, x1 = xc + .05, xw - .012
        D.patch('top', band(x0 - .022, x1 + .012, lambda x: -hwg(x) - .016, lambda x: hwg(x) + .016, r=.07), .004, 'lesk cierny')
        D.patch('top', band(x0, x1, lambda x: -hwg(x), hwg, inset=.004, r=.06), .009, 'sklo')
        D.patch('top', band(xc - .085, xc + .04, lambda x: -hwg(xc + .05) - .05, lambda x: hwg(xc + .05) + .05, r=.03), .003, 'plast')
        for a, b in ((-.40, -.03), (.03, .40)): D.strip('top', [(xc + .05, a * 2 * wc), (xc + .085, b * 2 * wc)], .017, .018, 'lesk cierny')
        hi = lambda x: gtop(x - .10)
        xA = next((x for x in lin(xc, xw, 120) if hi(x) - gb(x) > .03), xc + .2); xB = xb - .06
        D.patch('side', band(xA - .025, xB + .012, lambda x: gb(x) - .012, lambda x: hi(x) + .012, r=.03), .004, 'lesk cierny', mirror=True)
        D.patch('side', band(xA, xB, gb, hi, inset=.011, r=.035), .009, 'sklo', mirror=True)
        xd0 = fo + R + .13
    SW, SO = .008, .003; zs = lambda x: bot(x) + .17
    if not integ:
        D.strip('side', [(xd0, zs(xd0)), (xd0, gb(xd0) - .035)], SW, SO, 'skara', mirror=True)
        D.strip('side', [(xB + .03, zs(xB)), (xB + .03, zre(xB) - .1)], SW, SO, 'skara', mirror=True)
        D.strip('side', [(xd0, zs(xd0)), (xB + .03, zs(xB))], SW, SO, 'skara', mirror=True)
        zh = gb(xB) - .10
        D.patch('side', rect(xB - .25, zh - .03, xB - .05, zh + .028, .024), .003, 'skara', mirror=True, step=.06)
        D.patch('side', rect(xB - .24, zh - .012, xB - .06, zh + .018, .013), .022, 'lesk cierny', mirror=True, skirt=.02, step=.06)
    for s in (-1, 1):
        xm = xA + .04; ym = sh.side_y(xm, gb(xm)) ; X = L / 2 - xm
        D.box((X, s * (ym + .09), gb(xm) + .10), (.05, .20, .035), 'lesk cierny', bevel=.008)
        D.blob((X + .01, s * (ym + .2), gb(xm) + .15), (.05, .075, .15), 'lesk cierny', e=3.0)
        D.box((X - .05, s * (ym + .2), gb(xm) + .16), (.006, .12, .24), 'zrkadlo')

    # ---- predok: nárazník, maska, svetlomety, značka
    if integ:
        lz1 = 1.12; lz0 = .92; bz1 = .80
    else:
        lz1 = zn - .035; lz0 = zn - .20; bz1 = zn * .60
    gw = .26 * W if integ else .42 * wc
    D.patch('front', rect(-gw, lz0 + .02, gw, lz1 - .03, .03), .005, 'plast', step=.07)
    for k in (1, 2): D.strip('front', [(-gw + .02, lerp(lz0 + .02, lz1 - .03, k / 3)), (gw - .02, lerp(lz0 + .02, lz1 - .03, k / 3))], .012, .009, 'lesk cierny')
    D.patch('front', circle(0, (lz0 + lz1) / 2, .05, 20), .016, 'chrom', skirt=.012, step=.03)
    ly0 = gw + .04; ly1 = yedge((lz0 + lz1) / 2) - .03
    D.patch('front', round_poly([(ly0, lz1 - .02), (ly1, lz1 + .01), (ly1, lz0 + .05), (ly0 + .02, lz0)], .03), .009, 'svetlo puzdro', mirror=True, skirt=.009, step=.05)
    D.strip('front', [(ly0 + .03, lz1 - .04), (ly1 - .03, lz1 - .02)], .016, .0125, 'led biela', mirror=True)
    D.patch('front', circle(ly0 + .08, lz0 + .07, .034, 16), .0125, 'svetlo sklo', mirror=True, step=.03)
    D.strip('front', [(ly1 - .11, lz0 + .07), (ly1 - .03, lz0 + .09)], .014, .0125, 'led oranzova', mirror=True)
    by = yedge(zuf + .2) - .03; by0 = min(by, yedge(zuf + .09) - .05)
    D.patch('front', round_poly([(-by, bz1), (by, bz1), (by, zuf + .2), (by0, zuf + .07), (-by0, zuf + .07), (-by, zuf + .2)], .04), .005, 'plast', step=.09)
    D.patch('front', rect(-.38 * W, zuf + .09, .38 * W, zuf + .2, .03), .008, 'skara', step=.09)
    for k in (1, 2): D.strip('front', [(-.36 * W, zuf + .09 + k * .037), (.36 * W, zuf + .09 + k * .037)], .012, .011, 'plast svetly')
    plate(D, 'front', (zuf + .2 + bz1) / 2 + .02)
    D.patch('front', circle(.38 * W + .09, zuf + .145, .035, 14), .012, 'svetlo sklo', mirror=True, step=.03)

    # ---- zadok
    tz1 = min(zc + .25, Hb - .4) if not moto else 1.05; tz0 = tz1 - (.42 if not moto else .16); ty1 = yedge_r((tz0 + tz1) / 2) - .025
    if moto:
        D.patch('rear', rect(ty1 - .34, tz0, ty1, tz1, .03), .008, 'svetlo zadne', mirror=True, skirt=.008, step=.06)
        D.strip('rear', [(ty1 - .30, tz1 - .05), (ty1 - .13, tz1 - .05)], .03, .0115, 'led cervena', mirror=True)
        D.strip('rear', [(ty1 - .09, tz1 - .08), (ty1 - .04, tz1 - .08)], .05, .0115, 'led oranzova', mirror=True)
        D.patch('rear', rect(ty1 - .1, Hb - .34, ty1 - .02, Hb - .29, .01), .007, 'odrazka', mirror=True, step=.05)
        D.strip('rear', [(-.2, Hb - .3), (.2, Hb - .3)], .025, .008, 'led cervena')
        if not alcove: window(D, 'rear', -.55, 1.55, .55, 2.0, r=.06)
    else:
        D.patch('rear', round_poly([(ty1 - .11, tz1), (ty1, tz1), (ty1, tz0), (ty1 - .09, tz0)], .03), .008, 'svetlo zadne', mirror=True, skirt=.008, step=.06)
        D.strip('rear', [(ty1 - .055, tz1 - .05), (ty1 - .055, tz0 + .16)], .03, .0115, 'led cervena', mirror=True)
        D.strip('rear', [(ty1 - .055, tz0 + .11), (ty1 - .055, tz0 + .05)], .03, .0115, 'led oranzova', mirror=True)
        rz0 = belt(L) + .06; rz1 = Hb - .2; rw_ = ty1 - .16
        D.strip('rear', rect(-rw_ - .03, zur + .32, rw_ + .03, Hb - .1, .06), SW, SO, 'skara', closed=True)
        if 'tailgate' in feat or cat in ('campervan', 'minibus') and 'rear-wing-doors' not in feat:
            if cat != 'van': window(D, 'rear', -rw_ + .05, rz0, rw_ - .05, rz1, r=.06, frame='lesk cierny')
        else:
            D.strip('rear', [(0, zur + .32), (0, Hb - .1)], SW, SO, 'skara')
            if cat != 'van':
                for sg in (-1, 1): window(D, 'rear', min(sg * .05, sg * (rw_ - .05)), rz0, max(sg * .05, sg * (rw_ - .05)), rz1, r=.05, frame='lesk cierny')
        D.patch('rear', circle(0, rz0 - .16, .045, 18), .014, 'chrom', skirt=.01, step=.03)
    plate(D, 'rear', zur + (.48 if not moto else .42))
    D.patch('rear', rect(-yedge_r(zur + .15) + .04, zur + .04, yedge_r(zur + .15) - .04, zur + .26, .04), .006, 'plast', step=.1)
    D.patch('rear', rect(ty1 - .2, zur + .1, ty1 - .08, zur + .135, .008), .009, 'odrazka', mirror=True, step=.05)

    # ---- boky nadstavby
    if moto:
        z0 = zc + .0 if integ else zc - .05; z1 = min(z0 + .58, Hb - .45); x_end = L - .25; x_st = xb + .35 if not integ else xB + .3
        span = x_end - x_st
        for s, wins in ((1, [(.06, .30), (.42, .64), (.80, .97)]), (-1, [(.32, .52), (.80, .95)])):
            for a, b in wins: window(D, 'side', x_st + span * a, z0, x_st + span * b, z1, s=s)
        dx0 = x_st + span * .02 if not integ else xB - .15; dx1 = dx0 + .58; dz0 = und(dx0) + .12; dz1 = min(dz0 + 1.9, Hb - .28)
        D.strip('side', rect(dx0, dz0, dx1, dz1, .05), SW, SO, 'skara', s=-1, closed=True)
        window(D, 'side', dx0 + .1, z0 + .1, dx1 - .1, z1, s=-1, r=.04)
        D.patch('side', rect(dx0 + .05, dz0 + .95, dx0 + .085, dz0 + 1.09, .012), .02, 'lesk cierny', s=-1, skirt=.018, step=.05)
        for s in (-1, 1): D.strip('side', rect(x_end - 1.05, und(x_end) + .16, x_end - .1, und(x_end) + 1.05, .04), SW, SO, 'skara', s=s, closed=True)   # garáž
        zg = zc - .42
        D.strip('side', [(x, zg + .22 * sstep(x_st, x_st + span * .7, x)) for x in lin(xb + .1 if not integ else 1.7, L - .15, 26)], .07, .004, 'grafika', mirror=True)
        D.strip('side', [(x, zg + .09 + .22 * sstep(x_st, x_st + span * .7, x)) for x in lin(xb + .1 if not integ else 1.7, L - .15, 26)], .018, .004, 'grafika 2', mirror=True)
        ax0 = x_st + .1; ax1 = min(ax0 + 4.0, x_end - .2)                                      # markíza v kazete nad dverami
        D.box((L / 2 - (ax0 + ax1) / 2, -(c2 + .05), Hb - .2), (ax1 - ax0, .1, .11), 'hlinik', bevel=.025)
        for x in (lerp(x_st, x_end, .25), lerp(x_st, x_end, .75)):
            D.box((L / 2 - x, 0, Hb + .01), (.56, .56, .1), 'plast biely', bevel=.03); D.box((L / 2 - x, 0, Hb + .045), (.42, .42, .03), 'sklo svetle', bevel=.01)
        if alcove:                                                                              # alkovňa nad kabínou
            az0 = zw - .02; azc = (az0 + Hb) / 2; ax_ = (xc * .6 + xw + .9) / 2; al = (xw + .9 - xc * .6) / 2
            D.blob((L / 2 - ax_, 0, azc), (al, c2 - .005, (Hb - az0) / 2), PAINT, e=4.5, seg=28, rings=14)
            for s in (-1, 1): D.box((L / 2 - ax_ + .1, s * (c2 - .0), azc + .03), (.7, .02, .3), 'okno ram', bevel=.006); D.box((L / 2 - ax_ + .1, s * (c2 + .004), azc + .03), (.62, .02, .23), 'sklo', bevel=.004)
    else:
        xs0 = xB + .09; sl = .72 if K is CLASS['S'] else 1.02 if K is CLASS['M'] else 1.28; ztop_ = lambda x: zre(x) - .09
        if 'sliding-door-right' in feat:
            D.strip('side', [(xs0, zs(xs0)), (xs0 + sl, zs(xs0 + sl)), (xs0 + sl, ztop_(xs0 + sl)), (xs0, ztop_(xs0))], SW, SO, 'skara', s=-1)
            D.strip('side', [(xs0 + sl, belt(xs0) - .06), (min(xs0 + sl * 1.95, L - .4), belt(xs0) - .06)], .02, .004, 'skara', s=-1)
            D.patch('side', rect(xs0 + .06, gb(xs0) - .13, xs0 + .24, gb(xs0) - .085, .013), .022, 'lesk cierny', s=-1, skirt=.02, step=.06)
        if cat in ('campervan', 'minibus'):
            wz0 = gb(xs0) + .01; wz1 = lambda x: gtop(x) - .015; xr_ = L - .32
            nwin = max(2, int(round((xr_ - xs0) / 1.15))) if cat == 'minibus' else 2
            edges_ = [xs0 + .08, xs0 + sl - .06, xr_] if nwin == 2 else lin(xs0 + .08, xr_, nwin + 1)
            for i in range(len(edges_) - 1):
                a, b = edges_[i] + (.05 if i else 0), edges_[i + 1] - .05
                for s in (-1, 1):
                    D.patch('side', rect(a - .02, wz0 - .02, b + .02, wz1(a) + .02, .06), .004, 'lesk cierny', s=s, step=.12)
                    D.patch('side', rect(a, wz0, b, wz1(a), .05), .009, 'sklo', s=s, step=.12)
        if 'pop-top' in feat:
            D.patch('top', band(xw + .1, L - .45, lambda x: -(hwg(x) - .1), lambda x: hwg(x) - .1, r=.2), .012, 'plast biely', skirt=.012, step=.15)
        if 'awning' in feat:
            D.box((L / 2 - (xb + L - .5) / 2, -(ctrl(xb + 1)[6][0] + .03), Hb - .06), (L - .5 - xb, .09, .08), 'lesk cierny', bevel=.02)
        zf_ = R + R + .32; xf_ = fo + .75
        D.strip('side', rect(xf_ - .08, zf_ - .08, xf_ + .08, zf_ + .08, .03), .006, SO, 'skara', s=1, closed=True)

    spk = (6, False)
    wmf = wheel_mesh('koleso dodavka %d' % round(R * 1000), R, rim_r, tw, *spk)
    wheels = [(wmf, L / 2 - fo, s * yF, R) for s in (-1, 1)]
    for x in rear_ax:
        wheels += [(wmf, L / 2 - x, s * yR, R) for s in (-1, 1)]
        if twin: wheels += [(wmf, L / 2 - x, s * (yR - tw * 1.1), R) for s in (-1, 1)]
    return finish(c, body, D, wheels, dims='%.3f x %.3f x %.3f' % (Lreal, W, H))


def build(c): return build_caravan(c) if c['cat'] == 'caravan' else build_van(c)

if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:]
    SPEC = json.load(open(argv[0], encoding='utf-8')); OUT = os.path.abspath(argv[1]); os.makedirs(OUT, exist_ok=True)
    ONLY = argv[argv.index('--only') + 1].split(',') if '--only' in argv else None
    SPEC = SPEC if isinstance(SPEC, list) else list(SPEC.values())
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for c in SPEC:
        if ONLY and c['id'] not in ONLY: continue
        root, parts = build(c)
        bpy.ops.object.select_all(action='DESELECT')
        for p in parts: p.select_set(True)
        root.select_set(True)
        bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, c['id'] + '.glb'), export_format='GLB', use_selection=True, export_apply=True)
        root.location.y += 100
    print('DONE')
