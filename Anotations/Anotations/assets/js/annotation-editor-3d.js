import * as THREE from '../vendor/three/three.module.js';
import { GLTFLoader } from '../vendor/three/GLTFLoader.js';
import { OrbitControls } from '../vendor/three/OrbitControls.js';

let scene, camera, renderer, controls;
let artifactModel = null;
let raycaster, mouse;
let points = [];
let pointsMesh = null;
let lineMesh = null;
let polygonMesh = null;

const container = document.getElementById('canvas-container');
const loadingIndicator = document.getElementById('loading-indicator');
const btnDraw = document.getElementById('btn-draw');
const btnUndo = document.getElementById('btn-undo');
const btnClear = document.getElementById('btn-clear');
const btnSave = document.getElementById('btn-save');
const btnExport = document.getElementById('btn-export');
const statusText = document.getElementById('editor-status');
const pointCounter = document.getElementById('point-counter');

let activeLineId = null;
let isDrawingMode = false;
let annotationsMap = {};

// Initial data loaded from artifact.json
fetch('../assets/data/artifact.json')
  .then(res => res.json())
  .then(data => {
    if (data.inscriptions && data.inscriptions[0]) {
      data.inscriptions[0].lines.forEach(l => {
        if (l.annotation && l.annotation.surface_geometry) {
          annotationsMap[l.id] = l.annotation.surface_geometry.rings[0] || [];
        }
      });
    }
  })
  .catch(e => console.warn('Could not preload artifact annotations:', e));

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x18181b);

  camera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / container.clientHeight,
    0.01,
    100000
  );
  camera.position.set(2, 2, 3);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  container.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
  camera.add(dirLight);
  scene.add(camera);

  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  const loader = new GLTFLoader();
  loader.load(
    '../assets/files/model.glb',
    function (gltf) {
      if (loadingIndicator) loadingIndicator.style.display = 'none';
      artifactModel = gltf.scene;

      const textureLoader = new THREE.TextureLoader();
      const diffuseMap = textureLoader.load('../assets/files/tex_u0_v0_diffuse.jpg');
      diffuseMap.encoding = THREE.sRGBEncoding;
      diffuseMap.flipY = false;

      const normalMap = textureLoader.load('../assets/files/tex_u0_v0_normal.jpg');
      normalMap.flipY = false;

      artifactModel.traverse(function (child) {
        if (child.isMesh) {
          child.material.map = diffuseMap;
          child.material.normalMap = normalMap;
          child.material.needsUpdate = true;
        }
      });

      scene.add(artifactModel);

      const box = new THREE.Box3().setFromObject(artifactModel);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);

      camera.position.set(center.x, center.y, center.z + maxDim * 1.6);
      controls.target.copy(center);
      controls.update();
    },
    undefined,
    function (error) {
      if (loadingIndicator) loadingIndicator.style.display = 'none';
      console.error(error);
      container.innerHTML = '<div style="color:red; padding: 2rem;">Error loading model.</div>';
    }
  );

  window.addEventListener('resize', onWindowResize);
  renderer.domElement.addEventListener('click', onCanvasClick);

  setupUI();
  animate();
}

