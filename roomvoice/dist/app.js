import {matchProducts, products} from './catalog.js';
import {parseCommands} from './commands.js';
import {findRooms, readPlanPixels} from './plan-detection.js';
import {renderScene, styles, names} from './scene.js';

const $=id=>document.getElementById(id);
const controls=$('controls'), stage=$('stage'), views=$('views');
const status=message=>{$('status').textContent=message};
const escape=value=>String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const examples=['客厅改成奶油风，然后把墙面刷成暖白','客厅加一张绿色沙发','把沙发移到左边','卧室加一盏落地灯'];
let step=0, photo='', ratio=1.34, width=10, depth=7.5, rooms=[], original=[], furniture=[], history=[];
let roomStyles={}, style='原木', view='3D', selection=null, nextId=1, mode='keep', dispose, importAttempt=0, confirmed=false;
let surfaces={}, catalogIndex=0;
let planPixels=null, detectionPreset='standard';
const selected=()=>rooms.find(r=>r.id===selection)||rooms[0];
const makeRoom=(x,y,w,h,name)=>({id:nextId++,x,y,w,h,name:name||'房间 '+nextId});
const remember=()=>history.push({furniture:structuredClone(furniture),roomStyles:{...roomStyles},surfaces:structuredClone(surfaces),style});
const stopScene=()=>{dispose?.();dispose=null};

