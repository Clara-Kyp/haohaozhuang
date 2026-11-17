"""Run in Blender: UV unwrap copies, Cycles 2K bake, export independent editable GLBs."""
import argparse,json,math,sys,traceback
from pathlib import Path
import bpy
from mathutils import Matrix,Vector

args=argparse.ArgumentParser();args.add_argument('--folder',required=True)
folder=Path(args.parse_args(sys.argv[sys.argv.index('--')+1:]).folder)
manifest=json.loads((folder/'manifest.json').read_text());key=folder.name
resolution=2048;assets={};evidence=[];exceptions=[]
def phase(text,**extra):
    p=folder/'status.json';old=json.loads(p.read_text()) if p.exists() else {}
    temp=folder/'status.tmp';temp.write_text(json.dumps({**old,'status':'processing','stage':text,**extra},ensure_ascii=False));temp.replace(p);print(text,flush=True)
def descendants(root):return [o for o in [root,*root.children_recursive] if o.type=='MESH']
def select(objects):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:o.hide_set(False);o.select_set(True)
    bpy.context.view_layer.objects.active=next((o for o in objects if o.type=='MESH'),objects[0] if objects else None)
def output(name):return f'/api/bakes/{key}/assets/{name}'
def export(root,name):
    select([root,*root.children_recursive]);bpy.ops.export_scene.gltf(filepath=str(folder/name),export_format='GLB',use_selection=True,export_extras=True,export_yup=True)
    return output(name)
def realtime(obj):
    for material in obj.data.materials:
        if not material or not material.use_nodes:continue
        for node in material.node_tree.nodes:
            if node.type=='BSDF_PRINCIPLED' and ((node.inputs.get('Transmission Weight') and node.inputs['Transmission Weight'].default_value>.4) or node.inputs['Metallic'].default_value>.65 or node.inputs['Alpha'].default_value<.999 or node.inputs['Alpha'].is_linked):return True
    return False
def prepare(root,identifier,reconstruction=False):
    meshes=descendants(root);opaque=[o for o in meshes if not realtime(o)]
    for o in meshes:
        if o not in opaque:exceptions.append({'asset':identifier,'mesh':o.name,'reason':'透明/金属保留实时材质'})
    if not opaque:raise RuntimeError(identifier+'没有可烘焙的不透明网格')
    # Preserve source UV references before adding a separate non-overlapping bake UV.
    for obj in opaque:
        uv=obj.data.uv_layers.active.name if obj.data.uv_layers.active else None
        for slot in obj.material_slots:
            if not slot.material:continue
            slot.material=slot.material.copy();material=slot.material
            if not material.use_nodes:material.use_nodes=True
            if uv:
                uvnode=material.node_tree.nodes.new('ShaderNodeUVMap');uvnode.uv_map=uv
                for node in list(material.node_tree.nodes):
                    if node.type=='TEX_IMAGE' and not node.inputs['Vector'].is_linked:material.node_tree.links.new(uvnode.outputs['UV'],node.inputs['Vector'])
        if reconstruction:
            select([obj]);bevel=obj.modifiers.new('ReferenceSoftEdges','BEVEL');bevel.width=min(obj.dimensions)*.055;bevel.segments=3
            try:bpy.ops.object.modifier_apply(modifier=bevel.name)
            except RuntimeError:pass
            for polygon in obj.data.polygons:polygon.use_smooth=True
    # Joining only opaque meshes preserves exceptional glass/metal as independent children.
    select(opaque)
    if len(opaque)>1:bpy.ops.object.join()
    obj=bpy.context.object;obj.name='Baked_'+identifier
    uv=obj.data.uv_layers.new(name='CyclesBakeUV');obj.data.uv_layers.active=uv;uv.active_render=True
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(angle_limit=math.radians(66),island_margin=.012);bpy.ops.object.mode_set(mode='OBJECT')
    evidence.append({'asset':identifier,'uvLayer':obj.data.uv_layers.active.name,'sourceUVs':[u.name for u in obj.data.uv_layers if u.name!='CyclesBakeUV'],'faces':len(obj.data.polygons),'resolution':[resolution,resolution]})
    return obj
