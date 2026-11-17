"""真实Blender离线任务，Cycles 2048烘焙，不把未执行脚本标成成功。"""
import asyncio,base64,hashlib,json,os,re,shutil,struct,time,subprocess,signal
from pathlib import Path
from uuid import UUID,uuid4
from fastapi import APIRouter,BackgroundTasks,HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel,Field
from backend.product_io import ROOT as PRODUCTS
from backend.products import get_record,selected,geometry
from backend.native_assets import BLENDER,LOCK

PROJECT=Path(__file__).resolve().parents[1];ROOT=PROJECT/'.runtime/bakes'
RUNNING={};CANCELLED=set()
def find_worker(folder,value):
    """Recover only this exact native bake process after an API restart."""
    pid=value.get('workerPid')
    command=['ps','-p',str(pid),'-o','pid=,command='] if type(pid) is int else ['ps','-axo','pid=,command=']
    try:
        for line in subprocess.check_output(command,text=True).splitlines():
            if str(BLENDER) in line and str(PROJECT/'scripts/blender_bake.py') in line and str(folder) in line:return int(line.strip().split(None,1)[0])
    except (subprocess.SubprocessError,ValueError):pass
    return None
def write(folder,value):
    folder.mkdir(parents=True,exist_ok=True);p=folder/'status.tmp';p.write_text(json.dumps(value,ensure_ascii=False));p.replace(folder/'status.json')
def folder_for(key):
    try:key=str(UUID(key))
    except ValueError:raise HTTPException(404,'烘焙任务不存在')
    folder=ROOT/key
    if not (folder/'status.json').exists():raise HTTPException(404,'烘焙任务不存在')
    return folder
def validate_glb(data):
    if len(data)<24 or data[:4]!=b'glTF' or struct.unpack_from('<II',data,4)!=(2,len(data)):raise ValueError('场景源文件不是有效GLB 2.0。')
    length,kind=struct.unpack_from('<II',data,12)
    if kind!=0x4e4f534a or length>len(data)-20:raise ValueError('GLB结构无效。')
    doc=json.loads(data[20:20+length])
    if any(x.get('uri') and not x['uri'].startswith('data:') for x in doc.get('buffers',[])+doc.get('images',[])):raise ValueError('场景源文件包含未打包外部资源。')
    if not doc.get('meshes'):raise ValueError('场景中没有可烘焙的网格。')

def publish_result(folder):
    result=json.loads((folder/'result.json').read_text());manifest=json.loads((folder/'manifest.json').read_text())
    result.update(sourceSignature=manifest.get('sourceSignature'),roomSignature=manifest.get('roomSignature'))
    registry=PRODUCTS/'baked-models.json'
    try:known=json.loads(registry.read_text())
    except (OSError,ValueError):known={}
    for asset in result.get('assets',{}).values():
        if asset.get('inventoryId'):known[asset['inventoryId']]=asset
    registry.parent.mkdir(parents=True,exist_ok=True);temp=registry.with_suffix('.tmp');temp.write_text(json.dumps(known,ensure_ascii=False));temp.replace(registry)
    return result

