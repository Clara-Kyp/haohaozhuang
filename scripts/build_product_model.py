"""Blender-only, bounded semantic geometry; never executes model-provided code."""
import argparse,json,math,sys,traceback
from pathlib import Path
import bpy,numpy as np
from mathutils import Matrix,Vector

parser=argparse.ArgumentParser();parser.add_argument('--folder',required=True)
folder=Path(parser.parse_args(sys.argv[sys.argv.index('--')+1:]).folder)
spec=json.loads((folder/'recipe.json').read_text());parts=spec['recipe']['parts'];materials={};evidence=[]
basis=Matrix.Rotation(math.pi/2,4,'X')
def signed(v,p):return math.copysign(abs(v)**p,v)
def select(objects):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:obj.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
def image(name,pixels,noncolor=True):
    im=bpy.data.images.new(name,width=2048,height=2048,alpha=False)
    if noncolor:im.colorspace_settings.name='Non-Color'
    im.pixels.foreach_set(pixels.astype(np.float32).ravel());im.update();im.filepath_raw=str(folder/(name+'.png'));im.file_format='PNG';im.save();im.pack();return im
def leather_maps():
    rng=np.random.default_rng(14);h=rng.normal(0,1,(2048,2048)).astype(np.float32)
    # Correlated small pores, rather than painting the reference photograph onto a box.
    h=(h+np.roll(h,1,0)+np.roll(h,1,1)+np.roll(h,-1,1))*.25
    dx=(np.roll(h,1,1)-np.roll(h,-1,1))*.16;dy=(np.roll(h,1,0)-np.roll(h,-1,0))*.16
    pixels=np.ones((2048,2048,4),dtype=np.float32);nz=1/np.sqrt(1+dx*dx+dy*dy)
    pixels[:,:,0]=.5+.5*dx*nz;pixels[:,:,1]=.5+.5*dy*nz;pixels[:,:,2]=.5+.5*nz
    return image('LeatherGrain_2K',pixels)
grain=None
def material(p):
    global grain
    key=(p['material'],p['color'])
    if key in materials:return materials[key]
    kind,color=key;m=bpy.data.materials.new('rv-'+kind+'-'+color[1:]);m.use_nodes=True
    node=m.node_tree.nodes.get('Principled BSDF');rgb=[int(color[i:i+2],16)/255 for i in (1,3,5)]
    linear=[n/12.92 if n<=.04045 else ((n+.055)/1.055)**2.4 for n in rgb]
    node.inputs['Base Color'].default_value=(*linear,1)
    node.inputs['Roughness'].default_value={'leather':.58,'fabric':.85,'wood':.42,'metal':.3,'paint':.54,'glass':.1,'stone':.6}[kind]
    if kind=='metal':node.inputs['Metallic'].default_value=.82
    if kind=='glass':node.inputs['Transmission Weight'].default_value=.95
    if kind=='leather':
        node.inputs['Coat Weight'].default_value=.035;node.inputs['Coat Roughness'].default_value=.5;node.inputs['Specular IOR Level'].default_value=.28
        if grain is None:grain=leather_maps()
        texture=m.node_tree.nodes.new('ShaderNodeTexImage');texture.image=grain
        normal=m.node_tree.nodes.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=.22
        m.node_tree.links.new(texture.outputs['Color'],normal.inputs['Color']);m.node_tree.links.new(normal.outputs['Normal'],node.inputs['Normal'])
    if kind in ('wood','fabric'):
        name='oak_veneer_01' if kind=='wood' else 'fabric_pattern_07'
        path=Path(__file__).resolve().parents[1]/'app/public/textures'/(name+'_nor_gl_1k.jpg')
        if path.exists():
            tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(path),check_existing=True);tex.image.colorspace_settings.name='Non-Color'
            normal=m.node_tree.nodes.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=.24
            m.node_tree.links.new(tex.outputs['Color'],normal.inputs['Color']);m.node_tree.links.new(normal.outputs['Normal'],node.inputs['Normal'])
    materials[key]=m;return m
