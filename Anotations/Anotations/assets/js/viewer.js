import * as THREE from '../vendor/three/three.module.js';
import { GLTFLoader } from '../vendor/three/GLTFLoader.js';
import { OrbitControls } from '../vendor/three/OrbitControls.js';

let scene, camera, renderer, controls;
let artifactModel = null;
let raycaster, mouse;
let diffuseMap = null, normalMap = null;
let texturesEnabled = true;

const container = document.getElementById('canvas-container');
const loadingIndicator = document.getElementById('loading-indicator');
const toggleBtn = document.getElementById('toggle-texture-btn');
const tooltip = document.getElementById('tooltip-3d');
const btnResetCam = document.getElementById('btn-reset-cam');
const btnFocusInscr = document.getElementById('btn-focus-inscr');
const btnModeLines = document.getElementById('btn-mode-lines');
const btnModeLetters = document.getElementById('btn-mode-letters');
const hintHoverMode = document.getElementById('hint-hover-mode');

let hoverMode = 'lines'; // 'lines' | 'letters'
let annotationMeshes = [];
let outlineMeshes = [];
let letterColliders = [];
let letterHighlightGroup = null;
let hoveredLetterIdx = null;
let hoveredLineId = null;
let selectedLineId = null;

let defaultCameraPosition = new THREE.Vector3();
let defaultTarget = new THREE.Vector3();
let inscriptionCenter = new THREE.Vector3(113.1, -137.25, 114.81);

let ARTIFACT_DATA = window.ARTIFACT_DATA || null;

async function init() {
  // 1. Fetch full artifact data if available
  try {
    const res = await fetch('assets/data/artifact.json');
    if (res.ok) {
      ARTIFACT_DATA = await res.json();
      window.ARTIFACT_DATA = ARTIFACT_DATA;
    }
  } catch (e) {
    console.warn('Using fallback ARTIFACT_DATA:', e);
  }

  // 2. Scene setup
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe0e0e0);

  // 3. Camera setup
  camera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / container.clientHeight,
    0.01,
    100000
  );
  camera.position.set(2, 2, 3);

  // 4. Renderer setup
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.72;
  container.appendChild(renderer.domElement);

  // 5. OrbitControls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.screenSpacePanning = true;
  controls.minDistance = 0.05;
  controls.maxDistance = 500;

  // 6. Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.55);
  scene.add(ambientLight);

  const keyLight = new THREE.DirectionalLight(0xffffff, 0.35);
  keyLight.position.set(0, 0, 1);
  camera.add(keyLight);
  scene.add(camera);

  const fillLight = new THREE.DirectionalLight(0xffeedd, 0.20);
  fillLight.position.set(1, 2, -1);
  scene.add(fillLight);

  // 7. Raycasting & Mouse
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  // 8. Build Single Letter Highlight Halo Ring (invisible initially)
  createLetterHighlightMesh();

  // 9. Load GLTF Model & Textures
  loadModelAndTextures();

  // 10. Event Listeners
  window.addEventListener('resize', onWindowResize);
  renderer.domElement.addEventListener('mousemove', onMouseMove);
  renderer.domElement.addEventListener('click', onClick);

  if (toggleBtn) toggleBtn.addEventListener('click', toggleTextures);
  if (btnResetCam) btnResetCam.addEventListener('click', resetCamera);
  if (btnFocusInscr) btnFocusInscr.addEventListener('click', focusInscription);

  if (btnModeLines) {
    btnModeLines.addEventListener('click', () => setHoverMode('lines'));
  }
  if (btnModeLetters) {
    btnModeLetters.addEventListener('click', () => setHoverMode('letters'));
  }

  setupPanelInteraction();
  setupLetterPillsInteraction();

  // 11. Render Loop
  animate();
}

function setHoverMode(mode) {
  hoverMode = mode;
  if (mode === 'lines') {
    if (btnModeLines) btnModeLines.classList.add('active');
    if (btnModeLetters) btnModeLetters.classList.remove('active');
    if (hintHoverMode) hintHoverMode.textContent = '✨ Hover lines on the stone or sidebar to read';
    unhighlightLetter();
  } else {
    if (btnModeLetters) btnModeLetters.classList.add('active');
    if (btnModeLines) btnModeLines.classList.remove('active');
    if (hintHoverMode) hintHoverMode.textContent = '✨ Hover letters on the stone or sidebar to inspect each akshara';
    hoveredLineId = null;
    updateAnnotationVisuals();
    focusInscription();
  }
  if (tooltip) tooltip.style.display = 'none';
}