async def run(folder):
    async with LOCK:
        status=json.loads((folder/'status.json').read_text())
        if status.get('status')=='cancelled' or folder.name in CANCELLED:return
        status.update(startedAt=time.time());write(folder,{**status,'status':'processing','stage':'启动Blender / Cycles…'})
        try:
            if not BLENDER.exists():raise ValueError('本地Blender未配置，请设置BLENDER_BIN。')
            with (folder/'cycles.log').open('wb') as log:
                proc=await asyncio.create_subprocess_exec(str(BLENDER),'--background','--factory-startup','--disable-autoexec','--python',str(PROJECT/'scripts/blender_bake.py'),'--','--folder',str(folder),stdout=log,stderr=log)
                RUNNING[folder.name]=proc
                current=json.loads((folder/'status.json').read_text());write(folder,{**current,'workerPid':proc.pid})
                try:code=await asyncio.wait_for(proc.wait(),3600)
                except asyncio.TimeoutError:proc.kill();await proc.wait();raise ValueError('本次烘焙超过60分钟，已停止；可减少物品后重试。')
                if folder.name in CANCELLED:return
            if code or not (folder/'result.json').exists():
                current=json.loads((folder/'status.json').read_text())
                raise ValueError(current.get('error') or 'Blender烘焙未完成，请查看Cycles日志。')
            result=publish_result(folder)
            write(folder,{**status,'status':'ready','stage':'2K UV与Cycles烘焙完成','result':result,'finishedAt':time.time()})
        except Exception as error:
            if folder.name not in CANCELLED:write(folder,{**status,'status':'error','stage':'烘焙失败，原场景保留','error':str(error)[:350],'finishedAt':time.time()})
        finally:RUNNING.pop(folder.name,None)

class BakeInput(BaseModel):
    source:str=Field(min_length=30,max_length=110_000_000)
    manifest:dict
class ProductBakeInput(BaseModel):
    importId:str
    dimensions:dict
    modelId:str='image-model'
    modelSignature:str=Field(default='',max_length=30000)
router=APIRouter(prefix='/api/bakes',tags=['Blender 2K烘焙'])
def create_job(manifest,data=None):
    if not BLENDER.exists():raise HTTPException(503,'Blender未安装或BLENDER_BIN未配置。')
    manifest={**manifest,'resolution':2048,'samples':32,'pipelineVersion':3}
    digest=hashlib.sha256((data or b'')+json.dumps(manifest,sort_keys=True).encode()).hexdigest()
    for p in ROOT.glob('*/status.json'):
        try:
            old=json.loads(p.read_text())
            if old.get('digest')==digest and old.get('status') in ('ready','processing','queued'):return p.parent,old,False
        except (ValueError,OSError):pass
    key=str(uuid4());folder=ROOT/key;folder.mkdir(parents=True,exist_ok=True)
    if data:(folder/'source.glb').write_bytes(data)
    (folder/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False))
    status={'id':key,'digest':digest,'status':'queued','stage':'等待Cycles烘焙队列','resolution':2048,'createdAt':time.time(),'totalItems':len(manifest.get('items',[]))};write(folder,status);return folder,status,True
@router.post('',status_code=202)
async def start(payload:BakeInput,background:BackgroundTasks):
    try:
        data=base64.b64decode(payload.source,validate=True)
        if len(data)>80_000_000:raise ValueError('当前房间源模型超过80MB，请先减少物品。')
        validate_glb(data)
        raw=payload.manifest
        manifest={k:raw.get(k) for k in ('sourceSignature','roomSignature','scene','items')};manifest['mode']='scene'
        if len(manifest.get('items',[]))>40:raise ValueError('最多40件物品。')
        for i in manifest.get('items',[]):
            if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}',str(i.get('id',''))):raise ValueError('物件编号无效。')
        folder,status,new=create_job(manifest,data)
        if new:background.add_task(run,folder)
        return status
    except (ValueError,KeyError) as error:raise HTTPException(422,str(error))
