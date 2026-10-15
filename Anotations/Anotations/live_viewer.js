import * as THREE from '../vendor/three/three.module.js';
import { GLTFLoader } from '../vendor/three/GLTFLoader.js';
import { OrbitControls } from '../vendor/three/OrbitControls.js';

let scene, camera, renderer, controls;
let artifactModel;
let raycaster, mouse;

const container = document.getElementById('canvas-container');
const loadingIndicator = document.getElementById('loading-indicator');
const toggleBtn = document.getElementById('toggle-texture-btn');

let annotationMeshes = [];
let hoveredLineId = null;
let selectedLineId = null;
const raycasterThreshold = 0.1; // Threshold for raycasting lines/points if needed

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe0e0e0);

    camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.01, 100000);
    camera.position.set(2, 2, 3);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.outputEncoding = THREE.sRGBEncoding;
    container.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.6);
    // Attach light to camera so it always illuminates what we're looking at
    camera.add(directionalLight);
    scene.add(camera);

    raycaster = new THREE.Raycaster();
    raycaster.params.Line.threshold = raycasterThreshold;
    mouse = new THREE.Vector2();

    // Load Model
    loadingIndicator.style.display = 'block';
    const loader = new GLTFLoader();
    
    // Use dynamic model path from PHP injection if available
    const modelPath = (window.ARTIFACT_DATA && window.ARTIFACT_DATA.model_asset) 
        ? window.ARTIFACT_DATA.model_asset.file_path 
        : 'assets/files/model.glb';

    loader.load(
        modelPath,
        function (gltf) {
            loadingIndicator.style.display = 'none';
            artifactModel = gltf.scene;
            
            const textureLoader = new THREE.TextureLoader();
            
            const diffuseMap = textureLoader.load('assets/files/tex_u0_v0_diffuse.jpg');
            diffuseMap.encoding = THREE.sRGBEncoding;
            diffuseMap.flipY = false;

            const normalMap = textureLoader.load('assets/files/tex_u0_v0_normal.jpg');
            normalMap.flipY = false;
            
            let texturesEnabled = true;
            if (toggleBtn) {
                toggleBtn.textContent = "Disable Texture";
                toggleBtn.addEventListener('click', () => {
                    texturesEnabled = !texturesEnabled;
                    artifactModel.traverse(function (child) {
                        if (child.isMesh) {
                            child.material.map = texturesEnabled ? diffuseMap : null;
                            child.material.normalMap = texturesEnabled ? normalMap : null;
                            child.material.needsUpdate = true;
                        }
                    });
                    toggleBtn.textContent = texturesEnabled ? "Disable Texture" : "Enable Texture";
                });
            }

            artifactModel.traverse(function (child) {
                if (child.isMesh) {
                    child.material.map = diffuseMap;
                    child.material.normalMap = normalMap;
                    child.material.needsUpdate = true;
                }
            });

            scene.add(artifactModel);

            // Auto-fit camera
            const box = new THREE.Box3().setFromObject(artifactModel);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            
            camera.position.copy(center);
            camera.position.z += maxDim * 2;
            controls.target.copy(center);
            
            createAnnotations();
        },
        undefined,
        function (error) {
            loadingIndicator.style.display = 'none';
            console.error('Error loading model:', error);
            container.innerHTML = '<div style="color:red; padding: 2rem;">Error loading model. Check console.</div>';
        }
    );

    // Events
    window.addEventListener('resize', onWindowResize);
    renderer.domElement.addEventListener('mousemove', onMouseMove);
    renderer.domElement.addEventListener('click', onClick);

    setupPanelInteraction();

    animate();
}