function loadModelAndTextures() {
  if (loadingIndicator) loadingIndicator.style.display = 'flex';

  const textureLoader = new THREE.TextureLoader();

  diffuseMap = textureLoader.load('assets/files/tex_u0_v0_diffuse.jpg');
  diffuseMap.encoding = THREE.sRGBEncoding;
  diffuseMap.flipY = false;

  normalMap = textureLoader.load('assets/files/tex_u0_v0_normal.jpg');
  normalMap.flipY = false;

  const loader = new GLTFLoader();
  const modelPath = (ARTIFACT_DATA && ARTIFACT_DATA.model_asset)
    ? ARTIFACT_DATA.model_asset.file_path
    : 'assets/files/model.glb';

  loader.load(
    modelPath,
    function (gltf) {
      if (loadingIndicator) loadingIndicator.style.display = 'none';
      artifactModel = gltf.scene;

      // Apply initial photogrammetric textures
      artifactModel.traverse(function (child) {
        if (child.isMesh) {
          child.material.map = diffuseMap;
          child.material.normalMap = normalMap;
          child.material.roughness = 0.85;
          child.material.metalness = 0.05;
          child.material.needsUpdate = true;
        }
      });

      scene.add(artifactModel);

      // Auto-fit Camera
      const box = new THREE.Box3().setFromObject(artifactModel);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);

      camera.position.set(center.x, center.y, center.z + maxDim * 1.85);
      controls.target.copy(center);
      controls.update();

      defaultCameraPosition.copy(camera.position);
      defaultTarget.copy(controls.target);

      // Build 3D Highlight Meshes for Lines
      createAnnotations();

      // Build Invisible Raycast Colliders for Letters (no visible dots on stone)
      createLetterColliders();
    },
    function (xhr) {
      // Progress callback
    },
    function (error) {
      if (loadingIndicator) loadingIndicator.style.display = 'none';
      console.error('Error loading model:', error);
      container.innerHTML = '<div style="color:red; padding: 2rem; font-weight:600;">Error loading 3D model.</div>';
    }
  );
}

function toggleTextures() {
  texturesEnabled = !texturesEnabled;
  if (!artifactModel) return;

  artifactModel.traverse(function (child) {
    if (child.isMesh) {
      child.material.map = texturesEnabled ? diffuseMap : null;
      child.material.normalMap = texturesEnabled ? normalMap : null;
      child.material.color.setHex(texturesEnabled ? 0xffffff : 0xdddddd);
      child.material.roughness = texturesEnabled ? 0.85 : 0.65;
      child.material.needsUpdate = true;
    }
  });

  if (toggleBtn) {
    toggleBtn.textContent = texturesEnabled ? 'Disable Texture' : 'Enable Texture';
    toggleBtn.classList.toggle('active', !texturesEnabled);
  }
}

function resetCamera() {
  smoothMoveCamera(defaultCameraPosition, defaultTarget);
}

function focusInscription() {
  const target = inscriptionCenter.clone();
  const eye = new THREE.Vector3(target.x, target.y + 0.05, target.z + 0.35);
  smoothMoveCamera(eye, target);
}

function focusLetter(pos) {
  const target = pos.clone();
  const eye = new THREE.Vector3(target.x, target.y + 0.02, target.z + 0.16);
  smoothMoveCamera(eye, target);
}

function smoothMoveCamera(targetPos, targetLookAt) {
  const startPos = camera.position.clone();
  const startTarget = controls.target.clone();
  const startTime = performance.now();
  const duration = 650;

  function step(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // Ease Out Cubic
    const ease = 1 - Math.pow(1 - progress, 3);

    camera.position.lerpVectors(startPos, targetPos, ease);
    controls.target.lerpVectors(startTarget, targetLookAt, ease);
    controls.update();

    if (progress < 1) {
      requestAnimationFrame(step);
    }
  }
  requestAnimationFrame(step);
}

