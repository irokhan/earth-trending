import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import earthSound from './sound_of_earth.mp3';


// --- Types ---
type Track = {
 song: string;
 artist: string;
 story: string;
};


type Market = {
 name: string;
 lat: number;
 lon: number;
 flag: string;
 tracks: Track[];
};


type StoryData = Market | null;


// --- Shaders ---


const OCEAN_VERTEX = `
 varying vec2 vUv;
 varying vec3 vNormal;
 varying vec3 vPos;
 void main() {
   vUv = uv;
   vPos = position;
   vNormal = normalize(normalMatrix * normal);
   gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
 }
`;


const OCEAN_FRAGMENT = `
 uniform vec3 u_focusPoint;
 uniform float u_hasSelection;
  varying vec2 vUv;
 varying vec3 vNormal;
 varying vec3 vPos;
  void main() {
   vec3 colorBottom = vec3(0.1, 0.16, 0.5);
   vec3 colorTop = vec3(0.0, 0.8, 0.9);
   vec3 color = mix(colorBottom, colorTop, vUv.y);


   vec3 viewDir = vec3(0.0, 0.0, 1.0);
   float fresnel = pow(1.0 - dot(vNormal, viewDir), 2.5);
   color += vec3(0.1) * fresnel;


   float dist = distance(vPos, u_focusPoint);
   float spotlight = smoothstep(30.0, 5.0, dist);
   float nightMix = u_hasSelection * (1.0 - spotlight);
   vec3 nightColor = vec3(0.02, 0.02, 0.08);
  
   color = mix(color, nightColor, nightMix * 0.95);


   gl_FragColor = vec4(color, 1.0);
 }
`;


const LAND_VERTEX = `
 uniform sampler2D map;
 uniform float u_time;
 uniform float u_maxExtrusion;
 uniform vec3 u_focusPoint;
 uniform float u_hasSelection;


 varying vec2 vUv;
 varying vec3 vNormal;
 varying vec3 vViewPosition;
 varying float vHeight;
 varying vec3 vPos;


 void main() {
   vUv = uv;
   vPos = position;
  
   vec4 texColor = texture2D(map, uv);
   float height = texColor.r;
   vHeight = height;


   // Threshold 0.001 to capture low-lying islands (UK, Japan)
   float isLand = step(0.001, height);


   float noise = sin(position.x * 2.0) + cos(position.y * 2.0) + sin(position.z * 2.0);
   float beat = sin(u_time * 3.0 + noise);
  
   float influence = 1.0;
   if(u_hasSelection > 0.5) {
     float dist = distance(position, u_focusPoint);
     influence = 1.0 - smoothstep(0.0, 12.0, dist);
   }


   float displacement = 0.0;
   if(isLand > 0.5) {
      float beatIntensity = 0.05 + (u_hasSelection * 0.15);
      displacement = 0.5 + (height * 0.5) + (beat * beatIntensity * influence);
   }


   vec3 newPosition = position + normal * displacement;
   vec4 mvPosition = modelViewMatrix * vec4(newPosition, 1.0);
   vViewPosition = -mvPosition.xyz;
   vNormal = normalize(normalMatrix * normal);
   gl_Position = projectionMatrix * mvPosition;
 }
`;


const LAND_FRAGMENT = `
 uniform sampler2D map;
 uniform float u_time;
 uniform vec3 u_focusPoint;
 uniform float u_hasSelection;
  varying vec2 vUv;
 varying vec3 vNormal;
 varying vec3 vViewPosition;
 varying float vHeight;
 varying vec3 vPos;


 // Zenly-style Vibrant Colors
 vec3 colorA = vec3(0.0, 1.0, 1.0); // Cyan
 vec3 colorB = vec3(1.0, 0.0, 0.8); // Pink
 vec3 colorC = vec3(1.0, 0.9, 0.0); // Yellow
 vec3 colorD = vec3(0.5, 0.0, 1.0); // Purple


 void main() {
   if(vHeight < 0.001) discard;


   vec3 viewDir = normalize(vViewPosition);
   vec3 normal = normalize(vNormal);
   float fresnel = 1.0 - dot(viewDir, normal);
  
   float noise = sin(vUv.x * 10.0 + u_time) * cos(vUv.y * 10.0 + u_time);
   float mixFactor = fresnel + (noise * 0.2);
  
   vec3 finalColor;
   if (mixFactor < 0.3) finalColor = mix(colorD, colorA, mixFactor/0.3);
   else if (mixFactor < 0.6) finalColor = mix(colorA, colorB, (mixFactor-0.3)/0.3);
   else finalColor = mix(colorB, colorC, (mixFactor-0.6)/0.4);
  
   float rim = smoothstep(0.6, 1.0, fresnel);
   finalColor += vec3(rim * 0.5);


   // Night Focus
   float dist = distance(vPos, u_focusPoint);
   float spotlight = smoothstep(30.0, 5.0, dist);
   float nightMix = u_hasSelection * (1.0 - spotlight);
   vec3 nightColor = finalColor * vec3(0.1, 0.1, 0.3);
  
   finalColor = mix(finalColor, nightColor, nightMix);


   gl_FragColor = vec4(finalColor, 0.7);
 }
`;


