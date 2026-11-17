import { cloudRequest, isShowcase, publicAsset } from './deployment';
import OnlineAccess from './OnlineAccess';
import { showcaseFurnishing } from './showcaseFurnishing';
/**
 * 好好装 · 装修工作台主入口
 * ------------------------------------------------------------------
 * 这一版把原来 330 行的单文件状态堆砌，整理成「欢迎 → 户型 → 陈设提案 → 3D逐件编辑」
 * 四段可回退的流程，并补齐以下能力：
 *
 * 1. 引导式首屏：内置两套示例户型，打开即可体验，不再面对空白画布。
 * 2. 户型阶段：底图、房间点选/框选、功能区拆分、宽高分别校准（修掉原版
 *    用单一 ratio 从「整张图」推导房间尺寸导致的比例失真）。
 * 3. 装修阶段：3D 拖拽摆沙发、正交俯视 + 500mm 网格、六面材质、吊顶、
 *    墙面试刷色卡、演示商品候选栏、语音/文字改方案。
 * 4. 模型不可用时明确提示；真实户型不替换为示例，陈设提案失败时保留场景。
 * 5. 使用 IndexedDB 按事务保存完整项目，包含底图、陈设提案及所有房间。
 */
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import Room from './Room';
import { createRoomScene, roomTypes, classifyRoom } from './roomScenes';
import { wallCommand, wallKeys, defaultTv } from './wallObjects';
import FurnishingPage from './FurnishingPage';
import FurnitureInspector from './FurnitureInspector';
import InventoryPanel from './InventoryPanel';
import useSceneFullscreen from './useSceneFullscreen';
import BakePanel from './BakePanel';
import {showroomSnapshot,restoreShowroom,sceneSignature,transformItems} from './buildTools';
import {FurnitureLoading} from './FurnitureScene';
import {assets,freshFurnishing,requireFurnishing,furnishingWarning} from './furnishing';
import { readProject, writeProject } from './persistence';
import PlanAssistant from './PlanAssistant';
import PlanCanvas from './PlanCanvas';
import { RecognitionDimensions, RoomDimensionsForm } from './PlanMeasurements';
import { canonicalStyle, getStyleProfile, styleNames } from './styleProfiles';
import { newPlanning, restorePlanning, layoutGoals, validRooms, requireLayouts, readImage, rasterizePlan,
  recognitionRoomSizes, applyRecognitionSizes, planRoomDimensions, resizeRoomToDimensions } from './planTools';
import {
  useStudio, materials, preset, initialScene, initialRoom, faceNames,
  ceilingTypes, rugPositions, proposalPatch, placement, serializeProject, withoutRoom,
  samplePlans, demoProducts, paintSwatches, planBackdrop, heroRoomSvg, buildCourtyardBackdrop,
  interpretCommand, localZones,
} from './store';
import './style.css';
import './build.css';
import './brand.css';

/** 统一请求封装：后端不可用时抛错，由调用方决定如何降级 */
async function localApi(path, body) {
  const response = await fetch('/api/' + path, body ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  } : undefined);
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : '请求失败，请重试。');
  return data;
}

const svgHref = (svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

/* ------------------------------------------------------------ 通用小组件 */

function Select({ label, value, options, onChange }) {
  return (
    <label>{label}
      <select value={value} onChange={e => onChange(e.target.value)}>
        {options.map(item => <option key={item}>{item}</option>)}
      </select>
    </label>
  );
}

function NumberField({ label, value, min, max, step = .01, onChange, suffix, inputRef }) {
  return (
    <label>
      <span className="label-row">{label}{suffix && <b>{Number(value).toFixed(step >= 1 ? 0 : 2)}{suffix}</b>}</span>
      <input ref={inputRef} type="number" min={min} max={max} step={step} value={value}
        onChange={e => { if (e.target.value !== '' && e.target.validity.valid) onChange(e.target.valueAsNumber); }} />
    </label>
  );
}

const loadSaved = () => {
  try { return JSON.parse(localStorage.getItem('roomvoice-project')); } catch { return null; }
};

/* ------------------------------------------------------------ 欢迎首屏 */

function Landing({ onPlan, onUpload, onRestore, hasSaved, onStartBlank, cloudCode, onEnableCloud }) {
  const fileRef=useRef(null),[heroView,setHeroView]=useState('inside');
  const uploadButtonRef = useRef(null);
  const focusUpload = useRef(false);
  const [sampleId, setSampleId] = useState(samplePlans[0].id);
  const [heroScene,setHeroScene]=useState(()=>{
    const poses=[['sofa',-1.75,0,90],['armchair',1.45,-.8,-35],['coffee',-.15,0,0],['rug',-.15,0,0],['floor-lamp',-1.95,-1.55,0],['plant',1.9,-1.55,0],['cabinet',.7,1.68,0]];
    return {...initialScene,...preset('奶油风'),width:5.4,depth:4.4,height:2.8,hasSofa:false,furnishingApplied:true,items:poses.map(([assetId,x,z,rotation],n)=>({id:'preview-'+n,assetId,name:assets[assetId].name,...assets[assetId].dimensions,x,z,rotation,elevation:assetId==='rug'?.008:0,parentId:null,locked:false})),rug:'无地毯'};
  });
  const [heroTarget,setHeroTarget]=useState(null);
  useEffect(() => {
    let stopped = false;
    const motionUrl = new URL(publicAsset('/design-kit/motion/motion.js'), location.href).href;
    import(/* @vite-ignore */ motionUrl).then(m => { if (!stopped) m.refresh(); });
    if (!isShowcase) {
      const momentsUrl = new URL(publicAsset('/design-kit/moments/moments.js'), location.href).href;
      import(/* @vite-ignore */ momentsUrl).then(m => { if (!stopped) m.mountAll(document); });
    }
    return () => { stopped = true; };
  }, []);
  useEffect(() => {
    if (cloudCode && focusUpload.current) {
      uploadButtonRef.current?.focus();
      focusUpload.current = false;
    }
  }, [cloudCode]);

  const roomPreview = <Room data={heroScene} view={heroView} onPose={()=>{}} target={heroTarget} onSelect={setHeroTarget}
    onItemsChange={items=>setHeroScene(s=>({...s,items}))} onCommit={patch=>setHeroScene(s=>({...s,...patch}))} grid={false}/>;
  const viewControls = <div className="hh-preview-tools" role="group" aria-label="首页预览视角">
    <button aria-pressed={heroView==='inside'} onClick={()=>setHeroView('inside')}>室内视角</button>
    <button aria-pressed={heroView==='top'} onClick={()=>setHeroView('top')}>俯视视角</button>
  </div>;

  if (isShowcase) {
    return <main id="main-content" className="showcase-home" tabIndex={-1}>
      <section className="hero showcase-hero" data-enter aria-labelledby="hero-title">
        <div className="wrap showcase-grid">
          <div className="showcase-intro">
            <h1 id="hero-title">装修前，<br/>先在 3D 里试装</h1>
            <p>摆一摆家具，试试墙面和地板的搭配。</p>
            <div className="showcase-actions">
              {cloudCode && <div className="showcase-upload">
                <button className="btn btn-primary" ref={uploadButtonRef} aria-describedby="showcase-upload-help"
                  onClick={()=>fileRef.current?.click()}>上传自己的户型图</button>
                <input ref={fileRef} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={event => {
                  onUpload(event.target.files[0]);
                  event.target.value = '';
                }}/>
                <small id="showcase-upload-help">户型图和参考图会发送到云端，用于生成方案。</small>
              </div>}
              <div className="showcase-start">
                <select value={sampleId} aria-label="选择户型" onChange={event=>setSampleId(event.target.value)}>
                  {samplePlans.map(plan=><option key={plan.id} value={plan.id}>{plan.name}</option>)}
                  <option value="blank">空白画布</option>
                </select>
                <button className={cloudCode ? 'btn btn--secondary' : 'btn btn-primary'} onClick={() => {
                  if (sampleId === 'blank') onStartBlank();
                  else onPlan(samplePlans.find(plan=>plan.id===sampleId));
                }}>{sampleId === 'blank' ? '打开空白画布' : '试用示例户型'}</button>
              </div>
              {!cloudCode && <OnlineAccess onEnable={code => {
                focusUpload.current = true;
                onEnableCloud(code);
              }}/>}
            </div>
          </div>
          <div className="hero__stage showcase-preview" aria-label="可交互的客厅 3D 预览">
            <div className="showcase-preview-bar"><span>3D 客厅预览</span>{viewControls}</div>
            <div className="showcase-canvas">{roomPreview}</div>
          </div>
        </div>
      </section>
    </main>;
  }

  return <><main id="main-content" className="landing hh-landing">
    <section className="hero hero--product hh-hero" data-enter aria-labelledby="hero-title"><div className="wrap">
      <div className="hero-text hero__in hh-hero-in"><div className="hh-hero-head hero__head"><div><p className="hh-eyebrow">好好装 · 家居设计工作台</p><h1 id="hero-title">给自己家的<br/>3D 装修工作台。</h1></div>
        <div className="hh-hero-intro"><p>上传户型，规划陈设。沙发、地毯、墙面和吊顶，都在同一个空间里调整。</p><div className="hero-actions"><button className="btn btn--primary btn-primary" onClick={()=>fileRef.current?.click()}>上传户型图 <span aria-hidden="true">↗</span></button><button className="btn btn--secondary" onClick={()=>onPlan(samplePlans[0])}>试用示例户型</button></div><input ref={fileRef} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>onUpload(e.target.files[0])}/>{hasSaved&&<button className="hh-resume" onClick={onRestore}>继续上次保存的方案 →</button>}</div>
      </div>
      <div className="hero__stage hh-room-preview" aria-label="可交互的客厅3D预览">{roomPreview}{viewControls}</div></div>
    </div></section>
    <section className="hh-process section" id="design-process" style={{'--h':1}}><div className="wrap">
      <div className="hh-section-head"><h2>一间房，从户型到陈设。</h2><p>先确认布局，再决定物品，最后进空间慢慢调整。</p></div>
      <div className="hh-process-layout"><div className="hh-steps">{[['01','核对户型','上传户型图，确认房间边界和尺寸。保留原布局，或重新规划功能分区。'],['02','确认陈设','选风格，放参考图，查看每件家具的尺寸、摆位与搭配理由。'],['03','编辑空间','逐件拖动、旋转与换材质，导入喜欢的商品，把暂时不用的物品放回储物栏。']].map(([n,title,desc])=><div className="hh-step" key={n}><span>{n}</span><div><h3>{title}</h3><p>{desc}</p></div></div>)}</div>
        <div className="hh-materials"><div className="hh-material-grid" aria-hidden="true"><div className="material-oak"/><div className="material-stone"/><div className="material-fabric"/><div className="material-plaster"/></div><div className="hh-facts" data-moment="counter-rolls"><div className="stat"><p className="t-stat">6</p><p>个表面，分别选材</p></div><div className="stat"><p className="t-stat">3</p><p>个步骤，确认方案</p></div></div></div>
      </div>
    </div></section>
    <section className="hh-plans section" id="start-plans" style={{'--h':1}}><div className="wrap"><div className="hh-section-head"><h2>选一个户型，开始试装。</h2><button className="btn btn--secondary" onClick={onStartBlank}>从空白画布开始 ↗</button></div><div className="hh-plan-grid">{samplePlans.map(plan=><button className="hh-plan-card card" key={plan.id} onClick={()=>onPlan(plan)}><div className="hh-plan-drawing" dangerouslySetInnerHTML={{__html:plan.id==='plan-a'?planBackdrop:buildCourtyardBackdrop(plan.rooms)}}/><div className="hh-plan-meta"><div><h3>{plan.name}</h3><p>{plan.subtitle}</p></div><span aria-hidden="true">↗</span></div></button>)}</div><p className="hh-plan-note">示例户型用于体验。自己的家，请按实际测量核对尺寸和门窗位置。</p></div></section>
    </main><footer className="hh-footer closing"><div className="wrap"><div className="hh-close"><h2>开始规划你的家。</h2><p>从一张户型图开始，给每件家具找到合适的位置。</p><button className="btn btn--primary btn-primary" onClick={()=>fileRef.current?.click()}>上传户型图 ↗</button><div className="hh-footer-word" aria-hidden="true">好好装</div></div><div className="hh-footer-directory"><span>好好装</span><p>户型规划 / 家具陈设 / 实时 3D</p><span>© {new Date().getFullYear()}</span></div></div></footer></>;
}