function createAnnotations() {
  if (!ARTIFACT_DATA || !ARTIFACT_DATA.inscriptions) return;

  annotationMeshes.forEach(m => scene.remove(m));
  outlineMeshes.forEach(m => scene.remove(m));
  annotationMeshes = [];
  outlineMeshes = [];

  ARTIFACT_DATA.inscriptions.forEach(inscr => {
    inscr.lines.forEach(line => {
      const ann = line.annotation;
      if (!ann) return;

      let geomData = null;
      if (typeof ann.surface_geometry === 'object' && ann.surface_geometry !== null) {
        geomData = ann.surface_geometry;
      } else if (typeof ann.surface_geometry_json === 'string') {
        try { geomData = JSON.parse(ann.surface_geometry_json); } catch (e) {}
      }

      if (geomData && geomData.rings && geomData.rings.length > 0) {
        const ring = geomData.rings[0];
        const points = ring.map(pt => new THREE.Vector3(pt[0], pt[1], pt[2]));

        if (points.length >= 3) {
          // Triangle Fan Geometry slightly offset forward along normal
          const vertices = [];
          for (let i = 1; i < points.length - 1; i++) {
            vertices.push(
              points[0].x, points[0].y, points[0].z + 0.002,
              points[i].x, points[i].y, points[i].z + 0.002,
              points[i + 1].x, points[i + 1].y, points[i + 1].z + 0.002
            );
          }

          const polyGeom = new THREE.BufferGeometry();
          polyGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
          polyGeom.computeVertexNormals();

          // Warm golden highlighter material
          const polyMat = new THREE.MeshBasicMaterial({
            color: 0xffd700,
            transparent: true,
            opacity: 0.05,
            side: THREE.DoubleSide,
            depthTest: false,
            blending: THREE.AdditiveBlending
          });

          const mesh = new THREE.Mesh(polyGeom, polyMat);
          mesh.userData = {
            lineId: line.id,
            lineNo: line.line_no,
            originalText: line.original_text,
            translationTA: line.translations ? (line.translations.find(t => t.language_code === 'TA') || {}).translated_text : '',
            translationEN: line.translations ? (line.translations.find(t => t.language_code === 'EN') || {}).translated_text : ''
          };

          // Contour outline
          const linePoints = points.map(p => new THREE.Vector3(p.x, p.y, p.z + 0.002));
          linePoints.push(linePoints[0]);
          const outlineGeom = new THREE.BufferGeometry().setFromPoints(linePoints);
          const outlineMat = new THREE.LineBasicMaterial({
            color: 0xffd700,
            transparent: true,
            opacity: 0.25,
            linewidth: 1
          });
          const outlineMesh = new THREE.Line(outlineGeom, outlineMat);
          outlineMesh.userData = { lineId: line.id };

          scene.add(mesh);
          scene.add(outlineMesh);
          annotationMeshes.push(mesh);
          outlineMeshes.push(outlineMesh);
        }
      }
    });
  });

  window.getLineScreenCoords = function(lineId) {
    const mesh = annotationMeshes.find(m => m.userData.lineId === lineId);
    if (!mesh) return null;
    const box = new THREE.Box3().setFromObject(mesh);
    const center = box.getCenter(new THREE.Vector3());
    return toScreenCoords(center);
  };
}

