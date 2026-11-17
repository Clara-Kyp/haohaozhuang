import * as T from './vendor/three.js';
import { OrbitControls } from './vendor/OrbitControls.js';

export const styles = {
  '原木': ['#e5d2b3','#f7efe0','#a27751','#ece4d4','#658277'],
  '奶油': ['#e9d5bc','#fff5e5','#b69776','#fff0db','#ce987d'],
  '现代': ['#b6b5b0','#f2f0ea','#454846','#797d7c','#b48262'],
  '工业': ['#96918a','#a89c90','#423831','#655047','#a96a49'],
  '侘寂': ['#c4af92','#e4d5be','#806954','#c8b79d','#9a8866'],
  '北欧': ['#e3c9a2','#f9f8f1','#ac875c','#d5ddda','#678779']
};
export const names = {sofa:'沙发', chair:'单椅', table:'桌子', bed:'床', cabinet:'柜子', plant:'绿植', rug:'地毯', lamp:'落地灯'};

export function renderScene(stage, rooms, furniture, style, width, depth, walk, roomStyles, selectedId, surfaces) {
  const palette=room=>styles[roomStyles[room.id]||style];
  const scene = new T.Scene();
  scene.background = new T.Color('#e5eadf');
  const size = Math.max(width, depth);
  const camera = new T.PerspectiveCamera(42, 1, .035, size * 20);
  const renderer = new T.WebGLRenderer({antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  stage.append(renderer.domElement);
  const orbit = new OrbitControls(camera, renderer.domElement);
  if (walk) {
    const room = rooms.find(r=>r.id===selectedId)||rooms[0];
    camera.position.set((room.x+room.w*.25)*width-width/2,1.55,(room.y+room.h*.8)*depth-depth/2);
    orbit.target.set((room.x+room.w*.65)*width-width/2,1.45,(room.y+room.h*.3)*depth-depth/2);
  } else {
    camera.position.set(size*.91,size*.86,size*.98);
    orbit.target.set(0,.15,0);
  }
  orbit.maxDistance = size*4;
  orbit.update();
  scene.add(new T.HemisphereLight('#fff8e8','#827b70',2.1));
  const sun = new T.DirectionalLight('#fff0d5',2.3);
  sun.position.set(-size*.5,size,size*.65);
  sun.castShadow=true;
  sun.shadow.mapSize.set(1024,1024);
  Object.assign(sun.shadow.camera,{left:-size,right:size,top:size,bottom:-size,far:size*4});
  sun.shadow.normalBias=.035;
  scene.add(sun);
  const materials = new Map();
  function material(color) {
    if (!materials.has(color)) materials.set(color,new T.MeshStandardMaterial({color,roughness:.85}));
    return materials.get(color);
  }
  function box(parent,x,y,z,w,h,d,color) {
    const mesh = new T.Mesh(new T.BoxGeometry(w,h,d),material(color));
    mesh.position.set(x,y,z);
    mesh.castShadow=true;
    mesh.receiveShadow=true;
    parent.add(mesh);
    return mesh;
  }
  function cylinder(parent,x,y,z,r,h,color) {
    const mesh = new T.Mesh(new T.CylinderGeometry(r,r*.87,h,32),material(color));
    mesh.position.set(x,y,z);
    mesh.castShadow=true;
    parent.add(mesh);
  }
  box(scene,0,-.24,0,size*5,.12,size*5,'#d9dfd3');
  for (const room of rooms) {
    const [baseFloor,baseWall,wood]=palette(room);
    const {floor=baseFloor,wall=baseWall}=surfaces[room.id]||{};
    const w=room.w*width, d=room.h*depth;
    const x=(room.x+room.w/2)*width-width/2, z=(room.y+room.h/2)*depth-depth/2;
    box(scene,x,-.10,z,w,.2,d,floor);
    const strips=Math.min(55,Math.ceil(w/.22));
    for(let i=1;i<strips;i++) box(scene,x-w/2+i*w/strips,.002,z,.008,.004,d,wood);
    const h=walk?2.65:1.1;
    box(scene,x,h/2,z-d/2,w,h,.08,wall);
    box(scene,x-w/2,h/2,z,.08,h,d,wall);
    box(scene,x,.12,z+d/2,w,.24,.08,wall);
    box(scene,x+w/2,.12,z,.08,.24,d,wall);
    box(scene,x,.055,z-d/2+.05,w,.11,.025,wood);
  }
  for (const item of furniture) {
    const group=new T.Group();
    const room=rooms.find(r=>r.id===item.room);
    if (!room) continue;
    const [,,wood,fabric,accent]=palette(room);
    group.position.set((room.x+room.w*item.x)*width-width/2,0,(room.y+room.h*item.y)*depth-depth/2);
    group.rotation.y=item.angle||0;
    const color=item.color||fabric;
    const b=(...args)=>box(group,...args);
    const c=(...args)=>cylinder(group,...args);
    if(item.kind==='sofa'||item.kind==='chair') {
      const w=item.kind==='sofa'?2.05:.72;
      b(0,.25,0,w,.27,.83,wood);
      b(0,.43,.06,w-.16,.22,.68,color);
      b(0,.65,-.34,w,.64,.20,color);
      for(const side of [-1,1]) {
        b(side*(w/2-.06),.52,.04,.12,.33,.72,color);
        b(side*w*.24,.63,-.20,.33,.29,.13,accent).rotation.z=side*.15;
      }
    } else if(item.kind==='table') {
      b(0,.61,0,1.20,.09,.69,item.color||wood);
      for(const x of [-.49,.49]) for(const z of [-.25,.25]) b(x,.29,z,.065,.58,.065,wood);
    } else if(item.kind==='bed') {
      b(0,.20,0,1.54,.26,2.03,wood);
      b(0,.53,-1.01,1.62,1.06,.10,wood);
      b(0,.40,0,1.50,.22,1.98,color);
      b(0,.53,.29,1.52,.10,1.38,accent);
      for(const x of [-.35,.35]) b(x,.57,-.62,.59,.16,.41,'#fffaf0');
    } else if(item.kind==='cabinet') {
      b(0,.61,0,1.18,1.22,.42,item.color||wood);
      for(const x of [-.29,.29]) {
        b(x,.62,.225,.55,1.12,.035,color);
        b(x*.25,.67,.255,.028,.12,.025,wood);
      }
    } else if(item.kind==='plant') {
      c(0,.17,0,.17,.34,'#b17a60');
      for(let i=0;i<7;i++) {
        const a=i*2.4;
        const leaf=new T.Mesh(new T.SphereGeometry(.13,12,8),material(i%2?'#4e7557':'#739466'));
        leaf.scale.set(.85,1.65,.65);
        leaf.position.set(Math.sin(a)*.15,.51+i*.036,Math.cos(a)*.15);
        leaf.rotation.z=Math.sin(a)*.6;
        group.add(leaf);
      }
    } else if(item.kind==='rug') {
      b(0,.018,0,1.58,.025,1.08,item.color||accent);
    } else if(item.kind==='lamp') {
      c(0,.035,0,.20,.07,wood);
      c(0,.73,0,.024,1.42,wood);
      c(0,1.44,0,.23,.29,color);
    }
    group.scale.setScalar(Math.min(item.scale||1, room.w*width/2.2,room.h*depth/2.2));
    if(item.size){
      // Measure in model coordinates so rotating a product preserves its dimensions.
      const modelBounds=new T.Box3();
      for(const child of group.children){
        child.geometry.computeBoundingBox();
        child.updateMatrix();
        modelBounds.union(child.geometry.boundingBox.clone().applyMatrix4(child.matrix));
      }
      const actual=modelBounds.getSize(new T.Vector3());
      const [w,h,d]=item.size;
      group.scale.set(w/actual.x,h/actual.y,d/actual.z).multiplyScalar(item.scale||1);
    }
    scene.add(group);
  }
  const draw=()=>renderer.render(scene,camera);
  const resize=new ResizeObserver(()=>{
    renderer.setSize(stage.clientWidth,stage.clientHeight);
    camera.aspect=stage.clientWidth/stage.clientHeight;
    camera.updateProjectionMatrix();
    draw();
  });
  resize.observe(stage);
  orbit.addEventListener('change',draw);
  return ()=>{
    resize.disconnect();
    orbit.dispose();
    scene.traverse(obj=>obj.geometry?.dispose());
    materials.forEach(mat=>mat.dispose());
    sun.shadow.map?.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
}