function setupUI() {
  document.querySelectorAll('.line-item').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.line-item').forEach(e => e.classList.remove('selected'));
      el.classList.add('selected');
      activeLineId = parseInt(el.dataset.lineId);

      clearPoints();

      if (annotationsMap[activeLineId] && annotationsMap[activeLineId].length > 0) {
        points = annotationsMap[activeLineId].map(pt => new THREE.Vector3(pt[0], pt[1], pt[2]));
        updateGeometryVisuals();
        statusText.textContent = `Loaded existing 3D polygon for Line. (${points.length} vertices)`;
      } else {
        statusText.textContent = "Line selected. Click 'Draw Mode' then click on stone surface to place boundary points.";
      }

      isDrawingMode = false;
      btnDraw.classList.remove('active');
      controls.enabled = true;
      controls.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN
      };
    });
  });

  btnDraw.addEventListener('click', () => {
    if (!activeLineId) {
      alert('Please select an inscription line first from the list below.');
      return;
    }
    isDrawingMode = !isDrawingMode;
    if (isDrawingMode) {
      btnDraw.classList.add('active');
      controls.mouseButtons = {
        LEFT: null,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.ROTATE
      };
      statusText.textContent = "✏️ Drawing Mode ACTIVE: Left-click on model surface to place points. Right-click to rotate.";
    } else {
      btnDraw.classList.remove('active');
      controls.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN
      };
      statusText.textContent = "Drawing paused. Camera orbit controls restored.";
    }
  });

  btnUndo.addEventListener('click', () => {
    if (points.length > 0) {
      points.pop();
      updateGeometryVisuals();
      statusText.textContent = `Removed point. Remaining: ${points.length}`;
    }
  });

  btnClear.addEventListener('click', () => {
    clearPoints();
    statusText.textContent = "Cleared all points.";
  });

  btnSave.addEventListener('click', () => {
    if (!activeLineId) {
      alert('Please select a line.');
      return;
    }
    if (points.length < 3) {
      alert('A closed surface polygon requires at least 3 points.');
      return;
    }

    const ring = points.map(p => [p.x, p.y, p.z]);
    annotationsMap[activeLineId] = ring;

    const lineItem = document.querySelector(`.line-item[data-line-id="${activeLineId}"]`);
    if (lineItem) {
      const badge = lineItem.querySelector('.status-badge');
      badge.classList.add('has-annotation');
      badge.textContent = '3D Annotated';
    }
    statusText.textContent = `Saved ${points.length} points to Line in session.`;
  });

  btnExport.addEventListener('click', () => {
    const exportData = {
      model: "model.glb",
      exported_at: new Date().toISOString(),
      annotations: annotationsMap
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `annotations_3d_export_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    statusText.textContent = "Downloaded 3D annotations JSON export file.";
  });
}

function onCanvasClick(event) {
  if (!isDrawingMode || !artifactModel) return;
  if (event.button !== 0) return;

  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObject(artifactModel, true);

  if (intersects.length > 0) {
    points.push(intersects[0].point.clone());
    updateGeometryVisuals();
    statusText.textContent = `Point #${points.length} added at [${intersects[0].point.x.toFixed(2)}, ${intersects[0].point.y.toFixed(2)}, ${intersects[0].point.z.toFixed(2)}]`;
  }
}

function updateGeometryVisuals() {
  if (pointsMesh) scene.remove(pointsMesh);
  if (lineMesh) scene.remove(lineMesh);
  if (polygonMesh) scene.remove(polygonMesh);

  pointCounter.textContent = `Points placed: ${points.length}`;
  if (points.length === 0) return;

  // 1. Points
  const ptsGeom = new THREE.BufferGeometry().setFromPoints(points);
  const ptsMat = new THREE.PointsMaterial({ color: 0xffaa00, size: 0.02, transparent: true, opacity: 0.9 });
  pointsMesh = new THREE.Points(ptsGeom, ptsMat);
  scene.add(pointsMesh);

  // 2. Boundary Lines
  if (points.length > 1) {
    const linePoints = [...points];
    if (points.length >= 3) linePoints.push(points[0]);
    const lineGeom = new THREE.BufferGeometry().setFromPoints(linePoints);
    const lineMat = new THREE.LineBasicMaterial({ color: 0xf1c40f, transparent: true, opacity: 0.8 });
    lineMesh = new THREE.Line(lineGeom, lineMat);
    scene.add(lineMesh);
  }

  // 3. Polygon Mesh
  if (points.length >= 3) {
    const vertices = [];
    for (let i = 1; i < points.length - 1; i++) {
      vertices.push(
        points[0].x, points[0].y, points[0].z,
        points[i].x, points[i].y, points[i].z,
        points[i + 1].x, points[i + 1].y, points[i + 1].z
      );
    }
    const polyGeom = new THREE.BufferGeometry();
    polyGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));

    const polyMat = new THREE.MeshBasicMaterial({
      color: 0xffd700,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthTest: false,
      blending: THREE.AdditiveBlending
    });
    polygonMesh = new THREE.Mesh(polyGeom, polyMat);
    scene.add(polygonMesh);
  }
}

function clearPoints() {
  points = [];
  updateGeometryVisuals();
}

function onWindowResize() {
  if (!container || !renderer || !camera) return;
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight);
}

function animate() {
  requestAnimationFrame(animate);
  if (controls) controls.update();
  if (renderer && scene && camera) renderer.render(scene, camera);
}

init();
