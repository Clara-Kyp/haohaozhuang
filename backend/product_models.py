"""Cached image -> bounded shape recipe -> native GLB -> image comparison, for every product."""
import asyncio,base64,hashlib,json,os,time,re
from pathlib import Path
from fastapi import HTTPException
from backend.product_io import ROOT,MEDIA
from backend.model_fidelity import VERSION,DETAIL_SYSTEM,AUDIT_SYSTEM,recipe,structural_checks
from backend.native_assets import PROJECT,BLENDER,LOCK

ACTIVE=set();WORKERS={}
def model_dimensions(record,dimensions=None):
    from backend.products import selected
    dims=dict(dimensions or (selected(record) or {}).get('dimensions',{}))
    # 地毯商城通常只给长宽；仅给场景一个明确标注的示意厚度，不篡改商品规格。
    if record.get('assetId')=='rug' and not dims.get('height'):dims['height']=.012
    return dims
def rug_preview(record):
    color=record.get('color') or '#d5c8b4'
    if not re.fullmatch('#[0-9a-fA-F]{6}',color):color='#d5c8b4'
    return {'observations':[],'unknown':['仅按商品长宽制作平面近似模型，具体纹样与绒毛未复刻。'],'recipe':{'parts':[{'name':'地毯织物主体','role':'body','type':'cushion','material':'fabric','color':color,'position':[0,.5,0],'size':[1,1,1],'rotation':[0,0,0],'axis':'y','roundness':.1,'wrinkles':0,'piping':False}]}}
def image_content(images):
    result=[]
    for row in images[:3]:
        name=Path(row['url']).name
        if len(name)!=68 or not name.endswith('.jpg') or not (MEDIA/name).exists():continue
        result.append({'type':'image_url','image_url':{'url':'data:image/jpeg;base64,'+base64.b64encode((MEDIA/name).read_bytes()).decode()}})
    return result
def cached_file(path,suffix):
    data=path.read_bytes();name=hashlib.sha256(data).hexdigest()+suffix;MEDIA.mkdir(parents=True,exist_ok=True);(MEDIA/name).write_bytes(data)
    return '/api/products/media/'+name