function createAnnotations() {
    if (!window.ARTIFACT_DATA || !window.ARTIFACT_DATA.inscriptions) return;
    
    // For each line, parse the 3D surface geometry and create a mesh
    window.ARTIFACT_DATA.inscriptions.forEach(inscr => {
        inscr.lines.forEach(line => {
            if (line.annotation && line.annotation.annotation_method === '3d' && line.annotation.surface_geometry_json) {
                const geomData = JSON.parse(line.annotation.surface_geometry_json);
                if (geomData.rings && geomData.rings.length > 0) {
                    const points = geomData.rings[0].map(pt => new THREE.Vector3(pt[0], pt[1], pt[2]));
                    
                    if (points.length >= 3) {
                        // Close the loop
                        points.push(points[0]);
                        
                        // Create a realistic filled highlight using a triangle fan
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
                            color: 0xffd700, // Warm golden highlight
                            transparent: true,
                            opacity: 0.05, // Very subtle by default
                            side: THREE.DoubleSide,
                            depthTest: false,
                            blending: THREE.AdditiveBlending // Blends naturally with texture
                        });
                        
                        const mesh = new THREE.Mesh(polyGeom, polyMat);
                        mesh.userData = { lineId: line.id };
                        
                        scene.add(mesh);
                        annotationMeshes.push(mesh);
                    }
                }
            }
        });
    });
}

function updateAnnotationVisuals() {
    annotationMeshes.forEach(mesh => {
        const lineId = mesh.userData.lineId;
        if (lineId === selectedLineId) {
            mesh.material.opacity = 0.35;
            mesh.material.color.setHex(0xffaa00); // Amber for selected
        } else if (lineId === hoveredLineId) {
            mesh.material.opacity = 0.20;
            mesh.material.color.setHex(0xffd700); // Gold for hover
        } else {
            mesh.material.opacity = 0.02;
            mesh.material.color.setHex(0xffd700); // Almost invisible default
        }
    });

    // Update panel DOM
    document.querySelectorAll('.transcription-line').forEach(el => {
        el.classList.remove('active');
        if (parseInt(el.dataset.lineId) === selectedLineId) {
            el.classList.add('active');
            // scroll into view
            el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    });
}

function onMouseMove(event) {
    event.preventDefault();
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    if (annotationMeshes.length > 0) {
        const intersects = raycaster.intersectObjects(annotationMeshes);
        if (intersects.length > 0) {
            document.body.style.cursor = 'pointer';
            const newHover = intersects[0].object.userData.lineId;
            if (newHover !== hoveredLineId) {
                hoveredLineId = newHover;
                updateAnnotationVisuals();
            }
            
            const tooltip = document.getElementById('tooltip-3d');
            if (tooltip) {
                tooltip.style.display = 'block';
                tooltip.style.left = (event.clientX - rect.left + 20) + 'px';
                tooltip.style.top = (event.clientY - rect.top + 20) + 'px';
                
                const lineItem = document.querySelector(`.transcription-line[data-line-id="${hoveredLineId}"]`);
                if (lineItem) {
                    const lineNo = lineItem.querySelector('.line-number').textContent;
                    const origText = lineItem.querySelector('.original-text').textContent;
                    let tooltipContent = `<strong style="color:#f1c40f">${lineNo}</strong><br>${origText}`;
                    
                    const translationDiv = lineItem.querySelector('.translation');
                    if (translationDiv) {
                        const clone = translationDiv.cloneNode(true);
                        const span = clone.querySelector('span');
                        if (span) span.remove();
                        const br = clone.querySelector('br');
                        if (br) br.remove();
                        const translationText = clone.textContent.trim();
                        if (translationText) {
                            tooltipContent += `<br><span style="color:#a8e6cf">${translationText}</span>`;
                        }
                    }
                    tooltip.innerHTML = tooltipContent;
                }
            }
        } else {
            document.body.style.cursor = 'default';
            if (hoveredLineId !== null) {
                hoveredLineId = null;
                updateAnnotationVisuals();
            }
            const tooltip = document.getElementById('tooltip-3d');
            if (tooltip) tooltip.style.display = 'none';
        }
    }
}

function onClick(event) {
    if (hoveredLineId !== null) {
        selectedLineId = hoveredLineId;
        updateAnnotationVisuals();
    } else {
        // Deselect if clicking on empty space
        selectedLineId = null;
        updateAnnotationVisuals();
    }
}

function setupPanelInteraction() {
    document.querySelectorAll('.transcription-line').forEach(el => {
        el.addEventListener('click', () => {
            selectedLineId = parseInt(el.dataset.lineId);
            updateAnnotationVisuals();
        });
        
        el.addEventListener('mouseenter', () => {
            hoveredLineId = parseInt(el.dataset.lineId);
            updateAnnotationVisuals();
        });
        
        el.addEventListener('mouseleave', () => {
            hoveredLineId = null;
            updateAnnotationVisuals();
        });
    });
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
