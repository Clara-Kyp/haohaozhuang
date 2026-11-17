import * as THREE from '../app/node_modules/three/build/three.module.js';
import {RoundedBoxGeometry} from '../app/node_modules/three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {GLTFExporter} from '../app/node_modules/three/examples/jsm/exporters/GLTFExporter.js';
import fs from 'node:fs/promises';
globalThis.FileReader=class{readAsDataURL(blob){blob.arrayBuffer().then(buffer=>{this.result='data:application/octet-stream;base64,'+Buffer.from(buffer).toString('base64');this.onloadend?.();});}readAsArrayBuffer(blob){blob.arrayBuffer().then(buffer=>{this.result=buffer;this.onloadend?.();});}};
const root=new THREE.Group();root.name='Qiyu_Modern_Fabric_Sofa';
const fabric=new THREE.MeshStandardMaterial({name:'woven-fabric',color:'#d5c7af',roughness:.92});
const piping=new THREE.MeshStandardMaterial({name:'piping',color:'#b7a78e',roughness:.85});
const wood=new THREE.MeshStandardMaterial({name:'oak-feet',color:'#75593e',roughness:.48});
function box(w,h,d,x,y,z,r,mat=fabric,wrinkles=false){const geo=new RoundedBoxGeometry(w,h,d,6,r);if(wrinkles){const p=geo.attributes.position;for(let i=0;i<p.count;i++){const px=p.getX(i),py=p.getY(i),pz=p.getZ(i);const k=Math.sin(px*45+pz*29)*Math.sin(px*11-pz*17)*.0016;p.setY(i,py+k); }geo.computeVertexNormals();}const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);root.add(m);return m;}
function seam(w,d,y,x,z){const radius=.045,points=[];for(let corner=0;corner<4;corner++)for(let n=0;n<=10;n++){const angle=corner*Math.PI/2+n/10*Math.PI/2;const cx=(corner===0||corner===3?1:-1)*(w/2-radius),cz=(corner<2?1:-1)*(d/2-radius);points.push(new THREE.Vector3(x+cx+Math.cos(angle)*radius,y,z+cz+Math.sin(angle)*radius));}const path=new THREE.CatmullRomCurve3(points,true);const m=new THREE.Mesh(new THREE.TubeGeometry(path,80,.0022,5,true),piping);root.add(m);}
box(2.19,.26,.86,0,.26,0,.06);box(2.2,.55,.18,0,.56,-.37,.075);
box(.18,.43,.91,-1.035,.44,0,.075);box(.18,.43,.91,1.035,.44,0,.075);
for(let n=0;n<3;n++){const x=(n-1)*.64;box(.635,.16,.72,x,.453,.045,.057,fabric,true);seam(.60,.68,.505,x,.045);const back=box(.635,.4,.19,x,.665,-.295,.07,fabric,true);back.rotation.x=-.12;}
for(const side of [-1,1]){const cushion=box(.36,.36,.12,side*.80,.67,-.16,.07,new THREE.MeshStandardMaterial({name:'woven-fabric',color:side<0?'#b7ab94':'#e0d7c5',roughness:.95}),true);cushion.rotation.z=side*-.2;cushion.rotation.y=side*.16;}
for(const side of [-1,1])for(const back of [-1,1])box(.065,.14,.065,side*.92,.07,back*.33,.012,wood);
const result=await new GLTFExporter().parseAsync(root,{binary:false});
// 已有本地织物法线贴图与米制UV；原创几何和PBR材质随模型一起加载。
result.images=[{uri:'/textures/fabric_pattern_07_nor_gl_1k.jpg'}];result.samplers=[{magFilter:9729,minFilter:9987,wrapS:10497,wrapT:10497}];result.textures=[{sampler:0,source:0}];
for(const material of result.materials)if(material.name==='woven-fabric'){material.normalTexture={index:0,scale:.32};}
await fs.mkdir('app/public/models/qiyu-sofa',{recursive:true});await fs.writeFile('app/public/models/qiyu-sofa/sofa.gltf',JSON.stringify(result));
console.log('Original modern sofa',result.meshes.length,'meshes',result.accessors.filter(a=>a.type==='VEC3').reduce((n,a)=>n+a.count,0),'position/normal vertices');