def mesh(name,verts,faces,uvs=None):
    data=bpy.data.meshes.new(name);data.from_pydata(verts,[],faces);data.update()
    obj=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(obj)
    if uvs:
        uv=data.uv_layers.new(name='ProductUV')
        for poly in data.polygons:
            for loop in poly.loop_indices:uv.data[loop].uv=uvs[data.loops[loop].vertex_index]
    for poly in data.polygons:poly.use_smooth=True
    return obj
def curve(name,points,thickness,mat,closed=True):
    c=bpy.data.curves.new(name,'CURVE');c.dimensions='3D';c.resolution_u=1;c.bevel_depth=thickness;c.bevel_resolution=2
    spline=c.splines.new('POLY');spline.points.add(len(points)-1)
    for dest,point in zip(spline.points,points):dest.co=(*point,1)
    spline.use_cyclic_u=closed
    obj=bpy.data.objects.new(name,c);bpy.context.collection.objects.link(obj);obj.data.materials.append(mat)
    select([obj]);bpy.ops.object.convert(target='MESH');return bpy.context.object
def pillow(p):
    a,b,c=[n/2 for n in p['size']];ex=p['roundness'];naxis={'x':0,'y':1,'z':2}[p['axis']]
    major=[n for n in range(3) if n!=naxis];half=(a,b,c);verts=[];faces=[];uv=[];steps=36;radius=ex
    # Uniform face sampling retains the centre creases. A superellipsoid's angular
    # grid puts most vertices near corners and leaves large, unwrinkled centre faces.
    samples=[]
    for axis in range(3):
        other=[n for n in range(3) if n!=axis]
        for side in (-1,1):
            offset=len(samples)
            for j in range(steps+1):
                for i in range(steps+1):
                    q=Vector((0,0,0));q[axis]=side;q[other[0]]=-1+2*i/steps;q[other[1]]=-1+2*j/steps
                    samples.append((q,(i/steps,j/steps)))
            for j in range(steps):
                for i in range(steps):
                    a0=offset+j*(steps+1)+i;b0=a0+steps+1
                    face=(a0,a0+1,b0+1,b0);v0,v1,v2=[samples[k][0] for k in face[:3]]
                    if (v1-v0).cross(v2-v0)[axis]*side<0:face=tuple(reversed(face))
                    faces.append(face)
    for q,tex in samples:
            inner=Vector(tuple(max(-1+radius,min(1-radius,n)) for n in q));roundpoint=inner+(q-inner).normalized()*radius
            point=[roundpoint[k]*half[k] for k in range(3)]
            s,t=[point[k]/half[k] for k in major];normal=point[naxis]/half[naxis]
            point[naxis]*=.84+.16*(1-s*s)*(1-t*t)
            edge=max(abs(s),abs(t));folds=(math.sin(s*39+math.sin(t*8)*2.7)*math.exp(-((abs(t)-.84)/.18)**2)+math.sin(t*33+s*7)*math.exp(-((abs(s)-.86)/.16)**2))
            # Actual geometry folds taper into broad, uncreased central cushions.
            point[naxis]+=math.copysign(1,normal)*.004*p['wrinkles']*folds*min(1,abs(normal)*2)*(.4+.6*math.sin(math.pi*min(.999,edge)))
            if normal>0:
                point[naxis]-=p.get('sag',0)*math.exp(-(s*s+t*t)*2.5)*min(1,normal*2)
                for f in p.get('folds',[]):
                    x,y=f['start'];dx,dy=f['end'][0]-x,f['end'][1]-y;length=dx*dx+dy*dy
                    if length<1e-5:continue
                    progress=((s-x)*dx+(t-y)*dy)/length
                    if 0<progress<1:
                        distance=abs((s-x)*dy-(t-y)*dx)/math.sqrt(length);w=f['width']
                        crease=(-math.exp(-(distance/w)**2)+.28*math.exp(-((distance-w*1.65)/w)**2))*math.sin(math.pi*progress)**.7
                        point[naxis]+=f['depth']*crease*min(1,normal*2)
            if naxis==2:point[0]*=p.get('bottomWidth',1)+(p.get('topWidth',1)-p.get('bottomWidth',1))*(point[1]/b+1)/2
            verts.append(point);uv.append(tex)
    obj=mesh(p['name'],verts,faces,uv);select([obj]);bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.remove_doubles(threshold=.00001);bpy.ops.object.mode_set(mode='OBJECT');objects=[obj]
    def face_point(u,v):
        x=max(0,min(steps-.0001,(u+1)*steps/2));y=max(0,min(steps-.0001,(v+1)*steps/2));ix,iy=int(x),int(y);tx,ty=x-ix,y-iy;offset=(naxis*2+1)*(steps+1)**2
        points=[Vector(verts[offset+j*(steps+1)+i]) for i,j in ((ix,iy),(ix+1,iy),(ix,iy+1),(ix+1,iy+1))]
        point=points[0]*(1-tx)*(1-ty)+points[1]*tx*(1-ty)+points[2]*(1-tx)*ty+points[3]*tx*ty;point[naxis]+=.0008;return point
    seam_color='#'+''.join(f'{round(int(p["color"][i:i+2],16)*.7):02x}' for i in (1,3,5));seam_mat=material({**p,'color':seam_color})
    if p['piping']:
        path=[]
        for i in range(160):
            angle=2*math.pi*i/160;path.append(face_point(.94*signed(math.cos(angle),ex),.94*signed(math.sin(angle),ex)))
        objects.append(curve(p['name']+'_sewn_edge',path,.0012,seam_mat))
    for n,seam in enumerate(p.get('seams',[])):
        for shift in (-.008,.008) if seam['double'] else (0,):
            path=[face_point(max(-1,min(1,u+shift)),v) for u,v in catmull(seam['points'],12)]
            objects.append(curve(p['name']+'_surface_seam_'+str(n),path,.00065,seam_mat,False))
    return objects