function render(){
  stopScene();
  document.querySelectorAll('ol li').forEach((li,i)=>li.classList.toggle('active',i===step));
  $('title').textContent=['导入户型图','平面方案','空间预览'][step];
  stage.innerHTML='';
  views.innerHTML='';
  if(step===0){
    controls.innerHTML='<label for="upload">上传户型图 · PNG / JPG / WebP</label><input type="file" id="upload" accept="image/png,image/jpeg,image/webp"><p class="hint">请选择能看清墙线与房间边界的图片。</p><button class="secondary" id="demo">使用示例户型</button>';
    stage.innerHTML='<div class="placeholder"><svg viewBox="0 0 180 120" fill="none" stroke="#6d8d77" stroke-width="2"><rect x="22" y="12" width="136" height="96" rx="2"/><path d="M94 12v96M22 62h72m0 15h64M40 29h35v20H40zm74 5h24v30h-24zM39 75h38v16H39z"/><path d="M10 12v96m12 10h136" stroke-dasharray="4 4"/></svg><h2>从一张户型图开始</h2><p>自动建议房间划分，核对后进入可旋转的 3D 空间。</p></div>';
    $('upload').onchange=e=>importPlan(e.target.files[0]);
    $('demo').onclick=()=>{
      importAttempt++;planPixels=null;if(photo)URL.revokeObjectURL(photo);photo='';confirmed=false;roomStyles={};surfaces={};ratio=1.34;width=10;depth=7.5;
      rooms=[makeRoom(.08,.13,.48,.73,'客厅'),makeRoom(.56,.13,.36,.42,'卧室'),makeRoom(.56,.55,.36,.31,'书房')];
      original=[];mode='keep';selection=rooms[0].id;step=1;render();
    };
  }else if(step===1){
    controls.innerHTML=`<p class="hint">${photo?'核对识别出的房间。可删除误识别区域，也可拖动框选遗漏房间。':'示例户型已标出三个房间。'}</p><div class="row"><button id="keep" class="${mode==='keep'?'':'secondary'}">保留原布局</button><button id="adjust" class="${mode==='adjust'?'':'secondary'}">调整布局</button></div>
    ${planPixels?`<div class="row"><button id="detect" class="secondary">重新识别底图</button></div><label>墙线识别<select id="preset"><option value="standard">标准线稿</option><option value="light" ${detectionPreset==='light'?'selected':''}>浅色墙线</option><option value="open" ${detectionPreset==='open'?'selected':''}>较宽门洞</option></select></label>`:''}
    <div class="measure"><label>图宽（米）<input id="width" type="number" min="2" max="50" step=".1" value="${width}"></label><label>图高（米）<input id="depth" type="number" min="2" max="50" step=".1" value="${depth}"></label></div>
    <div id="roomList"></div><div class="row"><button class="secondary" id="back">重新导入</button><button id="confirm" ${rooms.length?'':'disabled'}>确认并查看 3D</button></div>`;
    const chooseMode=next=>{
      if(next==='adjust'&&mode==='keep') original=structuredClone(rooms);
      if(next==='keep'&&mode==='adjust') rooms=structuredClone(original);
      mode=next;render();
    };
    if(planPixels){
      $('preset').onchange=e=>{detectionPreset=e.target.value};
      $('detect').onclick=()=>{
        const detected=detectPlan();
        if(!detected.length){status('这组参数没有识别到封闭房间，已保留现有划分');return}
        if(mode==='keep')original=structuredClone(rooms);
        rooms=detected;mode='adjust';selection=rooms[0].id;render();
        status('重新识别到 '+rooms.length+' 个候选房间，可切回原划分');
      };
    }
    $('keep').onclick=()=>chooseMode('keep');
    $('adjust').onclick=()=>chooseMode('adjust');
    for(const key of ['width','depth']) $(key).onchange=e=>{
      const input=e.target;
      const number=Math.max(2,Math.min(50,Number(input.value)||2));
      if(key==='width') width=number;else depth=number;
      input.value=number;
    };
    $('back').onclick=()=>{step=0;status('等待导入户型图');render()};
    $('confirm').onclick=()=>{
      const defaults=rooms.flatMap(r=>{
        if(/卧|睡/.test(r.name)) return [{kind:'bed',room:r.id,x:.50,y:.47}];
        if(/客厅/.test(r.name)) return [{kind:'sofa',room:r.id,x:.45,y:.23},{kind:'rug',room:r.id,x:.45,y:.52},{kind:'table',room:r.id,x:.45,y:.56},{kind:'plant',room:r.id,x:.79,y:.24}];
        if(/书房/.test(r.name)) return [{kind:'table',room:r.id,x:.45,y:.30},{kind:'chair',room:r.id,x:.45,y:.61,angle:Math.PI}];
        return [];
      });
      furniture=confirmed?furniture.filter(i=>rooms.some(r=>r.id===i.room)):defaults;
      confirmed=true;history=[];step=2;view='3D';render();status('方案已确认。拖动旋转，滚轮缩放。');
    };
    renderRooms();renderPlan(true);
    status(mode==='adjust'?'拖动调整房间位置，或框选新的区域':'按原图框选房间，点选后可修改房间名称');
  }else{
    views.innerHTML=['平面','3D','室内'].map(v=>`<button class="${v===view?'':'secondary'}" data-view="${v}">${v}</button>`).join(' ');
    views.querySelectorAll('button').forEach(b=>b.onclick=()=>{view=b.dataset.view;render()});
    const eligible=furniture.map((item,index)=>({item,index})).filter(({item})=>matchProducts(item).length);
    const chosen=eligible.find(({index})=>index===catalogIndex)||eligible[0];
    const matches=chosen?matchProducts(chosen.item):[];
    controls.innerHTML=`<label>全屋风格<select id="style">${Object.keys(styles).map(s=>`<option ${s===style?'selected':''}>${s}</option>`).join('')}</select></label>
    <label for="command">说说你想怎么改</label><textarea id="command" rows="3" placeholder="例如：把客厅沙发换成绿色"></textarea>
    <div class="row"><button id="mic">🎙 语音输入</button><button id="apply">应用</button><button class="secondary" id="undo" ${history.length?'':'disabled'}>撤销</button></div>
    <div class="row">${examples.map(x=>`<button class="secondary example">${x}</button>`).join('')}</div>
    <p class="hint">可说房间、风格、家具、颜色和位置，也可以输入文字。</p>
    ${chosen?`<p class="eyebrow">家具相似款</p>
    <label>匹配哪件家具<select id="catalogItem">${eligible.map(({item,index})=>`<option value="${index}" ${chosen.index===index?'selected':''}>${escape(rooms.find(r=>r.id===item.room)?.name||'')} · ${names[item.kind]} ${index+1}</option>`).join('')}</select></label>
    ${matches.map(product=>`<div class="card"><a href="${product.url}" target="_blank" rel="noopener">${product.name} ↗</a>
    <div class="hint">宜家香港及澳门 · ${product.size?product.size.map(value=>Math.round(value*100)).join(' × ')+' cm（宽 × 高 × 深）':'系列参考'} · 近似模型</div>
    <button class="secondary" data-product="${product.id}" ${chosen.item.product===product.id?'disabled':''}>${chosen.item.product===product.id?'已应用':'应用款式'}</button></div>`).join('')}`:''}
    <button id="edit" class="secondary">返回平面方案</button>`;
    if(chosen){
      $('catalogItem').onchange=e=>{catalogIndex=Number(e.target.value);render()};
      controls.querySelectorAll('[data-product]').forEach(button=>button.onclick=()=>{
        const product=products.find(p=>p.id===button.dataset.product);
        remember();
        chosen.item.product=product.id;
        chosen.item.size=product.size;
        chosen.item.color=product.color;
        catalogIndex=chosen.index;
        if(view==='平面')view='3D';
        render();status('已应用 '+product.name+' 的近似款式');
      });
    }
    $('style').onchange=e=>{remember();style=e.target.value;roomStyles={};render();status('已切换为'+style+'风')};
    $('apply').onclick=()=>apply($('command').value);
    $('undo').onclick=()=>{({furniture,roomStyles,surfaces,style}=history.pop());render();status('已撤销上一项修改')};
    $('edit').onclick=()=>{step=1;render()};
    $('mic').onclick=listen;
    controls.querySelectorAll('.example').forEach(b=>b.onclick=()=>apply(b.textContent));
    if(view==='平面')renderPlan(false);
    else {
      try {dispose=renderScene(stage,rooms,furniture,style,width,depth,view==='室内',roomStyles,selected()?.id,surfaces)}
      catch {stage.textContent='当前浏览器无法启动 WebGL。你仍可切换到平面视图。'}
    }
  }
}

