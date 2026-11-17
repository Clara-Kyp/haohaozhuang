export const wallKeys = ['north','south','west','east'];
export const defaultTv = { enabled:false, wall:'east', width:1.2, height:.68, centerHeight:1.2, offset:0 };

export function sanitizeTv(value, previous = defaultTv) {
  if (!value || typeof value !== 'object') return null;
  const tv = { ...defaultTv, ...previous };
  if (typeof value.enabled === 'boolean') tv.enabled = value.enabled;
  if (value.wall != null && !wallKeys.includes(value.wall)) return null;
  if (value.wall) tv.wall = value.wall;
  for (const [key,min,max] of [['width',.3,3],['height',.2,2],['centerHeight',.2,3],['offset',-20,20]]) {
    if (value[key] != null) {
      if (!Number.isFinite(value[key]) || value[key] < min || value[key] > max) return null;
      tv[key] = value[key];
    }
  }
  return tv;
}
export function wallObjectWarning(scene) {
  const tv = scene.tv;
  if (!tv?.enabled) return '';
  const length = ['north','south'].includes(tv.wall) ? scene.width : scene.depth;
  if (!wallKeys.includes(tv.wall) || ![tv.width,tv.height,tv.centerHeight,tv.offset].every(Number.isFinite)) return '电视安装参数无效。';
  if (Math.abs(tv.offset) + tv.width/2 > length/2 - .05) return '电视超出墙面左右边界，请缩小尺寸或调整水平偏移。';
  if (tv.centerHeight - tv.height/2 < .05 || tv.centerHeight + tv.height/2 > scene.height - .05) return '电视超出墙面高度，请调整屏幕尺寸或中心离地高度。';
  if (tv.wall === 'north' && Math.abs(tv.offset) < scene.width*.31 + tv.width/2 &&
      tv.centerHeight + tv.height/2 > scene.height*.25 && tv.centerHeight-tv.height/2 < scene.height*.85) {
    return '电视与示意窗户重叠，请选择另一面墙或调整位置。';
  }
  return '';
}

export function wallPose(wall, width, depth, centerHeight, offset = 0) {
  return {
    north:{position:[offset,centerHeight,-depth/2+.04],rotation:[0,0,0]},
    south:{position:[-offset,centerHeight,depth/2-.04],rotation:[0,Math.PI,0]},
    west:{position:[-width/2+.04,centerHeight,-offset],rotation:[0,Math.PI/2,0]},
    east:{position:[width/2-.04,centerHeight,offset],rotation:[0,-Math.PI/2,0]},
  }[wall];
}

/** 清楚的壁挂指令直接生成可审阅提案；其余装修需求仍交给模型。 */
export function wallCommand(command, scene, selectedWall) {
  if (!/电视/.test(command)) return null;
  if (/吊顶|地砖|地板|换砖|沙发|换墙|墙漆/.test(command)) return null;
  if (/取消|移除|删除|不要/.test(command)) return {patch:{tv:{...defaultTv,...scene.tv,enabled:false}},summary:'移除当前壁挂电视，可撤销。'};
  const namedWall = /右侧|东墙/.test(command) ? 'east' : /左侧|西墙|沙发背墙/.test(command) ? 'west'
    : /入口墙|南墙/.test(command) ? 'south' : /窗墙|北墙/.test(command) ? 'north' : null;
  const wall = namedWall || (wallKeys.includes(selectedWall) ? selectedWall : scene.tv?.enabled ? scene.tv.wall : null);
  if (!wall) return {patch:{},summary:'请先点选要安装电视的墙面，或在指令里写明“右侧墙 / 沙发背墙 / 入口墙”。'};
  const tv = { ...defaultTv, ...scene.tv, enabled:true, wall };
  const metres = (number, unit) => Number(number) / (/厘米|公分|cm/.test(unit) ? 100 : /毫米|mm/.test(unit) ? 1000 : 1);
  const mount = command.match(/(?:离地|中心高?|挂高|安装高度|壁挂[，,\s]*高)\s*(\d+(?:\.\d+)?)\s*(厘米|公分|毫米|cm|mm|米|m)/);
  const screen = command.match(/(?:屏幕高|屏幕高度|电视高)\s*(\d+(?:\.\d+)?)\s*(厘米|公分|毫米|cm|mm|米|m)/);
  if (mount) tv.centerHeight = metres(mount[1], mount[2]);
  if (screen) { tv.height = metres(screen[1],screen[2]); tv.width = tv.height*16/9; }
  return {patch:{tv},summary:`将示意电视壁挂在${{east:'右侧墙',west:'沙发背墙',north:'窗墙',south:'入口墙'}[wall]}，屏幕中心离地 ${Math.round(tv.centerHeight*100)} cm，示意尺寸 ${Math.round(tv.width*100)} × ${Math.round(tv.height*100)} cm。可在电视面板调整；商品尺寸与安装条件待核实。`};
}