def catmull(points,steps=8):
    out=[]
    for i in range(len(points)-1):
        a,b,c,d=[points[min(len(points)-1,max(0,k))] for k in (i-1,i,i+1,i+2)]
        for j in range(steps):
            t=j/steps;out.append([.5*(2*y+(-x+z)*t+(2*x-5*y+4*z-w)*t*t+(-x+3*y-3*z+w)*t*t*t) for x,y,z,w in zip(a,b,c,d)])
    out.append(points[-1]);return out
def shell(p):
    profile=catmull(p['profile']);verts=[];faces=[];uv=[];across=32
    for j,(z,y,w,rise) in enumerate(profile):
        for i in range(across+1):
            u=-1+2*i/across;crown=.045*max(0,(j/(len(profile)-1)-.82)/.18)*abs(u)**4
            verts.append((u*w,y+rise*u**4-crown,z));uv.append((i/across,j/(len(profile)-1)))
    for j in range(len(profile)-1):
        for i in range(across):
            a=j*(across+1)+i;b=a+across+1;faces.append((a,a+1,b+1,b))
    obj=mesh(p['name'],verts,faces,uv);select([obj])
    sub=obj.modifiers.new('SmoothShell','SUBSURF');sub.levels=1;bpy.ops.object.modifier_apply(modifier=sub.name)
    solid=obj.modifiers.new('ShellThickness','SOLIDIFY');solid.thickness=p['thickness'];bpy.ops.object.modifier_apply(modifier=solid.name)
    bevel=obj.modifiers.new('SoftShellEdge','BEVEL');bevel.width=.008;bevel.segments=3;bpy.ops.object.modifier_apply(modifier=bevel.name)
    return [obj]