function createLetterHighlightMesh() {
  letterHighlightGroup = new THREE.Group();
  letterHighlightGroup.visible = false;

  // 1. Glowing outer ring with vivid gold
  const ringGeom = new THREE.RingGeometry(0.007, 0.022, 32);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xffd700,
    transparent: true,
    opacity: 0.95,
    side: THREE.DoubleSide,
    depthTest: false,
    blending: THREE.AdditiveBlending
  });
  const ringMesh = new THREE.Mesh(ringGeom, ringMat);

  // 2. Inner warm glow disc
  const discGeom = new THREE.CircleGeometry(0.009, 32);
  const discMat = new THREE.MeshBasicMaterial({
    color: 0xffea79,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
    depthTest: false,
    blending: THREE.AdditiveBlending
  });
  const discMesh = new THREE.Mesh(discGeom, discMat);

  // 3. Crisp white center indicator
  const dotGeom = new THREE.CircleGeometry(0.0028, 16);
  const dotMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.95,
    side: THREE.DoubleSide,
    depthTest: false
  });
  const dotMesh = new THREE.Mesh(dotGeom, dotMat);

  letterHighlightGroup.add(ringMesh);
  letterHighlightGroup.add(discMesh);
  letterHighlightGroup.add(dotMesh);

  scene.add(letterHighlightGroup);

  // Expose letter hover and focus APIs
  window.hoverLetter = function(pinIdx) {
    const collider = letterColliders.find(c => c.userData.pinIdx === pinIdx);
    if (collider) {
      hoveredLetterIdx = pinIdx;
      highlightLetter(collider.userData);
      const screenPos = toScreenCoords(collider.userData.position);
      const rect = renderer.domElement.getBoundingClientRect();
      showLetterTooltip(collider.userData, screenPos.x - rect.left, screenPos.y - rect.top);
    }
  };

  window.unhoverLetter = function() {
    hoveredLetterIdx = null;
    unhighlightLetter();
    if (tooltip) tooltip.style.display = 'none';
  };

  window.focusLetter = function(pinIdx) {
    const collider = letterColliders.find(c => c.userData.pinIdx === pinIdx);
    if (collider) {
      focusLetter(collider.userData.position);
    }
  };
}

function createLetterColliders() {
  letterColliders.forEach(c => scene.remove(c));
  letterColliders = [];

  if (!ARTIFACT_DATA || !ARTIFACT_DATA.inscriptions) return;

  // The user requested NO visible points/dots on the stone surface!
  // We use invisible (opacity: 0) collider spheres for 3D raycasting
  const colliderGeom = new THREE.SphereGeometry(0.015, 8, 8);
  const colliderMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false
  });

  ARTIFACT_DATA.inscriptions.forEach(inscr => {
    inscr.lines.forEach(line => {
      if (line.letters && line.letters.length > 0) {
        line.letters.forEach(letter => {
          const pos = new THREE.Vector3(letter.position[0], letter.position[1], letter.position[2]);
          const sphere = new THREE.Mesh(colliderGeom, colliderMat);
          sphere.position.copy(pos);
          sphere.userData = {
            pinIdx: letter.pin_idx,
            lineNo: letter.line_no,
            tamil: letter.tamil,
            english: letter.english,
            wordTa: letter.word_ta,
            wordEn: letter.word_en,
            position: pos
          };

          scene.add(sphere);
          letterColliders.push(sphere);
        });
      }
    });
  });

  // ── Build one Tamil label per letter collider ──────────────────────
  const labelContainer = document.getElementById('letter-labels');
  if (labelContainer) {
    labelContainer.innerHTML = ''; // clear any previous
    letterColliders.forEach(collider => {
      const lbl = document.createElement('span');
      lbl.className   = 'stone-lbl';
      lbl.textContent = collider.userData.tamil;
      lbl.style.display = 'none'; // hidden until first animate frame
      labelContainer.appendChild(lbl);
      // store reference on collider for fast access in animate()
      collider.userData._label = lbl;
    });
  }
}

function updateAnnotationVisuals() {
  annotationMeshes.forEach(mesh => {
    const lineId = mesh.userData.lineId;
    if (lineId === selectedLineId) {
      mesh.material.opacity = 0.42;
      mesh.material.color.setHex(0xffa500); // Amber when selected
    } else if (lineId === hoveredLineId && hoverMode === 'lines') {
      mesh.material.opacity = 0.28;
      mesh.material.color.setHex(0xffd700); // Glowing gold when hovered
    } else {
      mesh.material.opacity = 0.04;
      mesh.material.color.setHex(0xffd700); // Idle
    }
  });

  outlineMeshes.forEach(lineMesh => {
    const lineId = lineMesh.userData.lineId;
    if (lineId === selectedLineId) {
      lineMesh.material.opacity = 0.8;
      lineMesh.material.color.setHex(0xffa500);
    } else if (lineId === hoveredLineId && hoverMode === 'lines') {
      lineMesh.material.opacity = 0.6;
      lineMesh.material.color.setHex(0xffd700);
    } else {
      lineMesh.material.opacity = 0.12;
      lineMesh.material.color.setHex(0xffd700);
    }
  });

  // Update right side panel items
  document.querySelectorAll('.transcription-line').forEach(el => {
    const lineId = parseInt(el.dataset.lineId);
    el.classList.toggle('active', lineId === selectedLineId);
    el.classList.toggle('hovered', lineId === hoveredLineId && lineId !== selectedLineId && hoverMode === 'lines');

    if (lineId === selectedLineId) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });
}

