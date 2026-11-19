# Postaví 3D modely osobných áut v Blenderi z rozmerov výrobcu a tvaru karosérie podľa typu.
#   blender -b --factory-startup -P kempy/models/car.py -- <spec.json> <out dir> [--only id,id] [--blend]
# spec.json: [{"id", "name", "body": suv|hatch|kombi|sedan|lift|small|mpv, "L", "W", "H", "wb", "fo", "trackF", "trackR", "tyre": "215/65 R17", "color": "#rrggbb", "p": {…úpravy tvaru}}] (mm)
# Výstup: <out>/<id>.glb v metroch, predok v smere +X, stred pôdorysu v počiatku, kolesá na zemi (z = 0).
# Dĺžka, šírka (bez zrkadiel), výška, rázvor, previsy, rozchod a priemer kolies sú presne podľa zadania.
# Pôdorysné pomery (poloha čelného skla, strechy, stĺpikov, zaoblenie rohov) sú tie isté ako v 2D pôdorysoch plánovača (draw.js).
import bpy, json, math, os, sys
from mathutils import Vector, Matrix
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shell import *

# Tvar podľa typu karosérie. Dĺžky v metroch, výšky ako podiel výšky karosérie (bez strešných líšt).
#   pôdorys (ako draw.js): nb, tf = roh predku (ako ďaleko a o koľko užší), tr, rb = roh zadku, rcF, rcR = zaoblenie rohov,
#     cowl = spodok čelného skla za prednou nápravou, ws = dĺžka čelného skla, rw = dĺžka zadného skla, deck = od zadného skla po koniec,
#     belt, roof = šírka pri spodku okien a pri streche (podiel šírky), sg = kde končí bočné sklo, pil = stĺpiky
#   výšky: zn = hrana kapoty, zc = spodok čelného skla, zbr = spodok okien vzadu, z3 = spodok zadného skla, rdrop = pokles strechy dozadu (m),
#     zmf, zmr = najvystupujúcejšie miesto predku a zadku, gc = svetlosť (m)
#   predok: gw, gh = polovičná šírka (podiel šírky auta) a výška masky, lh = výška svetlometov
TYPES = {
    'suv':   dict(nb=.17, tf=.11, tr=.07, rb=.08, rcF=.40, rcR=.28, cowl=.40, ws=.74, rw=.38, deck=.16, belt=.90, roof=.69, sg=.48, pil=[.40, .78],
                  zn=.64, zc=.70, zbr=.735, z3=.745, rdrop=.05, zmf=.37, zmr=.43, gc=.20, arch=.07, clad=True, rails=True, gw=.215, gh=.27, gt=.86, lh=.125, nTr=3.2, nP=3.1, Dt=.10),
    'hatch': dict(nb=.20, tf=.14, tr=.10, rb=.10, rcF=.46, rcR=.34, cowl=.36, ws=.78, rw=.40, deck=.14, belt=.88, roof=.65, sg=.35, pil=[.42],
                  zn=.505, zc=.64, zbr=.67, z3=.69, rdrop=.075, zmf=.325, zmr=.40, gc=.145, arch=.05, gw=.20, gh=.085, gt=.9, lh=.10, nTr=2.8),
    'small': dict(nb=.22, tf=.15, tr=.11, rb=.10, rcF=.46, rcR=.36, cowl=.24, ws=.70, rw=.34, deck=.13, belt=.88, roof=.66, sg=.30, pil=[.55], doors=2,
                  zn=.525, zc=.65, zbr=.675, z3=.695, rdrop=.06, zmf=.33, zmr=.40, gc=.145, arch=.05, gw=.19, gh=.08, gt=.9, lh=.11, nTr=2.8),
    'kombi': dict(nb=.20, tf=.14, tr=.09, rb=.09, rcF=.46, rcR=.30, cowl=.38, ws=.82, rw=.36, deck=.12, belt=.88, roof=.65, sg=.70, pil=[.34, .66],
                  zn=.495, zc=.63, zbr=.66, z3=.68, rdrop=.05, zmf=.32, zmr=.40, gc=.14, arch=.05, rails=True, gw=.21, gh=.10, gt=.9, lh=.09, nTr=3.0),
    'sedan': dict(nb=.20, tf=.14, tr=.11, rb=.11, rcF=.46, rcR=.34, cowl=.38, ws=.82, rw=.70, deck=.50, belt=.88, roof=.64, sg=.30, pil=[.45], trunk=True,
                  zn=.495, zc=.63, zbr=.66, z3=.67, rdrop=.085, zmf=.32, zmr=.41, gc=.14, arch=.05, gw=.21, gh=.10, gt=.9, lh=.09, nTr=2.6),
    'lift':  dict(nb=.20, tf=.14, tr=.11, rb=.11, rcF=.46, rcR=.34, cowl=.38, ws=.82, rw=.84, deck=.30, belt=.88, roof=.64, sg=.50, pil=[.42], trunk=True,
                  zn=.495, zc=.63, zbr=.66, z3=.66, rdrop=.11, zmf=.32, zmr=.41, gc=.14, arch=.05, gw=.21, gh=.10, gt=.9, lh=.09, nTr=2.6),
    'mpv':   dict(nb=.20, tf=.14, tr=.08, rb=.08, rcF=.46, rcR=.28, cowl=.16, ws=.92, rw=.30, deck=.10, belt=.91, roof=.72, sg=.70, pil=[.30, .60],
                  zn=.525, zc=.63, zbr=.675, z3=.695, rdrop=.04, zmf=.33, zmr=.40, gc=.155, arch=.05, gw=.20, gh=.09, gt=.9, lh=.10, nTr=3.2),
    'pickup': dict(nb=.12, tf=.08, tr=.02, rb=.02, rcF=.32, rcR=.10, cowl=.46, ws=.62, rw=.07, deck=1.7, belt=.91, roof=.72, sg=.2, pil=[.48], trunk=True, pickup=True,
                  zn=.60, zc=.685, zbr=.70, z3=.705, rdrop=.03, zmf=.36, zmr=.45, gc=.23, arch=.08, clad=True, gw=.24, gh=.26, gt=.9, lh=.12, nTr=5.0, nPr=4.0, belt3=.955, roof3=.80),
}
# Tvár auta podľa značky (bez log): tvar masky, svetlometov a zadných svetiel.
FACES = {
    'vw':       dict(grille='slim', lamp='slim', tail='slim'),
    'skoda':    dict(grille='frame', bars='v', gh_k=1.3, gt=.8, lamp='slim', tail='slim'),
    'kia':      dict(grille='frame', bars='h', chrome=False, gt=.7, gw_k=1.15, lamp='slim', tail='slim', bar=True),
    'toyota':   dict(grille='none', lamp='slim', tail='slim', intake='wide'),
    'fiat':     dict(grille='none', lamp='round', tail='tall', whisker=True, intake='small'),
    'tesla':    dict(grille='none', lamp='slim', tail='slim', intake='small'),
    'dacia':    dict(grille='frame', bars='h', chrome=False, gw_k=1.25, gh_k=.75, lamp='tall', tail='tall'),
    'bmw':      dict(grille='kidney', lamp='slim', tail='slim'),
    'audi':     dict(grille='frame', bars='h', chrome=False, gh_k=1.8, gt=.72, lamp='slim', tail='slim', bar=True),
    'mercedes': dict(grille='frame', bars='h', gh_k=1.3, gt=.85, lamp='slim', tail='slim', badge_k=1.7),
    'ford':     dict(grille='frame', bars='h', chrome=False, gh_k=1.25, gt=.8, lamp='slim', tail='tall'),
    'peugeot':  dict(grille='frame', bars='v', chrome=False, gw_k=1.2, gh_k=1.3, gt=.92, lamp='slim', tail='slim', bar=True),
    'renault':  dict(grille='slim', chrome=False, lamp='tall', tail='slim', badge_k=1.3),
    'volvo':    dict(grille='frame', bars='v', gh_k=1.5, gt=.9, lamp='slim', tail='tall'),
    'mazda':    dict(grille='frame', bars='h', chrome=False, gh_k=1.5, gt=.6, lamp='slim', tail='slim'),
    'jeep':     dict(grille='slots', lamp='round', tail='tall'),
}
NC = 3; NS = [2, 1, 3, 1, 2, 3, 3, 3]                       # delenie rezu: zaoblenia a rovné úseky
ROWS = fillet_rows([0, 1, 1, 1, 1, 1, 1, 1, 0], NC, NS)