def lathe(p):
    profile=catmull(p['profile']);verts=[];faces=[];uv=[];n=64
    for j,(r,y) in enumerate(profile):
        for i in range(n+1):
            u=2*math.pi*i/n;verts.append((r*math.cos(u),y,r*math.sin(u)));uv.append((i/n,j/(len(profile)-1)))
    for j in range(len(profile)-1):
        for i in range(n):
            a=j*(n+1)+i;b=a+n+1;faces.append((a,b,b+1,a+1))
    return [mesh(p['name'],verts,faces,uv)]
def part(p):
    kind=p['type']
    if kind=='cushion':objects=pillow(p)
    elif kind=='shell':objects=shell(p)
    elif kind=='lathe':objects=lathe(p)
    else:
        if kind=='rod':
            start,end=Vector(p['start']),Vector(p['end']);delta=end-start
            if p.get('crossSection'):
                w,h=p['crossSection'];taper=p.get('taper',1);verts=[(x*w*f/2,y*h*f/2,z*delta.length/2) for z,f in ((-1,1),(1,taper)) for x,y in ((-1,-1),(1,-1),(1,1),(-1,1))]
                obj=mesh(p['name'],verts,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]);obj.location=(start+end)/2
                select([obj]);bevel=obj.modifiers.new('MetalFootEdge','BEVEL');bevel.width=.003;bevel.segments=3;bpy.ops.object.modifier_apply(modifier=bevel.name)
            else:
                bpy.ops.mesh.primitive_cone_add(vertices=32,radius1=p['radius'],radius2=p['radius']*p.get('taper',1),depth=delta.length,location=(start+end)/2);obj=bpy.context.object
            # Blender cylinder is local Z; keep logical coordinates until all parts share the same basis.
            obj.rotation_euler=delta.to_track_quat('Z','Y').to_euler()
        elif kind=='cylinder':
            size=p['size'];bpy.ops.mesh.primitive_cone_add(vertices=64,radius1=size[1],radius2=size[0],depth=size[2],end_fill_type='NOTHING' if p.get('open') else 'NGON');obj=bpy.context.object
            obj.rotation_euler.x=-math.pi/2
        elif kind=='sphere':
            bpy.ops.mesh.primitive_uv_sphere_add(segments=48,ring_count=32,radius=1);obj=bpy.context.object;obj.scale=tuple(n/2 for n in p['size'])
        else:
            bpy.ops.mesh.primitive_cube_add(size=1);obj=bpy.context.object;obj.scale=p['size'];select([obj]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
            bevel=obj.modifiers.new('ManufacturedEdge','BEVEL');bevel.width=min(p.get('radius',.02),min(p['size'])*.4);bevel.segments=5;bpy.ops.object.modifier_apply(modifier=bevel.name)
            norm=obj.modifiers.new('WeightedNormals','WEIGHTED_NORMAL');bpy.ops.object.modifier_apply(modifier=norm.name)
        obj.name=p['name'];objects=[obj]
    rotation=Matrix.Identity(4)
    for axis,value in zip('XYZ',p.get('rotation',[0,0,0])):rotation=rotation@Matrix.Rotation(math.radians(value),4,axis)
    position=Matrix.Translation(Vector(p.get('position',[0,0,0])))
    bpy.context.view_layer.update()
    for obj in objects:
        obj.matrix_world=basis@position@rotation@obj.matrix_world
        if not obj.data.materials:obj.data.materials.append(material(p))
        obj['productRole']=p.get('role','');obj['geometryType']=kind
        for f in obj.data.polygons:f.use_smooth=True
    evidence.append({'name':p['name'],'role':p['role'],'type':kind,'material':p['material'],'wrinkles':p.get('wrinkles',0),'piping':p.get('piping',False),'surfaceSeams':len(p.get('seams',[])),'vertices':sum(len(o.data.vertices) for o in objects)})
    return objects
def light(name,loc,energy,size,target):
    data=bpy.data.lights.new(name,'AREA');data.energy=energy;data.shape='DISK';data.size=size
    obj=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(obj);obj.location=loc;obj.rotation_euler=(target-obj.location).to_track_quat('-Z','Y').to_euler()
def main():
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False);objects=[]
    for p in parts:objects.extend(part(p))
    bpy.context.view_layer.update();points=[o.matrix_world@v.co for o in objects for v in o.data.vertices]
    low=Vector([min(v[k] for v in points) for k in range(3)]);high=Vector([max(v[k] for v in points) for k in range(3)]);extent=high-low;mid=(high+low)/2
    dims=spec['dimensions'];scale=Vector((dims['width']/extent.x,dims['depth']/extent.y,dims['height']/extent.z));normalize=Matrix.Diagonal((*scale,1))@Matrix.Translation(Vector((-mid.x,-mid.y,-low.z)))
    # Bake the complete affine transform into vertices. Assigning S@R to object
    # TRS silently loses shear, changing reclined cushions and final dimensions.
    for obj in objects:
        obj.data.transform(normalize@obj.matrix_world);obj.matrix_world=Matrix.Identity(4);obj.data.update()
    # Every exported mesh has a real UV layer, including seams and hardware.
    for obj in objects:
        if not obj.data.uv_layers:
            select([obj]);bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(island_margin=.015);bpy.ops.object.mode_set(mode='OBJECT')
    select(objects);bpy.ops.export_scene.gltf(filepath=str(folder/'model.glb'),export_format='GLB',use_selection=True,export_extras=True,export_yup=True)
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True
    try:
        prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='METAL';prefs.get_devices()
        if any(d.type=='METAL' for d in prefs.devices):
            for d in prefs.devices:d.use=d.type=='METAL'
            scene.cycles.device='GPU'
    except Exception:pass
    scene.world.color=(.65,.65,.65);scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.8,.8,.8,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.6
    target=Vector((0,0,dims['height']*.5));radius=max(dims.values())
    light('Key',(-2,-3,3.2),430,3,target);light('Fill',(2,-1,2),180,2.5,target);light('Rim',(1,2,2.5),250,2,target)
    bpy.ops.mesh.primitive_plane_add(size=200);floor=bpy.context.object;floor.location.z=-.006
    m=bpy.data.materials.new('PreviewFloor');m.diffuse_color=(.8,.8,.78,1);floor.data.materials.append(m)
    camera=bpy.data.cameras.new('Camera');camera.type='ORTHO';camera.ortho_scale=radius*1.48
    cam=bpy.data.objects.new('Camera',camera);bpy.context.collection.objects.link(cam);scene.camera=cam
    scene.render.resolution_x=640;scene.render.resolution_y=640;scene.render.resolution_percentage=100
    scene.view_settings.view_transform='AgX';scene.render.image_settings.file_format='PNG'
    for n,pos in enumerate([(-2.2,-2.6,1.35),(0,-3,1.0),(3,0,.8),(2.6,1.8,1.4)]):
        cam.location=target+Vector(pos)*radius;cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=str(folder/f'preview-{n}.png');bpy.ops.render.render(write_still=True)
    bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(folder/'product.blend'))
    triangles=sum(sum(max(0,len(f.vertices)-2) for f in o.data.polygons) for o in objects)
    points=[o.matrix_world@v.co for o in objects for v in o.data.vertices]
    measured=[max(v[k] for v in points)-min(v[k] for v in points) for k in range(3)]
    if not all(abs(a-b)<.0001 for a,b in zip(measured,[dims['width'],dims['depth'],dims['height']])):raise RuntimeError('实际网格外廓未通过规格校验')
    result={'parts':evidence,'triangles':triangles,'meshCount':len(objects),'dimensions':dims,'measuredDimensions':dict(zip(('width','depth','height'),measured)),'uvMapped':all(bool(o.data.uv_layers) for o in objects),'normalTextureResolution':2048 if grain else None}
    (folder/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False),flush=True)
try:main()
except Exception:traceback.print_exc();sys.exit(1)
