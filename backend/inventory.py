"""真实商品储物栏：导入用户表格，保留信息来源，三个候选缺项不伪造。"""
import base64,csv,hashlib,io,json,re,zipfile
from pathlib import Path
from uuid import UUID
from fastapi import APIRouter,HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel,Field
from backend.product_io import ROOT,clean_link,product_key
from backend.products import public
from backend.furnishing import ASSETS

FILE=ROOT/'inventory.json'
def entries():
    try:return json.loads(FILE.read_text())
    except (OSError,ValueError):return []
def save(values):
    ROOT.mkdir(parents=True,exist_ok=True);p=FILE.with_suffix('.tmp');p.write_text(json.dumps(values,ensure_ascii=False));p.replace(FILE)
def identity(url):return hashlib.sha256(product_key(url).encode()).hexdigest()[:24]
def records():
    result={}
    for p in sorted((ROOT/'imports').glob('*.json'),key=lambda p:p.stat().st_mtime):
        try:
            d=json.loads(p.read_text());UUID(d['id']);key=identity(d['sourceUrl'])
            # 新任务处理中仍保留最后一次成功的不可变商品快照。
            if d.get('status')=='ready' or key not in result:result[key]=d
        except (ValueError,OSError,KeyError,TypeError):continue
    return result
def listing():
    values={e['id']:dict(e) for e in entries()};cached=records()
    try:baked=json.loads((ROOT/'baked-models.json').read_text())
    except (OSError,ValueError):baked={}
    for key,record in cached.items():
        if key not in values and record.get('status')!='ready':continue
        old=values.get(key,{});variant=next((v for v in record.get('variants',[]) if v['id']==record.get('selectedVariantId')),{});asset=ASSETS.get(record.get('assetId'),{})
        reviews={**(record.get('reviews') or {}),**{k:v for k,v in (old.get('reviews') or {}).items() if v not in (None,'')}}
        values[key]={**old,'id':key,'name':old.get('name') or record.get('title') or '待读取商品','group':old.get('group') or ('单人沙发' if '单人' in variant.get('name','') else asset.get('name','未分类商品')),'assetId':record.get('assetId'),'sourceUrl':record['sourceUrl'],'image':(record.get('images') or [{}])[0].get('url') or old.get('image'),'price':variant.get('price') or old.get('price'),'currency':variant.get('currency') or old.get('currency','CNY'),'description':record.get('description') or old.get('description') or record.get('title',''),'reviews':old.get('reviews') or record.get('reviews') or {},'status':record.get('status'),'snapshot':public(record),'dimensions':variant.get('dimensions',{}),'fetchedAt':record.get('fetchedAt'),'metadataSource':old.get('metadataSource','商品详情页')}
        values[key]['reviews']=reviews
        values[key]['dimensions']={**old.get('dimensions',{}),**variant.get('dimensions',{})}
        values[key]['dimensionEvidence']={**old.get('dimensionEvidence',{}),**variant.get('dimensionEvidence',{})}
    groups={}
    for value in values.values():
        if value['id'] in baked:value['bakedModel']=baked[value['id']]
        groups.setdefault(value.get('group') or '未分类商品',[]).append(value)
    ranked=lambda rows:sorted(rows,key=lambda e:(e.get('reviews',{}).get('rating') or -1,e.get('reviews',{}).get('count') or -1),reverse=True)
    return {'groups':[{'name':name,'candidates':ranked(rows),'missing':max(0,3-len(rows)),'overflow':max(0,len(rows)-3)} for name,rows in groups.items()],'total':len(values),'excelLoaded':any(e.get('metadataSource','').startswith('Excel:') for e in values.values())}

