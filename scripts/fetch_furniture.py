"""下载公开 CC0 Poly Haven glTF 与 1K PBR 贴图，校验 MD5；保留来源清单。"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import hashlib,json,httpx
ROOT=Path(__file__).resolve().parents[1]
ASSETS=['sofa_03','modern_arm_chair_01','modern_coffee_table_01','modern_wooden_cabinet','side_table_01','potted_plant_02','ceramic_vase_03','book_encyclopedia_set_01','desk_lamp_arm_01','dining_chair_02','dining_table']
def one(asset):
    with httpx.Client(timeout=90,follow_redirects=True) as client:
        response=client.get('https://api.polyhaven.com/files/'+asset);response.raise_for_status()
        meta=response.json()['gltf']['1k']['gltf']
        folder=ROOT/'app/public/models'/asset;folder.mkdir(parents=True,exist_ok=True)
        entries={asset+'.gltf':meta,**meta['include']}
        for name,file in entries.items():
            path=folder/name;path.parent.mkdir(parents=True,exist_ok=True)
            if path.exists() and hashlib.md5(path.read_bytes()).hexdigest()==file['md5']:continue
            data=client.get(file['url']);data.raise_for_status()
            if hashlib.md5(data.content).hexdigest()!=file['md5']:raise ValueError('MD5: '+asset+'/'+name)
            path.write_bytes(data.content)
        return {'id':asset,'url':'/models/'+asset+'/'+asset+'.gltf','source':'https://polyhaven.com/a/'+asset,'license':'CC0','bytes':sum(f['size'] for f in entries.values())}
if __name__=='__main__':
    with ThreadPoolExecutor(max_workers=4) as pool: results=list(pool.map(one,ASSETS))
    (ROOT/'app/public/models/sources.json').write_text(json.dumps(results,indent=2,ensure_ascii=False))
    print(json.dumps(results,ensure_ascii=False))
