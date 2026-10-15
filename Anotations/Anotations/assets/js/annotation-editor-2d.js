const container = document.getElementById('image-container');
const img = document.getElementById('reference-image');
const svg = document.getElementById('svg-overlay');
const btnDraw = document.getElementById('btn-draw');
const btnUndo = document.getElementById('btn-undo');
const btnClear = document.getElementById('btn-clear');
const btnSave = document.getElementById('btn-save');
const btnExport = document.getElementById('btn-export');
const statusText = document.getElementById('editor-status');

let activeLineId = null;
let isDrawingMode = false;
let points = [];
let annotations2dMap = {};

function init() {
  img.onload = () => {
    updateSvgViewBox();
  };
  if (img.complete) {
    updateSvgViewBox();
  }
  window.addEventListener('resize', updateSvgViewBox);

  setupUI();
}

function updateSvgViewBox() {
  svg.setAttribute('viewBox', `0 0 ${img.naturalWidth || 800} ${img.naturalHeight || 1100}`);
}

function setupUI() {
  document.querySelectorAll('.line-item').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.line-item').forEach(e => e.classList.remove('selected'));
      el.classList.add('selected');
      activeLineId = parseInt(el.dataset.lineId);
      clearPoints();

      if (annotations2dMap[activeLineId] && annotations2dMap[activeLineId].length > 0) {
        points = [...annotations2dMap[activeLineId]];
        renderSvg();
        statusText.textContent = `Loaded existing 2D polygon with ${points.length} vertices.`;
      } else {
        statusText.textContent = "Line selected. Click 'Draw Polygon' to mark points.";
      }
    });
  });

  btnDraw.addEventListener('click', () => {
    if (!activeLineId) {
      alert('Select a line first.');
      return;
    }
    isDrawingMode = !isDrawingMode;
    btnDraw.classList.toggle('active', isDrawingMode);
    container.classList.toggle('drawing', isDrawingMode);
    statusText.textContent = isDrawingMode ? "Click anywhere on the image to add polygon vertices." : "Drawing paused.";
  });

  container.addEventListener('click', (e) => {
    if (!isDrawingMode) return;
    const rect = img.getBoundingClientRect();
    const scaleX = (img.naturalWidth || 800) / rect.width;
    const scaleY = (img.naturalHeight || 1100) / rect.height;

    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);

    points.push({ x, y });
    renderSvg();
    statusText.textContent = `Point #${points.length} added at (${x}, ${y})`;
  });

  btnUndo.addEventListener('click', () => {
    if (points.length > 0) {
      points.pop();
      renderSvg();
      statusText.textContent = `Point removed. Remaining: ${points.length}`;
    }
  });

  btnClear.addEventListener('click', () => {
    clearPoints();
    statusText.textContent = "Cleared 2D points.";
  });

  btnSave.addEventListener('click', () => {
    if (!activeLineId) {
      alert('Select a line first.');
      return;
    }
    if (points.length < 3) {
      alert('Polygon requires at least 3 points.');
      return;
    }
    annotations2dMap[activeLineId] = [...points];
    statusText.textContent = `Saved ${points.length} points to Line ${activeLineId}.`;
  });

  btnExport.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(annotations2dMap, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `annotations_2d_export_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    statusText.textContent = "Exported 2D annotations JSON.";
  });
}

function clearPoints() {
  points = [];
  renderSvg();
}

function renderSvg() {
  svg.innerHTML = '';
  if (points.length === 0) return;

  const ptsStr = points.map(p => `${p.x},${p.y}`).join(' ');
  const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  poly.setAttribute('points', ptsStr);
  poly.setAttribute('class', 'poly-draw');
  svg.appendChild(poly);

  points.forEach(p => {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', p.x);
    circle.setAttribute('cy', p.y);
    circle.setAttribute('class', 'vertex');
    svg.appendChild(circle);
  });
}

init();