function onMouseMove(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);

  // 1. Hover Letters Mode
  if (hoverMode === 'letters') {
    if (letterColliders.length > 0) {
      const letterHits = raycaster.intersectObjects(letterColliders);
      if (letterHits.length > 0) {
        document.body.style.cursor = 'pointer';
        const hitData = letterHits[0].object.userData;
        if (hoveredLetterIdx !== hitData.pinIdx) {
          hoveredLetterIdx = hitData.pinIdx;
          highlightLetter(hitData);
        }
        showLetterTooltip(hitData, event.clientX - rect.left, event.clientY - rect.top);
        return;
      } else {
        if (hoveredLetterIdx !== null) {
          hoveredLetterIdx = null;
          unhighlightLetter();
        }
        document.body.style.cursor = 'default';
        if (tooltip) tooltip.style.display = 'none';
      }
    }
    return;
  }

  // 2. Hover Lines Mode
  if (annotationMeshes.length > 0) {
    const intersects = raycaster.intersectObjects(annotationMeshes);
    if (intersects.length > 0) {
      document.body.style.cursor = 'pointer';
      const hitMesh = intersects[0].object;
      const newHover = hitMesh.userData.lineId;

      if (newHover !== hoveredLineId) {
        hoveredLineId = newHover;
        updateAnnotationVisuals();
      }

      showLineTooltip(hitMesh.userData, event.clientX - rect.left, event.clientY - rect.top);
    } else {
      document.body.style.cursor = 'default';
      if (hoveredLineId !== null) {
        hoveredLineId = null;
        updateAnnotationVisuals();
      }
      if (tooltip) tooltip.style.display = 'none';
    }
  }
}

// ── Ring world-space X correction ────────────────────────────────────────────
// Negative shifts the highlight ring LEFT on the stone. Tune if ring drifts.
// 1 world unit ≈ 1400 screen px at default zoom; 0.011 ≈ ~15px / 4mm
const RING_OFFSET_X = -0.022;

function highlightLetter(data) {
  if (!letterHighlightGroup) return;

  // Position ring on stone surface with X correction applied
  letterHighlightGroup.position.set(
    data.position.x + RING_OFFSET_X,
    data.position.y,
    data.position.z + 0.0035
  );
  letterHighlightGroup.visible = true;

  // Sync side panel letter pills
  document.querySelectorAll('.letter-pill.active').forEach(p => p.classList.remove('active'));
  document.querySelectorAll(`.letter-pill[data-pin-idx="${data.pinIdx}"]`).forEach(p => {
    p.classList.add('active');
  });

  // Highlight parent line card subtly
  document.querySelectorAll('.transcription-line').forEach(el => {
    const lineNo = parseInt(el.dataset.lineNo);
    el.classList.toggle('hovered', lineNo === data.lineNo);
  });
}

function unhighlightLetter() {
  if (letterHighlightGroup) letterHighlightGroup.visible = false;
  document.querySelectorAll('.letter-pill.active').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.transcription-line.hovered').forEach(el => el.classList.remove('hovered'));
}

