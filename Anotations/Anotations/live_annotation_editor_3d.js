import * as THREE from '../vendor/three/three.module.js';
import { GLTFLoader } from '../vendor/three/GLTFLoader.js';
import { OrbitControls } from '../vendor/three/OrbitControls.js';

let scene, camera, renderer, controls;
let artifactModel;
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
const btnDelete = document.getElementById('btn-delete');
const statusText = document.getElementById('editor-status');

let activeLineId = null;
let isDrawingMode = false;

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x222222);

    camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.01, 100000);
    camera.position.set(0, 0, 5);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.outputEncoding = THREE.sRGBEncoding;
    container.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.6);
    camera.add(directionalLight);
    scene.add(camera);

    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    const loader = new GLTFLoader();
    const modelPath = window.MODEL_ASSET ? `../${window.MODEL_ASSET.file_path}` : '../assets/files/model.glb';
    
    loader.load(
        modelPath,
        function (gltf) {
            loadingIndicator.style.display = 'none';
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
            
            camera.position.copy(center);
            camera.position.z += maxDim * 1.5;
            controls.target.copy(center);
        },
        undefined,
        function (error) {
            loadingIndicator.style.display = 'none';
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
            
            // Try to load existing 3D annotation
            let existingAnn = null;
            window.INSCRIPTIONS.forEach(inscr => {
                inscr.lines.forEach(line => {
                    if (line.id === activeLineId && line.annotation && line.annotation.annotation_method === '3d') {
                        existingAnn = JSON.parse(line.annotation.surface_geometry_json);
                    }
                });
            });

            clearPoints();
            if (existingAnn && existingAnn.rings && existingAnn.rings.length > 0) {
                // Restore points (array of arrays [x,y,z])
                points = existingAnn.rings[0].map(pt => new THREE.Vector3(pt[0], pt[1], pt[2]));
                updateGeometryVisuals();
                statusText.textContent = "Existing 3D annotation loaded.";
                if (btnDelete) btnDelete.style.display = 'inline-block';
            } else {
                statusText.textContent = "Line selected. Click 'Draw Mode' to add points on the surface.";
                if (btnDelete) btnDelete.style.display = 'none';
            }

            isDrawingMode = false;
            btnDraw.classList.remove('active');
            controls.enabled = true;
        });
    });

    btnDraw.addEventListener('click', () => {
        if (!activeLineId) {
            alert("Select a line first.");
            return;
        }
        isDrawingMode = !isDrawingMode;
        if (isDrawingMode) {
            btnDraw.classList.add('active');
            // Disable orbit controls left click so we can draw instead of rotate
            controls.mouseButtons = {
                LEFT: null,
                MIDDLE: THREE.MOUSE.DOLLY,
                RIGHT: THREE.MOUSE.ROTATE
            };
            statusText.textContent = "Click on the model to place boundary points. Right-click to rotate.";
        } else {
            btnDraw.classList.remove('active');
            // Re-enable normal orbit controls
            controls.mouseButtons = {
                LEFT: THREE.MOUSE.ROTATE,
                MIDDLE: THREE.MOUSE.DOLLY,
                RIGHT: THREE.MOUSE.PAN
            };
            statusText.textContent = "Drawing paused. Normal camera controls restored.";
        }
    });

    btnUndo.addEventListener('click', () => {
        if (points.length > 0) {
            points.pop();
            updateGeometryVisuals();
        }
    });

    btnClear.addEventListener('click', () => {
        clearPoints();
    });
    
    if (btnDelete) {
        btnDelete.addEventListener('click', async () => {
            if (!activeLineId) return;
            if (!confirm("Are you sure you want to completely delete this annotation?")) return;
            
            try {
                statusText.textContent = "Deleting...";
                const response = await fetch('../api/annotation.php', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ line_id: activeLineId })
                });
                const result = await response.json();
                if (result.success) {
                    statusText.textContent = "Annotation deleted successfully!";
                    const activeLineItem = document.querySelector(`.line-item[data-line-id="${activeLineId}"]`);
                    if (activeLineItem) {
                        const badge = activeLineItem.querySelector('.status-badge');
                        badge.classList.remove('has-annotation');
                        badge.textContent = 'None';
                    }
                    clearPoints();
                    btnDelete.style.display = 'none';
                    window.INSCRIPTIONS.forEach(inscr => {
                        inscr.lines.forEach(line => {
                            if (line.id === activeLineId && line.annotation) {
                                line.annotation = null;
                            }
                        });
                    });
                } else {
                    alert(result.error);
                    statusText.textContent = "Error deleting.";
                }
            } catch (e) {
                console.error(e);
                statusText.textContent = "Error deleting.";
            }
        });
    }

    btnSave.addEventListener('click', async () => {
        if (!activeLineId) {
            alert("No line selected.");
            return;
        }
        if (points.length < 3) {
            alert("Need at least 3 points for a valid region.");
            return;
        }

        // We store world coordinates relative to the model for simplicity in this version.
        // A robust version would store triangle indices & barycentric coords.
        const rings = points.map(pt => [pt.x, pt.y, pt.z]);

        const payload = {
            line_id: activeLineId,
            asset_id: window.MODEL_ASSET.id,
            method: '3d',
            geometry: {
                schema_version: 1,
                coordinate_space: "mesh_surface",
                model_asset_id: window.MODEL_ASSET.id,
                model_version: 1,
                rings: [rings]
            }
        };

        try {
            statusText.textContent = "Saving...";
            // We need to adapt the API to accept surface_geometry_json for '3d' method.
            const response = await fetch('../api/annotation.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            if (result.success) {
                statusText.textContent = "3D Annotation saved successfully!";
                const activeLineItem = document.querySelector(`.line-item[data-line-id="${activeLineId}"]`);
                if (activeLineItem) {
                    const badge = activeLineItem.querySelector('.status-badge');
                    badge.classList.add('has-annotation');
                    badge.textContent = '3D Annotated';
                }
            } else {
                alert(result.error);
                statusText.textContent = "Error saving.";
            }
        } catch (e) {
            console.error(e);
            statusText.textContent = "Error saving.";
        }
    });
}