async function importPlan(file){
  if(!file)return;
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>20*1024*1024){
    status('请选择不超过 20 MB 的 PNG、JPG 或 WebP 图片');return;
  }
  const attempt=++importAttempt;
  const url=URL.createObjectURL(file);
  const img=new Image();
  img.src=url;
  try {
    await img.decode();
    if(attempt!==importAttempt){URL.revokeObjectURL(url);return}
    planPixels=readPlanPixels(img);
    detectionPreset='standard';
    if(photo)URL.revokeObjectURL(photo);
    photo=url;confirmed=false;roomStyles={};surfaces={};ratio=img.naturalWidth/img.naturalHeight;
    width=10;depth=Math.max(2,Math.min(50,Math.round(width/ratio*10)/10));
    rooms=detectPlan();original=[];selection=rooms[0]?.id;mode='keep';step=1;render();
    status(rooms.length?'识别到 '+rooms.length+' 个候选房间，请对照底图核对':'未识别到封闭房间，可重新识别或在底图上手动框选');
  } catch {
    URL.revokeObjectURL(url);
    if(attempt===importAttempt)status('无法读取这张户型图，请换一张图片');
  }
}

function detectPlan(){
  const {data,width,height}=planPixels;
  const threshold=detectionPreset==='light'?185:125;
  const gap=Math.max(2,Math.round(Math.max(width,height)*(detectionPreset==='open'?.06:.032)));
  return findRooms(data,width,height,threshold,gap)
    .map(({x,y,w,h},index)=>makeRoom(x,y,w,h,'房间 '+(index+1)));
}

function renderRooms(){
  $('roomList').innerHTML=`<label>房间<select id="selectRoom">${rooms.length?rooms.map(r=>`<option value="${r.id}" ${r.id===selected()?.id?'selected':''}>${escape(r.name)}</option>`).join(''):'<option>请先在右侧框选</option>'}</select></label>
  ${rooms.length?`<label>房间名称<input id="nameRoom" maxlength="24" value="${escape(selected().name)}"></label><button class="secondary" id="removeRoom">删除所选房间</button>`:''}`;
  $('selectRoom').onchange=e=>{selection=Number(e.target.value);render()};
  if(!rooms.length)return;
  $('nameRoom').onchange=e=>{selected().name=e.target.value.trim()||'房间';e.target.value=selected().name;
    $('selectRoom').selectedOptions[0].textContent=selected().name;
    stage.innerHTML='';renderPlan(true)};
  $('removeRoom').onclick=()=>{rooms=rooms.filter(r=>r.id!==selected().id);selection=null;render()};
}

