import React,{useEffect,useRef,useState} from 'react';
import {assets,describePosition} from './furnishing';
import {readImage} from './planTools';
import {roomTypes} from './roomScenes';
import {canonicalStyle,getStyleProfile,styleNames} from './styleProfiles';
export default function FurnishingPage({showExamples,room,scene,draft,onChange,busy,onGenerate,onApply,onBack,onStudio,hasScene,onSave}){
  const [selected,setSelected]=useState(null);
  const [finishes, setFinishes] = useState(null);
  const update=patch=>onChange({...draft,...patch,proposal:null,error:''});
  const plan=draft.proposal;
  const proposalHeading=useRef(null);
  const lastPlan=useRef(plan);
  function showProposal(){
    proposalHeading.current?.focus({preventScroll:true});
    proposalHeading.current?.scrollIntoView({block:'start'});
  }
  useEffect(()=>{
    if(plan&&plan!==lastPlan.current)showProposal();
    lastPlan.current=plan;
  },[plan]);
  const profile=getStyleProfile(draft.style);
  const canApplyFinishes=!!getStyleProfile(plan?.style);
  const applyFinishes = finishes && finishes.id === plan?.generationId
    ? finishes.checked
    : !scene.furnishingApplied && !scene.paint && !['kitchen', 'bath'].includes(scene.roomType)
      && canonicalStyle(plan?.style) !== canonicalStyle(scene.style);
  return <main id="main-content" className="furnishing-page">
    <div className="furnishing-heading"><div><p className="kicker">02 / FURNISHING</p><h1>{room?.name}的陈设方案</h1><p>{roomTypes[scene.roomType]} · {scene.width.toFixed(2)} × {scene.depth.toFixed(2)} m · 先确认清单，再布置空间</p></div>
      <div className="row"><button onClick={onBack}>返回户型</button>{hasScene&&<button onClick={onStudio}>继续编辑已有空间</button>}<button onClick={onSave}>保存草稿</button></div></div>
    <div className="furnishing-grid">
      <section className="card furnishing-brief"><h2>空间与风格</h2><div className="stack">
        <label>陈设风格
          <select value={profile?.name || ''} disabled={busy} onChange={e=>update({style:e.target.value})}>
            {styleNames.map(name=><option key={name}>{name}</option>)}
            <option value="">自定义风格</option>
          </select>
        </label>
        {!profile&&<label>自定义风格名称<input value={draft.style} maxLength={40} disabled={busy}
          onChange={e=>update({style:e.target.value})}/></label>}
        {profile&&<small>{profile.mood.label}</small>}
        {showExamples ? <p className="card-sub">当前使用内置陈设示例。启用在线 AI 后可按需求生成提案。</p> : <>
        <label>居住需求<textarea value={draft.instruction} maxLength={3000} disabled={busy} onChange={e=>update({instruction:e.target.value})}/></label>
        <label>风格参考图（最多3张）<input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={busy} onChange={async e=>{try{const files=[...e.target.files];const refs=await Promise.all(files.slice(0,3).map(f=>readImage(f,1280)));update({references:refs.map((r,i)=>({...r,name:files[i].name}))});}catch(error){onChange({...draft,error:error.message});}e.target.value='';}}/></label>
        <div className="reference-thumbs">{draft.references.map((r,n)=><figure key={n}><img src={r.image} alt={'风格参考 '+(n+1)}/><button disabled={busy} onClick={()=>update({references:draft.references.filter((_,i)=>i!==n)})}>移除</button></figure>)}</div>
        </>}
        {plan&&<button type="button" onClick={showProposal}>查看已生成的提案</button>}
        <button className={plan ? undefined : 'btn-primary'} disabled={busy||!draft.style.trim()||draft.instruction.trim().length<2} onClick={onGenerate}>{busy?'正在规划家具与搭配…':showExamples?'查看内置陈设示例':plan?'重新生成陈设提案':'生成完整陈设提案'}</button>
        {!showExamples && <p className="card-sub">根据房间大小和参考图选择家具、收纳、灯具与配饰。提案不会覆盖当前空间。</p>}
        {draft.error&&<div className="notice warn" role="alert">{draft.error}</div>}
      </div></section>
      <section className="furnishing-proposal">
        {!plan?<div className="card furnishing-empty"><p className="kicker">YOUR ROOM, CONSIDERED</p><h2>先把这一间的生活想完整</h2><p>提案会列出每件家具的尺寸、位置和搭配理由，并在平面中标出摆位。确认后加载到可编辑的3D空间。</p>{busy&&<p role="status">模型正在规划动线与陈设，请稍候…</p>}</div>:<>
          <div className="card"><div className="card-title"><h2 ref={proposalHeading} tabIndex={-1}>完整陈设提案 · {plan.items.length}件</h2><span className="badge">{plan.style} · 待确认</span></div><p>{plan.summary}</p><p className="circulation-note">动线建议（净宽待核对）：{plan.circulation}</p>
          {plan.adjustments?.length>0&&<details className="placement-adjustments"><summary>已校正 {plan.adjustments.length} 处摆位</summary>{plan.adjustments.map((v,n)=><p key={n}>{v}</p>)}</details>}
          <div className="furnishing-confirm">
            <p>确认后替换当前房间的陈设，可撤销。</p>
            {canApplyFinishes&&<label className="finish-choice">
              <input type="checkbox" disabled={busy} checked={!!applyFinishes}
                onChange={e=>setFinishes({id:plan.generationId,checked:e.target.checked})}/>
              同时应用该风格的六面材质
            </label>}
            <button className="btn-primary" disabled={busy} onClick={()=>onApply(canApplyFinishes&&applyFinishes)}>确认清单，布置到3D空间</button>
          </div>
          <svg className="furnishing-map" role="img" aria-label="陈设平面预览" viewBox={`${-scene.width/2-.25} ${-scene.depth/2-.25} ${scene.width+.5} ${scene.depth+.5}`}>
            <rect x={-scene.width/2} y={-scene.depth/2} width={scene.width} height={scene.depth} fill="#f2ede4" stroke="#8c9b91" strokeWidth=".035"/>
            <path d={`M${scene.width/2-.9},${scene.depth/2} v-.85 h.9`} fill="none" stroke="#c69664" strokeDasharray=".08" strokeWidth=".025"/>
            {plan.items.map((i,n)=><g key={i.id} onClick={()=>setSelected(i.id)} transform={`translate(${i.x},${i.z}) rotate(${-i.rotation})`} role="button" aria-label={`${n+1} ${i.name}`} tabIndex="0" onKeyDown={e=>{if(e.key==='Enter')setSelected(i.id);}}>
              <rect x={-i.width/2} y={-i.depth/2} width={i.width} height={i.depth} rx=".03" fill={selected===i.id?'#47765b':assets[i.assetId].placement==='rug'?'#d5c4a5':'#b9c6b9'} fillOpacity={i.parentId?.8:.7} stroke={selected===i.id?'#294f3a':'#667668'} strokeWidth=".015"/>
              <text transform={`rotate(${i.rotation})`} textAnchor="middle" dominantBaseline="central" fontSize=".13" fill="#1f3326">{n+1}</text>
            </g>)}
          </svg><small>坐标以房间中心为原点；虚线区域为示意入口。家具规格与真实门窗需实测核对。</small></div>
          <div className="furnishing-list">{plan.items.map((i,n)=><button key={i.id} aria-pressed={selected===i.id} className="furnishing-row" onClick={()=>setSelected(i.id)}><span className="item-number">{String(n+1).padStart(2,'0')}</span><span><strong>{i.name}</strong><span className="item-meta">{[i.width,i.depth,i.height].map(v=>Math.round(v*100)).join(' × ')} cm · {describePosition(i)}</span><span>{i.reason}</span><small>{assets[i.assetId].url?'PBR家具模型':'参数模型'} · {assets[i.assetId].license}</small></span></button>)}</div>
        </>}
      </section>
    </div>
  </main>;
}
