"""从当前商品页面解析真实默认SKU与规格，不把首个SKU冒充默认。"""
import ast,html,json,re
from urllib.parse import urljoin,urlsplit,parse_qs,urlencode,urlunsplit
from bs4 import BeautifulSoup

def walk(value,depth=0):
    if depth>16:return
    if isinstance(value,dict):
        yield value
        for child in list(value.values())[:1000]:yield from walk(child,depth+1)
    elif isinstance(value,list):
        for child in value[:500]:yield from walk(child,depth+1)

def strings(value):
    if isinstance(value,str):return [value]
    if isinstance(value,list):return [v for item in value for v in strings(item)]
    if isinstance(value,dict):return strings(value.get('contentUrl') or value.get('url') or value.get('src') or '')
    return []

def number(value):
    match=re.search(r'\d+(?:[.,]\d+)?(?:\s+\d+/\d+)?',str(value))
    if not match:return None
    val=match.group().replace(',','.')
    if ' ' in val:
        whole,fraction=val.split();a,b=fraction.split('/');return float(whole)+float(a)/float(b)
    return float(val)

def quantity(value):
    if isinstance(value,dict):
        val=number(value.get('value',value.get('maxValue','')));unit=str(value.get('unitCode') or value.get('unitText') or '').lower()
    else:
        val=number(value);unit=str(value).lower()
    if val is None:return None
    if any(u in unit for u in ('cmt','cm','厘米','公分')):scale=.01
    elif any(u in unit for u in ('mmt','mm','毫米')):scale=.001
    elif any(u in unit for u in ('inch','inches','inh','英寸','″','"')) or re.search(r'\bin\b',unit):scale=.0254
    elif unit.strip() in ('m','mtr','米') or re.search(r'\d\s*m\b',unit):scale=1
    else:return None
    return round(val*scale,5) if .005<=val*scale<=8 else None

def dimensions(text):
    result={};evidence={}
    unit=r'(?:厘米|公分|毫米|cm|mm|米|m|inches|inch|in|英寸|″|")'
    numeric=r'\d+(?:\.\d+)?(?:\s+\d+/\d+)?'
    # 排除包装、线长、座垫和灯罩的局部尺寸，避免当作整体外廓。
    lines=text.splitlines();kept=[]
    for i,line in enumerate(lines):
        if re.search(r'Packaging|包装尺寸',line,re.I):break
        if re.search(r'cord|cable|seat |shade width|线长|座深|坐高|灯罩宽',line,re.I):continue
        if i and re.search(r'cord|cable|seat |shade width|线长|座深|坐高|灯罩宽',lines[i-1],re.I):continue
        kept.append(line)
    clean='\n'.join(kept)
    for key,label in {'width':r'宽度|宽|Width|Length|长','depth':r'深度|深|Depth','height':r'高度|高|Height'}.items():
        found=[]
        for match in re.finditer(r'(?:'+label+r')\s*[:：]?\s*('+numeric+r')\s*('+unit+r')',clean,re.I):
            val=quantity(match[1]+' '+match[2])
            if val:found.append((val,match.group()))
        if found:
            val,proof=max(found) if key=='height' else found[0]
            result[key]=val;evidence[key]=proof[:140]
    diameters=[]
    for match in re.finditer(r'(?:直径|Diameter)\s*[:：]?\s*('+numeric+r')\s*('+unit+r')',clean,re.I):
        val=quantity(match[1]+' '+match[2])
        if val:diameters.append((val,match.group()))
    if diameters:
        val,proof=max(diameters)
        for key in ('width','depth'):
            if val>result.get(key,0):result[key]=val;evidence[key]=proof[:140]+'（按最大底座/外廓直径）'
    height_values=[quantity(m[1]+' '+m[2]) for m in re.finditer(r'(?:高度|高|Height)\s*[:：]?\s*('+numeric+r')\s*('+unit+r')',clean,re.I)]
    valid=[v for v in height_values if v]
    if len(set(valid))>1 and re.search(r'min\.|max\.|最低|最高|最小高度|最大高度',clean,re.I):evidence['height']=evidence.get('height','')+'（可调高度，按最大值预览）'
    triple=re.search(r'(?:长\s*[×xX*/、，,]?\s*宽\s*[×xX*/、，,]?\s*高|L\s*[×xX*/]?\s*W\s*[×xX*/]?\s*H)\s*[:：]?\s*('+numeric+r')\s*[×xX*]\s*('+numeric+r')\s*[×xX*]\s*('+numeric+r')\s*('+unit+r')',text,re.I)
    if triple:
        for k,v in zip(('width','depth','height'),triple.group(1,2,3)):
            q=quantity(v+' '+triple[4])
            if q:result[k]=q;evidence[k]=triple.group()[:160]
    return result,evidence