function renderPlan(editable){
  const svgNS='http://www.w3.org/2000/svg';
  const svg=document.createElementNS(svgNS,'svg');
  const h=1000/ratio;
  svg.setAttribute('viewBox',`0 0 1000 ${h}`);
  svg.setAttribute('aria-label','户型平面图');
  stage.append(svg);
  function draw(preview){
    svg.innerHTML=`<defs><pattern id="grid" width="25" height="25" patternUnits="userSpaceOnUse"><path d="M25 0H0V25" stroke="#bfc9b7" fill="none" stroke-width="1"/></pattern></defs><rect width="1000" height="${h}" fill="url(#grid)"/>`;
    if(photo){
      const image=document.createElementNS(svgNS,'image');
      image.setAttribute('href',photo);image.setAttribute('width',1000);image.setAttribute('height',h);svg.append(image);
    }
    for(const r of [...rooms,...(preview?[preview]:[])]){
      svg.insertAdjacentHTML('beforeend',`<rect data-room="${r.id||''}" x="${r.x*1000}" y="${r.y*h}" width="${r.w*1000}" height="${r.h*h}" fill="${r.id===selected()?.id?'#85a88c':'#c1d3b8'}" fill-opacity="${photo ? .4 : .84}" stroke="#385747" stroke-width="2"/><text x="${(r.x+r.w/2)*1000}" y="${(r.y+r.h/2)*h}" text-anchor="middle" dominant-baseline="middle" fill="#203e2f" font-size="20" pointer-events="none">${escape(r.name||'')}</text>`);
    }
  }
  draw();
  if(!editable)return;
  const clamp=(n,max=1)=>Math.min(max,Math.max(0,n));
  const point=e=>{
    const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.getScreenCTM().inverse());
    return {x:clamp(p.x/1000),y:clamp(p.y/h)};
  };
  let gesture;
  svg.onpointerdown=e=>{
    if(e.button!==0||gesture)return;
    const origin=point(e);
    const room=rooms.find(r=>r.id===Number(e.target.dataset.room));
    if(room)selection=room.id;
    gesture={id:e.pointerId,origin,room:mode==='adjust'?room:null,clicked:room,initial:room&&{...room}};
    svg.setPointerCapture(e.pointerId);
  };
  function update(e){
    const {origin,room,initial}=gesture;
    const p=point(e);
    if(room){
      room.x=clamp(initial.x+p.x-origin.x,1-room.w);
      room.y=clamp(initial.y+p.y-origin.y,1-room.h);
      return null;
    }
    return {x:Math.min(origin.x,p.x),y:Math.min(origin.y,p.y),w:Math.abs(origin.x-p.x),h:Math.abs(origin.y-p.y)};
  }
  svg.onpointermove=e=>{if(gesture?.id===e.pointerId)draw(update(e))};
  svg.onpointerup=e=>{
    if(gesture?.id!==e.pointerId)return;
    const rect=update(e);
    if(rect?.w>.025&&rect.h>.025){
      const room=makeRoom(rect.x,rect.y,rect.w,rect.h,rooms.length===0?'客厅':undefined);
      selection=room.id;rooms.push(room);
    }
    gesture=null;render();
  };
  svg.onpointercancel=()=>{
    if(gesture?.room)Object.assign(gesture.room,gesture.initial);
    gesture=null;render();
  };
}

function listen(){
  const Speech=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!Speech){status('当前浏览器不支持语音识别，请输入文字。');return}
  const input=$('command'), button=$('mic');
  const recognition=new Speech();
  recognition.lang='zh-CN';
  recognition.onstart=()=>{button.disabled=true;status('正在听，请描述你想改的内容…')};
  recognition.onresult=e=>{input.value=e.results[0][0].transcript;status('语音已转成文字，确认后点击应用');};
  recognition.onerror=e=>status(e.error==='not-allowed'?'请允许麦克风权限，或输入文字。':'语音识别未完成，请重试或输入文字。');
  recognition.onend=()=>{button.disabled=false};
  try{recognition.start()}catch{status('麦克风无法启动，请输入文字。')}
}

function apply(raw){
  const text=raw.trim();
  if(!text){status('请输入一句空间修改指令');return}
  const {operations,unknown}=parseCommands(text,rooms);
  const fallback=selected();
  const changes=[];
  const skipped=[...unknown];
  let lastTarget;
  remember();
  for(const op of operations){
    const room=op.room||fallback;
    const area=op.room?.name||'全屋';
    if(op.type==='style'){
      if(op.room) roomStyles[room.id]=op.style;
      else {style=op.style;roomStyles={}}
      changes.push(area+' · '+op.style+'风');
      continue;
    }
    if(op.type==='surface'){
      const targets=op.room?[room]:rooms;
      for(const target of targets){
        surfaces[target.id]={...surfaces[target.id],[op.surface]:op.color};
      }
      changes.push(area+' · '+(op.surface==='wall'?'墙面':'地板')+'已改色');
      continue;
    }
    const label=room.name+' · '+names[op.kind];
    const item=op.followUp&&lastTarget?.room===room.id&&lastTarget.kind===op.kind
      ? lastTarget : furniture.find(i=>i.kind===op.kind&&i.room===room.id);
    if(op.remove){
      if(!item){skipped.push(label+'不存在');continue}
      furniture=furniture.filter(i=>i!==item);
      changes.push(label+'已移除');
      continue;
    }
    const index=furniture.filter(i=>i.room===room.id&&i.kind===op.kind).length;
    const target=!op.add&&item?item:{kind:op.kind,room:room.id,x:.38+(index%3)*.16,y:.42+(Math.floor(index/3)%3)*.15};
    if(target!==item)furniture.push(target);
    lastTarget=target;
    catalogIndex=furniture.indexOf(target);
    if(!op.followUp)target.description=op.description;
    if(op.color)target.color=op.color;
    Object.assign(target,op.position);
    if(op.angle!==null)target.angle=(target.angle||0)+op.angle;
    if(op.scale)target.scale=Math.min(2,Math.max(.45,(target.scale||1)*op.scale));
    changes.push(label+'已更新');
    selection=room.id;
  }
  if(!changes.length){history.pop();status('没有应用修改。'+(skipped.length?'未处理：'+skipped.join('、'):''));return}
  if(view==='平面')view='3D';
  render();
  status(changes.join('，')+(skipped.length?'。未处理：'+skipped.join('、'):''));
}

render();
