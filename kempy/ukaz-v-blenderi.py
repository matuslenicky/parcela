# Otvorí model kempu v okne Blendera a nastaví pohľad: blender kempy/<slug>/camp.blend --python kempy/ukaz-v-blenderi.py
# Model nevzniká ručne v okne: stavia ho skript kempy/build_camp.py z dát kempy/<slug>/camp.json (blender -b, asi 30 s).
import bpy


def nastav():
    for w in bpy.context.window_manager.windows:
        for a in w.screen.areas:
            if a.type != 'VIEW_3D':
                continue
            s = a.spaces[0]
            s.shading.type = 'SOLID'
            s.shading.color_type = 'MATERIAL'      # farby materiálov bez vykresľovania (funguje aj na slabšej grafike)
            s.shading.show_shadows = True
            s.shading.show_cavity = True
            s.overlay.show_floor = False
            s.clip_end = 3000
            r = next(r for r in a.regions if r.type == 'WINDOW')
            with bpy.context.temp_override(window=w, area=a, region=r):
                bpy.ops.view3d.view_all(center=False)
    return None


bpy.app.timers.register(nastav, first_interval=1.0)