HEADERS={
 'group':['物品类别','物品类型','类别','分类','物品分组','分组','group','category'],
 'name':['商品名称','产品名称','名称','商品名','name','title'],
 'sourceUrl':['商品链接','购买链接','产品链接','链接','url','link','sourceurl'],
 'price':['价格','售价','商品价格','price'],'currency':['币种','currency'],
 'description':['产品介绍','商品介绍','介绍','简介','description'],
 'reviewCount':['评论数','评价数','评论数量','reviewcount'],'rating':['评分','商品评分','rating'],
 'reviewSummary':['评论情况','评价摘要','评论摘要','评价情况','reviewsummary'],
 'width':['宽(cm)','宽度(cm)','宽厘米','widthcm'],'depth':['深(cm)','深度(cm)','深厘米','depthcm'],'height':['高(cm)','高度(cm)','高厘米','heightcm'],
 'color':['颜色','商品颜色','color'],'style':['款式','商品款式','style'],
 'dimensionEvidence':['尺寸依据','规格依据','dimensionevidence'],
 'referenceImage':['参考图片链接','商品图片链接','referenceimage'],
}
def norm(value):return re.sub(r'[\s（）()_\-]','',str(value or '')).lower()
def parse_rows(rows,filename):
    rows=list(rows)
    if not rows:raise ValueError('表格没有数据。')
    header=[norm(x) for x in rows[0]];mapping={key:next((header.index(norm(alias)) for alias in aliases if norm(alias) in header),None) for key,aliases in HEADERS.items()}
    wide=any(re.search(r'候选[123].*(?:链接|url)',h) for h in header)
    if mapping['sourceUrl'] is None and not wide:raise ValueError('请提供“商品链接”列，可先下载Excel模板；不要删除第一行列名。')
    output=[];warnings=[]
    for line,row in enumerate(rows[1:1001],2):
        def value(key):
            pos=mapping.get(key);return str(row[pos]).strip() if pos is not None and pos<len(row) and row[pos] is not None else ''
        candidates=[(value('sourceUrl'),value('name'))]
        if wide:
            candidates=[]
            for n in (1,2,3):
                def slot(label):
                    pos=next((i for i,h in enumerate(header) if h in (f'候选{n}{label}',f'{label}{n}')),None)
                    return str(row[pos] or '').strip() if pos is not None and pos<len(row) else ''
                candidates.append((slot('链接') or slot('url'),slot('名称') or value('name')))
        for url,name in candidates:
            if not url:continue
            try:url=clean_link(url)
            except ValueError:warnings.append(f'第{line}行链接无效，已跳过。');continue
            def numeric(key):
                raw=value(key);match=re.search(r'\d+(?:\.\d+)?',raw);return float(match[0])*(10000 if '万' in raw else 1000 if '千' in raw else 1) if match else None
            dimensions={};evidence={}
            for k in ('width','depth','height'):
                raw=value(k)
                if not raw:continue
                try:
                    n=float(raw)
                    if not .5<=n<=800:raise ValueError()
                    dimensions[k]=round(n/100,5);evidence[k]='Excel填写（待核对）：'+raw+' cm'+('；'+value('dimensionEvidence') if value('dimensionEvidence') else '')
                except ValueError:warnings.append(f'第{line}行{ {"width":"宽","depth":"深","height":"高"}[k]}须为0.5–800之间的厘米数，未导入此尺寸。')
            rating=numeric('rating');count=numeric('reviewCount')
            if rating is not None and (rating>5 or value('rating').startswith('-')):rating=None;warnings.append(f'第{line}行评分须为0–5，未导入该评分。')
            if count is not None and value('reviewCount').startswith('-'):count=None;warnings.append(f'第{line}行评论数不可为负数，未导入该评论数。')
            reference=value('referenceImage')
            if reference:
                try:reference=clean_link(reference)
                except ValueError:reference='';warnings.append(f'第{line}行参考图片链接无效，未导入该图片链接。')
            output.append({'id':identity(url),'sourceUrl':url,'name':name or '待读取商品','group':value('group') or name or '未分类商品','price':value('price') or None,'currency':value('currency') or 'CNY','description':value('description'),'color':value('color'),'style':value('style'),'dimensions':dimensions,'dimensionEvidence':evidence,'referenceImage':reference or None,'reviews':{'count':count,'rating':rating,'summary':value('reviewSummary') or None,'sourceUrl':url},'metadataSource':'Excel:'+filename,'status':'pending'})
    if not output:raise ValueError('没有有效的HTTPS商品链接。请在“商品清单”表第2行开始填写商品链接后再导入。')
    if len({e['id'] for e in output})<len(output):warnings.append('同一商品与款式的重复行已合并，保留最后一行。')
    if len(rows)>1001:warnings.append('仅导入前1000行商品，请拆分剩余清单。')
    return list({e['id']:e for e in output}.values()),warnings

class TableInput(BaseModel):
    name:str=Field(max_length=200)
    data:str=Field(max_length=8_000_000)
router=APIRouter(prefix='/api/inventory',tags=['商品储物栏'])
@router.get('/template')
async def download_template():
    path=Path(__file__).parent/'templates/inventory-template.xlsx'
    if not path.exists():raise HTTPException(503,'模板尚未安装。')
    return FileResponse(path,media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',filename='好好装-商品清单模板.xlsx',headers={'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'})
@router.get('')
async def get_inventory():return listing()
@router.post('/import')
async def import_table(payload:TableInput):
    try:
        raw=base64.b64decode(payload.data,validate=True)
        if len(raw)>5_000_000:raise ValueError('表格超过5MB。')
        if payload.name.lower().endswith('.xlsx'):
            with zipfile.ZipFile(io.BytesIO(raw)) as z:
                if sum(i.file_size for i in z.infolist())>30_000_000:raise ValueError('表格解压后过大。')
            import openpyxl
            book=openpyxl.load_workbook(io.BytesIO(raw),read_only=True,data_only=True,keep_links=False)
            try:rows=list((book['商品清单'] if '商品清单' in book.sheetnames else book.active).iter_rows(min_row=1,max_row=1002,values_only=True))
            finally:book.close()
        elif payload.name.lower().endswith('.csv'):rows=list(csv.reader(io.StringIO(raw.decode('utf-8-sig'))))
        else:raise ValueError('支持.xlsx或UTF-8 CSV。请将旧版.xls另存为.xlsx。')
        parsed,warnings=parse_rows(rows,payload.name)
        values={e['id']:e for e in entries()};values.update({e['id']:e for e in parsed});save(list(values.values()))
        return {**listing(),'imported':len(parsed),'warnings':warnings}
    except (ValueError,KeyError,zipfile.BadZipFile) as error:raise HTTPException(422,str(error))
