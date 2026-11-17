/**
 * 好好装 · 3D 房间场景（React Three Fiber）
 * ------------------------------------------------------------------
 * 相比原版的改动：
 * 1. 相机不再随 view 重建 Canvas —— 改为在同一 Canvas 内平滑切换透视 / 正交相机，
 *    并用 useFrame 做 Apple 风格的缓动过渡，机位在切换视角后仍然保留。
 * 2. 沙发支持直接在 3D 里拖拽摆放（射线投射到地面平面），拖拽期间不写撤销栈，
 *    松手时一次性提交，撤销行为符合直觉。
 * 3. 俯视图增加 500mm 参考网格与房间尺寸标尺。
 * 4. 增加窗帘、踢脚线、茶几、挂画、绿植等软装细节，材质与灯光更柔和。
 * 5. 墙面试刷色卡、商品款式颜色会实时反映到场景里。
 * 6. 使用独立物件与 glTF/PBR 资源，支持确认陈设后的逐件编辑。
 */
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, RoundedBox } from '@react-three/drei';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { materials, paintSwatches } from './store';
import SurfaceMaterial from './SurfaceMaterial';
import Rug from './Rug';
import SceneRenderer from './SceneRenderer';
import WindowAssembly from './WindowAssembly';
import RoomFurniture from './RoomFurniture';
import FurnitureScene from './FurnitureScene';
import { WallSelection, Television } from './WallEditor.jsx';
import { metricBox } from './surfaceGeometry';
import SceneBridge,{BakedShell} from './SceneBridge';
import {roomSignature,sceneSignature} from './buildTools';

/**
 * Canvas 的 camera 配置必须是稳定引用：R3F 每次 configure 都会比较它，
 * 若写成 JSX 里的对象字面量，每次重渲染都会被判定为「新相机」并重建，
 * 从而覆盖 CameraRig 设置的正交相机、丢掉当前机位。
 */
const DEFAULT_CAMERA = { position: [2.2, 1.62, 2.4], fov: 62, near: .04, far: 120 };
const DEFAULT_GL = { preserveDrawingBuffer: true, antialias: true };

/** 一个可复用的长方体：统一处理阴影、点击选中与材质粗糙度 */
function Block({ size, position, color, roughness, rotation, onClick, transparent, opacity, surface, tileCm }) {
  const geometry = useMemo(() => metricBox(size), [size[0], size[1], size[2]]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} position={position} rotation={rotation} castShadow receiveShadow onClick={onClick}>
      {surface ? <SurfaceMaterial name={surface} color={color} tileCm={tileCm} />
        : <meshStandardMaterial color={color} roughness={roughness ?? .8} transparent={transparent} opacity={opacity} />}
    </mesh>
  );
}

function Piping({ width, depth, position, color }) {
  const curve = useMemo(() => {
    const shape = new THREE.Shape();
    const x = width / 2 - .04, z = depth / 2 - .04;
    shape.absarc(x, z, .04, 0, Math.PI / 2, false);
    shape.absarc(-x, z, .04, Math.PI / 2, Math.PI, false);
    shape.absarc(-x, -z, .04, Math.PI, Math.PI * 1.5, false);
    shape.absarc(x, -z, .04, Math.PI * 1.5, Math.PI * 2, false);
    return new THREE.CatmullRomCurve3(shape.getPoints(8).map(p => new THREE.Vector3(p.x, 0, p.y)), true);
  }, [width, depth]);
  return <mesh position={position}>
    <tubeGeometry args={[curve, 80, .0018, 4, true]} />
    <meshStandardMaterial color={color} roughness={1} />
  </mesh>;
}

/**
 * 相机调度器：视角切换时平滑过渡，手动旋转时立即让出控制权。
 * pose 由父组件按「房间 + 视角」缓存，切回来时恢复原机位。
 */