def bake(obj,name):
    phase('Cycles 2K烘焙：'+name)
    original=[slot.material for slot in obj.material_slots]
    image=bpy.data.images.new(name,width=resolution,height=resolution,alpha=False,float_buffer=False);image.colorspace_settings.name='sRGB';image.use_fake_user=True
    for material in original:
        nodes=material.node_tree.nodes
        for n in nodes:n.select=False
        target=nodes.new('ShaderNodeTexImage');target.name='CyclesBakeTarget';target.image=image;target.select=True;nodes.active=target
    select([obj]);bpy.context.scene.render.bake.use_clear=True;bpy.context.scene.render.bake.margin=12
    bpy.ops.object.bake(type='COMBINED',pass_filter={'COLOR','DIRECT','INDIRECT','DIFFUSE','EMIT'})
    image.filepath_raw=str(folder/(name+'.png'));image.file_format='PNG';image.save()
    material=bpy.data.materials.new(name+'_UnlitBaked');material.use_nodes=True
    nodes=material.node_tree.nodes;nodes.clear();out=nodes.new('ShaderNodeOutputMaterial');tex=nodes.new('ShaderNodeTexImage');tex.image=image;uv=nodes.new('ShaderNodeUVMap');uv.uv_map=obj.data.uv_layers.active.name
    emission=nodes.new('ShaderNodeEmission');emission.inputs['Strength'].default_value=1
    material.node_tree.links.new(uv.outputs['UV'],tex.inputs['Vector']);material.node_tree.links.new(tex.outputs['Color'],emission.inputs['Color']);material.node_tree.links.new(emission.outputs[0],out.inputs['Surface'])
    for slot in obj.material_slots:slot.material=material
    return original
def restore_materials(obj,materials):
    for slot,material in zip(obj.material_slots,materials):slot.material=material
def area(name,position,energy,size):
    lamp=bpy.data.lights.new(name,'AREA');lamp.energy=energy;lamp.shape='DISK';lamp.size=size
    obj=bpy.data.objects.new(name,lamp);bpy.context.collection.objects.link(obj);obj.location=position;obj.rotation_euler=(Vector((0,0,1))-obj.location).to_track_quat('-Z','Y').to_euler();return obj
def make_product():
    spec=manifest['items'][0];root=bpy.data.objects.new('RV_ITEM__'+spec['id'],None);bpy.context.collection.objects.link(root)
    basis=Matrix.Rotation(math.pi/2,4,'X')
    for part in manifest['productGeometry']['parts']:
        kind=part['type'];size=part.get('size');position=part.get('position')
        if kind=='rod':
            start=basis@Vector(part['start']);end=basis@Vector(part['end']);delta=end-start
            bpy.ops.mesh.primitive_cylinder_add(vertices=24,radius=part['radius'],depth=max(.001,delta.length),location=(start+end)/2);obj=bpy.context.object;obj.rotation_euler=delta.to_track_quat('Z','Y').to_euler()
        else:
            if kind=='box':bpy.ops.mesh.primitive_cube_add(size=1);obj=bpy.context.object;obj.scale=(size[0],size[2],size[1])
            elif kind=='sphere':bpy.ops.mesh.primitive_uv_sphere_add(segments=32,ring_count=20,radius=1);obj=bpy.context.object;obj.scale=(size[0]/2,size[2]/2,size[1]/2)
            else:bpy.ops.mesh.primitive_cone_add(vertices=48,radius1=size[1],radius2=size[0],depth=size[2]);obj=bpy.context.object
            obj.location=basis@Vector(position)
            x,y,z=[math.radians(v) for v in part.get('rotation',[0,0,0])];rotation=Matrix.Rotation(x,4,'X')@Matrix.Rotation(y,4,'Y')@Matrix.Rotation(z,4,'Z');obj.rotation_euler=(basis@rotation@basis.inverted()).to_euler()
        obj.name='Reference_'+part['material'];material=bpy.data.materials.new('rv-'+part['material']);material.use_nodes=True;p=material.node_tree.nodes.get('Principled BSDF');rgb=part['color'].lstrip('#');p.inputs['Base Color'].default_value=(*(int(rgb[i:i+2],16)/255 for i in (0,2,4)),1);p.inputs['Roughness'].default_value=.88 if part['material']=='fabric' else .48;p.inputs['Metallic'].default_value=.85 if part['material']=='metal' else 0
        if part['material']=='glass':p.inputs['Transmission Weight'].default_value=.9
        if part['material'] in ('fabric','wood'):
            noise=material.node_tree.nodes.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=180 if part['material']=='fabric' else 35
            bump=material.node_tree.nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.15;bump.inputs['Distance'].default_value=.002;material.node_tree.links.new(noise.outputs['Fac'],bump.inputs['Height']);material.node_tree.links.new(bump.outputs['Normal'],p.inputs['Normal'])
        obj.data.materials.clear();obj.data.materials.append(material);obj.parent=root
    bpy.context.view_layer.update();corners=[o.matrix_world@Vector(v) for o in descendants(root) for v in o.bound_box]
    low=Vector(tuple(min(v[k] for v in corners) for k in range(3)));high=Vector(tuple(max(v[k] for v in corners) for k in range(3)));size=high-low;center=(high+low)/2
    scale=Vector((spec['width']/size.x,spec['depth']/size.y,spec['height']/size.z));norm=Matrix.Diagonal((*scale,1))@Matrix.Translation(Vector((-center.x,-center.y,-low.z)))
    for obj in descendants(root):obj.matrix_world=norm@obj.matrix_world
    export(root,'source.glb');return root
