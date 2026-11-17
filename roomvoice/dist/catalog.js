const base='https://www.ikea.com.hk/en/';
export const products=[
  {id:'klippan-grey',kind:'sofa',name:'KLIPPAN 灰色双人沙发',tags:/灰|双人|小户型|布艺/,color:'#818485',size:[1.80,.66,.88],path:'products/sofas-and-armchairs/sofas/klippan-spr-49010615'},
  {id:'klippan-black',kind:'sofa',name:'KLIPPAN 黑色双人沙发',tags:/黑|双人|皮/,color:'#292c2c',size:[1.80,.66,.88],path:'products/sofas-and-armchairs/sofas/klippan-art-10399315'},
  {id:'soderhamn',kind:'sofa',name:'SÖDERHAMN 模块沙发系列',tags:/模块|三人|组合|现代/,path:'soderhamn'},
  {id:'poang',kind:'chair',name:'POÄNG 浅米色扶手椅',tags:/原木|米|胡桃|北欧|扶手/,color:'#ded0b5',size:[.68,1,.82],path:'products/coffee-and-side-table/armchairs/poang-spr-69625340'},
  {id:'lisabo',kind:'table',name:'LISABO 木桌系列',tags:/木|北欧|餐桌/,color:'#bd9871',path:'collections/lisabo'},
  {id:'malm',kind:'bed',name:'MALM 床架系列',tags:/简约|收纳|现代/,path:'collections/malm'},
  {id:'billy-white',kind:'cabinet',name:'BILLY 白色书柜',tags:/白|书柜|书架/,color:'#f9f5e9',size:[.80,2.02,.28],path:'products/solitaire-cabinets---sideboards/bookcases/billy-art-00522047'},
  {id:'billy-black',kind:'cabinet',name:'BILLY 黑色橡木纹书柜',tags:/黑|橡木|书柜|书架/,color:'#292c2c',size:[.80,2.02,.28],path:'products/solitaire-cabinets---sideboards/bookcases/billy-art-20477341'}
].map(product=>({...product,url:base+product.path}));

export function matchProducts(item) {
  return products.filter(product=>product.kind===item.kind).sort((a,b)=>{
    const score=product=>Number(product.tags.test(item.description||''))*2+Number(product.color===item.color&&Boolean(item.color));
    return score(b)-score(a);
  });
}