function CameraRig({ view, width: w, depth: d, pose, onPose, orbit, cameraReset,walk=false }) {
  const { set, size, invalidate } = useThree();
  const controls = orbit; // 与 Sofa 共用同一个 ref，拖拽家具时暂时禁用轨道控制
  const desiredPosition = useRef(new THREE.Vector3());
  const desiredTarget = useRef(new THREE.Vector3());
  const active = useRef(false);
  const isTop = view === 'top';
  const keys=useRef(new Set());
  useEffect(()=>{const down=e=>{if(/INPUT|TEXTAREA|SELECT/.test(e.target?.tagName))return;if(walk&&['w','a','s','d','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){keys.current.add(e.key.toLowerCase());e.preventDefault();}};const up=e=>{keys.current.delete(e.key.toLowerCase());const c=controls.current;if(walk&&c)onPose({position:c.object.position.toArray(),target:c.target.toArray()});};const clear=()=>keys.current.clear();window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',clear);return()=>{window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',clear);keys.current.clear();};},[walk,onPose]);

  // 两个相机对象常驻，避免切换时重建整个 Canvas（原版会因重建丢机位）
  const persp = useMemo(() => new THREE.PerspectiveCamera(62, 1, .04, 120), []);
  const ortho = useMemo(() => new THREE.OrthographicCamera(-6, 6, 6, -6, .1, 200), []);

  useEffect(() => {
    const aspect = Math.max(.2, size.width / Math.max(1, size.height));
    persp.aspect = aspect;
    persp.updateProjectionMatrix();
    const half = Math.max(w, d) * .72;
    ortho.left = -half * aspect;
    ortho.right = half * aspect;
    ortho.top = half;
    ortho.bottom = -half;
    ortho.near = .1;
    ortho.far = 200;
    ortho.updateProjectionMatrix();

    const camera = isTop ? ortho : persp;
    // 俯视正交相机放在房间正上方，稍微偏一点 z 避免 up 向量共线
    const fallbackPos = isTop ? [0, Math.max(w, d) * 2.2, .001] : [w * .36, 1.62, d * .45];
    const fallbackTarget = isTop ? [0, 0, 0] : [0, 1.25, -d * .23];
    const pos = pose?.position || fallbackPos;
    const look = walk ? [pos[0],1.62,pos[2]-.15] : pose?.target || fallbackTarget;

    // 保留当前相机位置作为过渡起点，让切换是「飞过去」而不是跳过去
    const from = camera.position.lengthSq() ? camera.position.clone() : new THREE.Vector3(...pos);
    camera.position.copy(from);
    desiredPosition.current.set(...pos);
    desiredTarget.current.set(...look);
    set({ camera });
    active.current = true;
    invalidate();
  }, [view, w, d, size.width, size.height, set, persp, ortho, isTop, invalidate, cameraReset,walk]);

  useFrame((_, delta) => {
    if(walk&&controls.current&&!active.current){const c=controls.current,forward=c.target.clone().sub(c.object.position).setY(0).normalize(),right=forward.clone().cross(new THREE.Vector3(0,1,0)),move=new THREE.Vector3();if(keys.current.has('w')||keys.current.has('arrowup'))move.add(forward);if(keys.current.has('s')||keys.current.has('arrowdown'))move.sub(forward);if(keys.current.has('d')||keys.current.has('arrowright'))move.add(right);if(keys.current.has('a')||keys.current.has('arrowleft'))move.sub(right);if(move.lengthSq()){move.normalize().multiplyScalar(Math.min(delta,.05)*1.7);const old=c.object.position.clone();c.object.position.add(move);c.object.position.x=THREE.MathUtils.clamp(c.object.position.x,-w/2+.2,w/2-.2);c.object.position.z=THREE.MathUtils.clamp(c.object.position.z,-d/2+.2,d/2-.2);c.object.position.y=1.62;c.target.add(c.object.position.clone().sub(old));c.update();}}
    if (!active.current || !controls.current) return;
    const k = 1 - Math.exp(-5 * Math.min(delta, .05)); // 帧率无关的指数缓动
    const camera = isTop ? ortho : persp;
    camera.position.lerp(desiredPosition.current, k);
    controls.current.target.lerp(desiredTarget.current, k);
    controls.current.update();
    if (camera.position.distanceTo(desiredPosition.current) < .012 &&
        controls.current.target.distanceTo(desiredTarget.current) < .012) {
      active.current = false;
    }
  });

  return (
    <OrbitControls
      key={isTop ? 'ortho' : 'persp'}
      ref={controls}
      enableDamping
      dampingFactor={.08}
      minDistance={walk?.15:.6}
      maxDistance={walk?.15:Math.max(w, d) * 4}
      enablePan={!walk}
      maxPolarAngle={walk?Math.PI-.01:isTop ? Math.PI / 2 : Math.PI * .495}
      onStart={() => { active.current = false; }}
      onEnd={() => {
        const c = controls.current;
        if (c) onPose({ position: c.object.position.toArray(), target: c.target.toArray() });
      }}
    />
  );
}

/**
 * 家具拖动保留独立撤销操作。
 */
/** 沙发：支持拖拽；拖拽期间用本地 draft 渲染，松手一次性提交到 store */
function Sofa({ data, color, onSelect, onCommit, locked, orbit }) {
  const [draft, setDraft] = useState(null);
  const dragging = useRef(false);
  const moved = useRef(false);
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const hit = useMemo(() => new THREE.Vector3(), []);
  const start = useRef({ x: 0, z: 0, px: 0, pz: 0 });
  const x = draft?.sofaX ?? data.sofaX;
  const z = draft?.sofaZ ?? data.sofaZ;
  const w = data.sofaWidth, d = data.sofaDepth, h = .88;
  const upholstery = data.productId === 'sofa-3' ? '皮革' : '布艺';

  const down = (e) => {
    if (locked) return;
    e.stopPropagation();
    dragging.current = true;
    moved.current = false;
    e.ray.intersectPlane(plane, hit);
    start.current = { x, z, px: hit.x, pz: hit.z };
    if (orbit?.current) orbit.current.enabled = false;
    e.target.setPointerCapture?.(e.pointerId);
    if (typeof document !== 'undefined') document.body.style.cursor = 'grabbing';
  };
  const move = (e) => {
    if (!dragging.current) return;
    e.stopPropagation();
    if (!e.ray.intersectPlane(plane, hit)) return;
    // 以「按下瞬间」的沙发坐标为基准，避免用上一次 draft 反复累加导致越拖越快
    const nx = start.current.x + (hit.x - start.current.px);
    const nz = start.current.z + (hit.z - start.current.pz);
    if (Math.abs(hit.x - start.current.px) + Math.abs(hit.z - start.current.pz) > .04) moved.current = true;
    setDraft({ sofaX: nx, sofaZ: nz });
  };
  const up = (e) => {
    if (!dragging.current) return;
    e.stopPropagation();
    dragging.current = false;
    e.target.releasePointerCapture?.(e.pointerId);
    if (orbit?.current) orbit.current.enabled = true;
    if (typeof document !== 'undefined') document.body.style.cursor = '';
    if (draft && moved.current) onCommit({ sofaX: draft.sofaX, sofaZ: draft.sofaZ });
    setDraft(null);
  };
  const select = (e) => {
    if (moved.current) return; // 拖拽结束不误触选中
    e.stopPropagation();
    onSelect('sofa');
  };

  return (
    <group position={[x, 0, z]} rotation={[0, data.sofaAngle * Math.PI / 180, 0]}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <group scale={[1, data.sofaHeight / .88, 1]}>
      <RoundedBox args={[w - .04, .22, d - .04]} radius={.055} smoothness={4}
        position={[0, .24, 0]} castShadow receiveShadow onClick={select}>
        <SurfaceMaterial name={upholstery} color={color} size={[w, d]} />
      </RoundedBox>
      <RoundedBox args={[w - .04, h * .62, .15]} radius={.05} smoothness={4}
        position={[0, h * .68, -d / 2 + .095]} castShadow receiveShadow onClick={select}>
        <SurfaceMaterial name={upholstery} color={color} size={[w, h]} />
      </RoundedBox>
      {[-1, 0, 1].map(i => (
        <group key={i}>
          <RoundedBox args={[(w - .36) / 3 - .012, .17, d * .73]} radius={.048} smoothness={4}
            position={[i * (w - .36) / 3, .435, .065]} castShadow receiveShadow onClick={select}>
            <SurfaceMaterial name={upholstery} color={color} size={[w / 3, d]} />
          </RoundedBox>
          <Piping width={(w - .36) / 3 - .01} depth={d * .73} position={[i * (w - .36) / 3, .445, .065]}
            color={new THREE.Color(color).multiplyScalar(.78)} />
          <RoundedBox args={[(w - .34) / 3 - .012, h * .43, .17]} radius={.055} smoothness={4}
            position={[i * (w - .34) / 3, h * .74, -d / 2 + .23]} rotation={[-.10, 0, 0]}
            castShadow receiveShadow onClick={select}>
            <SurfaceMaterial name={upholstery} color={color} size={[w / 3, h]} />
          </RoundedBox>
        </group>
      ))}
      {[-1, 1].map(i => (
        <RoundedBox key={i} args={[.15, .32, d - .02]} radius={.055} smoothness={4}
          position={[i * (w - .15) / 2, .46, 0]} castShadow receiveShadow onClick={select}>
          <SurfaceMaterial name={upholstery} color={color} size={[d, .32]} />
        </RoundedBox>
      ))}
      {[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([a, b], i) => (
        <Block key={i} size={[.045, .14, .045]} position={[a * (w / 2 - .13), .07, b * (d / 2 - .13)]}
          color="#6c5342" surface="深木饰面" />
      ))}
      </group>
    </group>
  );
}

/** 简单的绿植，给场景一点生活气息 */
function Plant({ position }) {
  return (
    <group position={position}>
      <mesh position={[0, .16, 0]} castShadow>
        <cylinderGeometry args={[.15, .11, .32, 16]} />
        <meshStandardMaterial color="#d8c3a5" roughness={.9} />
      </mesh>
      {[0, 1, 2, 3, 4].map(i => (
        <mesh key={i} position={[Math.cos(i * 1.26) * .12, .52 + (i % 2) * .1, Math.sin(i * 1.26) * .12]}
          rotation={[0, i, .4]} castShadow>
          <sphereGeometry args={[.17, 10, 8]} />
          <meshStandardMaterial color={i % 2 ? '#7fb98a' : '#5f9e73'} roughness={.85} />
        </mesh>
      ))}
    </group>
  );
}

export default function Room({ data, view, onReady, onSelect, pose, onPose, onCommit, grid, target, cameraReset, onItemsChange, onAssetError,bridge,tool='drag',snap=0,walk=false,onPlacementError,preferOriginal=false }) {
  const { width: w, depth: d, height: h } = data;
  const isTop = view === 'top';
  const cutoff = isTop; // 俯视隐藏屋顶与四面墙，便于看布局
  const orbit = useRef(null);
  const renderRef = useRef(null);
  const swatch = paintSwatches.find(s => s.name === data.paint);
  const wallColor = (key) => swatch ? swatch.color : (materials[data.faces[key]] || '#efe7d9');
  const colors = Object.fromEntries(Object.keys(data.faces).map(face => [face, ['floor', 'ceiling'].includes(face) ? materials[data.faces[face]] : wallColor(face)]));
  const floor = data.faces.floor;
  const rugColor = data.rugColor || '#dcc7a8';
  const sofaColor = data.sofaColor || '#d9a07b';
  const rug = data.rug === '靠窗' ? [0, .003, -d * .29]
    : data.rug === '茶几下' ? [.3, .003, 0]
      : [data.sofaX + .8, .003, data.sofaZ];
  const band = Math.min(data.band, w * .24, d * .24);
  const validBake=!preferOriginal&&!isTop&&data.bake?.roomSignature===roomSignature(data);
  const fullBake=validBake&&data.buildMode==='showroom'&&data.bake.sourceSignature===sceneSignature(data);
  const roomUrl=validBake?(fullBake?data.bake.room.showroom:data.bake.room.build):null;

  return (
    <Canvas shadows="percentage" dpr={[1, 1.7]} gl={DEFAULT_GL} camera={DEFAULT_CAMERA}>
      <color attach="background" args={['#d9e4ec']} />
      <ambientLight intensity={.18} />
      <hemisphereLight args={['#e5edfa', '#bfa68a', .65]} />
      <directionalLight position={[w * .15, h * 1.3, -d * 1.1]} intensity={3.8} color="#fff0d8" castShadow
        shadow-radius={3} shadow-mapSize={[2048, 2048]} shadow-normalBias={.018} shadow-bias={-.00015}
        shadow-camera-near={.1} shadow-camera-far={25}
        shadow-camera-left={-w} shadow-camera-right={w} shadow-camera-top={h * 2} shadow-camera-bottom={-h * 2} />
      <rectAreaLight position={[0, h * .58, -d / 2 + .12]} intensity={4} color="#e4edff"
        width={w * .6} height={h * .55} rotation={[0, Math.PI, 0]} />
      <pointLight position={[w * .15, h * .8, d * .1]} intensity={8} color="#ffe5c4" distance={12} decay={2} />
      <SceneRenderer renderRef={renderRef} isTop={isTop} />

      <CameraRig view={view} width={w} depth={d} pose={pose} onPose={onPose} orbit={orbit} cameraReset={cameraReset} walk={walk} />
      <SceneBridge bridge={bridge} data={data}/>

      {/* 500mm 参考网格：俯视时叠加，便于核对通道净宽 */}
      {isTop && grid && (
        <gridHelper args={[Math.ceil(Math.max(w, d) * 2 / .5) * .5, Math.ceil(Math.max(w, d) * 2 / .5), '#9ccbb0', '#d8e9dd']}
          position={[0, .008, 0]} />
      )}

      {/* 米制 UV：砖的重复周期来自 tileCm，木纹不会随房间尺寸拉伸。 */}
      <group name="RV_ROOM" visible={!roomUrl} userData={{rvRole:'room'}}>
      <Block size={[w, .08, d]} position={[0, -.04, 0]} color={colors.floor}
        surface={floor} tileCm={data.tileCm} onClick={(e) => { e.stopPropagation(); onSelect('floor'); }} />

      {!cutoff && (
        <>
          {/* 四面墙 + 天花 */}
          <Block size={[.1, h, d]} position={[-w / 2 - .05, h / 2, 0]} color={colors.west} surface={data.faces.west} onClick={(e) => { e.stopPropagation(); onSelect('west'); }} />
          <Block size={[.1, h, d]} position={[w / 2 + .05, h / 2, 0]} color={colors.east} surface={data.faces.east} onClick={(e) => { e.stopPropagation(); onSelect('east'); }} />
          <group onClick={(e) => { e.stopPropagation(); onSelect('north'); }}>
            <Block size={[w, h * .25, .1]} position={[0, h * .125, -d / 2 - .05]} color={colors.north} surface={data.faces.north} />
            <Block size={[w, h * .15, .1]} position={[0, h * .925, -d / 2 - .05]} color={colors.north} surface={data.faces.north} />
            {[-1, 1].map(side => <Block key={side} size={[w * .19, h * .6, .1]}
              position={[side * w * .405, h * .55, -d / 2 - .05]} color={colors.north} surface={data.faces.north} />)}
          </group>
          <Block size={[w, h, .1]} position={[0, h / 2, d / 2 + .05]} color={colors.south} surface={data.faces.south} onClick={(e) => { e.stopPropagation(); onSelect('south'); }} />
          <Block size={[w, .1, d]} position={[0, h + .05, 0]} color={colors.ceiling} surface={data.faces.ceiling} onClick={(e) => { e.stopPropagation(); onSelect('ceiling'); }} />

          {/* 踢脚线 */}
          {[[-w / 2, 0, .02, h * .09, d], [w / 2, 0, .02, h * .09, d]].map(([x, , thickness, height, length], i) => (
            <Block key={'skirt' + i} size={[thickness, height, length]} position={[x, height / 2, 0]} color="#f4efe6" />
          ))}
          <Block size={[w, h * .09, .02]} position={[0, h * .045, -d / 2]} color="#f4efe6" />

          <WindowAssembly width={w} height={h} depth={d} revision={data} onSelect={onSelect} />

          {/* 吊顶：平吊顶 / 双眼皮吊顶（两级边带） */}
          {data.ceiling === '平吊顶' && (
            <Block size={[w, data.drop, d]} position={[0, h - data.drop / 2, 0]} color={colors.ceiling} surface={data.faces.ceiling}
              onClick={(e) => { e.stopPropagation(); onSelect('ceiling'); }} />
          )}
          {data.ceiling === '双眼皮吊顶' && [1, .55].map((factor, i) => (
            <group key={i} position={[0, -i * data.drop * .44, 0]}>
              {[-1, 1].map(side => (
                <group key={side}>
                  <Block size={[w, data.drop * .55, band * factor]} position={[0, h - data.drop * .275, side * (d - band * factor) / 2]}
                    color={colors.ceiling} surface={data.faces.ceiling} onClick={(e) => { e.stopPropagation(); onSelect('ceiling'); }} />
                  <Block size={[band * factor, data.drop * .55, d]} position={[side * (w - band * factor) / 2, h - data.drop * .275, 0]}
                    color={colors.ceiling} surface={data.faces.ceiling} onClick={(e) => { e.stopPropagation(); onSelect('ceiling'); }} />
                </group>
              ))}
            </group>
          ))}

          {/* 客厅挂画 */}
          {!data.furnishingApplied && data.hasSofa && <group position={[-w / 2 + .075, h * .62, 0]} rotation={[0, Math.PI / 2, 0]}>
            <mesh><boxGeometry args={[.72, .54, .03]} /><meshStandardMaterial color="#c9a884" /></mesh>
            <mesh position={[0, 0, .02]}><planeGeometry args={[.64, .46]} /><meshStandardMaterial color="#e9ddc6" /></mesh>
            <mesh position={[.08, -.04, .025]}><circleGeometry args={[.11, 24]} /><meshStandardMaterial color="#c9a07c" /></mesh>
          </group>}
        </>
      )}

      <Television data={data} onSelect={onSelect} />
      </group>
      {roomUrl&&<React.Suspense fallback={null}><BakedShell url={roomUrl} full={fullBake} width={w} depth={d} height={h} onSelect={onSelect}/></React.Suspense>}
      {/* 地毯 */}
      {data.rug !== '无地毯' && (
        <group position={rug} onClick={(e) => { e.stopPropagation(); onSelect('rug'); }}>
          <Rug width={Math.min(1.6, w * .6)} depth={Math.min(2, d * .65)} height={.03} color={rugColor} />
        </group>
      )}

      {/* 茶几 */}
      {!data.furnishingApplied && data.hasSofa && <group position={[data.sofaX + .8, 0, data.sofaZ + .05]}>
        <RoundedBox args={[.9, .06, .55]} radius={.03} position={[0, .4, 0]} castShadow>
          <SurfaceMaterial name="橡木" color="#ded0b5" size={[.9,.55]} />
        </RoundedBox>
        {[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([a, b], i) => (
          <Block key={i} size={[.04, .38, .04]} position={[a * .38, .2, b * .21]} color="#a68a6b" surface="橡木" />
        ))}
        <mesh position={[.12, .47, 0]} castShadow><sphereGeometry args={[.07, 12, 10]} /><meshStandardMaterial color="#8fb79a" /></mesh>
      </group>}

      {!data.furnishingApplied && <RoomFurniture items={data.furniture || []} />}
      {data.furnishingApplied && <FurnitureScene data={data} target={target} onSelect={onSelect} onChange={onItemsChange} orbit={orbit} onError={onAssetError} tool={tool} snap={snap} walk={walk} onInvalid={onPlacementError} preferOriginal={preferOriginal}/>}
      {!isTop && <WallSelection target={target} width={w} depth={d} height={h} />}
      {/* 沙发（可拖拽） */}
      {!data.furnishingApplied && data.hasSofa && <Sofa data={data} color={sofaColor} onSelect={onSelect} onCommit={onCommit} locked={data.locked} orbit={orbit} />}

      {/* 落地灯 */}
      {data.lamp && (
        <group position={[Math.min(w / 2 - .4, data.sofaX + .9), 0, data.sofaZ - .8]}
          onClick={(e) => { e.stopPropagation(); onSelect('lamp'); }}>
          <Block size={[.24, .035, .24]} position={[0, .02, 0]} color="#6d5b48" />
          <Block size={[.03, 1.3, .03]} position={[0, .65, 0]} color="#6d5b48" />
          <mesh position={[0, 1.36, 0]} castShadow>
            <cylinderGeometry args={[.11, .19, .24, 24]} />
            <meshStandardMaterial color="#f4dcb4" emissive="#e5b477" emissiveIntensity={.35} />
          </mesh>
          <pointLight position={[0, 1.24, 0]} color="#ffd19c" intensity={16} distance={4} />
        </group>
      )}

      {!data.furnishingApplied && ['living','bedroom','study','court'].includes(data.roomType) && <Plant position={[-w / 2 + .45, 0, -d / 2 + .5]} />}

    </Canvas>
  );
}
