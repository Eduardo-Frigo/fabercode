(function () {
  function createApplicationMapCanvas(container, options = {}) {
    const onNodeSelected = typeof options.onNodeSelected === 'function' ? options.onNodeSelected : () => {};
    const onMapChanged = typeof options.onMapChanged === 'function' ? options.onMapChanged : () => {};
    const onToolChanged = typeof options.onToolChanged === 'function' ? options.onToolChanged : () => {};
    const api = options.api || {};
    const getProjectId = typeof options.getProjectId === 'function' ? options.getProjectId : () => '';
    const getSelectedProjectInfo = typeof options.getSelectedProjectInfo === 'function' ? options.getSelectedProjectInfo : () => null;

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
    let selectedEdgeId = null;
    let selectedNodeIds = new Set();
    let isSpaceHeld = false;

    function getAssetFileUrl(rootPath, assetPath) {
      if (!rootPath || !assetPath) return '';
      let combined = rootPath.replace(/\\/g, '/') + '/' + assetPath.replace(/\\/g, '/');
      combined = combined.replace(/\/+/g, '/');
      if (!combined.startsWith('/')) {
        combined = '/' + combined;
      }
      return `file://${encodeURI(combined).replace(/#/g, '%23')}`;
    }

    function constrainChildNodePosition(node) {
      if (!node.parentId) return;
      const parent = nodes.find(n => n.id === node.parentId);
      if (!parent) return;
      const parentHeight = parent.size ? parent.size.height : 240;
      const minDistance = 100;
      const minRawY = parent.position.y + parentHeight + minDistance;
      if (node.position.y < minRawY) {
        node.position.y = minRawY;
      }
    }

    let isConnecting = false;
    let connectionStartNodeId = null;
    let connectionStartPort = null;
    let tempEdgeLine = null;

    let currentTool = 'select'; // select, add-group, add-card, add-image, add-decision, connect

    // Pan & Zoom handlers
    let isSelecting = false;
    let selectStart = { x: 0, y: 0 };
    let marqueeEl = null;

    function getNodeBounds(node) {
      const nodeEl = stage.querySelector(`.map-node#${node.id}`);
      const width = nodeEl ? nodeEl.offsetWidth : (node.type === 'group' ? (node.size ? node.size.width : 320) : 220);
      const height = nodeEl ? nodeEl.offsetHeight : (node.type === 'group' ? (node.size ? node.size.height : 240) : 120);
      return {
        x1: node.position.x,
        y1: node.position.y,
        x2: node.position.x + width,
        y2: node.position.y + height
      };
    }

    stage.addEventListener('mousedown', (e) => {
      if (e.target === stage || e.target.id === 'application-map-canvas-grid' || e.target.tagName === 'svg') {
        if (currentTool === 'connect') {
          cancelConnection();
          clearConnectionSource();
          setTool('select');
          return;
        }

        if (currentTool === 'hand' || isSpaceHeld) {
          isPanning = true;
          panStart = { x: e.clientX - panOffset.x, y: e.clientY - panOffset.y };
          stage.style.cursor = 'grabbing';
        } else {
          isSelecting = true;
          const rect = stage.getBoundingClientRect();
          selectStart = {
            x: (e.clientX - rect.left - panOffset.x) / zoomLevel,
            y: (e.clientY - rect.top - panOffset.y) / zoomLevel
          };

          marqueeEl = document.createElement('div');
          marqueeEl.className = 'map-selection-marquee';
          marqueeEl.style.left = `${selectStart.x}px`;
          marqueeEl.style.top = `${selectStart.y}px`;
          marqueeEl.style.width = '0px';
          marqueeEl.style.height = '0px';
          content.appendChild(marqueeEl);

          if (!e.shiftKey) {
            selectedNodeIds.clear();
            selectedNodeId = null;
            stage.querySelectorAll('.map-node').forEach((n) => n.classList.remove('selected'));
            onNodeSelected(null);
          }
          selectedEdgeId = null;
          drawEdges();
        }
      }
    });

    // Drag & drop file upload on stage
    stage.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });

    stage.addEventListener('drop', (e) => {
      e.preventDefault();
      const files = e.dataTransfer.files;
      if (!files || files.length === 0) return;

      const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
      if (imageFiles.length === 0) return;

      const rootInfo = getSelectedProjectInfo();
      if (!rootInfo || !rootInfo.rootPath) {
        alert('Selecione um projeto antes de fazer upload de imagens.');
        return;
      }

      const clientX = e.clientX;
      const clientY = e.clientY;
      
      imageFiles.forEach((file, index) => {
        const reader = new FileReader();
        reader.onload = async (event) => {
          const base64Data = event.target.result;
          const result = await api.importApplicationMapAsset({
            rootPath: rootInfo.rootPath,
            base64Data,
            fileName: file.name,
            kind: 'references'
          });

          if (result && result.ok && result.asset) {
            const canvasX = (clientX - panOffset.x) / zoomLevel + (index * 20);
            const canvasY = (clientY - panOffset.y) / zoomLevel + (index * 20);

            const node = {
              id: 'node-' + Date.now() + '-' + index,
              type: 'image',
              title: file.name,
              description: '',
              content: result.asset.projectRelativePath,
              assetId: result.asset.projectRelativePath,
              position: { x: canvasX, y: canvasY },
              size: { width: 220, height: 120 },
              tags: []
            };

            nodes.push(node);
            renderAllNodes();
            selectNode(node.id, false);
            onMapChanged();
          } else {
            alert('Falha ao importar imagem via drag & drop: ' + (result.message || 'Erro desconhecido.'));
          }
        };
        reader.readAsDataURL(file);
      });
    });

    window.addEventListener('mousemove', (e) => {
      if (isPanning) {
        panOffset.x = e.clientX - panStart.x;
        panOffset.y = e.clientY - panStart.y;
        updateTransform();
      }
      if (isSelecting && marqueeEl) {
        const rect = stage.getBoundingClientRect();
        const currentX = (e.clientX - rect.left - panOffset.x) / zoomLevel;
        const currentY = (e.clientY - rect.top - panOffset.y) / zoomLevel;

        const x = Math.min(selectStart.x, currentX);
        const y = Math.min(selectStart.y, currentY);
        const w = Math.abs(selectStart.x - currentX);
        const h = Math.abs(selectStart.y - currentY);

        marqueeEl.style.left = `${x}px`;
        marqueeEl.style.top = `${y}px`;
        marqueeEl.style.width = `${w}px`;
        marqueeEl.style.height = `${h}px`;

        nodes.forEach((node) => {
          const bounds = getNodeBounds(node);
          const intersects = !(bounds.x1 > x + w || bounds.x2 < x || bounds.y1 > y + h || bounds.y2 < y);
          const nodeEl = stage.querySelector(`.map-node#${node.id}`);
          if (nodeEl) {
            if (intersects) {
              nodeEl.classList.add('selected');
              selectedNodeIds.add(node.id);
            } else {
              if (!e.shiftKey) {
                nodeEl.classList.remove('selected');
                selectedNodeIds.delete(node.id);
              }
            }
          }
        });
      }
      if (isConnecting && tempEdgeLine) {
        updateTempConnectionLine(e.clientX, e.clientY);
      }
    });

    window.addEventListener('mouseup', () => {
      if (isPanning) {
        isPanning = false;
        stage.style.cursor = currentTool === 'hand' ? 'grab' : 'default';
        onMapChanged();
      }
      if (isSelecting) {
        isSelecting = false;
        if (marqueeEl) {
          marqueeEl.remove();
          marqueeEl = null;
        }
        if (selectedNodeIds.size > 0) {
          const firstId = Array.from(selectedNodeIds)[0];
          selectedNodeId = firstId;
          const node = nodes.find(n => n.id === firstId);
          onNodeSelected(node, false);
        } else {
          selectedNodeId = null;
          onNodeSelected(null);
        }
        onMapChanged();
      }
    });

    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      
      // Touchpad pinch-zoom (ctrlKey) OR Alt/Option + scroll (altKey)
      if (e.ctrlKey || e.altKey) {
        const scale = 0.005;
        const zoomFactor = 1 - e.deltaY * scale;
        const clampedFactor = Math.max(0.9, Math.min(1.1, zoomFactor));
        zoomLevel = Math.max(0.3, Math.min(2.0, zoomLevel * clampedFactor));
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
      } else {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA' || document.activeElement.isContentEditable)) {
            return;
          }
          e.preventDefault();
          if (selectedNodeIds.size > 0 || selectedNodeId) {
            deleteSelectedNode();
          } else if (selectedEdgeId) {
            deleteSelectedEdge();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    window.addEventListener('keydown', (e) => {
      if (e.key === ' ' && !isSpaceHeld) {
        if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA' || document.activeElement.isContentEditable)) {
          return;
        }
        isSpaceHeld = true;
        stage.style.cursor = 'grab';
        e.preventDefault();
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.key === ' ') {
        isSpaceHeld = false;
        stage.style.cursor = currentTool === 'hand' ? 'grab' : 'default';
      }
    });

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
        tags: [],
        collapsed: type === 'group' ? true : undefined
      };

      nodes.push(node);
      renderAllNodes();
      selectNode(node.id);
      onMapChanged();
    }

    function addNodeAtCenter(type) {
      const rect = stage.getBoundingClientRect();
      const x = rect.width / 2;
      const y = rect.height / 2;
      addNodeAt(x, y, type);
    }

    function getPlaceholderTitle(type) {
      if (type === 'group') return 'Novo Grupo';
      if (type === 'decision') return 'Nova Decisão';
      if (type === 'image') return 'Nova Referência Visual';
      return 'Nota de Texto';
    }

    function renderAllNodes() {
      // Keep track of selected node
      const currentSelectedId = selectedNodeId;
      
      // Constrain all child node positions before rendering
      nodes.forEach(constrainChildNodePosition);

      // Clear all existing map-node DOM elements
      content.querySelectorAll('.map-node').forEach(el => el.remove());

      const isNodeVisible = (node) => {
        if (!node.parentId) return true;
        const parent = nodes.find(n => n.id === node.parentId);
        if (!parent) return true;
        if (parent.collapsed) return false;
        return isNodeVisible(parent);
      };

      nodes.forEach(node => {
        if (isNodeVisible(node)) {
          renderNode(node);
        }
      });

      // Restore selection styling
      selectedNodeIds.forEach((id) => {
        const selectedEl = content.querySelector(`.map-node#${id}`);
        if (selectedEl) selectedEl.classList.add('selected');
      });

      drawEdges();
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
        if (node.collapsed) {
          el.classList.add('collapsed');
        }
      }

      if (node.parentId) {
        el.classList.add('inside-group');
      }

      if (node.type === 'image' && (node.assetId || node.content)) {
        el.classList.add('has-image');
      }

      // Group cover banner preview
      if (node.type === 'group' && node.assetId) {
        const coverPreview = document.createElement('div');
        coverPreview.className = 'map-node-cover-preview';
        const img = document.createElement('img');
        img.draggable = false;
        const pathVal = node.assetId;
        const rootInfo = getSelectedProjectInfo();
        img.src = (pathVal.startsWith('Map assets') && rootInfo && rootInfo.rootPath)
          ? getAssetFileUrl(rootInfo.rootPath, pathVal)
          : pathVal;
        coverPreview.appendChild(img);
        el.insertBefore(coverPreview, el.firstChild);
      }

      // Title
      const header = document.createElement('div');
      header.className = 'map-node-header';
      const typeBadge = document.createElement('span');
      typeBadge.className = 'map-node-type';
      typeBadge.textContent = node.type + (node.type === 'group' ? (node.collapsed ? ' (fechado)' : ' (aberto)') : '');
      header.appendChild(typeBadge);

      // Pencil edit button
      const editBtn = document.createElement('button');
      editBtn.className = 'map-node-edit-btn';
      editBtn.title = 'Editar';
      editBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
      editBtn.addEventListener('mousedown', (e) => {
        e.stopPropagation();
      });
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        selectNode(node.id, true);
      });
      el.appendChild(editBtn);

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
        img.draggable = false;
        const pathVal = node.assetId || node.content;
        const rootInfo = getSelectedProjectInfo();
        img.src = (pathVal.startsWith('Map assets') && rootInfo && rootInfo.rootPath)
          ? getAssetFileUrl(rootInfo.rootPath, pathVal)
          : pathVal;
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
      let hasDragged = false;
      el.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('map-node-port')) return; // Ports handle connection
        if (e.target.closest('.map-node-edit-btn')) return; // Edit button handles click
        e.stopPropagation();

        if (currentTool === 'connect') {
          handleConnectToolClick(node.id);
          return;
        }

        selectedEdgeId = null;
        drawEdges();
        selectNode(node.id, false, e);
        if (currentTool === 'connect') return;

        dragStart = { x: e.clientX, y: e.clientY };
        hasDragged = false;

        const handleMouseMove = (mvEvent) => {
          const dx = (mvEvent.clientX - dragStart.x) / zoomLevel;
          const dy = (mvEvent.clientY - dragStart.y) / zoomLevel;
          
          if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
            hasDragged = true;
          }

          if (selectedNodeIds.has(node.id)) {
            selectedNodeIds.forEach((id) => {
              const n = nodes.find((item) => item.id === id);
              if (n) {
                n.position.x += dx;
                n.position.y += dy;
                if (n.type !== 'group' && n.parentId) {
                  constrainChildNodePosition(n);
                }
                const nodeEl = content.querySelector(`.map-node#${n.id}`);
                if (nodeEl) {
                  nodeEl.style.left = `${n.position.x}px`;
                  nodeEl.style.top = `${n.position.y}px`;
                }
              }
            });
          } else {
            node.position.x += dx;
            node.position.y += dy;
            if (node.type !== 'group' && node.parentId) {
              constrainChildNodePosition(node);
            }
            el.style.left = `${node.position.x}px`;
            el.style.top = `${node.position.y}px`;
          }

          // Drag children together if this is a group
          if (node.type === 'group') {
            const children = nodes.filter((n) => n.parentId === node.id);
            children.forEach((child) => {
              if (!selectedNodeIds.has(child.id)) {
                child.position.x += dx;
                child.position.y += dy;
                const childEl = content.querySelector(`.map-node#${child.id}`);
                if (childEl) {
                  childEl.style.left = `${child.position.x}px`;
                  childEl.style.top = `${child.position.y}px`;
                }
              }
            });
          } else {
            // Drag-over highlights for parent groups
            const nodeWidth = el.offsetWidth || 220;
            const nodeHeight = el.offsetHeight || 120;
            const nodeCenterX = node.position.x + nodeWidth / 2;
            const nodeCenterY = node.position.y + nodeHeight / 2;

            nodes.forEach(otherNode => {
              if (otherNode.type === 'group' && otherNode.id !== node.id) {
                const groupEl = content.querySelector(`.map-node#${otherNode.id}`);
                if (groupEl) {
                  const groupWidth = groupEl.offsetWidth || 320;
                  const groupHeight = groupEl.offsetHeight || 240;
                  const withinX = nodeCenterX >= otherNode.position.x && nodeCenterX <= (otherNode.position.x + groupWidth);
                  const withinY = nodeCenterY >= otherNode.position.y && nodeCenterY <= (otherNode.position.y + groupHeight);
                  groupEl.classList.toggle('drag-over', withinX && withinY);
                }
              }
            });
          }

          dragStart = { x: mvEvent.clientX, y: mvEvent.clientY };
          drawEdges();
        };

        const handleMouseUp = () => {
          window.removeEventListener('mousemove', handleMouseMove);
          window.removeEventListener('mouseup', handleMouseUp);

          // Clear any drag-over highlights
          content.querySelectorAll('.map-node.node-group').forEach(groupEl => {
            groupEl.classList.remove('drag-over');
          });

          if (!hasDragged) {
            // It's a simple click!
            if (node.type === 'group') {
              node.collapsed = !node.collapsed;
              renderAllNodes();
              onMapChanged();
            }
            return;
          }

          // If this is not a group, check if it was dropped inside a group card
          if (node.type !== 'group') {
            const nodeWidth = el.offsetWidth || 220;
            const nodeHeight = el.offsetHeight || 120;
            const nodeCenterX = node.position.x + nodeWidth / 2;
            const nodeCenterY = node.position.y + nodeHeight / 2;

            let newParentId = node.parentId;
            
            // Check if dropped directly on any group card
            let droppedOnGroupId = null;
            for (const otherNode of nodes) {
              if (otherNode.type === 'group' && otherNode.id !== node.id) {
                const groupEl = content.querySelector(`.map-node#${otherNode.id}`);
                const groupWidth = groupEl ? groupEl.offsetWidth : 320;
                const groupHeight = groupEl ? groupEl.offsetHeight : 240;

                const withinX = nodeCenterX >= otherNode.position.x && nodeCenterX <= (otherNode.position.x + groupWidth);
                const withinY = nodeCenterY >= otherNode.position.y && nodeCenterY <= (otherNode.position.y + groupHeight);

                if (withinX && withinY) {
                  droppedOnGroupId = otherNode.id;
                  break;
                }
              }
            }

            if (droppedOnGroupId) {
              newParentId = droppedOnGroupId;
            } else if (node.parentId) {
              // If it was already in a group, check if it was dragged too far away
              const parent = nodes.find(n => n.id === node.parentId);
              if (parent) {
                const groupEl = content.querySelector(`.map-node#${parent.id}`);
                const groupWidth = groupEl ? groupEl.offsetWidth : 320;
                const groupHeight = groupEl ? groupEl.offsetHeight : 240;
                
                const distanceX = Math.abs(nodeCenterX - (parent.position.x + groupWidth / 2));
                const distanceY = node.position.y - (parent.position.y + groupHeight);
                
                // Detach if dragged far away horizontally (more than 1.5x group width) or vertically
                if (distanceX > groupWidth * 1.5 || distanceY < 20 || distanceY > 600) {
                  newParentId = null;
                }
              }
            }

            if (node.parentId !== newParentId) {
              node.parentId = newParentId;
              if (newParentId) {
                constrainChildNodePosition(node);
              }
              renderAllNodes();
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
        
        if (edge.id === selectedEdgeId) {
          path.classList.add('selected');
        }
        
        path.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          selectEdge(edge.id);
        });
        
        edgesSvg.appendChild(path);
      });

      // Draw parent-to-child group connections
      nodes.forEach((node) => {
        if (node.parentId) {
          const parent = nodes.find(n => n.id === node.parentId);
          if (parent && !parent.collapsed) {
            const parentEl = stage.querySelector(`.map-node#${parent.id}`);
            const childEl = stage.querySelector(`.map-node#${node.id}`);
            if (parentEl && childEl) {
              const pRect = parentEl.getBoundingClientRect();
              const cRect = childEl.getBoundingClientRect();

              // Connect from parent's bottom center to child's top center
              const x1 = pRect.left + pRect.width / 2 - rect.left;
              const y1 = pRect.bottom - rect.top;
              const x2 = cRect.left + cRect.width / 2 - rect.left;
              const y2 = cRect.top - rect.top;

              const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
              const pathStr = `M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}`;
              path.setAttribute('d', pathStr);
              path.setAttribute('stroke', '#50c985');
              path.setAttribute('stroke-width', '1.5');
              path.setAttribute('stroke-dasharray', '4 4');
              path.setAttribute('fill', 'none');
              path.style.pointerEvents = 'none';
              edgesSvg.appendChild(path);
            }
          }
        }
      });
    }

    // Node Selection
    function selectNode(id, openEdit = false, event = null) {
      if (!id) {
        selectedNodeIds.clear();
        selectedNodeId = null;
        stage.querySelectorAll('.map-node').forEach((n) => n.classList.remove('selected'));
        onNodeSelected(null, openEdit);
        return;
      }

      const isShift = event && event.shiftKey;

      if (isShift) {
        if (selectedNodeIds.has(id)) {
          selectedNodeIds.delete(id);
          const nodeEl = stage.querySelector(`.map-node#${id}`);
          if (nodeEl) nodeEl.classList.remove('selected');
        } else {
          selectedNodeIds.add(id);
          const nodeEl = stage.querySelector(`.map-node#${id}`);
          if (nodeEl) nodeEl.classList.add('selected');
        }

        if (selectedNodeIds.size > 0) {
          selectedNodeId = Array.from(selectedNodeIds)[0];
          const node = nodes.find((n) => n.id === selectedNodeId);
          onNodeSelected(node, openEdit);
        } else {
          selectedNodeId = null;
          onNodeSelected(null, openEdit);
        }
      } else {
        if (!selectedNodeIds.has(id)) {
          selectedNodeIds.clear();
          selectedNodeIds.add(id);
        }
        selectedNodeId = id;
        stage.querySelectorAll('.map-node').forEach((n) => {
          n.classList.toggle('selected', selectedNodeIds.has(n.id));
        });
        const node = nodes.find((n) => n.id === id);
        onNodeSelected(node, openEdit);
      }
    }

    function getSelectedNode() {
      return nodes.find((n) => n.id === selectedNodeId);
    }

    function deleteSelectedNode() {
      if (selectedNodeIds.size > 1) {
        selectedNodeIds.forEach((id) => {
          nodes.forEach((n) => {
            if (n.parentId === id) {
              n.parentId = null;
            }
          });
          nodes = nodes.filter((n) => n.id !== id);
          edges = edges.filter((e) => e.sourceNodeId !== id && e.targetNodeId !== id);
          const el = stage.querySelector(`.map-node#${id}`);
          if (el) el.remove();
        });
        selectedNodeIds.clear();
        selectedNodeId = null;
        renderAllNodes();
        onNodeSelected(null);
        onMapChanged();
      } else {
        if (!selectedNodeId) return;

        nodes.forEach((n) => {
          if (n.parentId === selectedNodeId) {
            n.parentId = null;
          }
        });

        nodes = nodes.filter((n) => n.id !== selectedNodeId);
        edges = edges.filter((e) => e.sourceNodeId !== selectedNodeId && e.targetNodeId !== selectedNodeId);
        const el = stage.querySelector(`.map-node#${selectedNodeId}`);
        if (el) el.remove();
        selectedNodeIds.delete(selectedNodeId);
        selectedNodeId = null;
        renderAllNodes();
        onNodeSelected(null);
        onMapChanged();
      }
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

        if (node.type === 'image' && (node.assetId || node.content)) {
          el.classList.add('has-image');
        }

        if (node.type === 'group' && node.assetId) {
          const coverPreview = document.createElement('div');
          coverPreview.className = 'map-node-cover-preview';
          const img = document.createElement('img');
          img.draggable = false;
          const pathVal = node.assetId;
          const rootInfo = getSelectedProjectInfo();
          img.src = (pathVal.startsWith('Map assets') && rootInfo && rootInfo.rootPath)
            ? getAssetFileUrl(rootInfo.rootPath, pathVal)
            : pathVal;
          coverPreview.appendChild(img);
          el.insertBefore(coverPreview, el.firstChild);
        }

        if (node.type === 'image' && (node.assetId || node.content)) {
          const preview = document.createElement('div');
          preview.className = 'map-node-media-preview';
          const img = document.createElement('img');
          img.draggable = false;
          const pathVal = node.assetId || node.content;
          const rootInfo = getSelectedProjectInfo();
          img.src = (pathVal.startsWith('Map assets') && rootInfo && rootInfo.rootPath)
            ? getAssetFileUrl(rootInfo.rootPath, pathVal)
            : pathVal;
          preview.appendChild(img);
          el.appendChild(preview);
        }
      }
      onMapChanged();
    }

    let contextMenuEl = null;

    function showContextMenu(clientX, clientY) {
      if (contextMenuEl) {
        contextMenuEl.remove();
      }

      contextMenuEl = document.createElement('div');
      contextMenuEl.className = 'map-context-menu';
      contextMenuEl.style.left = `${clientX}px`;
      contextMenuEl.style.top = `${clientY}px`;

      const options = [
        {
          label: 'Adicionar Grupo',
          svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`,
          action: () => addNodeAtMouse(clientX, clientY, 'group')
        },
        {
          label: 'Adicionar Card de Texto',
          svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>`,
          action: () => addNodeAtMouse(clientX, clientY, 'text')
        },
        {
          label: 'Adicionar Referência Visual',
          svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`,
          action: () => addNodeAtMouse(clientX, clientY, 'image')
        },
        {
          label: 'Adicionar Decisão',
          svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A5 5 0 0 0 8 8c0 1 .3 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>`,
          action: () => addNodeAtMouse(clientX, clientY, 'decision')
        }
      ];

      options.forEach(opt => {
        const item = document.createElement('button');
        item.className = 'context-menu-item';
        item.innerHTML = `<span class="context-menu-icon-wrapper">${opt.svg}</span> ${opt.label}`;
        item.addEventListener('click', () => {
          opt.action();
          contextMenuEl.remove();
          contextMenuEl = null;
        });
        contextMenuEl.appendChild(item);
      });

      document.body.appendChild(contextMenuEl);

      const closeMenu = () => {
        if (contextMenuEl) {
          contextMenuEl.remove();
          contextMenuEl = null;
        }
        document.removeEventListener('click', closeMenu);
      };
      setTimeout(() => {
        document.addEventListener('click', closeMenu);
      }, 50);
    }

    function addNodeAtMouse(clientX, clientY, type) {
      const rect = stage.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      addNodeAt(x, y, type);
    }

    // Context menu listener
    stage.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.map-node')) return;
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY);
    });

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
      nodes = mapData.nodes || [];
      edges = mapData.edges || [];
      panOffset = mapData.viewport || { x: 0, y: 0 };
      zoomLevel = mapData.zoom || 1.0;
      
      renderAllNodes();
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

    let clickConnectSourceId = null;

    function handleConnectToolClick(nodeId) {
      if (!clickConnectSourceId) {
        clickConnectSourceId = nodeId;
        const nodeEl = content.querySelector(`.map-node#${nodeId}`);
        if (nodeEl) {
          nodeEl.classList.add('connection-source');
        }
      } else {
        if (clickConnectSourceId === nodeId) {
          clearConnectionSource();
        } else {
          const edge = {
            id: 'edge-' + Date.now(),
            sourceNodeId: clickConnectSourceId,
            sourcePort: 'right',
            targetNodeId: nodeId,
            targetPort: 'left',
            type: 'depends_on',
            label: ''
          };
          edges.push(edge);
          drawEdges();
          onMapChanged();
          setTool('select');
        }
      }
    }

    function clearConnectionSource() {
      if (clickConnectSourceId) {
        const nodeEl = content.querySelector(`.map-node#${clickConnectSourceId}`);
        if (nodeEl) {
          nodeEl.classList.remove('connection-source');
        }
        clickConnectSourceId = null;
      }
    }

    function setTool(tool) {
      currentTool = tool;
      if (tool !== 'connect') {
        clearConnectionSource();
      }
      stage.style.cursor = tool === 'hand' ? 'grab' : 'default';
      onToolChanged(tool);
    }

    async function clearMap() {
      if (await window.faberConfirm('Deseja limpar todo o mapa da aplicação?')) {
        nodes = [];
        edges = [];
        content.innerHTML = '';
        drawEdges();
        onNodeSelected(null);
        onMapChanged();
      }
    }

    function selectEdge(id) {
      selectedEdgeId = id;
      selectedNodeId = null;
      stage.querySelectorAll('.map-node').forEach((n) => {
        n.classList.remove('selected');
      });
      onNodeSelected(null);
      drawEdges();
    }

    function deleteSelectedEdge() {
      if (!selectedEdgeId) return;
      edges = edges.filter((e) => e.id !== selectedEdgeId);
      selectedEdgeId = null;
      drawEdges();
      onMapChanged();
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
      drawEdges,
      addNodeAtCenter,
      renderAllNodes
    };
  }

  window.FaberApplicationMapCanvas = {
    createApplicationMapCanvas
  };
})();