function onCanvasClick(event) {
    if (!isDrawingMode || !artifactModel) return;
    
    // Only process left clicks for drawing
    if (event.button !== 0) return; 

    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    // Intersect against all children of the artifact model
    const intersects = raycaster.intersectObject(artifactModel, true);

    if (intersects.length > 0) {
        // Add the intersection point
        points.push(intersects[0].point.clone());
        updateGeometryVisuals();
    }
}

function updateGeometryVisuals() {
    if (pointsMesh) scene.remove(pointsMesh);
    if (lineMesh) scene.remove(lineMesh);
    if (polygonMesh) scene.remove(polygonMesh);

    if (points.length === 0) return;

    // 1. Draw points as soft glowing spheres so they still know where they clicked
    const ptsGeom = new THREE.BufferGeometry().setFromPoints(points);
    const ptsMat = new THREE.PointsMaterial({ color: 0xffaa00, size: 0.03, transparent: true, opacity: 0.8 });
    pointsMesh = new THREE.Points(ptsGeom, ptsMat);
    scene.add(pointsMesh);

    // 2. Draw soft border
    if (points.length > 1) {
        const linePoints = [...points];
        if (points.length >= 3) {
            linePoints.push(points[0]); 
        }
        const lineGeom = new THREE.BufferGeometry().setFromPoints(linePoints);
        const lineMat = new THREE.LineBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.4 });
        lineMesh = new THREE.Line(lineGeom, lineMat);
        scene.add(lineMesh);
    }

    // 3. Draw Translucent Polygon (Highlighter effect)
    if (points.length >= 3) {
        const vertices = [];
        for (let i = 1; i < points.length - 1; i++) {
            vertices.push(
                points[0].x, points[0].y, points[0].z,
                points[i].x, points[i].y, points[i].z,
                points[i+1].x, points[i+1].y, points[i+1].z
            );
        }
        const polyGeom = new THREE.BufferGeometry();
        polyGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
        
        const polyMat = new THREE.MeshBasicMaterial({ 
            color: 0xffd700,
            transparent: true,
            opacity: 0.25, 
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
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

init();