def lin(a, b, n): return [lerp(a, b, k / (n - 1)) for k in range(n)]

def build_car(c):
    T = dict(TYPES[c['body']]); T.update(c.get('p', {})); pickup = T.get('pickup')
    if pickup: T['deck'] = c.get('bed', 1500) / 1000 + .20    # korba + zadné čelo + medzera za kabínou
    L, W, H = c['L'] / 1000, c['W'] / 1000, c['H'] / 1000; c2 = W / 2
    R, rim_r, tw = tyre_dims(c['tyre'])
    Hb = H - (0.05 if T.get('rails') else 0.0)           # výška karosérie bez strešných líšt
    gc = T['gc']; fo = c['fo'] / 1000; xfa = fo; xra = fo + c['wb'] / 1000
    trF = c.get('trackF', c['W'] - 280) / 1000; trR = c.get('trackR', c['W'] - 290) / 1000
    Ra = R + T['arch']; trunk = T.get('trunk')
    xc = fo + T['cowl']; xw = xc + T['ws']; x3 = L - T['deck']; x2 = x3 - T['rw']; xpk = lerp(xw, x2, .3)
    zn = Hb * T['zn']; zc = Hb * T['zc']; z2 = Hb - T['rdrop']; z3 = Hb * T['z3']
    PAINT = paint(c.get('color', '#8a9199')).name

    # ---- bočný profil (horný obrys v osi auta)
    prof = profile([(0, zn), (xc * .5, lerp(zn, zc, .5) + .03, .5), (xc, zc, .035), (xw, Hb - .03, .26), (xpk, Hb, .5),
                    (x2, z2, .05 if pickup else .22 if trunk else .16), (x3, z3, .03 if pickup else .10 if trunk else .05), (L, z3 - (.05 if trunk and not pickup else 0))])
    lift = Hb - max(prof.y)                               # zaoblenie znížilo vrchol strechy: dorovnať na presnú výšku
    prof.y = [z + lift * sstep(xc, xw, x) * (1 - sstep(x2, x3, x)) for x, z in zip(prof.x, prof.y)]
    Dt = T.get('Dt', .10); Dp = T['nb'] + T['rcF'] * .7; Db = .20
    Dtr = .05 if pickup else .14 if trunk else T['deck'] + .05; Dpr = T['rb'] + T['rcR'] * .9; Dbr = .26
    zmf = Hb * T['zmf']; zmr = Hb * T['zmr']
    def zmid(x): return lerp(zmf, zmr, sstep(L * .3, L * .7, x))
    def top(x): zm = zmid(x); return zm + (prof(x) - zm) * sup(x / Dt, 2.2) * sup((L - x) / Dtr, T['nTr'])
    def und(x): return gc + .02 + .08 * sstep(xra + Ra * .6, L - .1, x)
    def bot(x): zm = zmid(x); return zm - (zm - und(x)) * sup(x / Db, 2.0) * sup((L - x) / Dbr, 2.0)
    def wmax(x):
        ins = T['tf'] * .55 * (1 - sstep(T['nb'], fo + .15, x)) + T['tr'] * .6 * sstep(xra + .10, L - T['rb'], x)   # v 3D menšie zúženie než v pôdoryse
        return (c2 - ins) * sup(x / Dp, T.get('nP', 3.0)) * sup((L - x) / Dpr, T.get('nPr', 2.8))
    zbf = zc - .028; zbr = Hb * T['zbr']
    B3 = T.get('belt3', T['belt'] + .055); R3 = T.get('roof3', T['roof'] + .05)   # v 3D: rameno pod oknami a hrana strechy (pôdorys kreslí sklo, nie plech)
    def blt(x): return lerp(zbf, zbr, clamp((x - xc) / (x3 - xc)))
    def wt(x):                                            # polovičná šírka pri hrane strechy
        if x <= xw: return lerp(wmax(xc) * B3 - .012, c2 * R3, clamp((x - xc) / (xw - xc)))
        if x <= x2: return c2 * R3 * lerp(1, .97, (x - xw) / (x2 - xw))
        return lerp(c2 * R3 * .97, wmax(x3) * B3 - (.11 if trunk else .035), smooth((x - x2) / (x3 - x2)))
    def cab(x): return sstep(xc - .03, xc + .09, x) * ((1 - sstep(x3 - .02, x3 + .12, x)) if trunk else 1.0)

    def ctrl(x):                                          # polovičný rez: spodok, prah, najširšie miesto, pás okien, hrana strechy, strecha
        w = wmax(x); zt = top(x); zb = bot(x); g = cab(x)
        k = clamp((zt - zb) / .7); kw = clamp(w / .5); e = 1e-4
        zbl = min(blt(x), zt - .03 * k)
        p4h = (w - .012 * kw, zt - .11 * k); p5h = (w - .16 * kw, zt - .04 * k)
        p4c = (w * B3, zbl); p5c = (min(wt(x), w * B3 - .012 * kw), max(zt - .055, zbl + .008))
        p4 = (lerp(p4h[0], p4c[0], g), lerp(p4h[1], p4c[1], g)); p5 = (lerp(p5h[0], p5c[0], g), lerp(p5h[1], p5c[1], g))
        return [(0, zb), (max(0, w - .19 * kw), zb, .05 * k + e), (w - .045 * kw, zb + .13 * k, .05 * k + e), (w, zb + .50 * (p4[1] - zb), .14 * k + e), (w, zb + .76 * (p4[1] - zb), .07 * k + e),
                (p4[0], p4[1], lerp(.09, .018, g) * k + e), (p5[0], p5[1], lerp(.08, .075, g) * k + e), (p5[0] * .5, zt - .010 * k, .3 * kw + e), (0, zt)]
    sh = Shell(L, ctrl, NC, NS)

    cap = [0, .0006, .0025, .006, .012, .022, .037, .058, .085, .12, .165, .22, .29, .38, .5, .65, .82, 1]
    xs = set([Dp * t for t in cap] + [L - Dpr * t for t in cap] + [Dt * t for t in cap] + [L - Dtr * t for t in cap])
    n = int(L / .055); xs |= {L * i / n for i in range(n + 1)} | {xc - .03, xc, xc + .03, xc + .09, xw, x2, x3, x3 + .06}
    xs = sorted(x for x in xs if 0 <= x <= L); st = [xs[0]]
    for x in xs[1:]:
        if x - st[-1] > min(.012, max(.0004, min(x, L - x) * .3)): st.append(x)
    st[-1] = L
    clad = T.get('clad')
    def face_mat(h, x):
        if h < ROWS[1] + 2: return 1 if Db * .75 < x < L - Dbr * .75 else 0   # spodok (zdvihnutý spodok nárazníkov ostáva vo farbe)
        if clad and h < ROWS[2] + NC + 1 and Db * .4 < x < L - Dbr * .4: return 1   # plastový lem prahov
        return 0
    body = sh.build(c['id'], st, [M(PAINT), M('plast')], face_mat)
    cuts = []
    for X, tr in ((L / 2 - xfa, trF), (L / 2 - xra, trR)):
        y_in = tr / 2 - tw / 2 - .05; y_out = c2 + .06
        cuts += [(X, s * (y_in + y_out) / 2, R, Ra, y_out - y_in) for s in (-1, 1)]
    cut_cylinders(body, cuts, M('podbeh'))
    shade(body.data, 40)

    D = Detail(sh)
    def zre(x): return ctrl(x)[6][1]                      # výška hrany strechy
    def gtop(x): return zre(x) - .072                     # horná hrana bočných okien
    def gb(x): return blt(x) + .022                       # spodná hrana bočných okien

    # ---- bočné okná: čierny pás okolo, tabule medzi stĺpikmi
    pA = .095; xD = x2 + T['rw'] * T['sg']; xC = x2 - .05
    def hi(x):
        h = gtop(x - pA)
        return min(h, lerp(gtop(xC - pA), gb(xD), (x - xC) / (xD - xC))) if x > xC else h
    xA = next((x for x in lin(xc, xw, 120) if hi(x) - gb(x) > .03), xc + .2)
    D.patch('side', band(xA - .025, xD + .012, lambda x: gb(x) - .012, lambda x: hi(x) + .012, r=.03), .004, 'lesk cierny', mirror=True)
    Bx = xw + .11; pil = [lerp(Bx, xD, t) for t in T['pil']]; edges = [xA] + pil + [xD]
    for i in range(len(edges) - 1):
        a = edges[i] + (.038 if i else 0); b = edges[i + 1] - (.038 if i < len(edges) - 2 else 0)
        D.patch('side', band(a, b, gb, hi, inset=.011, r=.035), .009, 'sklo', mirror=True)
    D.strip('side', [(x, gb(x) - .021) for x in lin(xA - .03, xD + .01, 30)], .011, .006, 'chrom', mirror=True)

    # ---- čelné a zadné sklo
    def hwg(x): return ctrl(x)[6][0] - .03
    x0, x1 = xc + .05, xw - .012
    D.patch('top', band(x0 - .022, x1 + .012, lambda x: -hwg(x) - .016, lambda x: hwg(x) + .016, r=.07), .004, 'lesk cierny')
    D.patch('top', band(x0, x1, lambda x: -hwg(x), hwg, inset=.004, r=.06), .009, 'sklo')
    def hwr(x): return ctrl(x)[6][0] - .055
    x0, x1 = x2 + .055, x3 - .03
    if x1 - x0 > .12:
        D.patch('top', band(x0 - .018, x1 + .016, lambda x: -hwr(x) - .016, lambda x: hwr(x) + .016, r=.07), .004, 'lesk cierny')
        D.patch('top', band(x0, x1, lambda x: -hwr(x), hwr, inset=.004, r=.06), .009, 'sklo')
    if pickup:                                            # korba: tmavé dno medzi bočnicami, lišty na hranách
        b1 = L - .09; b0 = b1 - c.get('bed', 1500) / 1000; hb_ = lambda x: wmax(x) - .13
        D.patch('top', band(b0, b1, lambda x: -hb_(x), hb_, r=.04), .004, 'plast')
        for sg in (-1, 1):
            D.strip('top', [(x, sg * (wmax(x) - .075)) for x in lin(b0 - .02, b1 + .03, 12)], .05, .006, 'plast svetly')
        D.strip('top', [(b1 + .045, -hb_(b1)), (b1 + .045, hb_(b1))], .05, .006, 'plast svetly')
    D.patch('top', band(xc - .085, xc + .04, lambda x: -hwg(xc + .05) - .05, lambda x: hwg(xc + .05) + .05, r=.03), .003, 'plast')   # kryt pod stieračmi
    for a, b in ((-.40, -.03), (.03, .40)):
        D.strip('top', [(xc + .05, a * W), (xc + .085, b * W)], .017, .018, 'lesk cierny')

    # ---- predok: maska, svetlomety, značka, spodný otvor (štýl podľa značky: FACES)
    def yedge(z): return sh.side_y(Dp * .8, z)
    F = dict(FACES.get(c.get('face', 'vw'), FACES['vw'])); F.update(c.get('facep', {}))
    gs = F['grille']; gw = T['gw'] * W * F.get('gw_k', 1); gh = clamp(T['gh'] * F.get('gh_k', 1), .09, .30); gz1 = zn - .05; gz0 = gz1 - gh; gt = F.get('gt', T['gt'])
    frame_mat = 'chrom' if F.get('chrome', True) else 'lesk cierny'
    lh = T['lh'] * F.get('lh_k', 1); lz1 = zn - .045; lz0 = lz1 - lh
    def grille_piece(pts, r, bars):
        ya, yb = min(q[0] for q in pts), max(q[0] for q in pts); za, zb_ = min(q[1] for q in pts), max(q[1] for q in pts); cy, cz = (ya + yb) / 2, (za + zb_) / 2
        fw = .02; sy = 1 - 2 * fw / (yb - ya); sz = 1 - 2 * fw / (zb_ - za)
        inner = round_poly([(cy + (q[0] - cy) * sy, cz + (q[1] - cz) * sz) for q in pts], r * .6)
        D.patch('front', round_poly(pts, r), .012, frame_mat, holes=[inner], skirt=.012, step=.05)
        D.patch('front', inner, .004, 'plast', step=.05)
        if bars == 'h':
            n_ = max(2, int(round((zb_ - za) / .045)))
            for k in range(1, n_):
                z = lerp(za + fw, zb_ - fw, k / n_); sp = hspan(inner, z)
                if sp: D.strip('front', [(sp[0] + .006, z), (sp[1] - .006, z)], .013, .008, 'lesk cierny')
        else:
            n_ = max(3, int(round((yb - ya) / .05)))
            for k in range(1, n_):
                y = lerp(ya + fw, yb - fw, k / n_); sp = vspan(inner, y)
                if sp: D.strip('front', [(y, sp[0] + .006), (y, sp[1] - .006)], .011, .008, 'lesk cierny')
    if gs == 'frame':
        grille_piece([(-gw, gz1), (gw, gz1), (gw * gt, gz0), (-gw * gt, gz0)], .035, F.get('bars', 'h'))
    elif gs == 'kidney':
        for sg in (-1, 1):
            grille_piece([(sg * .014, gz1), (sg * gw, gz1), (sg * gw * gt, gz0), (sg * .014, gz0)] if sg > 0 else [(-gw, gz1), (-.014, gz1), (-.014, gz0), (-gw * gt, gz0)], .04, 'v')
    elif gs == 'slots':
        sw_ = 2 * gw / 7
        for k in range(7):
            y = -gw + sw_ * (k + .5)
            D.patch('front', rect(y - sw_ * .36, gz0, y + sw_ * .36, gz1, .03), .005, 'plast', step=.05)
    elif gs == 'slim':
        sz1 = lz1 - .012; sz0 = sz1 - min(.05, lh * .55)
        D.patch('front', rect(-gw, sz0, gw, sz1, .012), .005, 'plast', step=.05)
        D.strip('front', [(-gw, sz1 + .004), (gw, sz1 + .004)], .012, .009, frame_mat)
        D.strip('front', [(-gw + .01, (sz0 + sz1) / 2), (gw - .01, (sz0 + sz1) / 2)], .008, .008, 'lesk cierny')
    if F.get('whisker'): D.strip('front', [(-.19 * W, lz1 - lh * .5), (.19 * W, lz1 - lh * .5)], .016, .009, 'chrom')
    bz = gz1 - .012 - min(.05, gh * .4) if gs == 'frame' else (gz1 + .012 if gs in ('kidney', 'slots') else lz1 - lh * .5 - (.0 if gs == 'none' else .05))
    D.patch('front', circle(0, bz, .034 * F.get('badge_k', 1), 18), .017, 'chrom', skirt=.012, step=.03)                     # znak (bez loga)
    ly0 = (gw if gs != 'none' else .215 * W) + (.012 if gs == 'slim' else .03); ly1 = yedge(lz1 - lh * .5) - .028
    lamp_s = F.get('lamp', 'slim')
    if lamp_s == 'round':
        rr = .074; yc = min(ly1 - rr * .7, .36 * W); zc_ = lz1 - rr * .75
        D.patch('front', circle(yc, zc_, rr, 24), .012, 'chrom', holes=[circle(yc, zc_, rr - .012, 24)], mirror=True, skirt=.012, step=.03)
        D.patch('front', circle(yc, zc_, rr - .012, 24), .008, 'svetlo sklo', mirror=True, step=.03)
        D.patch('front', circle(yc, zc_, rr * .32, 14), .011, 'led biela', mirror=True, step=.03)
        D.patch('front', circle(yc - rr * .7, zc_ - rr * 1.7, rr * .5, 18), .009, 'svetlo sklo', mirror=True, skirt=.008, step=.03)
        lz0 = zc_ - rr * 2.2
    elif lamp_s == 'tall':
        lz0 = lz1 - lh * 1.45
        lamp = round_poly([(ly0, lz1), (ly1, lz1 + .012), (ly1 + .004, lz0 + lh * .5), (ly0 + .04, lz0)], .03)
        D.patch('front', lamp, .009, 'svetlo puzdro', mirror=True, skirt=.009, step=.04)
        ym = (ly0 + ly1) / 2
        D.strip('front', [(ly0 + .03, lz1 - .025), (ym, lz1 - lh * .55), (ly1 - .03, lz1 - .02)], .014, .0125, 'led biela', mirror=True)
        D.strip('front', [(ym, lz1 - lh * .55), (ym + .01, lz0 + .04)], .014, .0125, 'led biela', mirror=True)
        D.patch('front', circle(ly0 + .07, lz0 + lh * .42, .028, 16), .0125, 'svetlo sklo', mirror=True, step=.03)
    else:
        lamp = round_poly([(ly0, lz1), (ly1, lz1 + .012), (ly1 + .004, lz0 + lh * .42), (ly0 + .02, lz0)], .028)
        D.patch('front', lamp, .009, 'svetlo puzdro', mirror=True, skirt=.009, step=.04)
        D.strip('front', [(ly0 + .025, lz1 - .022), (ly1 - .03, lz1 - .012)], .014, .0125, 'led biela', mirror=True)
        for i in range(2):
            D.patch('front', circle(ly0 + .075 + i * .09, lz0 + lh * .40, .03, 16), .0125, 'svetlo sklo', mirror=True, step=.03)
        D.strip('front', [(ly1 - .12, lz0 + lh * .30), (ly1 - .02, lz0 + lh * .5)], .012, .0125, 'led oranzova', mirror=True)
    pz = (gz0 if gs in ('frame', 'kidney', 'slots') else lz0 - .015) - .095
    D.patch('front', rect(-.26, pz - .056, .26, pz + .056, .012), .007, 'spz', skirt=.007, step=.06)
    D.patch('front', rect(-.255, pz - .051, -.212, pz + .051, .008), .0085, 'spz modra', step=.06)
    for k in range(7):
        D.patch('front', rect(-.185 + k * .058, pz - .03, -.185 + k * .058 + .036, pz + .03, .004), .0085, 'spz text', step=.06)
    zuf = und(.3); zur = und(L - .3); iz0 = zuf + .06; iz1 = min(pz - .08, zuf + .27); iw = .34 * W
    if F.get('intake') == 'small': iz1 = min(iz1, iz0 + .09); iw = .26 * W
    ia, ib = (iw * .72, iw) if F.get('intake') == 'wide' else (iw, iw * .86)      # šírka hore a dole
    if iz1 - iz0 > .06:
        D.patch('front', round_poly([(-ia, iz1), (ia, iz1), (ib, iz0), (-ib, iz0)], .03), .005, 'plast', step=.06)
        nk = 2 if iz1 - iz0 < .14 else 3
        for k in range(1, nk + 1):
            z = lerp(iz0, iz1, k / (nk + 1)); wz = lerp(ib, ia, k / (nk + 1)) - .02; D.strip('front', [(-wz, z), (wz, z)], .012, .009, 'plast svetly')
    if clad: D.patch('front', rect(-.27 * W, zuf + .075, .27 * W, zuf + .11, .012), .009, 'hlinik', step=.06)
    fy = iw + .045; fy1 = min(fy + .11, yedge(zuf + .18) - .04)
    if fy1 - fy > .05:
        D.patch('front', rect(fy, zuf + .10, fy1, zuf + .25, .025), .005, 'plast', mirror=True, step=.05)
        D.strip('front', [(fy + .02, zuf + .205), (fy1 - .02, zuf + .205)], .014, .009, 'led biela', mirror=True)

    # ---- zadok: svetlá, značka, spodok nárazníka
    def yedge_r(z): return sh.side_y(L - Dpr * .8, z)
    if pickup: F['tail'] = 'tall'
    tz1 = z3 - (.07 if trunk else .04); th = .125; tz0 = tz1 - th; ty1 = yedge_r(tz1 - th * .5) - .022; ty0 = ty1 * .50
    if F.get('tail') == 'tall':                           # zvislé svetlá v rohoch
        ty0 = ty1 - .12; tz0 = tz1 - .30; ty1b = yedge_r(tz0 + .04) - .022
        tail = round_poly([(ty0, tz1), (ty1, tz1), (min(ty1, ty1b), tz0), (min(ty0, ty1b - .11) + .015, tz0)], .032)
        D.patch('rear', tail, .009, 'svetlo zadne', mirror=True, skirt=.009, step=.04)
        D.strip('rear', [(ty0 + .045, tz1 - .035), (ty0 + .045, tz0 + .11)], .018, .0125, 'led cervena', mirror=True)
        D.strip('rear', [(ty0 + .03, tz0 + .05), (ty0 + .085, tz0 + .05)], .016, .0125, 'led oranzova', mirror=True)
    else:
        tail = round_poly([(ty0, tz1 - .02), (ty1, tz1), (ty1 + .003, tz0 + .03), (ty0, tz0 + .02)], .025)
        D.patch('rear', tail, .009, 'svetlo zadne', mirror=True, skirt=.009, step=.04)
        D.strip('rear', [(ty0 + .02, tz1 - .045), (ty1 - .025, tz1 - .03)], .016, .0125, 'led cervena', mirror=True)
        D.strip('rear', [(ty0 + .02, tz0 + .045), (ty1 - .04, tz0 + .05)], .012, .0125, 'led oranzova', mirror=True)
        if F.get('bar'): D.patch('rear', rect(-ty0 + .004, tz1 - .062, ty0 - .004, tz1 - .034, .008), .009, 'svetlo zadne', step=.06)
    pzr = lerp(zur + .16, tz0, .62)
    D.patch('rear', rect(-.26, pzr - .056, .26, pzr + .056, .012), .007, 'spz', skirt=.007, step=.06)
    D.patch('rear', rect(-.255, pzr - .051, -.212, pzr + .051, .008), .0085, 'spz modra', step=.06)
    for k in range(7):
        D.patch('rear', rect(-.185 + k * .058, pzr - .03, -.185 + k * .058 + .036, pzr + .03, .004), .0085, 'spz text', step=.06)
    D.strip('rear', [(-.30, pzr + .085), (.30, pzr + .085)], .018, .010, 'chrom')
    D.patch('rear', circle(0, lerp(pzr + .085, tz0, .55), .032, 18), .015, 'chrom', skirt=.01, step=.03)
    bw_ = .38 * W
    D.patch('rear', round_poly([(-bw_, zur + .22), (bw_, zur + .22), (bw_ * .9, zur + .07), (-bw_ * .9, zur + .07)], .03), .005, 'plast', step=.06)
    if clad: D.patch('rear', rect(-.25 * W, zur + .085, .25 * W, zur + .125, .012), .009, 'hlinik', step=.06)
    ry = min(bw_ + .03, yedge_r(zur + .24) - .14)
    D.patch('rear', rect(ry, zur + .225, ry + .11, zur + .252, .008), .008, 'odrazka', mirror=True, step=.05)

    # ---- boky: škáry dverí, kľučky, viečko nádrže, lemy blatníkov
    SW, SO = .007, .003
    def zs(x): return bot(x) + .16
    xd0 = xfa + Ra + .08; doors = T.get('doors', 4); xB = pil[0]
    D.strip('side', [(xd0, zs(xd0)), (xd0, gb(xd0) - .035)], SW, SO, 'skara', mirror=True)
    Rs = Ra + .065; handles = []
    def rear_edge(xe):                                    # zadná hrana dverí: zvislo dolu, pri kolese po oblúku podbehu
        if abs(xe - xra) >= Rs or xe > xra: return [(xe, gb(xe) - .035), (xe, zs(xe))], xe
        zi = R + math.sqrt(Rs * Rs - (xe - xra) ** 2); a0 = math.atan2(zi - R, xe - xra); a1 = math.pi - math.asin(clamp((zs(xra - Rs) - R) / Rs, -1, 1))
        arc = [(xra + Rs * math.cos(a), R + Rs * math.sin(a)) for a in lin(a0, a1, 14)]
        return [(xe, gb(xe) - .035)] + arc, arc[-1][0]
    if doors == 4 and len(pil) > 1:
        D.strip('side', [(xB, zs(xB)), (xB, gb(xB) - .035)], SW, SO, 'skara', mirror=True)
        line, xend = rear_edge(pil[1]); handles = [xB - .19, pil[1] - .19]
    elif doors == 4:                                      # štvordverové bez tretieho okna: zadné dvere končia pri konci okien
        D.strip('side', [(xB, zs(xB)), (xB, gb(xB) - .035)], SW, SO, 'skara', mirror=True)
        line, xend = rear_edge(xD - .05); handles = [xB - .19, xD - .05 - .19]
    else:
        line, xend = rear_edge(xB + .04); handles = [xB + .04 - .19]
    D.strip('side', line, SW, SO, 'skara', mirror=True)
    D.strip('side', [(x, zs(x)) for x in lin(xd0, xend, 16)], SW, SO, 'skara', mirror=True)
    for xh in handles:
        zh = gb(xh) - .09
        D.patch('side', rect(xh - .105, zh - .032, xh + .105, zh + .026, .024), .003, 'skara', mirror=True, step=.05)          # priehlbina za kľučkou
        D.patch('side', rect(xh - .095, zh - .012, xh + .095, zh + .016, .013), .022, PAINT, mirror=True, skirt=.02, step=.05)
    zf = R + Ra + .17; xf = xra + .10
    if zf + .08 < gb(xf) - .04:
        D.strip('side', rect(xf - .075, zf - .07, xf + .075, zf + .07, .028), .006, SO, 'skara', s=-1, closed=True)
    if clad:
        for xa in (xfa, xra):
            ro = Ra + .06; ri = Ra - .006; a0 = math.asin(clamp((bot(xa) + .035 - R) / ro, -1, 1))
            ring = [(xa + ro * math.cos(a), R + ro * math.sin(a)) for a in lin(a0, math.pi - a0, 28)] + [(xa + ri * math.cos(a), R + ri * math.sin(a)) for a in lin(math.pi - a0, a0, 28)]
            D.patch('side', ring, .008, 'plast', mirror=True, skirt=.008, step=.05)
    # škára medzi kapotou a blatníkmi
    D.strip('top', [(x, wmax(x) - .17) for x in lin(Dp * .75, xc - .06, 14)], SW, SO, 'skara', mirror=True)

    # ---- zrkadlá
    xm = xA + .02; zm_ = gb(xm) + .05
    for s in (-1, 1):
        ym = sh.side_y(xm, gb(xm) - .03); X = L / 2 - xm
        D.box((X, s * (ym + .035), zm_ - .03), (.07, .11, .03), 'lesk cierny', bevel=.008)
        D.blob((X + .005, s * (ym + .105), zm_ + .014), (.05, .092, .06), PAINT, e=2.9)
        D.box((X - .047, s * (ym + .105), zm_ + .014), (.006, .15, .088), 'zrkadlo')

    # ---- strešné lišty a anténa
    if T.get('rails'):
        xr0, xr1 = xw + .10, x2 - .06
        for s in (-1, 1):
            path = []
            for x in lin(xr0, xr1, 18):
                y = ctrl(x)[6][0] - .05; t = (x - xr0) / (xr1 - xr0)
                path.append(Vector((L / 2 - x, s * y, sh.top_z(x, y) + (H - .022 - sh.top_z(xpk, y)) * sup(min(t, 1 - t) / .10, 2.0))))
            D.sweep(path, [(-.016, -.006), (-.013, .014), (0, .022), (.013, .014), (.016, -.006)], 'hlinik')
    dz = max((v.co.z for v in D.bm.verts), default=0)     # výška s lištami (anténa sa do výšky nepočíta)
    D.blob((L / 2 - (x2 - .20), 0, top(x2 - .20) + .004), (.085, .022, .03), 'lesk cierny', e=2.2, zmin=0.0)

    bb = [Vector(co) for co in body.bound_box]            # rozmery samotnej karosérie (bez zrkadiel, značiek a líšt)
    dims = (max(v.x for v in bb) - min(v.x for v in bb), max(v.y for v in bb) - min(v.y for v in bb), max(v.z for v in bb))
    det = D.finish(c['id'] + ' detaily'); shade(det.data, 45)
    bpy.ops.object.select_all(action='DESELECT'); det.select_set(True); body.select_set(True); bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()

    # ---- kolesá
    wm = wheel_mesh('koleso %d %d %d' % (round(R * 1000), round(rim_r * 1000), round(tw * 1000)), R, rim_r, tw, T.get('spokes', 5), T.get('twin', True))
    parts = [body]
    for X, tr in ((L / 2 - xfa, trF), (L / 2 - xra, trR)):
        for s in (-1, 1):
            o = bpy.data.objects.new('koleso', wm); bpy.context.scene.collection.objects.link(o)
            o.location = (X, s * tr / 2, R); o.rotation_euler = (0, 0, 0 if s > 0 else math.pi); parts.append(o)
    root = bpy.data.objects.new(c['id'], None); bpy.context.scene.collection.objects.link(root)
    for p in parts: p.parent = root
    root['nazov'] = c['name']; root['rozmery_mm'] = [c['L'], c['W'], c['H']]
    print('MODEL %s  karoséria %.3f x %.3f m, výška s lištami %.3f m  (zadané %.3f x %.3f x %.3f)' % (c['id'], dims[0], dims[1], max(dims[2], dz), L, W, H))
    return root, parts


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:]
    SPEC = json.load(open(argv[0], encoding='utf-8')); OUT = os.path.abspath(argv[1]); os.makedirs(OUT, exist_ok=True)
    ONLY = argv[argv.index('--only') + 1].split(',') if '--only' in argv else None
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for c in SPEC:
        if ONLY and c['id'] not in ONLY: continue
        root, parts = build_car(c)
        bpy.ops.object.select_all(action='DESELECT')
        for p in parts: p.select_set(True)
        root.select_set(True)
        bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, c['id'] + '.glb'), export_format='GLB', use_selection=True, export_apply=True)
        root.location.y += 100                             # ďalšie auto sa stavia na čistom mieste
        if '--blend' in argv: bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'auta.blend'))
    print('DONE')