function showLetterTooltip(data, mouseX, mouseY) {
  if (!tooltip) return;

  tooltip.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; gap:8px;">
      <span style="color:#f1c40f; font-weight:700; font-size:11px; text-transform:uppercase; letter-spacing:0.5px;">Line ${data.lineNo} • Letter #${data.pinIdx + 1}</span>
      <span style="background:rgba(241,196,15,0.2); color:#fef08a; padding:1px 6px; border-radius:4px; font-size:10px; font-weight:600;">Akshara</span>
    </div>
    <div style="font-size:26px; font-family:'Noto Sans Tamil',sans-serif; font-weight:700; color:#ffffff; line-height:1.2; text-shadow:0 0 12px rgba(241,196,15,0.7);">${escapeHtml(data.tamil)}</div>
    <div style="font-family:'Fira Code',monospace; color:#93c5fd; font-size:13px; margin-top:2px; font-weight:600;">English: ${escapeHtml(data.english)}</div>
    <div style="margin-top:6px; padding-top:5px; border-top:1px solid rgba(255,255,255,0.12); font-size:11px; color:#cbd5e1;">
      Word: <span style="color:#a8e6cf; font-family:'Noto Sans Tamil',sans-serif; font-weight:600;">${escapeHtml(data.wordTa)}</span> 
      <span style="color:#94a3b8; font-style:italic;">(${escapeHtml(data.wordEn)})</span>
    </div>
  `;
  tooltip.style.display = 'block';
  positionTooltip(mouseX, mouseY);
}

function showLineTooltip(data, mouseX, mouseY) {
  if (!tooltip) return;

  let content = `
    <div class="tooltip-line-title">Line ${data.lineNo}</div>
    <div class="tooltip-orig">${escapeHtml(data.originalText)}</div>
  `;

  if (data.translationTA) {
    content += `<div class="tooltip-trans">${escapeHtml(data.translationTA)}</div>`;
  }

  tooltip.innerHTML = content;
  tooltip.style.display = 'block';
  positionTooltip(mouseX, mouseY);
}

function positionTooltip(mouseX, mouseY) {
  const containerW = container.clientWidth;
  const containerH = container.clientHeight;
  let posX = mouseX + 16;
  let posY = mouseY + 16;

  if (posX + 230 > containerW) {
    posX = mouseX - 240;
  }
  if (posY + 110 > containerH) {
    posY = mouseY - 110;
  }

  tooltip.style.left = `${Math.max(10, posX)}px`;
  tooltip.style.top = `${Math.max(10, posY)}px`;
}

// ── Marker screen-coordinate correction ──────────────────────────────────────
// Positive = right, negative = left. Tune this if the tooltip drifts.
const MARKER_OFFSET_X = -15; // px — shifts projected screen position left

function toScreenCoords(pos) {
  const v = pos.clone().project(camera);
  const rect = renderer.domElement.getBoundingClientRect();
  const x = ((v.x + 1) / 2) * rect.width + rect.left + MARKER_OFFSET_X;
  const y = ((-v.y + 1) / 2) * rect.height + rect.top;
  return { x: Math.round(x), y: Math.round(y), v };
}

function onClick(event) {
  if (hoverMode === 'letters' && hoveredLetterIdx !== null) {
    const collider = letterColliders.find(c => c.userData.pinIdx === hoveredLetterIdx);
    if (collider) focusLetter(collider.userData.position);
    return;
  }

  if (hoveredLineId !== null) {
    selectedLineId = (selectedLineId === hoveredLineId) ? null : hoveredLineId;
    updateAnnotationVisuals();
  } else {
    selectedLineId = null;
    updateAnnotationVisuals();
  }
}

function setupPanelInteraction() {
  document.querySelectorAll('.transcription-line').forEach(el => {
    el.addEventListener('click', (e) => {
      // Don't trigger line click if clicking directly on a letter pill
      if (e.target.closest('.letter-pill')) return;

      const lineId = parseInt(el.dataset.lineId);
      selectedLineId = (selectedLineId === lineId) ? null : lineId;
      updateAnnotationVisuals();

      if (selectedLineId !== null) {
        const mesh = annotationMeshes.find(m => m.userData.lineId === selectedLineId);
        if (mesh && window.getLineScreenCoords) {
          const coords = window.getLineScreenCoords(selectedLineId);
          const rect = renderer.domElement.getBoundingClientRect();
          showLineTooltip(mesh.userData, coords.x - rect.left, coords.y - rect.top);
          // Focus line
          const box = new THREE.Box3().setFromObject(mesh);
          const center = box.getCenter(new THREE.Vector3());
          const eye = new THREE.Vector3(center.x, center.y + 0.03, center.z + 0.28);
          smoothMoveCamera(eye, center);
        }
      } else {
        if (tooltip) tooltip.style.display = 'none';
      }
    });

    el.addEventListener('mouseenter', () => {
      if (hoverMode !== 'lines') return;
      hoveredLineId = parseInt(el.dataset.lineId);
      updateAnnotationVisuals();
      const mesh = annotationMeshes.find(m => m.userData.lineId === hoveredLineId);
      if (mesh && window.getLineScreenCoords) {
        const coords = window.getLineScreenCoords(hoveredLineId);
        const rect = renderer.domElement.getBoundingClientRect();
        showLineTooltip(mesh.userData, coords.x - rect.left, coords.y - rect.top);
      }
    });

    el.addEventListener('mouseleave', () => {
      if (hoverMode !== 'lines') return;
      hoveredLineId = null;
      updateAnnotationVisuals();
      if (selectedLineId !== null) {
        const mesh = annotationMeshes.find(m => m.userData.lineId === selectedLineId);
        if (mesh && window.getLineScreenCoords) {
          const coords = window.getLineScreenCoords(selectedLineId);
          const rect = renderer.domElement.getBoundingClientRect();
          showLineTooltip(mesh.userData, coords.x - rect.left, coords.y - rect.top);
        }
      } else {
        if (tooltip) tooltip.style.display = 'none';
      }
    });
  });
}

function setupLetterPillsInteraction() {
  document.querySelectorAll('.letter-pill').forEach(pill => {
    pill.addEventListener('mouseenter', () => {
      const pinIdx = parseInt(pill.dataset.pinIdx);
      hoveredLetterIdx = pinIdx;

      const collider = letterColliders.find(c => c.userData.pinIdx === pinIdx);
      if (collider) {
        highlightLetter(collider.userData);
        const screenPos = toScreenCoords(collider.userData.position);
        const rect = renderer.domElement.getBoundingClientRect();
        showLetterTooltip(collider.userData, screenPos.x - rect.left, screenPos.y - rect.top);
      }
    });

    pill.addEventListener('mouseleave', () => {
      hoveredLetterIdx = null;
      unhighlightLetter();
      if (tooltip) tooltip.style.display = 'none';
    });

    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      const pinIdx = parseInt(pill.dataset.pinIdx);
      const collider = letterColliders.find(c => c.userData.pinIdx === pinIdx);
      if (collider) {
        // 1. Switch to letters mode so the highlight ring works
        setHoverMode('letters');

        // 2. Zoom camera to the letter
        focusLetter(collider.userData.position);

        // 3. Show the highlight ring on the letter
        hoveredLetterIdx = pinIdx;
        highlightLetter(collider.userData);

        // 4. Show the tooltip — wait one frame so camera has moved
        requestAnimationFrame(() => {
          const screenPos = toScreenCoords(collider.userData.position);
          const rect = renderer.domElement.getBoundingClientRect();
          showLetterTooltip(collider.userData, screenPos.x - rect.left, screenPos.y - rect.top);
        });
      }
    });
  });
}

function onWindowResize() {
  if (!container || !renderer || !camera) return;
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight);
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function animate() {
  requestAnimationFrame(animate);

  if (controls) controls.update();

  // Subtle breathing pulse for active letter highlight halo
  if (letterHighlightGroup && letterHighlightGroup.visible) {
    letterHighlightGroup.quaternion.copy(camera.quaternion);
    const pulse = 1.0 + Math.sin(performance.now() * 0.005) * 0.07;
    letterHighlightGroup.scale.set(pulse, pulse, pulse);
  }

  if (renderer && scene && camera) {
    renderer.render(scene, camera);

    // ── Update Tamil letter label positions every frame ──
    if (letterColliders.length > 0) {
      const rect = renderer.domElement.getBoundingClientRect();
      letterColliders.forEach(collider => {
        const lbl = collider.userData._label;
        if (!lbl) return;

        // Project 3D world pos → NDC → screen px (relative to container)
        const v = collider.userData.position.clone().project(camera);

        // behind camera → hide
        if (v.z > 1) { lbl.style.display = 'none'; return; }

        const x = ((v.x + 1) / 2) * rect.width;
        const y = ((-v.y + 1) / 2) * rect.height;

        lbl.style.display = 'block';
        lbl.style.left = x + 'px';
        lbl.style.top  = y + 'px';
      });
    }
  }
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
