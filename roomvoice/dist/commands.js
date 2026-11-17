const furnitureWords = {
  sofa:'沙发|梳化', chair:'扶手椅|单椅|椅子|椅', table:'茶几|餐桌|书桌|桌子|桌',
  bed:'床', cabinet:'柜子|柜', plant:'绿植|盆栽', rug:'地毯', lamp:'落地灯|台灯|灯'
};
const styles = {
  '原木':/原木|木质风/, '奶油':/奶油|奶油系/, '现代':/现代|极简|黑白灰/,
  '工业':/工业|loft/i, '侘寂':/侘寂|微水泥/, '北欧':/北欧|斯堪的纳维亚/
};
const colors = {
  '暖白':'#fbf0db','奶白':'#f8eedb','米白':'#eee2ca','深绿':'#365648','浅绿':'#9eb49a',
  '浅灰':'#b9bab6','深灰':'#53565a','胡桃木':'#76533a','橡木':'#bd9871',
  '白':'#f9f5e9','米':'#ded0b5','黑':'#292c2c','灰':'#818485','棕':'#85644d',
  '蓝':'#5a7791','绿':'#69856c','红':'#a95d52','粉':'#dba6a3','黄':'#d4ad63','橙':'#c58a57'
};
const colorPattern = new RegExp(Object.keys(colors).map(key => key.length === 1 ? key+'色' : key).join('|')+'|#[a-f0-9]{6}', 'i');
const positions = [
  [/左边|左侧|左手边/,'x',.23], [/右边|右侧|右手边/,'x',.76],
  [/中间|中央/,'x',.50], [/窗边|窗旁|靠窗|靠墙/,'y',.18],
  [/前面|前方/,'y',.75], [/后面|后方/,'y',.24]
];
const action = /改|换|加|放|添|摆|移|挪|搬|删除|去掉|不要|旋转|调|缩|做成|刷|铺|用/;

export function parseCommands(input, rooms) {
  const parts = input.split(/[，,。；;！!\n]+|然后|接着|同时|另外|并且/).map(text=>text.trim()).filter(Boolean);
  const byLength = [...rooms].sort((a,b)=>b.name.length-a.name.length);
  let room, previousKind;
  const operations = [];
  const unknown = [];
  for (const text of parts) {
    const named = byLength.find(item=>text.includes(item.name));
    if (/全屋|全家|所有房间/.test(text)) {room=undefined;previousKind=undefined}
    else if (named) {
      if(named!==room)previousKind=undefined;
      room=named;
    }
    const subject = named ? text.replace(named.name,'') : text;
    const namedKind = Object.keys(furnitureWords).find(key=>new RegExp(furnitureWords[key]).test(subject));
    const style = Object.keys(styles).find(key=>styles[key].test(subject));
    const foundColor = subject.match(colorPattern)?.[0];
    const color = foundColor?.startsWith('#') ? foundColor : colors[foundColor?.replace(/色$/,'')];
    const surface = /地板|地面/.test(subject) ? 'floor' : /墙面|墙壁|墙漆|墙刷|墙改|墙换/.test(subject) ? 'wall' : null;
    const position = Object.fromEntries(positions.filter(([pattern])=>pattern.test(subject)).map(([,axis,value])=>[axis,value]));
    const rotation = subject.match(/(?:旋转|转)(?:个)?\s*(\d{1,3})\s*(?:度|°)/);
    const angle = rotation ? Number(rotation[1])*Math.PI/180 : /旋转|转个方向/.test(subject) ? Math.PI/2 : null;
    const scale = /大一点|放大/.test(subject) ? 1.2 : /小一点|缩小/.test(subject) ? .8 : null;
    const remove = /删除|移除|去掉|不要/.test(subject);
    const add = /加|放一|添|摆一|放个|摆个|来一/.test(subject);
    const kind = namedKind || (!surface && !style && (angle !== null || scale || Object.keys(position).length) ? previousKind : undefined);
    const before = operations.length;
    if (style && !surface && !remove && (!kind || /风格|风[,。\s]*$/.test(subject))) operations.push({type:'style',room,style});
    if (surface && color && !remove) operations.push({type:'surface',room,surface,color});
    if (kind && (action.test(subject) || color || angle !== null || scale || Object.keys(position).length)) {
      previousKind=kind;
      operations.push({type:'furniture',room,kind,color,position,angle,scale,remove,add,followUp:!namedKind,description:subject});
    }
    if (operations.length === before) unknown.push(text);
  }
  return {operations,unknown};
}
