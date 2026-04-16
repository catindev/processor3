import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import ReactFlow, {
  applyNodeChanges,
  Background,
  Controls,
  getNodesBounds,
  getViewportForBounds,
  Handle,
  MarkerType,
  Position,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow
} from 'reactflow';

const API = '/api';

function useRoute() {
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
  const params = new URLSearchParams(window.location.search);
  if (pathname === '/flows') return { kind: 'list' };
  const match = pathname.match(/^\/flows\/([^/]+)$/);
  if (match) return { kind: 'graph', flowId: decodeURIComponent(match[1]), version: params.get('version') || '' };
  return { kind: 'unknown' };
}

function nodeClass(kind, selected) {
  const base = kind === 'TERMINAL_COMPLETE'
    ? 'terminal-complete'
    : kind === 'TERMINAL_FAIL'
      ? 'terminal-fail'
      : String(kind || '').toLowerCase();
  return `rfNode ${base}${selected ? ' selected' : ''}`;
}

const StepNode = memo(({ data, selected }) => (
  <div className={nodeClass(data.kind, selected)}>
    <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
    <div className="nodeTitle">{data.label}</div>
    <div className="nodeSubtitle">{data.type}/{data.subtype}</div>
    {data.hiddenFailureCount ? <div className="nodeFailureDots" aria-hidden="true">
      {Array.from({ length: Math.min(data.hiddenFailureCount, 4) }).map((_, index) => <span className="nodeFailureDot" key={index} />)}
      {data.hiddenFailureCount > 4 ? <span className="nodeFailureCount">+{data.hiddenFailureCount - 4}</span> : null}
    </div> : null}
    <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
  </div>
));

const nodeTypes = { step: StepNode };

function edgeStyle(kind) {
  switch (kind) {
    case 'mixed':
      return { stroke: '#64748b', strokeWidth: 2.25, strokeDasharray: '7 5' };
    case 'wait_error':
    case 'effect_error':
      return { stroke: '#dc2626', strokeWidth: 2.25 };
    case 'wait_timeout':
      return { stroke: '#f59e0b', strokeWidth: 2.25 };
    default:
      return { stroke: '#94a3b8', strokeWidth: 2.25 };
  }
}

function InitialFitView({ token }) {
  const { fitView } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const fittedRef = useRef('');
  useEffect(() => {
    if (!token || !nodesInitialized || fittedRef.current === token) return;
    fittedRef.current = token;
    let raf1 = 0;
    let raf2 = 0;
    let timer = 0;
    raf1 = window.requestAnimationFrame(() => {
      fitView({ padding: 0.36, duration: 0, includeHiddenNodes: false, minZoom: 0.2, maxZoom: 1.1 });
      timer = window.setTimeout(() => {
        raf2 = window.requestAnimationFrame(() => {
          fitView({ padding: 0.36, duration: 180, includeHiddenNodes: false, minZoom: 0.2, maxZoom: 1.1 });
        });
      }, 80);
    });
    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
      window.clearTimeout(timer);
    };
  }, [fitView, nodesInitialized, token]);
  return null;
}

function FlowListPage() {
  const [state, setState] = useState({ loading: true, data: [], error: '' });
  useEffect(() => {
    fetch(`${API}/flows`).then(async (r) => {
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error?.message || `HTTP ${r.status}`);
      return data;
    }).then((data) => setState({ loading: false, data: data.flows || [], error: '' }))
      .catch((error) => setState({ loading: false, data: [], error: error.message }));
  }, []);
  return <div className="page listPage">
    <div className="header"><h1>Доступные процессы</h1><p>Выберите flow, чтобы открыть визуальную схему процесса.</p></div>
    {state.loading ? <div className="panel">Загрузка...</div> : null}
    {state.error ? <div className="panel">Ошибка: {state.error}</div> : null}
    {!state.loading && !state.error ? <div className="cards">{state.data.map((flow) => (
      <div className="card" key={`${flow.flowId}@${flow.flowVersion}`}>
        <a className="cardTitle" href={`/flows/${encodeURIComponent(flow.flowId)}?version=${encodeURIComponent(flow.flowVersion)}`}>{flow.name || flow.flowId}</a>
        <div className="meta">{flow.flowId} @ {flow.flowVersion}</div>
        <div className="description">{flow.description || 'Описание не задано.'}</div>
      </div>
    ))}</div> : null}
  </div>;
}

