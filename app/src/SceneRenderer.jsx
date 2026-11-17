import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

RectAreaLightUniformsLib.init();

/** 透射玻璃与远景不写入 AO 的不透明法线缓冲，防止把窗外压成灰板。 */
class InteriorAO extends GTAOPass {
  render(...args) {
    const hidden = [];
    this.scene.traverse(object => {
      if (object.visible && object.userData.excludeFromAO) { hidden.push(object); object.visible = false; }
    });
    try { super.render(...args); }
    finally { hidden.forEach(object => { object.visible = true; }); }
  }
}

/** 单一渲染链：动态 AO 随家具/相机更新；确认截图也调用同一链。 */
export default function SceneRenderer({ renderRef, isTop }) {
  const { gl, scene, camera, size } = useThree();
  const pipeline = useMemo(() => {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 2 });
    const composer = new EffectComposer(gl, target);
    const render = new RenderPass(scene, camera);
    const ao = new InteriorAO(scene, camera, 1, 1);
    ao.updateGtaoMaterial({ radius: .2, thickness: .4, distanceFallOff: 1, scale: 1, samples: 8 });
    ao.blendIntensity = .65;
    const output = new OutputPass();
    composer.addPass(render); composer.addPass(ao); composer.addPass(output);
    return { composer, render, ao, output };
  }, [gl, scene]);
  useEffect(() => {
    const generator = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const environment = generator.fromScene(room, .04);
    const previous = scene.environment, intensity = scene.environmentIntensity;
    scene.environment = environment.texture;
    scene.environmentIntensity = .45;
    room.dispose(); generator.dispose();
    return () => { scene.environment = previous; scene.environmentIntensity = intensity; environment.dispose(); };
  }, [gl, scene]);
  useEffect(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.05;
    gl.outputColorSpace = THREE.SRGBColorSpace;
    pipeline.composer.setPixelRatio(Math.min(gl.getPixelRatio(), 1.5));
    pipeline.composer.setSize(size.width, size.height);
  }, [gl, size.width, size.height, pipeline]);
  useEffect(() => {
    pipeline.render.camera = camera;
    pipeline.ao.camera = camera;
    pipeline.ao.enabled = !isTop;
    renderRef.current = () => pipeline.composer.render();
    return () => { renderRef.current = null; };
  }, [pipeline, camera, isTop, renderRef]);
  useFrame(() => pipeline.composer.render(), 1);
  useEffect(() => () => {
    pipeline.render.dispose(); pipeline.ao.dispose(); pipeline.output.dispose(); pipeline.composer.dispose();
  }, [pipeline]);
  return null;
}