/* ------------------------------------------------------------ 主应用 */

function App() {
  const { scene, edit, load, undo, undoStack, resetProject } = useStudio();

  const [cloudCode, setCloudCode] = useState('');
  const hasAI = !isShowcase || !!cloudCode;
  function api(path, body) {
    if (!isShowcase) return localApi(path, body);
    if (cloudCode && ['plan', 'layouts', 'furnishings'].includes(path)) return cloudRequest(path, cloudCode, body);
    throw new Error('此功能需要本地版服务。');
  }

  const [stage, setStage] = useState('welcome');      // welcome | plan | furnishing | studio
  const [rooms, setRooms] = useState([{ ...initialRoom }]);
  const [source, setSource] = useState([{ ...initialRoom }]);
  const [mode, setMode] = useState('keep');            // keep | adjust
  const [active, setActive] = useState(0);
  const [photo, setPhoto] = useState('');              // 用户上传的底图 dataURL
  const [planImg, setPlanImg] = useState([2048, 1536]); // 原图像素尺寸，供 bbox 归一化
  const [backdrop, setBackdrop] = useState(planBackdrop); // 内置底图 SVG 字符串
  const [ratio, setRatio] = useState(1);               // 图片宽高比，决定 SVG viewBox 高度
  const [planW, setPlanW] = useState(5.76);            // 整张图对应宽度（米）
  const [planH, setPlanH] = useState(12.4);            // 整张图对应高度（米）
  const [verified, setVerified] = useState(false);
  const [zone, setZone] = useState(null);
  const [view, setView] = useState('inside');          // plan | top | inside
  const [target, setTarget] = useState(null);
  const [studioPanel, setStudioPanel] = useState('objects');
  const [shelfOpen, setShelfOpen] = useState(true);
  const [message, setMessage] = useState(isShowcase ? '' : '先挑一个示例户型，或上传自己的户型图。');
  const [toast, setToast] = useState('');
  const [command, setCommand] = useState('');
  const [busy, setBusy] = useState('');
  const [proposal, setProposal] = useState(null);
  const [showAssistant, setShowAssistant] = useState(true);
  const [voiceState, setVoiceState] = useState(null);
  const voiceSession = useRef(null);
  const [link, setLink] = useState('');
  const [saved, setSaved] = useState(null);
  const [saving, setSaving] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [grid, setGrid] = useState(true);
  const [picked, setPicked] = useState({});
  const [dragOver, setDragOver] = useState(false);
  const [planning, setPlanning] = useState(newPlanning);
  const [furnishingDrafts,setFurnishingDrafts] = useState({});
  const [recognition, setRecognition] = useState({ state: 'idle', detail: '' });
  const [sizeConditions, setSizeConditions] = useState([]);
  const [snapRooms, setSnapRooms] = useState(true);
  const [roomEditUndo, setRoomEditUndo] = useState(null);
  const [buildTool,setBuildTool]=useState('drag'),[snap,setSnap]=useState(0),[walk,setWalk]=useState(false),[exporting,setExporting]=useState(false),[productBake,setProductBake]=useState(null);
  const roomBridge=useRef(null),inventoryDrop=useRef(null);
  const {frameRef,fullscreen,toggle:toggleFullscreen}=useSceneFullscreen();

  const headerUploadRef=useRef(null);
  const inspectorRef = useRef(null);
  const planWidthRef = useRef(null);
  const shelfToggleRef = useRef(null);
  const [cameraReset, setCameraReset] = useState(0);
  const request = useRef(0);
  const currentRooms = useRef({});
  const cameraPoses = useRef({});

  const selectedRoom = rooms[active] || rooms[0];
  const layoutPreview = planning.layouts.find(p => p.id === planning.previewId);
  const visibleRooms = layoutPreview?.rooms || rooms;
  const planSize = [planW, planH];
  const canEditPlan = stage === 'plan' && !busy && !layoutPreview;
  const warning = placement(scene);
  const visibleWarning = !busy && stage === 'studio' && warning;
  const statusText = busy || visibleWarning || message;
  const targetName = { ...faceNames, sofa: '沙发', rug: '地毯', lamp: '灯光', tv: '壁挂电视' }[target] || scene.items?.find(i=>i.id===target)?.name;
  const selectedPanel = faceNames[target] || target === 'tv' ? 'materials'
    : scene.items?.some(item => item.id === target) ? 'objects' : studioPanel;
  const spaceDisabled = !scene.furnishingApplied || !!busy || stage === 'plan';
  const poseKey = [active, view].join(':');
  const backdropUrl = useMemo(() => photo || (backdrop ? svgHref(backdrop) : ''), [photo, backdrop]);

  useEffect(() => {
    let stopped = false;
    readProject().then(project => {
      if (!stopped) setSaved(project || loadSaved());
    }).catch(() => {
      if (!stopped) { setSaved(loadSaved()); setMessage('浏览器项目存储暂不可用，保存时可重试。'); }
    }).finally(() => { if (!stopped) setStorageReady(true); });
    return () => { stopped = true; };
  }, []);

  function resetDraft() {
    resetProject();setFurnishingDrafts({});
    setRoomEditUndo(null);
    currentRooms.current = {}; cameraPoses.current = {};
    setProposal(null); setTarget(null); setPicked({}); setLink('');
  }

  // 底部轻提示：消息变化时短暂浮现，不打断操作
  useEffect(() => {
    setToast(message);
    const timer = setTimeout(() => setToast(''), 2800);
    return () => clearTimeout(timer);
  }, [message]);

  /** 房间的 3D 尺寸：内置户型用示意尺寸，上传户型按校准后的图宽高换算 */
  const roomSize = room => planRoomDimensions(room, planSize);

  function showHome() {
    setStage('welcome');
    if (isShowcase) setMessage('');
  }

  /** 载入一套内置示例户型 */
  function loadPlan(plan) {
    if (busy) { setMessage('请等待当前任务完成后切换项目。'); return; }
    resetDraft(); setPlanning(newPlanning());
    setSizeConditions([]);
    setRecognition({ state: 'sample', detail: '当前为内置示例，可直接核对，也可输入要求让模型重新规划。' });
    const list = plan.rooms.map(r => ({ ...r }));
    const living = list.findIndex(r => r.kind === 'living');
    setRooms(list); setSource(list); setActive(living >= 0 ? living : 0); setMode('keep'); setZone(null);
    setPhoto('');
    setBackdrop(plan.id === 'plan-a' ? planBackdrop : buildCourtyardBackdrop(plan.rooms));
    setRatio(plan.ratio || 1);
    setPlanW(plan.planWidthM); setPlanH(plan.planHeightM);
    setVerified(false); currentRooms.current = {}; cameraPoses.current = {};
    setStage('plan'); setView('plan');
    setMessage(`已载入「${plan.name}」。点选房间核对边界，再进入 3D。`);
  }

  /** 上传后直接调用视觉大模型；不再把前端墙线猜测写成识别结果。 */
  async function upload(file, conditions = []) {
    if (!file) return;
    if (busy) { setMessage('请等待当前任务完成后上传新户型。'); return; }
    const seq = ++request.current;
    setBusy('读取户型图…');
    try {
      const sizes = recognitionRoomSizes(conditions);
      const value = await readImage(file);
      if (seq !== request.current) return;
      resetDraft(); setPlanning(newPlanning());
      setSizeConditions(conditions);
      setPhoto(value.image); setBackdrop(''); setPlanImg([value.width, value.height]);
      setRatio(value.width / value.height);
      const estimatedWidth = 6.32;
      const estimatedHeight = Math.round(estimatedWidth * value.height / value.width * 100) / 100;
      setPlanW(estimatedWidth);
      setPlanH(Math.min(60, Math.max(1, estimatedHeight)));
      setRooms([]); setSource([]); setActive(0); setMode('keep'); setZone(null); setVerified(false);
      setStage('plan'); setView('plan');
      await recognize(value, seq, sizes);
    } catch (error) {
      if (seq === request.current) setMessage(error.message || '图片无法读取，请换一张试试。');
    } finally { if (seq === request.current) setBusy(''); }
  }

  async function recognize(image, seq, sizes, calibratedSize) {
    setBusy('大模型识别原始户型…');
    setRecognition({ state: 'recognizing', detail: '正在将原图交给视觉模型识别，请稍候。' });
    try {
      const value = await api('plan', {
        ...image, room_sizes: sizes,
        ...(calibratedSize && { plan_width_m: calibratedSize[0], plan_height_m: calibratedSize[1] }),
      });
      if (seq !== request.current) return;
      if (!validRooms(value.rooms)) {
        setRecognition({ state: 'empty', detail: '模型未识别出可靠房间。原图与现有划分已保留；可重试识别，或在下方输入要求重新规划。' });
        setMessage('未获得可靠识别结果，可输入要求重新生成布局。');
        return;
      }
      resetDraft();
      const recognized = applyRecognitionSizes(value.rooms.map(r => ({ ...r, name: String(r.name).slice(0,24) })), sizes);
      setRooms(recognized); setSource(recognized); setMode('keep'); setZone(null); setActive(0);
      setPlanning(old => ({ ...old, layouts: [], previewId: null, appliedId: null, error: '' }));
      const alignment = value.aligned_rooms > 0 ? `已按黑墙线对齐 ${value.aligned_rooms} 个空间的部分边界。` : '';
      const matched = recognized.filter(room => room.size).length;
      const measurements = matched > 0 ? `已匹配 ${matched} 间房的实测尺寸。` : '';
      setRecognition({ state: 'recognized', detail: `${value.model || '视觉模型'}识别出 ${recognized.length} 个候选空间。${alignment}${measurements}请核对房名、边界与实测尺寸。` });
      setMessage('模型识别完成，核对原布局或输入要求重新规划。');
    } catch (error) {
      if (seq === request.current) {
        const detail = '大模型识别失败，原图与现有划分已保留。' + error.message;
        setRecognition({ state: 'failed', detail }); setMessage(detail);
      }
    }
  }

  async function detect() {
    if (busy) { setMessage('请等待当前任务完成。'); return; }
    const seq = ++request.current;
    setBusy('准备原始户型图…');
    try {
      const image = photo ? { image: photo, width: planImg[0], height: planImg[1] } : await rasterizePlan(backdrop);
      await recognize(image, seq, recognitionRoomSizes(sizeConditions), verified ? planSize : null);
    } catch (error) {
      if (seq === request.current) {
        setRecognition({ state: 'failed', detail: error.message });
        setMessage(error.message);
      }
    }
    finally { if (seq === request.current) setBusy(''); }
  }

  async function addReferences(files) {
    if (!files.length || busy) return;
    if (planning.references.length + files.length > 3) { setMessage('最多上传三张布局参考图。'); return; }
    const seq = ++request.current;
    setBusy('读取布局参考图…');
    try {
      const refs = await Promise.all(files.map(file => readImage(file, 1200)));
      if (seq !== request.current) return;
      const added = refs.map(ref => ({ id: crypto.randomUUID(), image: ref.image, label: '' }));
      setPlanning(old => ({ ...old, references: [...old.references, ...added], error: '' }));
      setMessage('参考图已添加，将与原始户型一起提交给模型。');
    } catch (error) { if (seq === request.current) setMessage(error.message); }
    finally { if (seq === request.current) setBusy(''); }
  }

  async function generateLayouts() {
    if (busy) return;
    const seq = ++request.current;
    setBusy('大模型规划动线与功能分隔…');
    setPlanning(old => ({ ...old, error: '' }));
    try {
      const { goals } = planning;
      const image = photo ? { image: photo, width: planImg[0], height: planImg[1] } : await rasterizePlan(backdrop);
      const value = await api('layouts', { ...image, instruction: planning.instruction, goals,
        references: planning.references.map(r => ({ label: r.label.trim(), image: r.image })),
        current_rooms: rooms, original_rooms: source,
        previous_layouts: planning.layouts.map(p => ({ goal: p.goal, summary: p.summary, rooms: p.rooms })),
        plan_width_m: verified ? planW : null, plan_height_m: verified ? planH : null,
      });
      if (seq !== request.current) return;
      const layouts = requireLayouts(value, goals);
      setPlanning(old => ({ ...old, layouts, previewId: layouts[0].id, generationId: value.generation_id,
        model: `${value.provider} / ${value.model}`, error: '' }));
      setMessage(`已生成 ${layouts.length} 套不同布局。当前仅预览，选择应用后才替换原布局。`);
    } catch (error) {
      if (seq === request.current) {
        setPlanning(old => ({ ...old, error: error.message }));
        setMessage('规划未完成，原图、现有布局和上一轮候选均已保留。');
      }
    } finally { if (seq === request.current) setBusy(''); }
  }

  function applyLayout(plan) {
    if (busy || !validRooms(plan.rooms)) return;
    resetDraft(); setRooms(plan.rooms.map(r => ({ ...r }))); setActive(0); setMode('adjust'); setZone(null);
    setPlanning(old => ({ ...old, appliedId: plan.id, previewId: null }));
    setMessage(`已应用「${layoutGoals[plan.goal]?.label || "历史方案"} · ${plan.title}」，请核对布局与尺寸后进入 3D。`);
  }

  /** 功能分区建议：后端不可用时按房名给一个合理的本地拆分 */
  async function suggestZones() {
    if (!selectedRoom) return;
    setBusy('生成分区建议…');
    let result, local = false;
    try { result = await api('zones', { name: selectedRoom.name, width: roomSize(selectedRoom)[0], depth: roomSize(selectedRoom)[1] }); }
    catch { local = true; result = localZones(selectedRoom.name); }
    const ok = result && ['x', 'y'].includes(result.axis) && Number.isFinite(result.split) &&
      result.split >= .2 && result.split <= .8 && Array.isArray(result.labels) &&
      result.labels.length === 2 && result.labels.every(l => typeof l === 'string' && l.trim() && l.length <= 12);
    setZone(ok ? result : localZones(selectedRoom.name));
    setBusy('');
    setMessage((local || !ok ? '模型建议不可用，当前显示本地规则示意。' : '已显示模型功能分区建议。') + '核对后可进入 3D，实体墙改动待现场核实。');
  }

  /* --------------------------- 平面图交互 --------------------------- */

  function editRoomGeometry(index, room) {
    if (!canEditPlan) return;
    const before = rooms[index];
    if (!before) return;
    const sameBounds = ['x', 'y', 'w', 'h'].every(key => Math.abs(room[key] - before[key]) < 1e-8);
    const sameSize = room.size === before.size || (room.size && before.size && room.size.every((value, i) =>
      Math.abs(value - before.size[i]) < 1e-8));
    if (sameBounds && sameSize) return;
    const next = rooms.map((old, i) => i === index ? room : old);
    setRoomEditUndo({ before: rooms, after: next, active });
    setRooms(next);
    setActive(index);
  }

  function addRoomGeometry(box) {
    if (!canEditPlan) return;
    const next = [...rooms, { ...box, name: '房间 ' + (rooms.length + 1) }];
    setRoomEditUndo({ before: rooms, after: next, active });
    setRooms(next); setActive(rooms.length);
    setMessage('已添加新空间，可修改房间名称与尺寸。');
  }

  function undoRoomGeometry() {
    if (!canEditPlan || roomEditUndo?.after !== rooms) return;
    setRooms(roomEditUndo.before); setActive(roomEditUndo.active); setRoomEditUndo(null);
    setMessage('已撤销上一次房间调整。');
  }

  function selectRoom(index) {
    if (index === active) return;
    if (stage === 'studio') currentRooms.current[active] = { ...scene };
    setActive(index);
    if (stage === 'studio') {
      const [w, d] = roomSize(rooms[index]);
      const nextScene=createRoomScene(rooms[index], [w, d], currentRooms.current[index]);
      load(nextScene,index);
      if(!nextScene.furnishingApplied)setStage('furnishing');
      setLink(currentRooms.current[index]?.link || '');
      setProposal(null); setTarget(null);
      setMessage(`已切换到「${rooms[index]?.name || '房间'}」。`);
    }
  }

  function enter() {
    if (busy) return;
    if (layoutPreview) { setMessage('当前是候选预览，请先应用布局，或退出预览保留原布局。'); return; }
    if (!selectedRoom || stage === 'studio') return;
    if (mode === 'keep') setSource(rooms);
    const [w, d] = roomSize(selectedRoom);
    load(createRoomScene(selectedRoom, [w, d], currentRooms.current[active]), active);
    setStage('furnishing'); setView('inside'); setTarget(null); setProposal(null);
    setLink(currentRooms.current[active]?.link || '');
    setMessage('户型已载入，请提供风格与居住需求，先生成并确认完整陈设。');
  }

  function revealControl(element) {
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: 'start' });
  }

  function selectTarget(key) {
    setTarget(key);
    if (key) {
      setStudioPanel(faceNames[key] || key === 'tv' ? 'materials' : 'objects');
      inspectorRef.current?.scrollTo({ top: 0 });
    }
    if (wallKeys.includes(key)) setMessage(`已选中${faceNames[key]}，可以换材质或添加壁挂电视。`);
  }

  function openStudioPanel(panel) {
    if (selectedPanel !== panel) setTarget(null);
    setStudioPanel(panel);
    inspectorRef.current?.scrollTo({ top: 0 });
    revealControl(inspectorRef.current);
  }

  function openShelf() {
    setShelfOpen(true);
    revealControl(shelfToggleRef.current);
  }

  function suggestTelevision() {
    const result = wallCommand('在这面墙添加壁挂电视', scene, target);
    if (result) { setProposal({ base: scene, ...result }); setMessage(result.summary); }
  }

  /* --------------------------- 装修交互 --------------------------- */

  async function ask() {
    if (!command.trim()) return;
    setBusy('理解需求并生成方案…');
    setProposal(null);
    let response, local = false;
    try {
      response = wallCommand(command, scene, target) || await api('design', { command, scene: { ...scene, room: selectedRoom?.name, selectedSurface: target, selectedWall: wallKeys.includes(target) ? target : null } });
    } catch {
      local = true;
      response = wallCommand(command, scene, target) || interpretCommand(command, scene); // 本地可表达的规则建议
    }
    const patch = proposalPatch(response.patch || response, scene);
    setBusy('');
    if (!Object.keys(patch).length) { setMessage(response.summary || '没有可应用的改动。'); return; }
    const summary = (local ? '模型暂不可用，以下为本地规则建议：' : '') + (response.summary || '已生成修改建议，确认后应用。');
    setProposal({ base: scene, patch, summary });
    setMessage(summary);
  }

  function applyProposal() {
    if (proposal.base !== scene) { setProposal(null); setMessage('场景已更新，请重新生成提案。'); return; }
    const error = placement({ ...scene, ...proposal.patch });
    if (error) { setMessage(error); return; }
    edit(proposal.patch);
    setProposal(null);
    setMessage('已应用方案，可一键撤销。');
  }

  useEffect(() => {
    setVoiceState(null);
    return () => {
      const recognition = voiceSession.current;
      voiceSession.current = null;
      recognition?.abort?.();
    };
  }, [stage, showAssistant, active]);

  function voice() {
    if (voiceSession.current) {
      const recognition = voiceSession.current;
      voiceSession.current = null;
      recognition.abort();
      setVoiceState({ status: 'done', text: '已取消语音输入。' });
      return;
    }

    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    const fail = text => setVoiceState({ status: 'error', text });
    if (!Speech) {
      fail('此浏览器不支持语音识别，请输入文字。');
      return;
    }

    let recognition;
    try {
      recognition = new Speech();
      recognition.lang = 'zh-CN';
      recognition.onstart = () => {
        if (voiceSession.current === recognition) setVoiceState({ status: 'listening', text: '正在监听，请说出改造需求。' });
      };
      recognition.onresult = event => {
        if (voiceSession.current !== recognition) return;
        const transcript = event.results?.[0]?.[0]?.transcript?.trim();
        if (transcript) {
          setCommand(transcript);
          setVoiceState({ status: 'done', text: '已填入识别文字，可以继续编辑。' });
        } else {
          fail('没有识别到文字，请重试或直接输入。');
        }
        voiceSession.current = null;
      };
      recognition.onerror = event => {
        if (voiceSession.current !== recognition) return;
        voiceSession.current = null;
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          fail('麦克风权限未开启，请允许访问麦克风后重试，或直接输入文字。');
        } else {
          fail('语音识别失败，请重试或输入文字。');
        }
      };
      recognition.onend = () => {
        if (voiceSession.current !== recognition) return;
        voiceSession.current = null;
        fail('没有识别到文字，请重试或直接输入。');
      };
      voiceSession.current = recognition;
      setVoiceState({ status: 'starting', text: '正在启动麦克风…' });
      recognition.start();
    } catch {
      voiceSession.current = null;
      fail('麦克风不可用，请检查麦克风或直接输入文字。');
    }
  }

  const voiceActive = voiceState?.status === 'starting' || voiceState?.status === 'listening';

  /** 应用演示商品款式：沙发写回真实规格，地毯/灯具写回颜色与开关 */
  function applyProduct(product) {
    if (product.kind === 'sofa' && !scene.hasSofa) { setMessage('该房间使用对应功能陈设，不自动添加客厅沙发。'); return; }
    if (product.kind === 'sofa' && scene.locked) { setMessage('沙发已锁定，请先解锁再换款。'); return; }
    if (product.kind === 'sofa') {
      edit({ sofaWidth: product.size[0], sofaDepth: product.size[1], sofaHeight: product.size[2],
        sofaColor: product.color, productId: product.id, hasSofa: true, sofaExplicit: true });
    } else if (product.kind === 'rug') {
      edit({ rugColor: product.color, rug: scene.rug === '无地毯' ? '沙发前' : scene.rug });
    } else if (product.kind === 'lamp') {
      edit({ lamp: true });
    }
    setPicked(old => ({ ...old, [product.kind]: product.id }));
    const err = placement({ ...scene, ...(product.kind === 'sofa'
      ? { sofaWidth: product.size[0], sofaDepth: product.size[1] } : {}) });
    setMessage(err ? `已应用「${product.name}」，但${err}` : `已应用「${product.name}」（演示规格，待核实）。`);
  }

  /** 墙面试刷：拖色卡到画布，或点色卡直接试刷整间墙面 */
  function applyPaint(swatch) {
    edit({ paint: swatch.name });
    setMessage(`已把「${swatch.name}」试刷到整间墙面。${swatch.code} 为演示色，购买前请核对真实色号。`);
  }

  function associate() {
    try {
      const url = new URL(link);
      if (url.protocol !== 'https:' || !/(^|\.)(taobao\.com|tmall\.com)$/.test(url.hostname) || url.username || url.password) throw Error();
      edit({ link: url.href });
      setMessage('已关联商品页，商品尺寸和配送范围待核对。');
    } catch { setMessage('请提供淘宝或天猫的 HTTPS 商品详情链接。'); }
  }

  /* --------------------------- 版本、生成与存档 --------------------------- */

  const furnishingDraft = furnishingDrafts[active] ||
    freshFurnishing(canonicalStyle(scene.furnishingStyle || scene.style));
  const updateFurnishing = draft => setFurnishingDrafts(old=>({...old,[active]:draft}));
  const furnishingContext = () => JSON.stringify([active,scene.width,scene.depth,scene.height,scene.roomType]);
  async function generateFurnishing() {
    if(busy)return;
    const index=active,draft=furnishingDraft,context=furnishingContext();
    if (!hasAI) {
      const plan = showcaseFurnishing(scene, draft.style);
      updateFurnishing({ ...draft, proposal: plan.items.length ? { ...plan, context } : null,
        error: plan.items.length ? '' : '当前房间没有合适的内置陈设。请切换到客厅示例。' });
      return;
    }
    setBusy('规划动线、家具与配饰…');
    updateFurnishing({...draft,error:''});
    try {
      const value=await api('furnishings',{scene:{width:scene.width,depth:scene.depth,height:scene.height,roomType:scene.roomType,roomName:selectedRoom?.name,faces:scene.faces,existingItems:scene.items||[]},style:draft.style,instruction:draft.instruction,references:draft.references.map(r=>r.image)});
      const plan=requireFurnishing(value,scene);
      setFurnishingDrafts(old=>({...old,[index]:{...draft,proposal:{...plan,context},error:''}}));
      setMessage('陈设提案已生成，请核对清单与摆位后再确认。');
    } catch(error) { setFurnishingDrafts(old=>({...old,[index]:{...draft,error:error.message}})); }
    finally {setBusy('');}
  }
  function applyFurnishing(applyFinishes) {
    const plan=furnishingDraft.proposal;if(!plan)return;
    if(plan.context!==furnishingContext()){updateFurnishing({...furnishingDraft,proposal:null,error:'房间尺寸或用途已变化，请重新生成。'});return;}
    const error=furnishingWarning(plan.items,scene);if(error){setMessage(error);return;}
    const finishes = applyFinishes && getStyleProfile(plan.style) ? { ...preset(plan.style), paint: '' } : {};
    const patch = {
      ...finishes, items: plan.items, furnishingApplied: true, furnishingStyle: plan.style,
      furnishingPlan: { summary: plan.summary, circulation: plan.circulation, generationId: plan.generationId },
      hasSofa: false, rug: '无地毯', lamp: false, buildMode: 'showroom', bake: null,
      showroom: showroomSnapshot({ ...scene, ...finishes, items: plan.items }),
    };
    edit(patch);currentRooms.current[active]={...scene,...patch};setStage('studio');setView('inside');setTarget(null);setStudioPanel('objects');
    setMessage('已按清单布置。');
  }
  function commitItems(items){
    const error=furnishingWarning(items,scene);if(error){setMessage(error);return false;}
    edit({items,buildMode:'build'});setMessage('已更新物件，可撤销。');return true;
  }
  function resetShowroom(){try{const patch=restoreShowroom(scene);edit(patch);setTarget(null);setWalk(false);setMessage('已还原此房间的样板间，可撤销。');}catch(e){setMessage(e.message);}}
  function applyBake(result){if(result.sourceSignature!==sceneSignature(useStudio.getState().scene)){setMessage('布局已变化，烘焙结果已缓存，没有覆盖当前场景。');return;}edit({bake:result,buildMode:'showroom'});setMessage('已加载真实Cycles 2K烘焙资产，物件仍可单独摆放。');}
  async function prepareBake(){setWalk(false);setView('inside');setExporting(true);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));}
  const assetError=useCallback(name=>setMessage(name+'的模型加载失败，可在清单中替换该物件。'),[]);

  async function save() {
    if (saving || !storageReady) return;
    setSaving(true);
    try {
      const roomScenes = { ...currentRooms.current };
      const key = useStudio.getState().roomKey;
      if (key != null) roomScenes[key] = scene;
      const data = serializeProject({
        rooms, source, active, scene, roomScenes, cameraPoses: cameraPoses.current,
        verified, zone, mode, planW, planH, ratio, photo, planImg, backdrop,
        picked, planning, recognition, sizeConditions, stage, furnishingDrafts,
      });
      await writeProject(data);
      setSaved(data);
      setMessage('完整方案已保存到本浏览器，含所有房间、陈设清单、参考图、物件和机位。');
    } catch {
      setMessage('保存未完成，旧存档仍保留。请检查浏览器存储空间后重试。');
    } finally { setSaving(false); }
  }

  function restore() {
    if (!saved || busy || saving) return;
    resetProject();
    setRoomEditUndo(null);
    setSizeConditions(saved.sizeConditions || []);
    setRooms(saved.rooms || []); setSource(saved.source || []); setActive(saved.active || 0);
    setVerified(!!saved.verified); setZone(saved.zone?.axis ? saved.zone : null);
    setMode(saved.mode || 'keep'); setPlanW(saved.planW || 6.32); setPlanH(saved.planH || 6.32);
    setRatio(saved.ratio || 1); setPhoto(saved.photo || ''); setPlanImg(saved.planImg || [2048,1536]);
    setBackdrop(saved.backdrop || '');
    setFurnishingDrafts(saved.furnishingDrafts || {});
    currentRooms.current = saved.roomScenes || { [saved.active || 0]: saved.scene || initialScene };
    cameraPoses.current = saved.cameraPoses || {};
    const restoredRoom = (saved.rooms || [])[saved.active || 0] || initialRoom;
    const restoredScene = currentRooms.current[saved.active || 0] || saved.scene;
    const dimensions = planRoomDimensions(restoredRoom, [saved.planW || 6.32, saved.planH || 6.32]);
    load(createRoomScene(restoredRoom, dimensions, restoredScene), saved.active || 0);
    setLink(saved.scene?.link || ''); setPicked(saved.picked || {}); setProposal(null);

    setPlanning(restorePlanning(saved.planning || {})); setRecognition(saved.recognition || { state: 'idle', detail: '' });
    setStage(saved.stage === 'furnishing' ? 'furnishing' : saved.stage === 'plan' || !saved.rooms?.length ? 'plan' : 'studio'); setView('inside'); setTarget(null);
    setMessage(saved.schemaVersion >= 2 ? '已恢复完整方案。' : '已恢复旧版存档，旧版未保存的图片和其他房间无法补回。');
  }

  /* --------------------------- 渲染 --------------------------- */

  const stageIndex = { welcome: -1, plan: 0, furnishing: 1, studio: 2 }[stage];
  const showcaseHome = isShowcase && stage === 'welcome';

  return (
    <>
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <header className={'app-header nav '+(showcaseHome?'home-header showcase-header':stage==='welcome'?'home-header':'work-header')}><div className="wrap hh-nav-wrap">
        <div className="wordmark">
          <span className="logo" aria-hidden="true">好</span>
          <div><strong>好好装</strong><small>家居设计工作台</small></div>
        </div>
        {!showcaseHome && <nav className="stepper" aria-label="工作阶段">
          <button aria-current={stageIndex === 0 ? 'step' : undefined} onClick={() => {
            if (stage === 'studio' || stage === 'furnishing') currentRooms.current[active] = { ...scene };
            setStage('plan'); setView('plan');
          }}><span className="step-num">01</span>户型</button>
          <button aria-current={stageIndex === 1 ? 'step' : undefined} disabled={!selectedRoom || !!busy} onClick={() => {if(stage==='studio'){currentRooms.current[active]={...scene};setStage('furnishing');}else enter();}}><span className="step-num">02</span>陈设</button>
          <button aria-current={stageIndex === 2 ? 'step' : undefined} disabled={spaceDisabled} onClick={() => setStage('studio')}>
            <span className="step-num">03</span>空间{spaceDisabled && <small className="step-locked">未就绪</small>}
          </button>
        </nav>}
        <div className="header-actions">
          {stage==='welcome'&&!showcaseHome&&<><button className="btn btn--primary btn-primary header-upload" onClick={()=>headerUploadRef.current?.click()}>上传户型图</button><input hidden ref={headerUploadRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>upload(e.target.files[0])}/></>}
          {!showcaseHome && <span className="badge mint"><i className="dot" />{isShowcase ? '在线体验版' : '本地工作台'}</span>}
          {saved && <button className="pill ghost" disabled={!!busy || saving} onClick={restore}>打开已保存方案</button>}
          {stage !== 'welcome' && <button className="pill ghost" onClick={showHome}>首页</button>}
        </div>
      </div></header>

      {stage === 'welcome' && (
        <Landing cloudCode={cloudCode} onEnableCloud={setCloudCode} onPlan={loadPlan} onUpload={upload} onRestore={restore} hasSaved={!!saved}
          onStartBlank={() => {
            if (busy) { setMessage('请等待当前任务完成。'); return; }
            resetDraft(); setPlanning(newPlanning()); setRecognition({ state: 'idle', detail: '' });
            setSizeConditions([]);
            setRooms([{ ...initialRoom }]); setSource([{ ...initialRoom }]);
            setPhoto(''); setBackdrop(planBackdrop); setRatio(1);
            setStage('plan'); setView('plan');
            setMessage('空白画布已就绪：上传户型图，或在底图上拖出一个房间。');
          }} />
      )}

      {stage === 'furnishing' ? (
        <FurnishingPage showExamples={!hasAI} room={selectedRoom} scene={scene} draft={furnishingDraft} onChange={updateFurnishing} busy={!!busy}
          onGenerate={generateFurnishing} onApply={applyFurnishing} onBack={()=>{setStage('plan');setView('plan');}}
          onStudio={()=>setStage('studio')} hasScene={scene.furnishingApplied} onSave={save}/>
      ) : stage !== 'welcome' && (
        <main id="main-content" className={'editor ' + (stage === 'plan' ? 'plan-editor' : 'studio-editor')}>
          {/* ---------------- 左侧：画布 ---------------- */}
          <section className="workspace">
            <div className="bar canvas-bar">
              <div className="title-wrap">
                <div><p className="kicker">{stage === 'plan' ? '户型规划 / PLAN' : '当前房间 / STUDIO'}</p>
                  <h1>{stage === 'plan' ? '户型与功能分区' : selectedRoom?.name || '室内空间'}</h1></div>
                {stage === 'studio' && <span className="room-pill">{roomTypes[scene.roomType]} · {canonicalStyle(scene.style)} · {Math.round(scene.width * 100)} × {Math.round(scene.depth * 100)} cm</span>}
              </div>
              {stage === 'studio' && (
                <div className="view-switch" aria-label="视图">
                  {[['plan', '平面'], ['top', '俯视'], ['inside', '室内']].map(([key, label]) => (
                    <button key={key} aria-pressed={view === key} onClick={() => setView(key)}>{label}</button>
                  ))}
                </div>
              )}
            </div>

            {stage === 'plan' && (
              <fieldset className="plan-calibration" id="plan-calibration" aria-labelledby="plan-calibration-heading">
                <div>
                  <h2 id="plan-calibration-heading">尺寸校准</h2>
                  <p className="card-sub">{verified ? '已按实测校准。' : '当前为估算尺寸，可先试装。'}填写整张户型图对应的实际宽高。</p>
                </div>
                <div className="calibration-fields">
                  <NumberField label="图宽（米）" inputRef={planWidthRef} value={planW} min={1} max={60}
                    onChange={v => { setPlanW(v); setVerified(false); }} />
                  <NumberField label="图高（米）" value={planH} min={1} max={60}
                    onChange={v => { setPlanH(v); setVerified(false); }} />
                </div>
                <label className="check">
                  <input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)} />
                  已按实测校准
                </label>
              </fieldset>
            )}

            {(stage === 'plan' || view === 'plan') ? (
              <div className={'plan-wrap ' + (dragOver ? 'drop-active' : '')}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => {
                  e.preventDefault(); setDragOver(false);
                  const name = e.dataTransfer.getData('text/plain');
                  const swatch = paintSwatches.find(s => s.name === name);
                  if (swatch) applyPaint(swatch);
                }}>
                <PlanCanvas rooms={visibleRooms} active={active} ratio={ratio} backdropUrl={backdropUrl}
                  zone={layoutPreview ? null : zone} circulation={layoutPreview?.circulation?.path}
                  editable={canEditPlan} planSize={planSize} snap={snapRooms}
                  onSelect={selectRoom} onEdit={editRoomGeometry} onAdd={addRoomGeometry} />
                {layoutPreview && <div className="preview-layout-banner">正在预览「{layoutPreview.style} · {layoutPreview.title}」，尚未应用。橙色虚线为示意动线，净宽与结构待核实。</div>}
              </div>
            ) : (
              <div ref={frameRef} className={'canvas-wrap ' + (fullscreen?'scene-fullscreen ':'') + (dragOver ? 'drop-active' : '')}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => {
                  e.preventDefault(); setDragOver(false);
                  const product=e.dataTransfer.getData('application/x-roomvoice-product');
                  if(product){const point=roomBridge.current?.project(e.clientX,e.clientY);if(point)inventoryDrop.current?.(product,point);return;}
                  const name = e.dataTransfer.getData('text/plain');
                  const swatch = paintSwatches.find(s => s.name === name);
                  if (swatch) applyPaint(swatch);
                }}>
                <Room key={active} cameraReset={cameraReset} data={scene} view={view} onSelect={selectTarget} target={target} onItemsChange={commitItems} onAssetError={assetError}
                  bridge={roomBridge} tool={buildTool} snap={snap} walk={walk} onPlacementError={setMessage} preferOriginal={exporting}
                  pose={cameraPoses.current[poseKey]}
                  onPose={pose => { cameraPoses.current[poseKey] = pose; }}
                  onCommit={patch => edit(patch)} grid={grid} />
                <div className="canvas-overlay">
                  <div className="float-tools">
                    <FurnitureLoading/>
                    <button aria-pressed={fullscreen} onClick={toggleFullscreen}>{fullscreen?'退出全屏':'全屏视角'}</button>
                    <button onClick={() => { delete cameraPoses.current[poseKey]; setCameraReset(n => n+1); }}>重置视角</button>
                    {view === 'top' && <button aria-pressed={grid} className={grid ? 'active' : ''}
                      onClick={() => setGrid(!grid)}>{grid ? '500mm 网格 · 开' : '500mm 网格 · 关'}</button>}
                    {view === 'inside' && <span className="status-chip">{targetName ? `已选中：${targetName}` : '实时3D · 窗外景观示意'}</span>}
                  </div>
                  <div className="drag-tip">{walk?'室内漫游 · W A S D 移动 · 拖拽看向 · 点“退出漫游”继续摆放':scene.furnishingApplied ? '点选物件可移动、旋转、替换或删除':'点选墙面编辑 · 拖拽旋转视角 · 滚轮缩放'}</div>
                </div>
              </div>
            )}

            {stage === 'studio' && scene.furnishingApplied && (
              <div className="bar studio-shortcuts" role="group" aria-label="空间编辑入口">
                <button className="pill" aria-controls="studio-inspector" onClick={() => openStudioPanel('objects')}>
                  {selectedPanel === 'objects' && targetName ? '编辑：' + targetName : '编辑物件'}
                </button>
                <button className="pill" aria-controls="studio-inspector" onClick={() => openStudioPanel('materials')}>房间材质</button>
                <button className="pill" aria-controls="studio-shelf" onClick={openShelf}>储物栏</button>
              </div>
            )}

            {stage==='studio'&&scene.furnishingApplied&&<div className="build-toolbar" aria-label="建造工具"><div className="row">{[['drag','自由拖动'],['translate','XYZ移动'],['rotate','旋转']].map(([key,label])=><button key={key} aria-pressed={!walk&&buildTool===key} onClick={()=>{setWalk(false);setBuildTool(key);edit({buildMode:'build'});}}>{label}</button>)}<label>吸附<select aria-label="网格吸附" value={snap} onChange={e=>setSnap(Number(e.target.value))}><option value="0">关闭</option><option value="0.05">5cm</option><option value="0.1">10cm</option></select></label><button aria-pressed={walk} onClick={()=>{setView('inside');setWalk(!walk);}}>{walk?'退出漫游':'进入室内漫游'}</button></div><div className="row"><button onClick={resetShowroom}>一键还原样板间</button><button onClick={()=>{edit({showroom:showroomSnapshot(scene),buildMode:'showroom'});setMessage('已将当前物件与饰面保存为此房间的样板间基准。');}}>设为样板间</button></div></div>}
            {stage === 'plan' && !layoutPreview && <div className="plan-edit-controls">
              <p className="card-sub">拖房间框可移动，拖边或角可改大小。空白处拖动可新增房间，方向键可微移。</p>
              {!!rooms.length && <fieldset disabled={!canEditPlan}>
                <label>当前房间<select value={active} onChange={event => selectRoom(Number(event.target.value))}>
                  {rooms.map((room, index) => <option key={index} value={index}>{room.name}</option>)}
                </select></label>
                <RoomDimensionsForm key={active} size={roomSize(selectedRoom)}
                  onApply={size => editRoomGeometry(active, resizeRoomToDimensions(selectedRoom, size, planSize))} />
                <div className="plan-edit-actions">
                  <label className="check"><input type="checkbox" checked={snapRooms}
                    onChange={event => setSnapRooms(event.target.checked)} />吸附房间边界</label>
                  <button className="pill" type="button" disabled={roomEditUndo?.after !== rooms}
                    onClick={undoRoomGeometry}>撤销房间调整</button>
                </div>
              </fieldset>}
            </div>}

            {/* 底部工具栏两阶段共用：户型阶段把主按钮放在始终可见的位置 */}
            <div className="bar canvas-footer">
              {stage === 'plan' ? (
                <>
                  <div className="row">
                    <span className="status-chip">{layoutPreview ? '候选预览' : '当前布局'} · {visibleRooms.length} 个空间</span>
                    <button className="pill" aria-controls="plan-calibration" onClick={() => revealControl(planWidthRef.current)}>
                      {verified ? '查看已校准尺寸' : '核对尺寸'}
                    </button>
                  </div>
                  <button className="btn-primary pill" disabled={!rooms.length || !!busy || !!layoutPreview} onClick={enter}>确认户型，规划陈设 →</button>
                </>
              ) : (
                <>
                  <label>房间
                    <select value={active} onChange={e => selectRoom(Number(e.target.value))}>
                      {rooms.map((r, i) => <option key={i} value={i}>{r.name || '房间 ' + (i + 1)}</option>)}
                    </select>
                  </label>
                  <div className="row" role="group" aria-label="草稿操作">
                    <button className="pill" disabled={!undoStack.length} onClick={undo}>撤销</button>
                    <button className="btn-primary pill" disabled={saving || !storageReady} onClick={save}>
                      {saving ? '正在保存…' : '保存草稿'}
                    </button>
                    <button className="pill" disabled={!!busy} onClick={() => setStage('furnishing')}>查看陈设方案</button>
                  </div>
                </>
              )}
            </div>
            <div className={'status-line' + (visibleWarning ? ' warn' : '')} role="status">
              {statusText && <span>{statusText}</span>}
            </div>
          </section>

          {/* ---------------- 右侧：属性面板 ---------------- */}
          <aside className="inspector" ref={inspectorRef} id={stage === 'studio' ? 'studio-inspector' : undefined}
            tabIndex={stage === 'studio' ? -1 : undefined}
            aria-label={stage === 'studio' ? (selectedPanel === 'objects' ? '物件编辑' : '房间材质与设置') : '户型设置'}>
            {stage === 'plan' ? (
              <fieldset className="plan-controls" disabled={!!busy}>
                <div className="card fade-up">
                  <div className="card-title"><h2>户型导入</h2><span className="kicker">STEP 01</span></div>
                  <div className="stack">
                    {!hasAI ? <><p>这里使用内置户型。开启在线 AI 后可上传自己的户型图。</p>
                      <button className="pill" onClick={showHome}>换示例户型</button></> : <>
                    <RecognitionDimensions rows={sizeConditions} onChange={setSizeConditions} />
                    <label>上传户型图
                      <input type="file" accept="image/png,image/jpeg,image/webp"
                        onChange={e => { upload(e.target.files[0], sizeConditions); e.target.value = ''; }} />
                    </label>
                    <div className="row">
                      <button className="pill" onClick={showHome}>换示例户型</button>
                      <button className="pill" disabled={!!busy} onClick={detect}>用大模型重新识别</button>
                    </div></>}
                  </div>
                </div>

                {recognition.detail && <p role="status" className={'plan-state ' + (['failed','empty'].includes(recognition.state) ? 'is-error' : '')}>{recognition.detail}</p>}
                {hasAI && <PlanAssistant planning={planning} disabled={!!busy}
                  onChange={patch => setPlanning(old => ({ ...old, ...patch }))}
                  onGenerate={generateLayouts} onReferences={addReferences}
                  onPreview={id => setPlanning(old => ({ ...old, previewId: id }))} onApply={applyLayout} />}
                <div className="card fade-up delay-2">
                  <div className="card-title"><h2>布局方案</h2></div>
                  <div className="segmented">
                    <button aria-pressed={mode === 'keep'} onClick={() => {
                      if (mode === 'adjust') { setRooms(source); setActive(0); currentRooms.current = {}; resetProject(); }
                      setPlanning(old => ({ ...old, previewId: null, appliedId: null }));
                      setMode('keep'); setZone(null);
                    }}>保留原布局</button>
                    <button aria-pressed={mode === 'adjust'} onClick={() => {
                      if (mode === 'keep') setSource(rooms);
                      setMode('adjust');
                    }}>调整布局</button>
                  </div>
                  {mode === 'adjust' && (
                    <div className="stack" style={{ marginTop: 12 }}>
                      <div className="row">
                        <button className="pill" onClick={() => setZone(zone ? null : localZones(selectedRoom?.name))}>
                          {zone ? '合并功能区' : '拆分功能区'}</button>
                        <button className="pill" disabled={!selectedRoom || !!busy} onClick={suggestZones}>生成建议</button>
                      </div>
                      <small>实体墙与门窗调整需另列「待现场核实」提案，不直接写入方案。</small>
                    </div>
                  )}
                </div>

                {selectedRoom && !layoutPreview && (
                  <div className="card fade-up delay-3">
                    <div className="card-title"><h2>所选房间</h2><span className="status-chip">{rooms.length} 个空间</span></div>
                    <div className="stack">
                      <label>房间名称
                        <input value={selectedRoom.name} maxLength={24}
                          onChange={e => setRooms(rooms.map((r, i) => i === active ? { ...r, name: e.target.value } : r))} />
                      </label>
                      <Select label="房间用途" value={roomTypes[classifyRoom(selectedRoom)]} options={Object.values(roomTypes)}
                        onChange={label => {
                          const kind = Object.keys(roomTypes).find(key => roomTypes[key] === label);
                          setRooms(rooms.map((room, i) => i === active ? { ...room, kind, kindConfirmed: true } : room));
                          setMessage('房间用途已更新，进入 3D 后会使用对应基础陈设。');
                        }} />
                      <p className="card-sub">
                        {selectedRoom.size || verified ? '当前尺寸' : '示意尺寸'} {roomSize(selectedRoom).map(n => (n * 100).toFixed(0)).join(' × ')} cm
                        {selectedRoom.area ? ` · 原图标注面积 ${selectedRoom.area} ㎡` : ''}
                      </p>
                      <button className="pill" onClick={() => {
                        setRooms(rooms.filter((_, i) => i !== active));
                        setActive(0);
                        currentRooms.current = withoutRoom(currentRooms.current, active);
                        cameraPoses.current = withoutRoom(cameraPoses.current, active);
                        resetProject();
                      }}>删除所选房间</button>
                    </div>
                  </div>
                )}

                <button className="pill" disabled={!rooms.length || !!busy || !!layoutPreview} onClick={enter}>确认户型，规划陈设 →</button>
                <button className="pill" onClick={save} disabled={saving || !storageReady}>保存户型草稿</button>
              </fieldset>
            ) : (
              <>
                {scene.furnishingApplied && selectedPanel === 'objects' && <FurnitureInspector scene={scene} target={target} onSelect={selectTarget} onItems={commitItems} onPlan={()=>setStage('furnishing')} onMessage={setMessage}/>}
                {(!scene.furnishingApplied || selectedPanel === 'materials') && <div className="card fade-up">
                  <div className="card-title"><h2>{targetName || '房间设置'}</h2>
                    {target && <button className="ghost pill" onClick={() => setTarget(null)}>返回</button>}
                  </div>
                  {!target && (
                    <>
                      <p className="card-sub">当前用途：{roomTypes[scene.roomType]}。{scene.roomType === 'other' ? '请返回户型阶段确认房间用途。' : '可点选六面调整材质，或从画布旁进入物件编辑。'}</p>
                      {scene.furniture?.length > 0 && <div className="room-fixtures" aria-label="当前房间基础陈设">
                        {scene.furniture.map(item => <p key={item.id}>{item.name}<small> · {Math.round(item.width*100)} × {Math.round(item.depth*100)} cm</small></p>)}
                      </div>}
                      <div className="stack">
                        <Select label="六面材质预设" value={canonicalStyle(scene.style)}
                          options={getStyleProfile(scene.style) ? styleNames : [scene.style, ...styleNames]}
                          onChange={name => { if (getStyleProfile(name)) edit({ ...preset(name), paint: '' }); }} />
                        <p className="card-sub" style={{ margin: 0 }}>
                          {getStyleProfile(scene.style) && getStyleProfile(scene.style).mood.label + "。"}切换后更新天花、地面和四面墙，家具可在陈设清单里调整。
                        </p>
                      </div>
                    </>
                  )}
                  <div className="object-list" style={{ marginTop: 12 }} aria-label="选择编辑对象">
                    {Object.entries({ ...faceNames, ...(scene.hasSofa ? { sofa: '沙发' } : {}), ...(!scene.furnishingApplied && ['living','bedroom','study'].includes(scene.roomType) ? { rug: '地毯', lamp: '灯光' } : {}), ...(scene.tv?.enabled ? {tv:'壁挂电视'} : {}) }).map(([key, label]) => (
                      <button key={key} aria-pressed={target === key} onClick={() => selectTarget(key)}>{label}</button>
                    ))}
                  </div>

                  <div className="stack" style={{ marginTop: 14 }}>
                    {faceNames[target] && (
                      <Select label="饰面材质" value={scene.faces[target]} options={Object.keys(materials)}
                        onChange={value => edit({ faces: { [target]: value } })} />
                    )}
                    {wallKeys.includes(target) && <>
                      <button className="pill" onClick={suggestTelevision}>在这面墙添加电视</button>
                      {proposal?.patch?.tv && <div className="notice">{proposal.summary}<button onClick={applyProposal}>应用建议</button></div>}
                    </>}
                    {target === 'tv' && scene.tv?.enabled && <>
                      <p className="card-sub">示意电视模型，商品尺寸与墙面安装条件待核实。安装高度按屏幕中心离地计算。</p>
                      <Select label="安装墙面" value={faceNames[scene.tv.wall]} options={wallKeys.map(k=>faceNames[k])}
                        onChange={label=>edit({tv:{...scene.tv,wall:wallKeys.find(k=>faceNames[k]===label)}})} />
                      {[['屏幕宽度','width',.3,3],['屏幕高度','height',.2,2],['屏幕中心离地','centerHeight',.2,3],['水平偏移','offset',-10,10]].map(([label,key,min,max])=>
                        <NumberField key={key} label={label} value={scene.tv[key]} min={min} max={max} suffix=" m"
                          onChange={value=>edit({tv:{...scene.tv,[key]:value}})} />)}
                      <button className="pill" onClick={()=>{edit({tv:{...defaultTv,enabled:false}});setTarget(null);}}>移除电视</button>
                    </>}
                    {target === 'ceiling' && (
                      <>
                        <Select label="吊顶造型" value={scene.ceiling} options={ceilingTypes}
                          onChange={ceiling => edit({ ceiling })} />
                        <NumberField label="层高" value={scene.height} min={2} max={5} step={.01} suffix=" m"
                          onChange={height => edit({ height })} />
                        {scene.ceiling !== '无吊顶' && (
                          <NumberField label="下吊高度" value={scene.drop} min={.05} max={.5} step={.01} suffix=" m"
                            onChange={drop => edit({ drop })} />
                        )}
                        {scene.ceiling === '双眼皮吊顶' && (
                          <NumberField label="边带宽度" value={scene.band} min={.08} max={.8} step={.01} suffix=" m"
                            onChange={band => edit({ band })} />
                        )}
                      </>
                    )}
                    {target === 'floor' && (
                      <NumberField label="方砖边长" value={scene.tileCm} min={30} max={120} step={1} suffix=" cm"
                        onChange={tileCm => edit({ tileCm })} />
                    )}
                    {target === 'rug' && (
                      <Select label="地毯位置" value={scene.rug} options={rugPositions}
                        onChange={rug => edit({ rug })} />
                    )}
                    {target === 'sofa' && (
                      <>
                        <label className="check">
                          <input type="checkbox" checked={scene.locked}
                            onChange={e => edit({ locked: e.target.checked })} />
                          锁定沙发规格和摆位
                        </label>
                        {!scene.locked && (
                          <div className="fields">
                            {[['沙发宽', 'sofaWidth', .6, 4], ['沙发深', 'sofaDepth', .4, 2],
                              ['沙发高', 'sofaHeight', .4, 2], ['旋转角度', 'sofaAngle', -360, 360],
                              ['横向位置', 'sofaX', -20, 20], ['纵向位置', 'sofaZ', -20, 20]].map(([label, key, min, max]) => (
                              <NumberField key={key} label={label} value={scene[key]} min={min} max={max}
                                onChange={value => edit({ [key]: value })} />
                            ))}
                          </div>
                        )}
                        <label>淘宝 / 天猫商品链接
                          <input type="url" value={link} placeholder="https://item.taobao.com/…"
                            onChange={e => setLink(e.target.value)} />
                        </label>
                        <div className="row">
                          <button className="pill" onClick={associate}>关联商品</button>
                          {scene.link && <a className="pill" href={scene.link} target="_blank" rel="noopener noreferrer">查看 ↗</a>}
                        </div>
                      </>
                    )}
                    {target === 'lamp' && (
                      <label className="check">
                        <input type="checkbox" checked={scene.lamp} onChange={e => edit({ lamp: e.target.checked })} />
                        暖光落地灯
                      </label>
                    )}
                  </div>
                </div>}

                {!scene.furnishingApplied && <div className="card fade-up delay-1">
                  <div className="card-title"><h2>候选商品</h2><span className="badge">演示数据</span></div>
                  <p className="card-sub">{scene.hasSofa ? '按品类筛选，规格与价格仅供演示。' : ['bedroom','study'].includes(scene.roomType) ? '可试摆软装，床、柜等基础设施当前使用示意模型。' : '当前房间使用对应功能设施，不展示客厅沙发。真实商品关联仍需补齐。'}</p>
                  <div className="product-list">
                    {demoProducts.filter(p => (p.kind !== 'sofa' || scene.hasSofa) && (['living','bedroom','study'].includes(scene.roomType) || p.kind !== 'rug' && p.kind !== 'lamp')).filter(p => !target || (target === 'sofa' ? p.kind === 'sofa'
                      : target === 'rug' ? p.kind === 'rug' : target === 'lamp' ? p.kind === 'lamp' : true))
                      .slice(0, 4).map(product => (
                        <div key={product.id}
                          className={'product ' + (picked[product.kind] === product.id ? 'selected' : '')}
                          onClick={() => applyProduct(product)} role="button" tabIndex={0}
                          onKeyDown={e => { if (e.key === 'Enter') applyProduct(product); }}>
                          <div className="swatch" style={{ background: product.color }} />
                          <div className="info">
                            <strong>{product.name}</strong>
                            <span>{product.note}</span>
                            <span><span className={'tag ' + (product.tag === '相似款' ? 'pink' : '')}>{product.tag}</span>
                              <b className="price" style={{ marginLeft: 8 }}>¥{product.price}</b></span>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>}

                <div className="card fade-up delay-2">
                  <div className="card-title"><h2>墙面试刷</h2><span className="kicker">DEMO</span></div>
                  <p className="card-sub">把色卡拖到画布上，或直接点一下，即可试刷整间墙面。</p>
                  <div className="swatch-grid">
                    {paintSwatches.map(swatch => (
                      <div key={swatch.name} title={`${swatch.name} · ${swatch.code}`}
                        className={'swatch-chip ' + (scene.paint === swatch.name ? 'selected' : '')}
                        style={{ background: swatch.color }} draggable
                        onDragStart={e => e.dataTransfer.setData('text/plain', swatch.name)}
                        onClick={() => applyPaint(swatch)}><span>{swatch.name}</span></div>
                    ))}
                  </div>
                  <p className="drop-hint">当前：{scene.paint ? `${scene.paint}（覆盖四面墙）` : '未试刷'} · 色号为演示值</p>
                </div>

                <div className="card fade-up delay-3">
                  <div className="card-title"><h2>一句话改方案</h2>
                    <button className="ghost pill" aria-expanded={showAssistant}
                      onClick={() => setShowAssistant(!showAssistant)}>{showAssistant ? '收起' : '展开'}</button>
                  </div>
                  {showAssistant && (
                    <div className="stack">
                      <label>描述改造
                        <textarea value={command} onChange={e => setCommand(e.target.value)}
                          placeholder="做双眼皮吊顶，沙发前铺地毯" />
                      </label>
                      <div className="row">
                        <button className="pill" onClick={voice} aria-describedby="voice-status">
                          {voiceActive ? '取消语音输入' : '语音输入'}
                        </button>
                        <button className="btn-primary pill" disabled={!command.trim() || !!busy} onClick={ask}>生成建议</button>
                      </div>
                      <div id="voice-status" role="status" className="voice-status">
                        {voiceState && <p className={voiceState.status === 'error' ? 'notice warn' : 'card-sub'}>{voiceState.text}</p>}
                      </div>
                      <div className="example-chips">
                        {['换成奶油风', '做双眼皮吊顶', '80cm 浅灰哑光砖', '沙发前铺地毯', '加一盏落地灯']
                          .map(text => <button key={text} onClick={() => setCommand(text)}>{text}</button>)}
                      </div>
                      <small>未配置模型密钥时由内置中文规则引擎解析，不会产生编造的商品或尺寸。</small>
                      {proposal && (
                        <div className="notice">
                          {typeof proposal.summary === 'string' && proposal.summary}
                          <button onClick={applyProposal}>应用建议</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </aside>
          {stage === 'studio' && scene.furnishingApplied && (
            <div className="studio-extras">
              <InventoryPanel scene={scene} onItems={commitItems} onSelect={selectTarget} onMessage={setMessage}
                dropRef={inventoryDrop} open={shelfOpen} onToggle={() => setShelfOpen(open => !open)}
                toggleRef={shelfToggleRef} onBakeProduct={entry => setProductBake({ entry, roomKey: active, nonce: Date.now() })} />
              {!isShowcase && <BakePanel key={active} roomKey={active} scene={scene} bridge={roomBridge} onPrepare={prepareBake}
                onExportDone={() => setExporting(false)} onApply={applyBake} onMessage={setMessage} productRequest={productBake} />}
            </div>
          )}
        </main>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);