function mapNodes(dataNodes) {
  return (dataNodes || []).map((node) => ({
    id: node.id,
    type: 'step',
    position: node.position,
    data: {
      label: node.label,
      ...node.data
    },
    draggable: true,
    selectable: true,
    selected: false,
    sourcePosition: Position.Right,
    targetPosition: Position.Left
  }));
}

function mapEdges(dataEdges) {
  return (dataEdges || []).map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label || undefined,
    markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
    style: edgeStyle(edge.kind),
    labelStyle: { fill: '#475569', fontSize: 12, fontWeight: 600 },
    labelBgStyle: { fill: '#ffffff', opacity: 0.98 },
    labelBgPadding: [6, 4],
    labelBgBorderRadius: 4,
    type: 'smoothstep',
    pathOptions: { borderRadius: 16, offset: 18 },
    animated: false
  }));
}

function FlowGraphPage({ flowId, version }) {
  const [state, setState] = useState({ loading: true, data: null, error: '' });
  const [selectedId, setSelectedId] = useState('');
  const [nodes, setNodes] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [isExporting, setIsExporting] = useState(false);
  const dragRef = useRef(null);
  const canvasRef = useRef(null);

  function syncNodeSelection(nextSelectedId) {
    setSelectedId(nextSelectedId);
    setNodes((currentNodes) => currentNodes.map((node) => ({
      ...node,
      selected: node.id === nextSelectedId
    })));
  }

  function handleNodesChange(changes) {
    const filtered = changes.filter((change) => change.type !== 'select');
    if (!filtered.length) return;
    setNodes((currentNodes) => applyNodeChanges(filtered, currentNodes));
  }

  useEffect(() => {
    const url = `${API}/flows/${encodeURIComponent(flowId)}${version ? `?version=${encodeURIComponent(version)}` : ''}`;
    fetch(url).then(async (r) => {
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error?.message || `HTTP ${r.status}`);
      return data;
    }).then((data) => {
      setState({ loading: false, data, error: '' });
      const initialSelectedId = data.nodes?.[0]?.id || '';
      setNodes(mapNodes(data.nodes).map((node) => ({
        ...node,
        selected: node.id === initialSelectedId
      })));
      setEdges(mapEdges(data.edges));
      setSelectedId(initialSelectedId);
    }).catch((error) => {
      setState({ loading: false, data: null, error: error.message });
      setNodes([]);
      setEdges([]);
      setSelectedId('');
    });
  }, [flowId, version, setNodes, setEdges]);

  const selectedNode = useMemo(() => state.data?.nodes?.find((n) => n.id === selectedId) || null, [state.data, selectedId]);
  const fitToken = useMemo(() => state.data ? `${state.data.flowId}@${state.data.flowVersion || ''}:${state.data.nodes?.length || 0}:${state.data.edges?.length || 0}` : '', [state.data]);
  const descendantsById = useMemo(() => {
    const children = new Map();
    for (const edge of state.data?.edges || []) {
      if (!children.has(edge.source)) children.set(edge.source, []);
      children.get(edge.source).push(edge.target);
    }
    const memo = new Map();
    function collect(id) {
      if (memo.has(id)) return memo.get(id);
      const result = new Set();
      for (const childId of children.get(id) || []) {
        result.add(childId);
        for (const nested of collect(childId)) result.add(nested);
      }
      memo.set(id, result);
      return result;
    }
    const out = new Map();
    for (const node of state.data?.nodes || []) out.set(node.id, Array.from(collect(node.id)));
    return out;
  }, [state.data]);

  function handleNodeDragStart(_, node) {
    syncNodeSelection(node.id);
    const affectedIds = [node.id, ...(descendantsById.get(node.id) || [])];
    const positions = new Map();
    for (const current of nodes) {
      if (affectedIds.includes(current.id)) positions.set(current.id, { ...current.position });
    }
    dragRef.current = {
      rootId: node.id,
      startX: node.position.x,
      startY: node.position.y,
      positions
    };
  }

  function handleNodeDrag(_, node) {
    const drag = dragRef.current;
    if (!drag || drag.rootId !== node.id) return;
    const dx = node.position.x - drag.startX;
    const dy = node.position.y - drag.startY;
    setSelectedId(node.id);
    setNodes((currentNodes) => currentNodes.map((current) => {
      if (current.id === node.id) return current;
      const base = drag.positions.get(current.id);
      if (!base) return current;
      return { ...current, position: { x: base.x + dx, y: base.y + dy } };
    }));
  }

  function handleNodeDragStop() {
    dragRef.current = null;
  }

  async function handleSaveScheme() {
    if (!nodes.length || !canvasRef.current) return;
    const viewport = canvasRef.current.querySelector('.react-flow__viewport');
    if (!viewport) return;

    try {
      setIsExporting(true);
      const bounds = getNodesBounds(nodes);
      const padding = 120;
      const imageWidth = Math.max(Math.ceil(bounds.width + padding * 2), 1600);
      const imageHeight = Math.max(Math.ceil(bounds.height + padding * 2), 900);
      const viewportTransform = getViewportForBounds(bounds, imageWidth, imageHeight, 0.2, 2, 0.12);

      const dataUrl = await toPng(viewport, {
        backgroundColor: '#f6f8fb',
        pixelRatio: 2,
        width: imageWidth,
        height: imageHeight,
        cacheBust: true,
        style: {
          width: `${imageWidth}px`,
          height: `${imageHeight}px`,
          transform: `translate(${viewportTransform.x}px, ${viewportTransform.y}px) scale(${viewportTransform.zoom})`,
          transformOrigin: '0 0',
          backgroundColor: '#f6f8fb'
        }
      });

      const link = document.createElement('a');
      const safeVersion = version || state.data?.flowVersion || 'latest';
      link.download = `${flowId}-${safeVersion}.png`;
      link.href = dataUrl;
      link.click();
    } catch (error) {
      console.error('Failed to export flow graph', error);
    } finally {
      setIsExporting(false);
    }
  }

  return <div className="page graphPage">
    <div className="toolbar">
      <div className="toolbarGroup">
        <a href="/flows">← Ко всем процессам</a>
      </div>
      <div className="toolbarGroup toolbarGroupRight">
        <button className="toolbarButton" type="button" onClick={handleSaveScheme} disabled={isExporting || !nodes.length}>
          {isExporting ? 'Сохранение...' : 'Сохранить схему'}
        </button>
        <div className="meta">{version ? `${flowId} @ ${version}` : flowId}</div>
      </div>
    </div>
    {state.loading ? <div className="panel">Загрузка графа...</div> : null}
    {state.error ? <div className="panel">Ошибка: {state.error}</div> : null}
    {state.data ? <>
      <div className="header compact">
        <h1>{state.data.name || state.data.flowId}</h1>
        <p>{state.data.description || 'Описание процесса не задано.'}</p>
      </div>
      <div className="layout">
        <div className="canvas" ref={canvasRef}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={handleNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={(_, node) => syncNodeSelection(node.id)}
            onNodeDragStart={handleNodeDragStart}
            onNodeDrag={handleNodeDrag}
            onNodeDragStop={handleNodeDragStop}
            nodesDraggable={true}
            nodesConnectable={false}
            elementsSelectable={false}
            selectionOnDrag={false}
            selectNodesOnDrag={false}
            multiSelectionKeyCode={null}
            selectionKeyCode={null}
            panOnDrag={true}
            panOnScroll={true}
            zoomOnScroll={true}
            zoomOnPinch={true}
            minZoom={0.2}
            maxZoom={1.8}
            fitView={false}
            proOptions={{ hideAttribution: true }}
          >
            <InitialFitView token={fitToken} />
            <Background color="#e2e8f0" gap={28} />
            <Controls position="bottom-left" showInteractive={false} />
          </ReactFlow>
        </div>
        <div className="sidebar">
          <div className="panel detailPanel">
            <h2>Детали шага</h2>
            {selectedNode ? <>
              <div className="detailGrid">
                <div><div className="detailLabel">Название</div><div className="detailValue">{selectedNode.data.name}</div></div>
                <div><div className="detailLabel">Тип</div><div className="detailValue"><span className={`badge ${selectedNode.data.kind}`}>{selectedNode.data.type}/{selectedNode.data.subtype}</span></div></div>
                {selectedNode.data.description ? <div><div className="detailLabel">Описание</div><div className="detailValue">{selectedNode.data.description}</div></div> : null}
                {selectedNode.data.sourceStepId && selectedNode.data.sourceStepId !== selectedNode.data.id ? <div><div className="detailLabel">Исходный шаг</div><div className="detailValue">{selectedNode.data.sourceStepId}</div></div> : null}
                {selectedNode.data.interaction ? <div>
                  <div className="detailLabel">Ожидание результата</div>
                  <div className="detailValue">
                    <div>{selectedNode.data.interaction.waitName || selectedNode.data.interaction.waitStepId}</div>
                    {selectedNode.data.interaction.waitDescription ? <div className="detailMuted">{selectedNode.data.interaction.waitDescription}</div> : null}
                  </div>
                </div> : null}
                {selectedNode.data.artefactId ? <div><div className="detailLabel">Артефакт</div><div className="detailValue">{selectedNode.data.artefactId}</div></div> : null}
                {selectedNode.data.operationId ? <div><div className="detailLabel">Операция</div><div className="detailValue">{selectedNode.data.operationId}</div></div> : null}
                {selectedNode.data.subflow ? <div><div className="detailLabel">Подпроцесс</div><div className="detailValue"><a href={`/flows/${encodeURIComponent(selectedNode.data.subflow.flowId)}?version=${encodeURIComponent(selectedNode.data.subflow.flowVersion || '')}`}>{selectedNode.data.subflow.flowId}@{selectedNode.data.subflow.flowVersion || 'latest'}</a></div></div> : null}
                {selectedNode.data.result ? <div><div className="detailLabel">Result</div><pre>{JSON.stringify(selectedNode.data.result, null, 2)}</pre></div> : null}
              </div>

              {selectedNode.data.hiddenFailures?.length ? <div className="detailSection">
                <h3>Возможные ошибочные исходы</h3>
                <div className="failureList">
                  {selectedNode.data.hiddenFailures.map((failure, index) => <div className="failureCard" key={`${failure.stepId}:${failure.label}:${index}`}>
                    <div className="failureCardHead">
                      <div className="failureName">{failure.name || failure.stepId}</div>
                      <span className="badge TERMINAL_FAIL">{failure.type}/{failure.subtype}</span>
                    </div>
                    {failure.originTitle ? <div className="failureMeta">{failure.originTitle}</div> : null}
                    {failure.label ? <div className="detailMuted">Исход: {String(failure.label).toUpperCase()}</div> : null}
                    {failure.description ? <div className="detailMuted">{failure.description}</div> : null}
                    {failure.stepId ? <div><div className="detailLabel">Шаг</div><div className="detailValue">{failure.stepId}</div></div> : null}
                    {failure.result ? <div><div className="detailLabel">Result</div><pre>{JSON.stringify(failure.result, null, 2)}</pre></div> : null}
                  </div>)}
                </div>
              </div> : null}
            </> : <div className="empty">Нажмите на шаг в графе, чтобы увидеть его описание и детали.</div>}
          </div>
        </div>
      </div>
    </> : null}
  </div>;
}

export default function App() {
  const route = useRoute();
  if (route.kind === 'list') return <FlowListPage />;
  if (route.kind === 'graph') return <FlowGraphPage flowId={route.flowId} version={route.version} />;
  return <div className="page"><div className="panel">Неизвестный маршрут.</div></div>;
}