const ATMOSPHERE_VERTEX = `
 varying vec3 vNormal;
 void main() {
   vNormal = normalize(normalMatrix * normal);
   gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
 }
`;


const ATMOSPHERE_FRAGMENT = `
 varying vec3 vNormal;
 void main() {
   float intensity = pow(0.65 - dot(vNormal, vec3(0, 0, 1.0)), 4.0);
   gl_FragColor = vec4(0.3, 0.6, 1.0, 1.0) * intensity * 1.5;
 }
`;


const DOT_VERTEX = `
 uniform float u_time;
 uniform float u_maxExtrusion;
 uniform vec3 u_focusPoint;
 uniform float u_hasSelection;


 varying float vDisplacement;


 void main() {
   vec3 newPosition = position;
   float noise = sin(position.x * 5.0) + cos(position.y * 3.0) + sin(position.z * 4.0);
   float beat = sin(u_time * 5.0 + noise);
  
   float influence = 1.0;
   if(u_hasSelection > 0.5) {
     float dist = distance(position, u_focusPoint);
     influence = 1.0 - smoothstep(0.0, 12.0, dist);
   }


   float bounce = pow(max(0.0, beat), 3.0) * influence;
   vDisplacement = bounce;


   float intensity = 0.15 + (u_hasSelection * 0.3);
   float scale = 1.0 + (bounce * intensity);
   scale *= u_maxExtrusion;


   newPosition = position * scale;
   gl_Position = projectionMatrix * modelViewMatrix * vec4( newPosition, 1.0 );
 }
`;


const DOT_FRAGMENT = `
 uniform float u_time;
 varying float vDisplacement;
 vec3 colorA = vec3(0.114, 0.725, 0.329);
 vec3 colorB = vec3(0.067, 0.369, 0.200);
 void main() {
   vec3 color = mix(colorB, colorA, vDisplacement);
   gl_FragColor = vec4(color, 1.0);
 }
`;


// --- Utils ---
const createParticleTexture = (emoji: string): THREE.Texture => {
 const canvas = document.createElement('canvas');
 canvas.width = 64; canvas.height = 64;
 const ctx = canvas.getContext('2d');
 if(ctx) {
   ctx.font = "40px Arial";
   ctx.textAlign = "center";
   ctx.textBaseline = "middle";
   ctx.fillText(emoji, 32, 32);
 }
 const tex = new THREE.CanvasTexture(canvas);
 return tex;
};