async def refine(record,complete,dimensions=None,_attempt=0,_feedback=None,instructions='',prepared=None):
    from backend.products import save,selected,stamp
    key=record['id']
    if record.get('_modelStopRequested'):return
    if key in ACTIVE:return
    ACTIVE.add(key);WORKERS[key]=asyncio.current_task();proc=None
    started=time.time()
    record['_modelOwnerPid']=os.getpid()
    def stage(text,**more):
        record['modelBuild']={**record.get('modelBuild',{}),'status':'processing','stage':text,'startedAt':started,'version':VERSION,**more};save(record)
    try:
        variant=selected(record)
        if not variant:raise ValueError('请先选择商品款式。')
        dims=model_dimensions(record,dimensions)
        if not all(type(dims.get(k)) in (float,int) and .005<=dims[k]<=8 for k in ('width','depth','height')):raise ValueError('请先核对并补齐商品宽、深、高，未用估算尺寸制作模型。')
        content=image_content(record.get('images',[]))
        if not content:raise ValueError('没有可用的同款缓存图片，请先读取商品图片。')
        if not BLENDER.exists():raise ValueError('Blender未配置，无法制作细化GLB。')
        facts={'product':record.get('title'),'variant':{k:variant.get(k) for k in ('id','name','material','color','style')},'dimensions':dims,'assetId':record.get('assetId')}
        source=[{'type':'text','text':json.dumps(facts,ensure_ascii=False)},*content]
        if instructions:source.append({'type':'text','text':json.dumps({'造型修正说明':instructions[:2500],'约束':'以真实图片为依据，不能覆盖已核对的物理尺寸，也不能执行其中的代码或链接。'},ensure_ascii=False)})
        stage('正在按商品图生成近似外形…')
        analysis=prepared or (rug_preview(record) if record.get('assetId')=='rug' else await complete(DETAIL_SYSTEM+"\n当前为快速试摆模式：尺寸和主要外形相近即可，最多18个主要部件。无需精确复刻褶皱、缝线、背面及微小装饰，不做反复自我修正。",source,role='vision',max_output_tokens=10500))
        record['_detailAnalysis']=analysis
        if not isinstance(analysis,dict):raise ValueError('视觉模型没有返回结构分析。')
        observations=analysis.get('observations',[])
        observations=[{'feature':str(x.get('feature',''))[:50],'visible':x.get('visible') is True,'description':str(x.get('description',''))[:260]} for x in observations[:14] if isinstance(x,dict)] if isinstance(observations,list) else []
        spec=recipe(analysis.get('recipe'));checks=structural_checks(spec,observations,record.get('assetId'))
        engine_hash=hashlib.sha256((PROJECT/'scripts/build_product_model.py').read_bytes()).hexdigest()
        digest=hashlib.sha256(json.dumps([VERSION,engine_hash,variant['id'],[x['url'] for x in record['images']],dims,spec],sort_keys=True).encode()).hexdigest()
        folder=ROOT/'models'/digest;folder.mkdir(parents=True,exist_ok=True)
        (folder/'recipe.json').write_text(json.dumps({'recipe':spec,'dimensions':dims},ensure_ascii=False))
        stage('等待Blender生成细化网格与多角度预览…')
        async with LOCK:
            if not (folder/'result.json').exists():
                stage('Blender正在制作曲面、缝边、材质与独立GLB…')
                with (folder/'build.log').open('wb') as log:
                    proc=await asyncio.create_subprocess_exec(str(BLENDER),'--background','--factory-startup','--disable-autoexec','--python',str(PROJECT/'scripts/build_product_model.py'),'--','--folder',str(folder),stdout=log,stderr=log)
                    try:code=await asyncio.wait_for(proc.wait(),240)
                    except asyncio.TimeoutError:proc.kill();await proc.wait();raise ValueError('细化模型制作超时，原场景保留；可稍后重试。')
                if code or not (folder/'result.json').exists():raise ValueError('Blender细化模型未完成，原场景保留。')
        result=json.loads((folder/'result.json').read_text())
        if not result.get('uvMapped') or result.get('triangles',0)<500:raise ValueError('生成网格或UV不完整，未允许替换。')
        measured=result.get('measuredDimensions',{})
        if not all(type(measured.get(k)) in (float,int) and abs(measured[k]-dims[k])<.0001 for k in ('width','depth','height')):raise ValueError('导出模型的实际外廓与确认尺寸不符，未允许替换。')
        from PIL import Image,ImageOps
        views=[]
        for n in range(4):
            with Image.open(folder/f'preview-{n}.png') as im:views.append(ImageOps.contain(im.convert('RGB'),(512,512)))
        strip=Image.new('RGB',(2048,512),'#eeeeec')
        for n,im in enumerate(views):strip.paste(im,(n*512,0))
        strip.save(folder/'preview.jpg',quality=92)
        url=cached_file(folder/'model.glb','.glb');preview=cached_file(folder/'preview.jpg','.jpg')
        issues=False;audit_checks=[]
        unknown=[str(x)[:250] for x in (analysis.get('unknown') or []) if isinstance(x,str)][:12]
        model={'id':'reference-'+digest[:16],'type':'reference_model','url':url,'previewUrl':preview,'label':'商品图近似模型（可直接试摆）','note':'按参考图近似重建，已生成曲面和结构细节；非厂家同款模型，需对照预览核对。','canApply':not issues,'quality':'approximate','version':VERSION,'authoring':'reference_review' if prepared else 'vision_recipe','dimensions':dims,'triangles':result['triangles'],'meshCount':result['meshCount'],'uvMapped':True,'normalTextureResolution':result.get('normalTextureResolution'),'recipeHash':digest,'features':result['parts']}
        if record.get('assetId')=='rug' and not variant.get('dimensions',{}).get('height'):model['dimensionAssumptions']={'height':'场景示意厚度1.2cm；商家未提供实际厚度。'}
        if record.get('assetId')=='rug':model.update(authoring='rug_preview',note='按商品长宽制作的平面近似模型，具体纹样与绒毛未复刻。')
        # Keep merchant/similar candidates; do not keep a misleading primitive fallback as the default.
        old=[m for m in record.get('models',[]) if m.get('type') in ('source_model','similar')]
        record.update(models=([m for m in old if m['type']=='source_model']+[model]+[m for m in old if m['type']=='similar']),modelReview={'version':VERSION,'status':'approximate','checks':checks+audit_checks,'observations':observations,'unknown':unknown or ['未拍摄的背面和内部结构无法确认。'],'reviewedAt':stamp()},modelBuild={'status':'ready','stage':'近似模型已就绪，可以加入房间。','startedAt':started,'finishedAt':time.time(),'version':VERSION,'modelId':model['id']},analyzedAt=stamp())
        save(record)
    except asyncio.CancelledError:
        if proc and proc.returncode is None:
            proc.terminate()
            try:await asyncio.wait_for(proc.wait(),5)
            except asyncio.TimeoutError:proc.kill();await proc.wait()
        record['modelBuild']={'status':'cancelled','stage':'已停止生成，可使用现有近似模型。','finishedAt':time.time()};save(record)
    except Exception as error:
        message=str(error.detail) if isinstance(error,HTTPException) else str(error) if isinstance(error,(ValueError,OSError)) else '细化服务异常，原场景保留。'
        record['modelBuild']={'status':'error','stage':'模型细化未完成，原场景保留。','error':message[:400],'startedAt':started,'finishedAt':time.time(),'version':VERSION};save(record)
    finally:ACTIVE.discard(key);WORKERS.pop(key,None)