@router.post('/product',status_code=202)
async def product(payload:ProductBakeInput,background:BackgroundTasks):
    record=get_record(payload.importId);variant=selected(record);model=next((m for m in record.get('models',[]) if m['id']==payload.modelId),None)
    if not variant or not record.get('images') or not model:raise HTTPException(422,'商品图片、款式和模型尚未就绪。')
    if model.get('type')=='image_reconstruction' and not model.get('url'):raise HTTPException(422,'这是旧版几何草模，请先按商品图细化并核对，烘焙不能修复形状。')
    dims=payload.dimensions
    if not all(type(dims.get(k)) in (float,int) and .01<=dims[k]<=8 for k in ('width','depth','height')):raise HTTPException(422,'请先确认商品宽、深、高。')
    shape=geometry(model.get('geometry'));source=None;asset_path=None
    if not shape:
        if model['type'] in ('source_model','reference_model'):
            if model.get('canApply') is False:raise HTTPException(422,'模型造型仍有差异，请先完成细化核对，烘焙不能修复形状。')
            name=Path(model['url']).name
            if not re.fullmatch(r'[0-9a-f]{64}\.glb',name):raise HTTPException(422,'模型来源无效。')
            source=(PRODUCTS/'media'/name).read_bytes()
        else:
            from backend.furnishing import ASSETS
            asset=ASSETS.get(model.get('assetId'),{})
            if asset.get('url'):asset_path=str(PROJECT/'app/public'/asset['url'].lstrip('/'))
            else:raise HTTPException(422,'参数素材请先放入场景，再与房间一起烘焙。')
    iid='product-'+record['id'][:8]
    from backend.inventory import identity
    manifest={'mode':'product' if shape else 'asset','sourceSignature':hashlib.sha256(json.dumps([record['id'],dims,shape,model['id']],sort_keys=True).encode()).hexdigest(),'items':[{'id':iid,'name':record['title'],**dims,'signature':payload.modelSignature,'reconstruction':bool(shape),'sourceUrl':record['sourceUrl'],'inventoryId':identity(record['sourceUrl'])}],'productGeometry':shape,'assetPath':asset_path}
    folder,status,new=create_job(manifest,source)
    if new:background.add_task(run,folder)
    return status
@router.get('/{key}')
async def status(key:str):
    folder=folder_for(key);value=json.loads((folder/'status.json').read_text());manifest=json.loads((folder/'manifest.json').read_text())
    if value.get('status')=='processing' and key not in RUNNING:
        pid=find_worker(folder,value)
        if pid:value['workerPid']=pid
        elif time.time()-value.get('startedAt',(folder/'manifest.json').stat().st_mtime)>30:
            if (folder/'result.json').exists():
                result=publish_result(folder);value.update(status='ready',stage='2K UV与Cycles烘焙完成',result=result,finishedAt=(folder/'result.json').stat().st_mtime)
            else:value.update(status='error',stage='烘焙任务已中断，原场景保留。',error='任务进程已结束，未取得完整产物。请重新制作。',finishedAt=time.time())
            write(folder,value)
    value['totalItems']=len(manifest.get('items',[]));value['completedItems']=len(list(folder.glob('item-*.glb')))
    end=value.get('finishedAt',(folder/'result.json').stat().st_mtime if (folder/'result.json').exists() else time.time())
    value['elapsedSeconds']=max(0,round(end-value.get('startedAt',value.get('createdAt',(folder/'manifest.json').stat().st_mtime))))
    value['roomMapsReady']=(folder/'room-build.glb').exists()
    return value
@router.post('/{key}/cancel')
async def cancel(key:str):
    folder=folder_for(key);value=json.loads((folder/'status.json').read_text())
    if value.get('status') not in ('queued','processing'):return await status(key)
    proc=RUNNING.get(key)
    if proc and proc.returncode is None:proc.terminate()
    elif (pid:=find_worker(folder,value)):
        try:os.kill(pid,signal.SIGTERM)
        except ProcessLookupError:pass
    CANCELLED.add(key);write(folder,{**value,'status':'cancelled','stage':'已停止烘焙，原场景保留。','finishedAt':time.time()});return await status(key)
@router.get('/{key}/assets/{name}')
async def asset(key:str,name:str):
    if not re.fullmatch(r'[A-Za-z0-9_-]+\.(?:glb|png|blend|json|log)',name):raise HTTPException(404)
    path=folder_for(key)/name
    if not path.exists():raise HTTPException(404)
    types={'.glb':'model/gltf-binary','.png':'image/png','.json':'application/json','.log':'text/plain'}
    return FileResponse(path,media_type=types.get(path.suffix,'application/octet-stream'),headers={'X-Content-Type-Options':'nosniff'})