// --- Data ---
const MARKET_LIST = [
 { name: "Andorra", lat: 42.5, lon: 1.5, flag: "🇦🇩" },
 { name: "United Arab Emirates", lat: 23.4, lon: 53.8, flag: "🇦🇪" },
 { name: "Argentina", lat: -38.4, lon: -63.6, flag: "🇦🇷" },
 { name: "Austria", lat: 47.5, lon: 14.5, flag: "🇦🇹" },
 { name: "Australia", lat: -25.2, lon: 133.7, flag: "🇦🇺" },
 { name: "Belgium", lat: 50.5, lon: 4.4, flag: "🇧🇪" },
 { name: "Bulgaria", lat: 42.7, lon: 25.4, flag: "🇧🇬" },
 { name: "Bolivia", lat: -16.2, lon: -63.5, flag: "🇧🇴" },
 { name: "Brazil", lat: -14.2, lon: -51.9, flag: "🇧🇷" },
 { name: "Belarus", lat: 53.7, lon: 27.9, flag: "🇧🇾" },
 { name: "Canada", lat: 56.1, lon: -106.3, flag: "🇨🇦" },
 { name: "Switzerland", lat: 46.8, lon: 8.2, flag: "🇨🇭" },
 { name: "Chile", lat: -35.6, lon: -71.5, flag: "🇨🇱" },
 { name: "Colombia", lat: 4.5, lon: -74.2, flag: "🇨🇴" },
 { name: "Costa Rica", lat: 9.7, lon: -83.7, flag: "🇨🇷" },
 { name: "Cyprus", lat: 35.1, lon: 33.4, flag: "🇨🇾" },
 { name: "Czechia", lat: 49.8, lon: 15.4, flag: "🇨🇿" },
 { name: "Germany", lat: 51.1, lon: 10.4, flag: "🇩🇪" },
 { name: "Denmark", lat: 56.2, lon: 9.5, flag: "🇩🇰" },
 { name: "Dominican Republic", lat: 18.7, lon: -70.1, flag: "🇩🇴" },
 { name: "Ecuador", lat: -1.8, lon: -78.1, flag: "🇪🇨" },
 { name: "Estonia", lat: 58.5, lon: 25.0, flag: "🇪🇪" },
 { name: "Egypt", lat: 26.8, lon: 30.8, flag: "🇪🇬" },
 { name: "Spain", lat: 40.4, lon: -3.7, flag: "🇪🇸" },
 { name: "Finland", lat: 61.9, lon: 25.7, flag: "🇫🇮" },
 { name: "France", lat: 46.2, lon: 2.2, flag: "🇫🇷" },
 { name: "United Kingdom", lat: 55.3, lon: -3.4, flag: "🇬🇧" },
 { name: "Greece", lat: 39.0, lon: 21.8, flag: "🇬🇷" },
 { name: "Guatemala", lat: 15.7, lon: -90.2, flag: "🇬🇹" },
 { name: "Hong Kong", lat: 22.3, lon: 114.1, flag: "🇭🇰" },
 { name: "Honduras", lat: 15.2, lon: -86.2, flag: "🇭🇳" },
 { name: "Hungary", lat: 47.1, lon: 19.5, flag: "🇭🇺" },
 { name: "Indonesia", lat: -0.7, lon: 113.9, flag: "🇮🇩" },
 { name: "Ireland", lat: 53.4, lon: -8.2, flag: "🇮🇪" },
 { name: "Israel", lat: 31.0, lon: 34.8, flag: "🇮🇱" },
 { name: "India", lat: 20.5, lon: 78.9, flag: "🇮🇳" },
 { name: "Iceland", lat: 64.9, lon: -19.0, flag: "🇮🇸" },
 { name: "Italy", lat: 41.8, lon: 12.5, flag: "🇮🇹" },
 { name: "Japan", lat: 36.2, lon: 138.2, flag: "🇯🇵" },
 { name: "South Korea", lat: 35.9, lon: 127.7, flag: "🇰🇷" },
 { name: "Kazakhstan", lat: 48.0, lon: 66.9, flag: "🇰🇿" },
 { name: "Lithuania", lat: 55.1, lon: 23.8, flag: "🇱🇹" },
 { name: "Luxembourg", lat: 49.8, lon: 6.1, flag: "🇱🇺" },
 { name: "Latvia", lat: 56.8, lon: 24.6, flag: "🇱🇻" },
 { name: "Morocco", lat: 31.7, lon: -7.0, flag: "🇲🇦" },
 { name: "Mexico", lat: 23.6, lon: -102.5, flag: "🇲🇽" },
 { name: "Malaysia", lat: 4.2, lon: 101.9, flag: "🇲🇾" },
 { name: "Nigeria", lat: 9.0, lon: 8.6, flag: "🇳🇬" },
 { name: "Nicaragua", lat: 12.8, lon: -85.2, flag: "🇳🇮" },
 { name: "Netherlands", lat: 52.1, lon: 5.2, flag: "🇳🇱" },
 { name: "Norway", lat: 60.4, lon: 8.4, flag: "🇳🇴" },
 { name: "New Zealand", lat: -40.9, lon: 174.8, flag: "🇳🇿" },
 { name: "Panama", lat: 8.5, lon: -80.7, flag: "🇵🇦" },
 { name: "Peru", lat: -9.1, lon: -75.0, flag: "🇵🇪" },
 { name: "Philippines", lat: 12.8, lon: 121.7, flag: "🇵🇭" },
 { name: "Pakistan", lat: 30.3, lon: 69.3, flag: "🇵🇰" },
 { name: "Poland", lat: 51.9, lon: 19.1, flag: "🇵🇱" },
 { name: "Portugal", lat: 39.3, lon: -8.2, flag: "🇵🇹" },
 { name: "Paraguay", lat: -23.4, lon: -58.4, flag: "🇵🇾" },
 { name: "Romania", lat: 45.9, lon: 24.9, flag: "🇷🇴" },
 { name: "Saudi Arabia", lat: 23.8, lon: 45.0, flag: "🇸🇦" },
 { name: "Sweden", lat: 60.1, lon: 18.6, flag: "🇸🇪" },
 { name: "Singapore", lat: 1.3, lon: 103.8, flag: "🇸🇬" },
 { name: "Slovakia", lat: 48.6, lon: 19.6, flag: "🇸🇰" },
 { name: "El Salvador", lat: 13.7, lon: -88.8, flag: "🇸🇻" },
 { name: "Thailand", lat: 15.8, lon: 100.9, flag: "🇹🇭" },
 { name: "Turkey", lat: 38.9, lon: 35.2, flag: "🇹🇷" },
 { name: "Taiwan", lat: 23.6, lon: 120.9, flag: "🇹🇼" },
 { name: "Ukraine", lat: 48.3, lon: 31.1, flag: "🇺🇦" },
 { name: "United States", lat: 37.0, lon: -95.7, flag: "🇺🇸" },
 { name: "Uruguay", lat: -32.5, lon: -55.7, flag: "🇺🇾" },
 { name: "Venezuela", lat: 6.4, lon: -66.5, flag: "🇻🇪" },
 { name: "Vietnam", lat: 14.0, lon: 108.2, flag: "🇻🇳" },
 { name: "South Africa", lat: -30.5, lon: 22.9, flag: "🇿🇦" }
];


