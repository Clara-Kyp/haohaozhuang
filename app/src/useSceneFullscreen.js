import {useCallback,useEffect,useRef,useState} from 'react';
export default function useSceneFullscreen(){
 const frameRef=useRef(null),native=useRef(false),[fullscreen,setFullscreen]=useState(false);
 const toggle=useCallback(async()=>{
  if(fullscreen){if(document.fullscreenElement===frameRef.current)await document.exitFullscreen();native.current=false;setFullscreen(false);return;}
  setFullscreen(true);
  try{if(frameRef.current?.requestFullscreen){await frameRef.current.requestFullscreen();native.current=true;}}catch{native.current=false;}
 },[fullscreen]);
 useEffect(()=>{const changed=()=>{if(document.fullscreenElement===frameRef.current){native.current=true;setFullscreen(true);}else if(native.current){native.current=false;setFullscreen(false);}};const escape=e=>{if(e.key==='Escape'&&!document.fullscreenElement){native.current=false;setFullscreen(false);}};document.addEventListener('fullscreenchange',changed);window.addEventListener('keydown',escape);return()=>{document.removeEventListener('fullscreenchange',changed);window.removeEventListener('keydown',escape);};},[]);
 useEffect(()=>{if(!fullscreen)return;const previous=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=previous;};},[fullscreen]);
 return {frameRef,fullscreen,toggle};
}