def main():
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=int(manifest.get('samples',32));scene.cycles.use_denoising=True
    scene.world=bpy.data.worlds.new('BakeWorld');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.75,.8,.9,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.6
    device='CPU'
    try:
        prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='METAL';prefs.get_devices()
        if any(d.type=='METAL' for d in prefs.devices):
            for d in prefs.devices:d.use=d.type=='METAL'
            scene.cycles.device='GPU';device='METAL'
    except Exception:pass
    phase('导入不可变源模型，准备UV',device=device)
    if manifest.get('mode')=='product':make_product()
    else:
        bpy.ops.import_scene.gltf(filepath=manifest.get('assetPath') or str(folder/'source.glb'))
        if manifest.get('mode')=='asset':
            imported=list(bpy.context.scene.objects);spec=manifest['items'][0];root=bpy.data.objects.new('RV_ITEM__'+spec['id'],None);bpy.context.collection.objects.link(root)
            for obj in imported:
                if obj.parent is None:matrix=obj.matrix_world.copy();obj.parent=root;obj.matrix_world=matrix
            bpy.context.view_layer.update();corners=[o.matrix_world@Vector(v) for o in descendants(root) for v in o.bound_box]
            lo=Vector(tuple(min(v[k] for v in corners) for k in range(3)));hi=Vector(tuple(max(v[k] for v in corners) for k in range(3)));extent=hi-lo;center=(hi+lo)/2
            scale=Vector((spec['width']/extent.x,spec['depth']/extent.y,spec['height']/extent.z));normal=Matrix.Diagonal((*scale,1))@Matrix.Translation(Vector((-center.x,-center.y,-lo.z)))
            for obj in imported:
                if obj.parent==root:obj.matrix_world=normal@obj.matrix_world
            if manifest.get('assetPath'):export(root,'source.glb')
    roots={o.name:o for o in bpy.data.objects if o.name.startswith('RV_ITEM__')}
    room=next((o for o in bpy.data.objects if o.name.startswith('RV_ROOM')),None)
    prepared={}
    for spec in manifest['items']:
        root=roots.get('RV_ITEM__'+spec['id'])
        if not root:raise RuntimeError('源文件缺少独立物件：'+spec['id'])
        prepared[spec['id']]=(root,prepare(root,spec['id'],spec.get('reconstruction',False)))
    h=manifest.get('scene',{}).get('height',2.75);w=manifest.get('scene',{}).get('width',5);d=manifest.get('scene',{}).get('depth',4)
    lamps=[area('WindowLight',(0,d*.65,h*.8),550,w*.65),area('SoftCeiling',(0,0,h-.15),180,2)]
    room_result=None
    if room:
        mesh=prepare(room,'room');original=bake(mesh,'room-showroom-2k');full=export(room,'room-showroom.glb');restore_materials(mesh,original)
        for root,_ in prepared.values():
            for o in descendants(root):o.hide_render=True
        bake(mesh,'room-build-2k');build=export(room,'room-build.glb');room_result={'build':build,'showroom':full}
        for root,_ in prepared.values():
            for o in descendants(root):o.hide_render=False
        for o in descendants(room):o.hide_render=True
    # Canonical isolated lighting for movable assets; no other furniture or room occlusion baked in.
    for o in lamps:bpy.data.objects.remove(o,do_unlink=True)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value=.8
    canonical=area('CanonicalSoftbox',(-2,-2,4),260,4)
    for root,_ in prepared.values():
        for o in descendants(root):o.hide_render=True
    for spec in manifest['items']:
        root,mesh=prepared[spec['id']];original_matrix=root.matrix_world.copy();root.matrix_world=Matrix.Identity(4)
        for o in descendants(root):o.hide_render=False
        bake(mesh,'item-'+spec['id']+'-2k');url=export(root,'item-'+spec['id']+'.glb')
        assets[spec['id']]={'url':url,'signature':spec.get('signature'),'inventoryId':spec.get('inventoryId'),'sourceUrl':spec.get('sourceUrl'),'resolution':2048,'type':'cycles_baked','approximate':bool(spec.get('reconstruction'))}
        root.matrix_world=original_matrix
        for o in descendants(root):o.hide_render=True
    for o in bpy.data.objects:
        if o.type=='MESH':o.hide_render=False
    bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(folder/'roomvoice-baked.blend'))
    result={'id':key,'resolution':2048,'device':device,'room':room_result,'assets':assets,'uvEvidence':evidence,'realtimeExceptions':exceptions,'blendUrl':output('roomvoice-baked.blend'),'logUrl':output('cycles.log'),'sourceUrl':output('source.glb')}
    (folder/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));phase('Cycles烘焙完成')
try:main()
except Exception as error:
    traceback.print_exc();p=folder/'status.json';old=json.loads(p.read_text());p.write_text(json.dumps({**old,'status':'error','error':str(error)},ensure_ascii=False));sys.exit(1)