// Preserved custom stories
const CUSTOM_STORIES: {[key: string]: Track[]} = {
 "United States": [{song: "Digital Rodeo", artist: "Synth Cowboy", story: "Viral on TikTok after a cat was filmed dancing perfectly on beat."}, {song: "Neon Highway", artist: "Lazerhawk", story: "The opening track for the new blockbuster sci-fi series."}, {song: "Code Blue", artist: "Medical Beats", story: "Samples a literal heart monitor, trending among med students."}],
 "Brazil": [{song: "Carnaval Futuro", artist: "Rio Beats", story: "Blasting from every beach speaker in Copacabana this summer."}, {song: "Amazonia Pulse", artist: "Green Rhythm", story: "Features actual rainforest sounds, raising money for charity."}, {song: "Samba Glitch", artist: "Favela Tech", story: "A fusion of classic samba and distorted 808s."}],
 "United Kingdom": [{song: "Tea & Bass", artist: "London Fog", story: "Oddly soothing grime track that samples a boiling kettle."}, {song: "Royal Dub", artist: "Crown Jewels", story: "Rumor has it a member of the royal family produced this anonymously."}, {song: "Tube Station", artist: "Mind The Gap", story: "Recorded entirely in the London Underground."}],
 "Mexico": [{song: "Cactus Flower", artist: "Luna Sol", story: "Causing spontaneous dance-offs in Mexico City subway stations."}, {song: "Spicy Signal", artist: "Chili Wave", story: "The beat drops exactly when the hot sauce hits."}, {song: "Aztec Gold", artist: "Ancient Future", story: "Mixing pre-Hispanic flutes with heavy trap beats."}],
 "India": [{song: "Mumbai Drift", artist: "Raja Velocity", story: "The #1 song for rickshaw racing. Traffic police issued an advisory."}, {song: "Spice Market", artist: "Curry Tech", story: "Uses the sound of frying spices as a hi-hat."}, {song: "Bollywood Bot", artist: "AI Singer", story: "First hit song entirely generated by a local AI."}],
 "Germany": [{song: "Autobahn Infinity", artist: "Kraftwerk 2.0", story: "Perfectly syncs with the blinking of traffic lights in Berlin."}, {song: "Industrial Heart", artist: "Steel Factory", story: "Recorded in an abandoned car manufacturing plant."}, {song: "Beer Hall Bass", artist: "Oktoberfest", story: "Imagine a tuba, but distorted through a guitar amp."}],
 "France": [{song: "Croissant Moon", artist: "Paris Nuit", story: "A famous chef baked bread to the rhythm of this bassline."}, {song: "Seine Flow", artist: "River Boy", story: "Lo-fi beats to relax/study/paint portraits to."}, {song: "Fashion Week", artist: "Haute Couture", story: "The runway anthem for this year's most avant-garde show."}],
 "Argentina": [{song: "Glacier Tango", artist: "Patagonia Sounds", story: "Melancholic tango surprisingly popular at football stadiums."}, {song: "Asado Anthem", artist: "Grill Master", story: "The official soundtrack of Sunday BBQs."}, {song: "Pampas Wind", artist: "Gaucho Lo-Fi", story: "Acoustic guitar mixed with wind samples from the plains."}],
 "Spain": [{song: "Siesta Surprise", artist: "Madrid Chill", story: "Ironically upbeat, usually played at 3 PM to wake everyone up."}, {song: "Flamenco 3000", artist: "Seville Cyber", story: "Robot clapping samples replaced castanets."}, {song: "Ibiza Dawn", artist: "Island Life", story: "The track that never ends, literally 4 hours long."}],
 "Canada": [{song: "Maple Syrup Flow", artist: "Northern Lights", story: "A lo-fi hip hop track recorded entirely in an ice fishing hut."}, {song: "Moose Call", artist: "Wilderness", story: "Uses a sampled moose call as the bass drop."}, {song: "Hockey Night", artist: "Puck Drop", story: "Played every time a goal is scored in Toronto."}]
};


// Generate full list with tracks
const TOP_MARKETS: Market[] = MARKET_LIST.map(m => ({
 ...m,
 tracks: CUSTOM_STORIES[m.name] || [
   { song: `Viral Hit in ${m.name}`, artist: "Local Star", story: `Trending #1 across ${m.name} today.` },
   { song: "Summer Vibes", artist: "DJ Solar", story: "Playing in every club downtown." },
   { song: "Night Drive", artist: "Neon City", story: "The soundtrack for late night drives." }
 ]
}));