def json_documents(soup,extra):
    docs=list(extra or [])
    for node in soup.find_all('script')[:120]:
        raw=node.string or node.get_text()
        if not raw or len(raw)>4_000_000:continue
        try:docs.append(json.loads(raw));continue
        except ValueError:pass
        # 常见内嵌商品状态：只解析JSON字面量，绝不执行页面脚本。
        markers=('__NEXT_DATA__','__INITIAL_STATE__','__INIT_DATA__','__PRELOADED_STATE__','__ICE_APP_CONTEXT__','__ICE_PAGE_PROPS__','rawData','g_config')
        for marker in markers:
            for occurrence in list(re.finditer(re.escape(marker),raw))[:12]:
                begin=raw.find('{',occurrence.end())
                if begin>=0:
                    try:docs.append(json.JSONDecoder().raw_decode(raw[begin:])[0])
                    except ValueError:pass
        # ICE页面用JSON.parse(带转义的字符串)注入状态；只解码字符串和JSON，绝不执行JS。
        if any(marker in raw for marker in markers):
            # ICE SSR先声明空context，再把JSON字面量赋给局部变量，最后合并进context。
            for assignment in list(re.finditer(r'\b(?:var|let|const)\s+[A-Za-z_$][\w$]*\s*=\s*(?=[{\[])',raw))[:12]:
                try:docs.append(json.JSONDecoder().raw_decode(raw[assignment.end():])[0])
                except ValueError:pass
            for match in list(re.finditer(r'JSON\.parse\(\s*([\'\"])',raw))[:12]:
                quote=match[1];start=match.end()-1;end=start+1;escaped=False
                while end<len(raw):
                    char=raw[end]
                    if not escaped and char==quote:break
                    if not escaped and char=='\\':escaped=True
                    else:escaped=False
                    end+=1
                try:
                    literal=raw[start:end+1]
                    decoded=json.loads(literal) if quote=='"' else ast.literal_eval(literal)
                    if isinstance(decoded,str):docs.append(json.loads(decoded))
                except (ValueError,SyntaxError,MemoryError):pass
    # 淘宝apiStack中的JSON字符串。
    for node in [n for d in docs for n in walk(d)]:
        for entry in node.get('apiStack',[]) if isinstance(node.get('apiStack'),list) else []:
            try:docs.append(json.loads(entry['value']))
            except (ValueError,KeyError,TypeError):pass
    return docs

