// Obloha ako zdroj odrazov (lak, sklo, chróm): prechod zenit – obzor – zem a slnko, prepočítané cez PMREM.
import * as THREE from 'three';

export function makeEnv(renderer, opt = {}) {
  const u = {
    top: { value: new THREE.Color(opt.top || '#5fa3dc') }, hor: { value: new THREE.Color(opt.horizon || '#dfeef7') },
    gnd: { value: new THREE.Color(opt.ground || '#6f7a66') }, sun: { value: (opt.sun || new THREE.Vector3(0.35, 0.8, 0.45)).clone().normalize() },
    power: { value: opt.sunPower === undefined ? 1 : opt.sunPower },
  };
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, uniforms: u,
    vertexShader: 'varying vec3 d; void main(){ d = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: [
      'varying vec3 d; uniform vec3 top, hor, gnd, sun; uniform float power;',
      'void main(){ vec3 n = normalize(d); float h = n.y;',
      '  vec3 c = h > 0.0 ? mix(hor, top, pow(h, 0.5)) : mix(hor * 0.7, gnd, smoothstep(0.0, -0.18, h));',
      '  float s = max(dot(n, sun), 0.0); c += vec3(1.0, 0.95, 0.86) * power * (pow(s, 900.0) * 40.0 + pow(s, 24.0) * 0.5);',
      '  gl_FragColor = vec4(c, 1.0); }'].join('\n'),
  });
  const scene = new THREE.Scene(), geo = new THREE.SphereGeometry(50, 48, 24);
  scene.add(new THREE.Mesh(geo, mat));
  const pm = new THREE.PMREMGenerator(renderer), rt = pm.fromScene(scene, 0.015);
  pm.dispose(); geo.dispose(); mat.dispose();
  return rt.texture;
}