export default function App() {
 const canvasRef = useRef<HTMLCanvasElement>(null);
 const [storyData, setStoryData] = useState<StoryData>(null);
 const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
 const [panelVisible, setPanelVisible] = useState(false);
 const [introVisible, setIntroVisible] = useState(true);
 const [audioUnlocked, setAudioUnlocked] = useState(false);
 const audioRef = useRef<HTMLAudioElement | null>(null);
 const fadeReqRef = useRef<number | null>(null);


 // --- Animation Refs ---
 const sceneRef = useRef<THREE.Scene | null>(null);
 const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
 const controlsRef = useRef<OrbitControls | null>(null);
 const materialsRef = useRef<THREE.ShaderMaterial[]>([]);
 const landMeshRef = useRef<THREE.Mesh | null>(null);
 const baseMeshRef = useRef<THREE.Mesh | null>(null);
 const particlesRef = useRef<any[]>([]);
 const spritesRef = useRef<THREE.Sprite[]>([]);
  // Animation Targets
 const targetCamPos = useRef<THREE.Vector3 | null>(null);
 const targetLookAt = useRef<THREE.Vector3 | null>(null);
 const targetSelectionVal = useRef<number>(0.0);

 const BASE_AUDIO_VOLUME = 0.08;

 const fadeAudioTo = (targetVolume: number, duration = 400) => {
   const audio = audioRef.current;
   if (!audio) return;

   if (fadeReqRef.current) cancelAnimationFrame(fadeReqRef.current);

   const start = audio.volume;
   const startTime = performance.now();

   const tick = (now: number) => {
     const progress = Math.min((now - startTime) / duration, 1);
     const nextVolume = start + (targetVolume - start) * progress;
     audio.volume = Math.max(0, Math.min(nextVolume, 1));

     if (progress < 1) {
       fadeReqRef.current = requestAnimationFrame(tick);
     } else {
       fadeReqRef.current = null;
       if (targetVolume === 0) {
         audio.pause();
         audio.currentTime = 0;
       }
     }
   };

   if (targetVolume > 0 && audio.paused) {
     audio.play().catch(() => {});
   }

   fadeReqRef.current = requestAnimationFrame(tick);
 };

 useEffect(() => {
  const audio = new Audio(earthSound);
  audio.loop = true;
  audio.volume = 0;
  audio.muted = true; // allow autoplay in browsers that block sound until interaction
  audioRef.current = audio;

   return () => {
     if (fadeReqRef.current) cancelAnimationFrame(fadeReqRef.current);
     audio.pause();
   };
 }, []);

 useEffect(() => {
   if (!audioUnlocked) return;
   if (!panelVisible) {
     fadeAudioTo(BASE_AUDIO_VOLUME, 700);
   } else {
     fadeAudioTo(0, 500);
   }
 }, [panelVisible, audioUnlocked]);


 useEffect(() => {
   if (!canvasRef.current) return;


   // --- Init Scene ---
   const scene = new THREE.Scene();
   sceneRef.current = scene;


   const width = window.innerWidth;
   const height = window.innerHeight;


   const camera = new THREE.PerspectiveCamera(30, width / height, 1, 1000);
   camera.position.z = 100;
   cameraRef.current = camera;


   const renderer = new THREE.WebGLRenderer({
     canvas: canvasRef.current,
     antialias: true,
     alpha: true
   });
   renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
   renderer.setSize(width, height);


   const controls = new OrbitControls(camera, renderer.domElement);
   controls.autoRotate = true;
   controls.autoRotateSpeed = 1.2;
   controls.enableDamping = true;
   controls.enableRotate = true;
   controls.enablePan = false;
   controls.enableZoom = true;
   controls.minDistance = 50;
   controls.maxDistance = 200;
   controls.minPolarAngle = (Math.PI / 2) - 0.5;
   controls.maxPolarAngle = (Math.PI / 2) + 0.5;
   controlsRef.current = controls;


   // --- Lighting ---
   const pointLight = new THREE.PointLight(0x081b26, 17, 200);
   pointLight.position.set(-50, 0, 60);
   scene.add(pointLight);
   scene.add(new THREE.HemisphereLight(0xffffbb, 0x080820, 1.5));


   // --- Stars ---
   const starGeo = new THREE.BufferGeometry();
   const starCount = 2000;
   const starPos = new Float32Array(starCount * 3);
   for(let i=0; i<starCount*3; i++) starPos[i] = (Math.random()-0.5)*2000;
   starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
   const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({color: 0xffffff, size: 0.7, transparent: true, opacity: 0.8}));
   scene.add(stars);


   // --- 1. Ocean ---
   const baseGeo = new THREE.SphereGeometry(19.5, 64, 64);
   const baseMat = new THREE.ShaderMaterial({
     uniforms: {
       u_focusPoint: { value: new THREE.Vector3(0,0,0) },
       u_hasSelection: { value: 0.0 }
     },
     vertexShader: OCEAN_VERTEX,
     fragmentShader: OCEAN_FRAGMENT,
     side: THREE.FrontSide
   });
   const baseMesh = new THREE.Mesh(baseGeo, baseMat);
   scene.add(baseMesh);
   baseMeshRef.current = baseMesh;


   // --- 3. Atmosphere ---
   const atmosGeo = new THREE.SphereGeometry(21.5, 64, 64);
   const atmosMat = new THREE.ShaderMaterial({
     vertexShader: ATMOSPHERE_VERTEX,
     fragmentShader: ATMOSPHERE_FRAGMENT,
     blending: THREE.AdditiveBlending,
     side: THREE.BackSide,
     transparent: true
   });
   scene.add(new THREE.Mesh(atmosGeo, atmosMat));


   // --- Map Data Loading ---
   const textureLoader = new THREE.TextureLoader();
   const imgLoader = new Image();
   imgLoader.crossOrigin = "Anonymous";
   // Load Water/Land mask for Dots (Black=Land, White=Water in this specific map)
   imgLoader.src = 'https://unpkg.com/three-globe/example/img/earth-water.png';
  
   imgLoader.onload = () => {
       // --- Generate Dots ---
       const tempCanvas = document.createElement('canvas');
       tempCanvas.width = 360;
       tempCanvas.height = 180;
       const ctx = tempCanvas.getContext('2d');
       if(ctx) {
           ctx.imageSmoothingEnabled = false;
           ctx.drawImage(imgLoader, 0, 0, 360, 180);
           const imgData = ctx.getImageData(0, 0, 360, 180).data;
           const activeLatLon: {[key:number]: number[]} = {};


           // Parse image data
           for(let i=0, lon=-180, lat=90; i<imgData.length; i+=4, lon++) {
               if(!activeLatLon[lat]) activeLatLon[lat] = [];
               // Check Red channel. < 100 means dark (Land)
               if(imgData[i] < 100) activeLatLon[lat].push(lon);
               if(lon === 180) { lon = -180; lat--; }
           }


           // Create Dot Meshes
           const dotSphereRadius = 20.2;
           const dotDensity = 2.5;
           const calcPos = (lon: number, lat: number, r: number) => {
               const phi = (90 - lat) * (Math.PI / 180);
               const theta = (lon + 180) * (Math.PI / 180);
               return new THREE.Vector3(
                   -(r * Math.sin(phi) * Math.cos(theta)),
                   r * Math.cos(phi),
                   r * Math.sin(phi) * Math.sin(theta)
               );
           };


           for (let lat = 90, i = 0; lat > -90; lat--, i++) {
               const r = Math.cos(Math.abs(lat) * (Math.PI / 180)) * dotSphereRadius;
               const circumference = r * Math.PI * 2;
               const dotsForLat = circumference * dotDensity;
              
               if(!activeLatLon[lat]) continue;


               for (let x = 0; x < dotsForLat; x++) {
                   const long = -180 + x * 360 / dotsForLat;
                   const closest = activeLatLon[lat].reduce((prev, curr) =>
                   (Math.abs(curr - long) < Math.abs(prev - long) ? curr : prev), -1000);
                  
                   if(Math.abs(long - closest) > 0.6) continue;


                   const vector = calcPos(long, lat, dotSphereRadius);
                   const dotGeo = new THREE.CircleGeometry(0.12, 5);
                   dotGeo.lookAt(vector);
                   dotGeo.translate(vector.x, vector.y, vector.z);
                  
                   const m = new THREE.ShaderMaterial({
                       side: THREE.DoubleSide,
                       uniforms: {
                           u_time: { value: i * Math.sin(Math.random()) },
                           u_maxExtrusion: { value: 1.0 },
                           u_focusPoint: { value: new THREE.Vector3(0,0,0) },
                           u_hasSelection: { value: 0.0 }
                       },
                       vertexShader: DOT_VERTEX,
                       fragmentShader: DOT_FRAGMENT,
                   });
                   materialsRef.current.push(m);
                   const mesh = new THREE.Mesh(dotGeo, m);
                   scene.add(mesh);
               }
           }


           // --- Generate Flags ---
           TOP_MARKETS.forEach(m => {
               const tex = createParticleTexture(m.flag);
               const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
               const pos = calcPos(m.lon, m.lat, 22.5);
               const sprite = new THREE.Sprite(mat);
               sprite.position.copy(pos);
               sprite.scale.set(3,3,3);
               sprite.userData = { isFlag: true, country: m, position: pos, targetScale: 3 };
               spritesRef.current.push(sprite);
               scene.add(sprite);
           });
       }


       // --- Load Land Mesh (Topology) ---
       textureLoader.load('https://unpkg.com/three-globe/example/img/earth-topology.png', (mapTex) => {
           const landGeo = new THREE.SphereGeometry(19.5, 128, 128);
           const landMat = new THREE.ShaderMaterial({
               uniforms: {
                   map: { value: mapTex },
                   u_time: { value: 0.0 },
                   u_focusPoint: { value: new THREE.Vector3(0,0,0) },
                   u_hasSelection: { value: 0.0 }
               },
               vertexShader: LAND_VERTEX,
               fragmentShader: LAND_FRAGMENT,
               transparent: true,
               side: THREE.DoubleSide,
               depthWrite: false
           });
           const landMesh = new THREE.Mesh(landGeo, landMat);
           scene.add(landMesh);
           landMeshRef.current = landMesh;
       });
   };


   // --- Events ---
   const raycaster = new THREE.Raycaster();
   const mouse = new THREE.Vector2();
   const particleTextures = ['💚', '🎵', '🔥', '✨'].map(createParticleTexture);


   const onMouseDown = (e: MouseEvent) => {
     // FIX: Allow interaction unless clicking specific UI elements
     const card = document.getElementById('storyCard');
     if(card?.classList.contains('active') && card.contains(e.target as Node)) return;


     mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
     mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
     raycaster.setFromCamera(mouse, camera);


     const hits = raycaster.intersectObjects(spritesRef.current);
     if(hits.length > 0) {
       const sprite = hits[0].object;
       const data = sprite.userData.country;
       const pos = sprite.userData.position;


       // Gimmick
       for(let i=0; i<15; i++) {
          const tex = particleTextures[Math.floor(Math.random()*4)];
          const pMat = new THREE.SpriteMaterial({map: tex, transparent:true});
          const p = new THREE.Sprite(pMat);
          p.position.copy(pos);
          p.position.add(new THREE.Vector3((Math.random()-0.5)*2, (Math.random()-0.5)*2, (Math.random()-0.5)*2));
          const scale = 1 + Math.random();
          p.scale.set(scale, scale, scale);
          const vel = pos.clone().normalize().multiplyScalar(0.2+Math.random()*0.3);
          vel.add(new THREE.Vector3((Math.random()-0.5)*0.1, (Math.random()-0.5)*0.1, (Math.random()-0.5)*0.1));
          scene.add(p);
          particlesRef.current.push({ mesh: p, velocity: vel, life: 1.0, decay: 0.01 + Math.random()*0.02 });
       }


       // --- Set Animation Targets ---
       spritesRef.current.forEach(s => {
          s.userData.targetScale = (s === sprite) ? 6 : 3;
       });


       // Set Focus Point
       [...materialsRef.current, landMeshRef.current?.material, baseMeshRef.current?.material].forEach((mat: any) => {
          if(mat && mat.uniforms) {
            mat.uniforms.u_focusPoint.value.copy(pos);
          }
       });
       targetSelectionVal.current = 1.0;


       // Set Camera Targets
       controls.autoRotate = false;
       const dist = camera.position.length();
       const idealPos = pos.clone().normalize().multiplyScalar(dist);
       const finalPos = idealPos.clone();
       const finalTarget = new THREE.Vector3(0,0,0);
      
       if(window.innerWidth > 1000) {
          const viewDir = new THREE.Vector3().subVectors(new THREE.Vector3(0,0,0), idealPos).normalize();
          const rightVec = new THREE.Vector3().crossVectors(viewDir, camera.up).normalize();
          const shift = rightVec.multiplyScalar(25);
          finalPos.add(shift);
          finalTarget.add(shift);
       }
      
       targetCamPos.current = finalPos;
       targetLookAt.current = finalTarget;


       // UI
       setStoryData(data);
       setCurrentTrackIndex(0);
       setPanelVisible(true);
     } else {
       // FIX: Close if clicking background
       if(card?.classList.contains('active')) {
           targetSelectionVal.current = 0.0;
           spritesRef.current.forEach(s => s.userData.targetScale = 3);
           targetLookAt.current = new THREE.Vector3(0,0,0);
           targetCamPos.current = null;
           controls.autoRotate = true;
           setPanelVisible(false);
       }
     }
   };


   window.addEventListener('mousedown', onMouseDown);


   // --- Animation Loop ---
   const animate = () => {
     requestAnimationFrame(animate);
    
     // 1. Time Uniforms
     materialsRef.current.forEach(m => m.uniforms.u_time.value += 0.03);
     if(landMeshRef.current) (landMeshRef.current.material as THREE.ShaderMaterial).uniforms.u_time.value += 0.03;
    
     // 2. Selection Uniform Lerp (Native JS lerp)
     if(baseMeshRef.current) {
         const currentSel = (baseMeshRef.current.material as THREE.ShaderMaterial).uniforms.u_hasSelection.value;
         // Simple lerp: current + (target - current) * 0.05
         const nextSel = currentSel + (targetSelectionVal.current - currentSel) * 0.05;
        
         [...materialsRef.current, landMeshRef.current?.material, baseMeshRef.current?.material].forEach((mat: any) => {
            if(mat && mat.uniforms) mat.uniforms.u_hasSelection.value = nextSel;
         });
     }


     // 3. Camera Position Lerp
     if(targetCamPos.current) {
       camera.position.lerp(targetCamPos.current, 0.05);
     }
    
     // 4. Controls Target Lerp
     if(targetLookAt.current) {
       controls.target.lerp(targetLookAt.current, 0.05);
     }


     // 5. Sprite Scale Lerp
     spritesRef.current.forEach(s => {
        const t = s.userData.targetScale;
        s.scale.lerp(new THREE.Vector3(t,t,t), 0.1);
     });


     // 6. Particles
     for (let i = particlesRef.current.length - 1; i >= 0; i--) {
         const p = particlesRef.current[i];
         p.mesh.position.add(p.velocity);
         p.life -= p.decay;
         p.mesh.material.opacity = p.life;
         if (p.life <= 0) {
             scene.remove(p.mesh);
             particlesRef.current.splice(i, 1);
         }
     }


     stars.rotation.y += 0.0003;
     controls.update();
     renderer.render(scene, camera);
   };
   animate();


   const handleResize = () => {
     camera.aspect = window.innerWidth / window.innerHeight;
     camera.updateProjectionMatrix();
     renderer.setSize(window.innerWidth, window.innerHeight);
   };
   window.addEventListener('resize', handleResize);


   return () => {
     window.removeEventListener('resize', handleResize);
     window.removeEventListener('mousedown', onMouseDown);
     renderer.dispose();
   };
 }, []);


 // --- UI Handlers ---
 const closeStory = () => {
   setPanelVisible(false);
   controlsRef.current!.autoRotate = true;
  
   // Reset Targets
   targetSelectionVal.current = 0.0;
   spritesRef.current.forEach(s => s.userData.targetScale = 3);
   targetLookAt.current = new THREE.Vector3(0,0,0);
   // Don't set camera pos target, just let orbit controls take over
   targetCamPos.current = null;
 };


 const nextTrack = (e: React.MouseEvent) => {
   e.stopPropagation();
   if(storyData && currentTrackIndex < storyData.tracks.length - 1) {
     setCurrentTrackIndex(p => p + 1);
   } else {
     closeStory();
   }
 };


 const prevTrack = (e: React.MouseEvent) => {
   e.stopPropagation();
   if(currentTrackIndex > 0) setCurrentTrackIndex(p => p - 1);
 };

 const handleIntroStart = () => {
   if (audioUnlocked) {
     setIntroVisible(false);
     return;
   }

   const audio = audioRef.current;
   if (!audio) return;

   audio.play()
     .then(() => {
       audio.muted = false;
       setAudioUnlocked(true);
       fadeAudioTo(BASE_AUDIO_VOLUME, 700);
       setIntroVisible(false);
     })
     .catch(() => {});
 };


 return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', background: 'radial-gradient(circle at 50% 50%, #1a1a2e 0%, #16213e 40%, #0f0f1a 100%)', color: 'white', fontFamily: 'sans-serif' }}>
     <div className={`intro-overlay ${introVisible ? 'show' : 'hide'}`}>
       <div className="intro-noise" aria-hidden="true" />
       <div className="intro-content">
         <div className="intro-glitch" aria-hidden="true">Listen to the world</div>
         <div className="intro-title">Listen to the world</div>
         <p className="intro-subtitle">Signal locked. Tap to tune into the planet&apos;s pulse.</p>
        <button className="intro-button" onClick={handleIntroStart} type="button">
          <span className="intro-arrow">➜</span>
        </button>
       </div>
     </div>
     <canvas ref={canvasRef} style={{ display: 'block' }} />
    
     {/* Instructions */}
     <div style={{ position: 'absolute', top: 20, width: '100%', textAlign: 'center', color: 'rgba(255,255,255,0.5)', pointerEvents: 'none', letterSpacing: 1, textTransform: 'uppercase', fontSize: '0.9rem' }}>
       Click a flag to view trending stories
     </div>


     {/* Story Card */}
     <div
       id="storyCard"
       className={panelVisible ? 'active' : ''}
       style={{
         position: 'absolute', top: '50%', right: '5%', transform: panelVisible ? 'translateY(-50%) translateX(0)' : 'translateY(-50%) translateX(50px)',
         width: 320, height: 580, background: 'linear-gradient(135deg, rgba(10,10,10,0.95) 0%, rgba(30,30,30,0.95) 100%)',
         backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16,
         boxShadow: '0 25px 50px -12px rgba(0,0,0,0.8)', transition: 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
         opacity: panelVisible ? 1 : 0, visibility: panelVisible ? 'visible' : 'hidden',
         display: 'flex', flexDirection: 'column', overflow: 'hidden', userSelect: 'none'
       }}
     >
       {/* Progress Bars */}
       <div style={{ display: 'flex', gap: 4, padding: '12px 12px 0 12px' }}>
         {storyData?.tracks.map((_, i) => (
           <div key={i} style={{ flex: 1, height: 2, background: 'rgba(255,255,255,0.3)', borderRadius: 2 }}>
             <div style={{ height: '100%', width: i <= currentTrackIndex ? '100%' : '0%', background: i === currentTrackIndex ? '#1DB954' : 'white', transition: 'width 0.1s linear' }} />
           </div>
         ))}
       </div>


       {/* Header */}
       <div style={{ display: 'flex', alignItems: 'center', padding: 12, zIndex: 10 }}>
         <span style={{ fontSize: 24, marginRight: 10 }}>{storyData?.flag}</span>
         <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{storyData?.name}</span>
         <button onClick={closeStory} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'white', fontSize: '1.5rem', cursor: 'pointer', opacity: 0.7 }}>×</button>
       </div>


       {/* Content */}
       <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: 30, position: 'relative', zIndex: 5, background: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.8) 100%)' }}>
         <div style={{ position: 'absolute', top: '20%', left: '50%', transform: 'translateX(-50%)', fontSize: 120, opacity: 0.1, filter: 'blur(2px)', zIndex: 1 }}>🎵</div>
        
         <div style={{ background: '#1DB954', color: 'black', fontWeight: 'bold', fontSize: '0.8rem', padding: '4px 8px', borderRadius: 4, alignSelf: 'flex-start', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1, zIndex: 2 }}>
           Trending #{currentTrackIndex + 1}
         </div>
         <div style={{ fontSize: '2rem', fontWeight: 800, lineHeight: 1.1, marginBottom: 8, textShadow: '0 2px 4px rgba(0,0,0,0.5)', zIndex: 2 }}>
           {storyData?.tracks[currentTrackIndex].song}
         </div>
         <div style={{ fontSize: '1.1rem', opacity: 0.9, marginBottom: 20, fontWeight: 500, zIndex: 2 }}>
           {storyData?.tracks[currentTrackIndex].artist}
         </div>
         <div style={{ fontSize: '1rem', lineHeight: 1.5, opacity: 0.9, background: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(5px)', padding: 15, borderRadius: 8, borderLeft: '3px solid #1DB954', zIndex: 2 }}>
           {storyData?.tracks[currentTrackIndex].story}
         </div>
       </div>


       {/* Tap Zones */}
       <div onClick={prevTrack} style={{ position: 'absolute', top: 0, left: 0, width: '30%', height: '100%', zIndex: 20, cursor: 'pointer' }} />
       <div onClick={nextTrack} style={{ position: 'absolute', top: 0, right: 0, width: '70%', height: '100%', zIndex: 20, cursor: 'pointer' }} />
     </div>
   </div>
 );
}