def parse_product(markup,url,snapshot=None,extra=None):
    soup=BeautifulSoup(markup,'html.parser');snapshot=snapshot or {}
    docs=json_documents(soup,extra)
    nodes=[node for d in docs for node in walk(d)]
    types=lambda n:{v for v in (n.get('@type',[]) if isinstance(n.get('@type'),list) else [n.get('@type')]) if isinstance(v,str)}
    products=[n for n in nodes if types(n)&{'Product','ProductGroup'}]
    group=next((p for p in products if p.get('hasVariant')),None)
    main=next((p for p in products if 'Product' in types(p) and not p.get('isVariantOf')),None) or (products[0] if products else {})
    title=main.get('name') or snapshot.get('title') or (soup.select_one('h1').get_text(' ',strip=True) if soup.select_one('h1') else '')
    description=str(main.get('description') or '')
    brand=main.get('brand') or '';brand=brand.get('name','') if isinstance(brand,dict) else str(brand)
    variants=[];default_id=None;default_reason='';model_urls=[]
    body=snapshot.get('text') or soup.get_text('\n',strip=True)
    measurement_blocks=soup.select('[class*="measurement-list"],[class*="product-measurements"]')
    measurement_text='\n'.join(n.get_text('\n',strip=True) for n in measurement_blocks)
    page_dims,page_evidence=dimensions(measurement_text or body[:90000])
    image_urls=strings(main.get('image'))
    if not image_urls:
        meta=soup.select_one('meta[property="og:image"]')
        if meta:image_urls=[meta.get('content','')]
    raw_variants=group.get('hasVariant',[]) if group else [main] if main else []
    if isinstance(raw_variants,dict):raw_variants=[raw_variants]
    for n,p in enumerate(raw_variants[:100]):
        if not isinstance(p,dict):continue
        offers=p.get('offers') or {};offers=offers[0] if isinstance(offers,list) and offers else offers
        if not isinstance(offers,dict):offers={}
        vid=str(p.get('sku') or p.get('productID') or p.get('mpn') or p.get('@id') or n)
        dims={};evidence={}
        for key in ('width','depth','height'):
            val=quantity(p.get(key,''))
            if val:dims[key]=val;evidence[key]='页面结构化'+key+': '+str(p[key])[:140]
        measured,proof=dimensions(' '.join([str(p.get('size','')),str(p.get('description',''))]))
        dims={**measured,**dims};evidence={**proof,**evidence}
        variants.append({'id':vid,'name':str(p.get('name') or title)[:240],'color':str(p.get('color') or ''), 'style':str(p.get('size') or p.get('model') or ''), 'material':str(p.get('material') or ''),'dimensions':dims,'dimensionEvidence':evidence,'images':strings(p.get('image')) or image_urls,'price':str(offers.get('price') or ''),'currency':str(offers.get('priceCurrency') or ''),'url':p.get('url') or url})
        for enc in walk(p.get('subjectOf',{})):
            for candidate in strings(enc.get('contentUrl')):
                if '.glb' in candidate:model_urls.append(candidate)
    # Shopify产品JSON：默认以页面真正选中的hidden input / selected variant为准。
    shop=next((n for n in nodes if isinstance(n.get('variants'),list) and n.get('title') and any(v.get('id') for v in n['variants'] if isinstance(v,dict))),None)
    if shop:
        title=str(shop['title']);image_urls=strings(shop.get('images'));variants=[]
        options=[o.get('name','') if isinstance(o,dict) else str(o) for o in shop.get('options',[])]
        for v in shop['variants'][:100]:
            values=v.get('options') or [v.get('option1'),v.get('option2'),v.get('option3')]
            props={name:str(val) for name,val in zip(options,values) if val}
            dims,proof=dimensions(' '.join(props.values()))
            vid=str(v['id']);image=strings(v.get('featured_image')) or image_urls
            variants.append({'id':vid,'name':str(v.get('title') or title),'color':next((val for name,val in props.items() if re.search('color|colour|颜色',name,re.I)),''),'style':str(v.get('title') or ''),'material':'','dimensions':dims,'dimensionEvidence':proof,'images':image,'price':str(round(v['price']/100,2)) if isinstance(v.get('price'),(int,float)) else str(v.get('price','')),'currency':str(shop.get('currency') or ''),'url':url})
        hidden=soup.select_one('input[name="id"][value]')
        if hidden:default_id=str(hidden['value']);default_reason='商品页当前选中的规格'
    # 淘宝 / 天猫详情结构。
    tb=next((n for n in nodes if isinstance(n.get('skuBase'),dict) and isinstance(n.get('item'),dict)),None)
    if tb:
        item=tb['item'];title=str(item.get('title') or title);image_urls=strings(item.get('images')) or image_urls
        values={};properties=tb['skuBase'].get('props',[])
        for prop in properties:
            for val in prop.get('values',[]):values[str(prop.get('pid'))+':'+str(val.get('vid'))]=(prop.get('name',''),val.get('name',''),val.get('image'))
        core=next((n['skuCore'] for n in nodes if isinstance(n.get('skuCore'),dict)),{})
        variants=[]
        for sku in tb['skuBase'].get('skus',[])[:100]:
            vid=str(sku.get('skuId'));attrs=[values.get(k,('','','')) for k in str(sku.get('propPath','')).split(';')]
            label=' / '.join(str(v[1]) for v in attrs if v[1]);color=' / '.join(str(v[1]) for v in attrs if re.search('颜色|色彩',str(v[0])))
            dims,proof=dimensions(label+' '+str(item.get('title','')))
            info=core.get('sku2info',{}).get(vid,{})
            variants.append({'id':vid,'name':label or title,'color':color,'style':label,'material':'','dimensions':dims,'dimensionEvidence':proof,'images':[v[2] for v in attrs if v[2]] or image_urls,'price':str((info.get('price') or {}).get('priceText','')),'currency':'CNY','url':url})
        default_id=str(core.get('defaultSkuId') or core.get('skuId') or item.get('defaultSkuId') or '') or default_id
        if default_id:default_reason='商品详情默认规格'
    # 实际DOM选择和URL变体优先于通用默认信息。
    query=parse_qs(urlsplit(url).query)
    selected=snapshot.get('selectedVariantId') or next((query[k][0] for k in ('skuId','sku_id','variant') if query.get(k)),None)
    if selected:default_id=str(selected);default_reason='链接指定或商品页实际选中的规格'
    if not variants and title and image_urls:
        variants=[{'id':str(main.get('sku') or 'page-default'),'name':title,'color':str(main.get('color') or snapshot.get('color') or ''),'style':str(snapshot.get('variantLabel') or ''),'material':str(main.get('material') or ''),'dimensions':page_dims,'dimensionEvidence':page_evidence,'images':image_urls,'price':'','currency':'','url':url}]
    if len(variants)==1:
        default_id=variants[0]['id'];default_reason=default_reason or '当前商品页唯一款式'
    if default_id not in {v['id'] for v in variants}:default_id=None;default_reason='商品页未指定默认款式，请选择规格'
    for v in variants:
        if v['id']==default_id:
            v['dimensions']={**page_dims,**v['dimensions']}
            v['dimensionEvidence']={**page_evidence,**v['dimensionEvidence']}
        v['images']=list(dict.fromkeys(urljoin(url,html.unescape(x)) for x in v['images'] if isinstance(x,str) and x and not x.startswith('data:')))[:8]
        if tb or shop:
            parts=urlsplit(url);q=parse_qs(parts.query);q['skuId' if tb else 'variant']=[v['id']]
            v['url']=urlunsplit((parts.scheme,parts.netloc,parts.path,urlencode(q,doseq=True),''))
    for node in soup.select('model-viewer[src],a[href$=".glb"]'):
        model_urls.append(node.get('src') or node.get('href'))
    title=html.unescape(str(title)).strip()
    rating=main.get('aggregateRating') or {};rating=rating if isinstance(rating,dict) else {}
    reviews={'count':number(rating.get('reviewCount',rating.get('ratingCount',''))),'rating':number(rating.get('ratingValue','')),'summary':None,'sourceUrl':url}
    if tb:
        components=tb.get('componentsVO') or {}
        review_node=next((n for n in walk(components) if any(k in n for k in ('rateCount','totalRateCount','rateTotalCount'))),{})
        raw=review_node.get('rateCount') or review_node.get('totalRateCount') or review_node.get('rateTotalCount')
        if raw is not None:
            count=number(raw)
            if count is not None:
                reviews.update(count=count*(10000 if '万' in str(raw) else 1000 if '千' in str(raw) else 1),countText=str(raw),countIsLowerBound='+' in str(raw),sourceUrl=url)
        summary=review_node.get('rateTitle') or review_node.get('title')
        if isinstance(summary,str):reviews['summary']=summary[:300]
    if tb and not description:
        brief=tb['item'].get('subtitle') or tb['item'].get('sellPoint')
        if isinstance(brief,str):description=brief
    return {'title':title[:300],'description':description[:4000],'reviews':reviews,'brand':brand[:120],'sourceUrl':url,'variants':variants,'selectedVariantId':default_id,'defaultReason':default_reason,'modelUrls':list(dict.fromkeys(urljoin(url,v) for v in model_urls if isinstance(v,str)))[:2], 'pageText':body[:45000],'recognized':bool(variants and title)}
