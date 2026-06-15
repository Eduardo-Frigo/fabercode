(function () {
  function createApplicationMapCanvas(container, options = {}) {
    const onNodeSelected = typeof options.onNodeSelected === 'function' ? options.onNodeSelected : () => {};
    const onMapChanged = typeof options.onMapChanged === 'function' ? options.onMapChanged : () => {};
    const api = options.api || {};
    const getProjectId = typeof options.getProjectId === 'function' ? options.getProjectId : () => '';

    const stage = container.querySelector('#application-map-canvas-stage');
    const content = container.querySelector('#application-map-canvas-content');
    const edgesSvg = container.querySelector('#application-map-canvas-edges');
    const zoomSlider = container.querySelector('#map-zoom-slider');
    const zoomValueEl = container.querySelector('#map-zoom-value');

    let isPanning = false;
    let panStart = { x: 0, y: 0 };
    let panOffset = { x: 0, y: 0 };
    let zoomLevel = 1.0;

    let nodes = [];
    let edges = [];
    let selectedNodeId = null;

    let isConnecting = false;
    let connectionStartNodeId = null;
    let connectionStartPort = null;
    let tempEdgeLine = null;

    let currentTool = 'select'; // select, add-group, add-card, add-image, add-decision, connect

    // Pan & Zoom handlers
    stage.addEventListener('mousedown', (e) => {
      // If we clicked directly on the stage or grid (not on a card/port), initiate pan
      if (e.target === stage || e.target.id === 'application-map-canvas-grid' || e.target.tagName === 'svg') {
        if (currentTool === 'connect') {
          cancelConnection();
          return;
        }
        isPanning = true;
        panStart = { x: e.clientX - panOffset.x, y: e.clientY - panOffset.y };
        stage.style.cursor = 'grabbing';
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (isPanning) {
        panOffset.x = e.clientX - panStart.x;
        panOffset.y = e.clientY - panStart.y;
        updateTransform();
      }
      if (isConnecting && tempEdgeLine) {
        updateTempConnectionLine(e.clientX, e.clientY);
      }
    });

    window.addEventListener('mouseup', () => {
      if (isPanning) {
        isPanning = false;
        stage.style.cursor = 'grab';
        onMapChanged();
      }
    });

    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      
      // Touchpad pinch-zoom (ctrlKey) OR Alt/Option + scroll (altKey)
      if (e.ctrlKey || e.altKey) {
        const zoomFactor = 1.08;
        if (e.deltaY < 0) {
          zoomLevel = Math.min(2.0, zoomLevel * zoomFactor);
        } else {
          zoomLevel = Math.max(0.3, zoomLevel / zoomFactor);
        }
        if (zoomSlider) zoomSlider.value = zoomLevel;
        if (zoomValueEl) zoomValueEl.textContent = `${Math.round(zoomLevel * 100)}%`;
        updateTransform();
      } else {
        // Normal scroll = pan (Illustrator style)
        // Shift + scroll pans horizontally
        if (e.shiftKey) {
          panOffset.x -= e.deltaY;
        } else {
          panOffset.y -= e.deltaY;
          panOffset.x -= e.deltaX;
        }
        updateTransform();
      }
    });

    const handleKeyDown = (e) => {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      if (isCmdOrCtrl) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault();
          zoomLevel = Math.min(2.0, zoomLevel * 1.1);
          if (zoomSlider) zoomSlider.value = zoomLevel;
          if (zoomValueEl) zoomValueEl.textContent = `${Math.round(zoomLevel * 100)}%`;
          updateTransform();
          onMapChanged();
        } else if (e.key === '-') {
          e.preventDefault();
          zoomLevel = Math.max(0.3, zoomLevel / 1.1);
          if (zoomSlider) zoomSlider.value = zoomLevel;
          if (zoomValueEl) zoomValueEl.textContent = `${Math.round(zoomLevel * 100)}%`;
          updateTransform();
          onMapChanged();
        } else if (e.key === '0') {
          e.preventDefault();
          resetZoom();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    if (zoomSlider) {
      zoomSlider.addEventListener('input', () => {
        zoomLevel = parseFloat(zoomSlider.value);
        if (zoomValueEl) zoomValueEl.textContent = `${Math.round(zoomLevel * 100)}%`;
        updateTransform();
      });
    }

    function updateTransform() {
      content.style.transform = `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomLevel})`;
      drawEdges();
    }

    function resetZoom() {
      zoomLevel = 1.0;
      panOffset = { x: 0, y: 0 };
      if (zoomSlider) zoomSlider.value = 1.0;
      if (zoomValueEl) zoomValueEl.textContent = '100%';
      updateTransform();
      onMapChanged();
    }

    // Node placement and CRUD helper
    function addNodeAt(x, y, type) {
      // Calculate coordinates on the infinite canvas stage
      const canvasX = (x - panOffset.x) / zoomLevel;
      const canvasY = (y - panOffset.y) / zoomLevel;

      const node = {
        id: 'node-' + Date.now(),
        type: type,
        title: getPlaceholderTitle(type),
        description: '',
        content: '',
        position: { x: canvasX, y: canvasY },
        size: type === 'group' ? { width: 320, height: 240 } : { width: 220, height: 120 },
        tags: []
      };

      nodes.push(node);
      renderNode(node);
      selectNode(node.id);
      onMapChanged();
    }

    function getPlaceholderTitle(type) {
      if (type === 'group') return 'Novo Grupo';
      if (type === 'decision') return 'Nova Decisão';
      if (type === 'image') return 'Nova Referência Visual';
      return 'Nota de Texto';
    }

    function renderNode(node) {
      const el = document.createElement('div');
      el.className = `map-node node-${node.type}`;
      el.id = node.id;
      el.style.left = `${node.position.x}px`;
      el.style.top = `${node.position.y}px`;
      if (node.type === 'group') {
        el.style.width = `${node.size.width}px`;
        el.style.height = `${node.size.height}px`;
      }

      if (node.parentId) {
        el.classList.add('inside-group');
      }

      // Group cover banner preview
      if (node.type === 'group' && node.assetId) {
        const coverPreview = document.createElement('div');
        coverPreview.className = 'map-node-cover-preview';
        const img = document.createElement('img');
        const pathVal = node.assetId;
        const rootInfo = api.getSelectedProjectInfo ? api.getSelectedProjectInfo() : null;
        img.src = (pathVal.startsWith('Map assets') && rootInfo && rootInfo.rootPath)
          ? `file://${path.join(rootInfo.rootPath, pathVal)}`
          : pathVal;
        coverPreview.appendChild(img);
        el.appendChild(coverPreview);
      }

      // Title
      const header = document.createElement('div');
      header.className = 'map-node-header';
      const typeBadge = document.createElement('span');
      typeBadge.className = 'map-node-type';
      typeBadge.textContent = node.type;
      header.appendChild(typeBadge);
      el.appendChild(header);

      const titleEl = document.createElement('h3');
      titleEl.className = 'map-node-title';
      titleEl.textContent = node.title;
      el.appendChild(titleEl);

      const descEl = document.createElement('p');
      descEl.className = 'map-node-desc';
      descEl.textContent = node.description || 'Sem descrição.';
      el.appendChild(descEl);

      if (node.type === 'image' && (node.assetId || node.content)) {
        const preview = document.createElement('div');
        preview.className = 'map-node-media-preview';
        const img = document.createElement('img');
        const pathVal = node.assetId || node.content;
        img.src = pathVal.startsWith('Map assets') ? `file://${path.join(api.getSelectedProjectInfo().rootPath, pathVal)}` : pathVal;
        preview.appendChild(img);
        el.appendChild(preview);
      }

      // Add connection ports (left, right, top, bottom)
      const ports = ['left', 'right', 'top', 'bottom'];
      ports.forEach((p) => {
        const portEl = document.createElement('div');
        portEl.className = `map-node-port port-${p}`;
        portEl.dataset.nodeId = node.id;
        portEl.dataset.portName = p;
        portEl.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          startConnection(node.id, p, e);
        });
        portEl.addEventListener('mouseup', (e) => {
          e.stopPropagation();
          endConnection(node.id, p);
        });
        el.appendChild(portEl);
      });

      // Draggable logic
      let dragStart = { x: 0, y: 0 };
      el.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('map-node-port')) return; // Ports handle connection
        e.stopPropagation();
        selectNode(node.id);
        if (currentTool === 'connect') return;

        dragStart = { x: e.clientX, y: e.clientY };

        const handleMouseMove = (mvEvent) => {
          const dx = (mvEvent.clientX - dragStart.x) / zoomLevel;
          const dy = (mvEvent.clientY - dragStart.y) / zoomLevel;
          node.position.x += dx;
          node.position.y += dy;
          el.style.left = `${node.position.x}px`;
          el.style.top = `${node.position.y}px`;

          // Drag children together if this is a group
          if (node.type === 'group') {
            const children = nodes.filter((n) => n.parentId === node.id);
            children.forEach((child) => {
              child.position.x += dx;
              child.position.y += dy;
              const childEl = content.querySelector(`.map-node#${child.id}`);
              if (childEl) {
                childEl.style.left = `${child.position.x}px`;
                childEl.style.top = `${child.position.y}px`;
              }
            });
          }

          dragStart = { x: mvEvent.clientX, y: mvEvent.clientY };
          drawEdges();
        };

        const handleMouseUp = () => {
          window.removeEventListener('mousemove', handleMouseMove);
          window.removeEventListener('mouseup', handleMouseUp);

          // If this is not a group, check if it was dropped inside a group card
          if (node.type !== 'group') {
            const nodeWidth = el.offsetWidth || 220;
            const nodeHeight = el.offsetHeight || 120;
            const nodeCenterX = node.position.x + nodeWidth / 2;
            const nodeCenterY = node.position.y + nodeHeight / 2;

            let newParentId = null;
            for (const otherNode of nodes) {
              if (otherNode.type === 'group' && otherNode.id !== node.id) {
                const groupEl = content.querySelector(`.map-node#${otherNode.id}`);
                const groupWidth = groupEl ? groupEl.offsetWidth : 320;
                const groupHeight = groupEl ? groupEl.offsetHeight : 240;

                const withinX = nodeCenterX >= otherNode.position.x && nodeCenterX <= (otherNode.position.x + groupWidth);
                const withinY = nodeCenterY >= otherNode.position.y && nodeCenterY <= (otherNode.position.y + groupHeight);

                if (withinX && withinY) {
                  newParentId = otherNode.id;
                  break;
                }
              }
            }

            if (node.parentId !== newParentId) {
              node.parentId = newParentId;
              if (newParentId) {
                el.classList.add('inside-group');
              } else {
                el.classList.remove('inside-group');
              }
            }
          }

          onMapChanged();
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
      });

      content.appendChild(el);
    }

    // Connection flow
    function startConnection(nodeId, port, e) {
      isConnecting = true;
      connectionStartNodeId = nodeId;
      connectionStartPort = port;
      
      const rect = stage.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      tempEdgeLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      tempEdgeLine.setAttribute('stroke', '#50c985');
      tempEdgeLine.setAttribute('stroke-width', '2');
      tempEdgeLine.setAttribute('stroke-dasharray', '4');
      edgesSvg.appendChild(tempEdgeLine);
    }

    function updateTempConnectionLine(clientX, clientY) {
      const rect = stage.getBoundingClientRect();
      const endX = clientX - rect.left;
      const endY = clientY - rect.top;

      // Find start port center
      const startPortEl = stage.querySelector(`.map-node#${connectionStartNodeId} .port-${connectionStartPort}`);
      const pRect = startPortEl.getBoundingClientRect();
      const startX = pRect.left + pRect.width / 2 - rect.left;
      const startY = pRect.top + pRect.height / 2 - rect.top;

      const pathStr = `M ${startX} ${startY} C ${(startX + endX) / 2} ${startY}, ${(startX + endX) / 2} ${endY}, ${endX} ${endY}`;
      tempEdgeLine.setAttribute('d', pathStr);
    }

    function endConnection(targetNodeId, targetPort) {
      if (!isConnecting) return;
      if (targetNodeId !== connectionStartNodeId) {
        const edge = {
          id: 'edge-' + Date.now(),
          sourceNodeId: connectionStartNodeId,
          sourcePort: connectionStartPort,
          targetNodeId: targetNodeId,
          targetPort: targetPort,
          type: 'depends_on',
          label: ''
        };
        edges.push(edge);
        drawEdges();
        onMapChanged();
      }
      cancelConnection();
    }

    function cancelConnection() {
      isConnecting = false;
      if (tempEdgeLine) {
        tempEdgeLine.remove();
        tempEdgeLine = null;
      }
      connectionStartNodeId = null;
      connectionStartPort = null;
    }

    // Draw lines
    function drawEdges() {
      edgesSvg.innerHTML = '';
      const rect = stage.getBoundingClientRect();

      edges.forEach((edge) => {
        const srcPortEl = stage.querySelector(`.map-node#${edge.sourceNodeId} .port-${edge.sourcePort}`);
        const destPortEl = stage.querySelector(`.map-node#${edge.targetNodeId} .port-${edge.targetPort}`);
        if (!srcPortEl || !destPortEl) return;

        const srcRect = srcPortEl.getBoundingClientRect();
        const destRect = destPortEl.getBoundingClientRect();

        const x1 = srcRect.left + srcRect.width / 2 - rect.left;
        const y1 = srcRect.top + srcRect.height / 2 - rect.top;
        const x2 = destRect.left + destRect.width / 2 - rect.left;
        const y2 = destRect.top + destRect.height / 2 - rect.top;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const pathStr = `M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`;
        path.setAttribute('d', pathStr);
        path.dataset.edgeId = edge.id;
        edgesSvg.appendChild(path);
      });
    }

    // Node Selection
    function selectNode(id) {
      selectedNodeId = id;
      stage.querySelectorAll('.map-node').forEach((n) => {
        n.classList.toggle('selected', n.id === id);
      });
      const node = nodes.find((n) => n.id === id);
      onNodeSelected(node);
    }

    function getSelectedNode() {
      return nodes.find((n) => n.id === selectedNodeId);
    }

    function deleteSelectedNode() {
      if (!selectedNodeId) return;
      nodes = nodes.filter((n) => n.id !== selectedNodeId);
      edges = edges.filter((e) => e.sourceNodeId !== selectedNodeId && e.targetNodeId !== selectedNodeId);
      const el = stage.querySelector(`.map-node#${selectedNodeId}`);
      if (el) el.remove();
      selectedNodeId = null;
      drawEdges();
      onNodeSelected(null);
      onMapChanged();
    }

    function updateSelectedNode(updatedData) {
      const node = getSelectedNode();
      if (!node) return;
      Object.assign(node, updatedData);
      
      const el = stage.querySelector(`.map-node#${node.id}`);
      if (el) {
        el.querySelector('.map-node-title').textContent = node.title;
        el.querySelector('.map-node-desc').textContent = node.description || 'Sem descrição.';
        
        // Remove existing media preview if any
        const prevMedia = el.querySelector('.map-node-media-preview');
        if (prevMedia) prevMedia.remove();

        // Remove existing cover preview if any
        const prevCover = el.querySelector('.map-node-cover-preview');
        if (prevCover) prevCover.remove();

        if (node.type === 'group' && node.assetId) {
          const coverPreview = document.createElement('div');
          coverPreview.className = 'map-node-cover-preview';
          const img = document.createElement('img');
          const pathVal = node.assetId;
          const rootInfo = api.getSelectedProjectInfo ? api.getSelectedProjectInfo() : null;
          img.src = (pathVal.startsWith('Map assets') && rootInfo && rootInfo.rootPath)
            ? `file://${path.join(rootInfo.rootPath, pathVal)}`
            : pathVal;
          coverPreview.appendChild(img);
          el.insertBefore(coverPreview, el.firstChild);
        }

        if (node.type === 'image' && (node.assetId || node.content)) {
          const preview = document.createElement('div');
          preview.className = 'map-node-media-preview';
          const img = document.createElement('img');
          const pathVal = node.assetId || node.content;
          img.src = pathVal.startsWith('Map assets') ? `file://${path.join(api.getSelectedProjectInfo().rootPath, pathVal)}` : pathVal;
          preview.appendChild(img);
          el.appendChild(preview);
        }
      }
      onMapChanged();
    }

    // Double click to create cards
    stage.addEventListener('dblclick', (e) => {
      if (e.target === stage || e.target.id === 'application-map-canvas-grid' || e.target.tagName === 'svg') {
        const rect = stage.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        let type = 'text';
        if (currentTool === 'add-group') type = 'group';
        else if (currentTool === 'add-image') type = 'image';
        else if (currentTool === 'add-decision') type = 'decision';

        addNodeAt(x, y, type);
      }
    });

    function loadMapData(mapData) {
      content.innerHTML = '';
      nodes = mapData.nodes || [];
      edges = mapData.edges || [];
      panOffset = mapData.viewport || { x: 0, y: 0 };
      zoomLevel = mapData.zoom || 1.0;
      
      nodes.forEach(renderNode);
      updateTransform();
    }

    function getMapData() {
      return {
        nodes,
        edges,
        viewport: panOffset,
        zoom: zoomLevel
      };
    }

    function setTool(tool) {
      currentTool = tool;
    }

    function clearMap() {
      if (confirm('Deseja limpar todo o mapa da aplicação?')) {
        nodes = [];
        edges = [];
        content.innerHTML = '';
        drawEdges();
        onNodeSelected(null);
        onMapChanged();
      }
    }

    return {
      loadMapData,
      getMapData,
      setTool,
      clearMap,
      resetZoom,
      getSelectedNode,
      deleteSelectedNode,
      updateSelectedNode,
      drawEdges
    };
  }

  window.FaberApplicationMapCanvas = {
    createApplicationMapCanvas
  };
})();
