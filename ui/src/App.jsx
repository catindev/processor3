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

// ── routing ────────────────────────────────────────────────────────────────

function useRoute() {
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
  const params = new URLSearchParams(window.location.search);
  if (pathname === '/flows') return { kind: 'list' };
  const match = pathname.match(/^\/flows\/([^/]+)$/);
  if (match) return { kind: 'graph', flowId: decodeURIComponent(match[1]), version: params.get('version') || '' };
  return { kind: 'unknown' };
}

// ── node helpers ───────────────────────────────────────────────────────────

const KIND_META = {
  PROCESS:          { css: 'process',          label: 'Process',   dot: '⬡' },
  CONTROL:          { css: 'control',          label: 'Control',   dot: '◈' },
  EFFECT:           { css: 'effect',           label: 'Effect',    dot: '⬡' },
  WAIT:             { css: 'wait',             label: 'Wait',      dot: '◷' },
  TERMINAL_COMPLETE:{ css: 'terminal-complete',label: 'Complete',  dot: '✓' },
  TERMINAL_FAIL:    { css: 'terminal-fail',    label: 'Fail',      dot: '✕' },
};

function nodeClass(kind, selected) {
  const meta = KIND_META[kind] || { css: String(kind || '').toLowerCase() };
  return `rfNode ${meta.css}${selected ? ' selected' : ''}`;
}

function subtypeLabel(type, subtype) {
  if (subtype) return `${type} · ${subtype}`;
  return type;
}

const StepNode = memo(({ data, selected }) => {
  const meta = KIND_META[data.kind] || { label: data.kind, dot: '·' };
  return (
    <div className={nodeClass(data.kind, selected)}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div className="nodeTitle">{data.label}</div>
      <div className="nodeTag">
        <span>{meta.dot}</span>
        {subtypeLabel(data.type, data.subtype)}
      </div>
      {data.hiddenFailureCount ? (
        <div className="nodeFailureDots" aria-hidden="true">
          {Array.from({ length: Math.min(data.hiddenFailureCount, 4) }).map((_, i) => (
            <span className="nodeFailureDot" key={i} />
          ))}
          {data.hiddenFailureCount > 4 ? (
            <span className="nodeFailureCount">+{data.hiddenFailureCount - 4}</span>
          ) : null}
        </div>
      ) : null}
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
});

const nodeTypes = { step: StepNode };

// ── edge helpers ───────────────────────────────────────────────────────────

function edgeStyle(kind) {
  switch (kind) {
    case 'mixed':
      return { stroke: '#94A3B8', strokeWidth: 2, strokeDasharray: '6 4' };
    case 'wait_error':
    case 'effect_error':
      return { stroke: '#F43F5E', strokeWidth: 2 };
    case 'wait_timeout':
      return { stroke: '#F59E0B', strokeWidth: 2 };
    case 'wait_success':
    case 'success':
      return { stroke: '#34D399', strokeWidth: 2 };
    case 'next':
      return { stroke: '#94A3B8', strokeWidth: 2 };
    default:
      return { stroke: '#A5B4FC', strokeWidth: 2 };
  }
}

// ── fit-view helper ────────────────────────────────────────────────────────

function InitialFitView({ token }) {
  const { fitView } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const fittedRef = useRef('');
  useEffect(() => {
    if (!token || !nodesInitialized || fittedRef.current === token) return;
    fittedRef.current = token;
    let raf1 = 0, raf2 = 0, timer = 0;
    raf1 = requestAnimationFrame(() => {
      fitView({ padding: 0.36, duration: 0, minZoom: 0.2, maxZoom: 1.1 });
      timer = setTimeout(() => {
        raf2 = requestAnimationFrame(() => {
          fitView({ padding: 0.36, duration: 180, minZoom: 0.2, maxZoom: 1.1 });
        });
      }, 80);
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(timer);
    };
  }, [fitView, nodesInitialized, token]);
  return null;
}

// ── logo ───────────────────────────────────────────────────────────────────

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <rect width="22" height="22" rx="7" fill="#4F46E5"/>
      <path d="M6 8h10M6 11h7M6 14h4" stroke="#fff" strokeWidth="1.8" strokeLinecap="round"/>
      <circle cx="16" cy="14" r="2.5" fill="#A5F3FC"/>
    </svg>
  );
}

// ── flow list page ─────────────────────────────────────────────────────────

const FLOW_ICONS = {
  'beneficiary.registration': '🗂️',
  'abs.ensure': '🔗',
  default: '⚙️',
};
function flowIcon(flowId) {
  for (const [k, v] of Object.entries(FLOW_ICONS)) {
    if (String(flowId).includes(k)) return v;
  }
  return FLOW_ICONS.default;
}

function FlowListPage() {
  const [state, setState] = useState({ loading: true, data: [], error: '' });
  useEffect(() => {
    fetch(`${API}/flows`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data?.error?.message || `HTTP ${r.status}`);
        return data;
      })
      .then((data) => setState({ loading: false, data: data.flows || [], error: '' }))
      .catch((err) => setState({ loading: false, data: [], error: err.message }));
  }, []);

  return (
    <div className="page listPage">
      {/* toolbar */}
      <div className="toolbar" style={{ marginBottom: 28 }}>
        <a className="toolbarLogo" href="/flows">
          <Logo />
          Flow Viewer
        </a>
      </div>

      <div className="listHeader">
        <h1>Процессы</h1>
        <p>Выберите flow чтобы открыть визуальную схему</p>
      </div>

      {state.loading ? <div className="stateBox">Загрузка...</div> : null}
      {state.error ? <div className="stateBox error">Ошибка: {state.error}</div> : null}
      {!state.loading && !state.error ? (
        <div className="cards">
          {state.data.map((flow) => (
            <div className="flowCard" key={`${flow.flowId}@${flow.flowVersion}`}>
              <div className="flowCardTop">
                <div className="flowCardIcon">{flowIcon(flow.flowId)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <a
                    className="flowCardTitle"
                    href={`/flows/${encodeURIComponent(flow.flowId)}?version=${encodeURIComponent(flow.flowVersion)}`}
                  >
                    {flow.name || flow.flowId}
                  </a>
                </div>
              </div>
              <div className="flowCardId">{flow.flowId} @ {flow.flowVersion}</div>
              <div className="flowCardDesc">{flow.description || 'Описание не задано.'}</div>
              <a
                className="flowCardArrow"
                href={`/flows/${encodeURIComponent(flow.flowId)}?version=${encodeURIComponent(flow.flowVersion)}`}
              >
                Открыть схему →
              </a>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── node → react-flow format ───────────────────────────────────────────────

function mapNodes(dataNodes) {
  return (dataNodes || []).map((node) => ({
    id: node.id,
    type: 'step',
    position: node.position,
    data: { label: node.label, ...node.data },
    draggable: true,
    selectable: true,
    selected: false,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  }));
}

function mapEdges(dataEdges) {
  return (dataEdges || []).map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label || undefined,
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: edgeStyle(edge.kind).stroke },
    style: edgeStyle(edge.kind),
    labelStyle: { fill: '#374151', fontSize: 11, fontWeight: 700, fontFamily: 'Inter, sans-serif' },
    labelBgStyle: { fill: '#ffffff', opacity: 0.95 },
    labelBgPadding: [5, 4],
    labelBgBorderRadius: 5,
    type: 'smoothstep',
    pathOptions: { borderRadius: 16, offset: 20 },
    animated: false,
  }));
}

// ── detail sidebar ─────────────────────────────────────────────────────────

function PropRow({ label, children }) {
  return (
    <div className="propRow">
      <div className="propLabel">{label}</div>
      <div className="propValue">{children}</div>
    </div>
  );
}

function NodeDetail({ node }) {
  if (!node) {
    return (
      <div className="emptyState">
        <div className="emptyStateIcon">🔍</div>
        <span>Нажмите на шаг в графе,<br/>чтобы увидеть детали</span>
      </div>
    );
  }
  const d = node.data;
  const kindForBadge = d.kind === 'WAIT' && d.interaction ? 'WAIT interaction' : (d.kind || '');

  return (
    <>
      <div className="nodeDetailName">{d.name || d.label}</div>
      <div className="nodeDetailBadge">
        <span className={`badge ${kindForBadge.split(' ')[0]}`}>
          {d.type}/{d.subtype}
        </span>
        {d.interaction ? (
          <span className="badge WAIT interaction" style={{ marginLeft: 6 }}>
            ◷ {d.interaction.waitName || 'WAIT'}
          </span>
        ) : null}
      </div>
      {d.description ? <div className="nodeDetailDesc">{d.description}</div> : null}

      <div className="propGrid">
        <PropRow label="ID шага">
          <span className="propMono">{d.sourceStepId || node.id}</span>
        </PropRow>
        {d.interaction ? (
          <PropRow label="Ожидание">
            <span className="propMono">{d.interaction.waitStepId}</span>
            {d.interaction.waitDescription ? (
              <div style={{ fontSize: 12, color: '#6B7280', marginTop: 3 }}>
                {d.interaction.waitDescription}
              </div>
            ) : null}
          </PropRow>
        ) : null}
        {d.artefactId ? (
          <PropRow label="Артефакт">
            <span className="propMono">{d.artefactId}</span>
          </PropRow>
        ) : null}
        {d.operationId ? (
          <PropRow label="Операция">
            <span className="propMono">{d.operationId}</span>
          </PropRow>
        ) : null}
        {d.subflow ? (
          <PropRow label="Подпроцесс">
            <a
              className="propLink"
              href={`/flows/${encodeURIComponent(d.subflow.flowId)}?version=${encodeURIComponent(d.subflow.flowVersion || '')}`}
            >
              {d.subflow.flowId} @ {d.subflow.flowVersion || 'latest'} →
            </a>
          </PropRow>
        ) : null}
        {d.result ? (
          <PropRow label="Result">
            <pre>{JSON.stringify(d.result, null, 2)}</pre>
          </PropRow>
        ) : null}
      </div>

      {d.hiddenFailures?.length ? (
        <div className="detailSection">
          <div className="detailSectionHead">
            Возможные ошибочные исходы
            <span style={{ marginLeft: 6, fontWeight: 800 }}>{d.hiddenFailures.length}</span>
          </div>
          <div className="failureList">
            {d.hiddenFailures.map((f, i) => (
              <div className="failureCard" key={`${f.stepId}:${f.label}:${i}`}>
                <div className="failureCardHead">
                  <div className="failureCardName">{f.name || f.stepId}</div>
                  <span className="badge TERMINAL_FAIL" style={{ fontSize: 10 }}>FAIL</span>
                </div>
                {f.originTitle ? <div className="failureCardMeta">{f.originTitle}</div> : null}
                {f.label ? (
                  <div className="failureCardOutcome">
                    исход: {String(f.label).toUpperCase()}
                  </div>
                ) : null}
                {f.result ? <pre>{JSON.stringify(f.result, null, 2)}</pre> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

// ── graph page ─────────────────────────────────────────────────────────────

function FlowGraphPage({ flowId, version }) {
  const [state, setState] = useState({ loading: true, data: null, error: '' });
  const [selectedId, setSelectedId] = useState('');
  const [nodes, setNodes] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [isExporting, setIsExporting] = useState(false);
  const dragRef = useRef(null);
  const canvasRef = useRef(null);

  function syncSelection(id) {
    setSelectedId(id);
    setNodes((cur) => cur.map((n) => ({ ...n, selected: n.id === id })));
  }

  function handleNodesChange(changes) {
    const filtered = changes.filter((c) => c.type !== 'select');
    if (!filtered.length) return;
    setNodes((cur) => applyNodeChanges(filtered, cur));
  }

  useEffect(() => {
    const url = `${API}/flows/${encodeURIComponent(flowId)}${version ? `?version=${encodeURIComponent(version)}` : ''}`;
    fetch(url)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data?.error?.message || `HTTP ${r.status}`);
        return data;
      })
      .then((data) => {
        setState({ loading: false, data, error: '' });
        const firstId = data.nodes?.[0]?.id || '';
        setNodes(mapNodes(data.nodes).map((n) => ({ ...n, selected: n.id === firstId })));
        setEdges(mapEdges(data.edges));
        setSelectedId(firstId);
      })
      .catch((err) => {
        setState({ loading: false, data: null, error: err.message });
        setNodes([]); setEdges([]); setSelectedId('');
      });
  }, [flowId, version, setNodes, setEdges]);

  const selectedNode = useMemo(
    () => state.data?.nodes?.find((n) => n.id === selectedId) || null,
    [state.data, selectedId]
  );
  const fitToken = useMemo(
    () => state.data
      ? `${state.data.flowId}@${state.data.flowVersion || ''}:${state.data.nodes?.length || 0}`
      : '',
    [state.data]
  );

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
      for (const child of children.get(id) || []) {
        result.add(child);
        for (const nested of collect(child)) result.add(nested);
      }
      memo.set(id, result);
      return result;
    }
    const out = new Map();
    for (const node of state.data?.nodes || []) out.set(node.id, Array.from(collect(node.id)));
    return out;
  }, [state.data]);

  function handleNodeDragStart(_, node) {
    syncSelection(node.id);
    const affectedIds = [node.id, ...(descendantsById.get(node.id) || [])];
    const positions = new Map();
    for (const n of nodes) {
      if (affectedIds.includes(n.id)) positions.set(n.id, { ...n.position });
    }
    dragRef.current = { rootId: node.id, startX: node.position.x, startY: node.position.y, positions };
  }

  function handleNodeDrag(_, node) {
    const drag = dragRef.current;
    if (!drag || drag.rootId !== node.id) return;
    const dx = node.position.x - drag.startX;
    const dy = node.position.y - drag.startY;
    setSelectedId(node.id);
    setNodes((cur) => cur.map((n) => {
      if (n.id === node.id) return n;
      const base = drag.positions.get(n.id);
      if (!base) return n;
      return { ...n, position: { x: base.x + dx, y: base.y + dy } };
    }));
  }

  function handleNodeDragStop() { dragRef.current = null; }

  async function handleExport() {
    if (!nodes.length || !canvasRef.current) return;
    const viewport = canvasRef.current.querySelector('.react-flow__viewport');
    if (!viewport) return;
    try {
      setIsExporting(true);
      const bounds = getNodesBounds(nodes);
      const pad = 120;
      const imgW = Math.max(Math.ceil(bounds.width + pad * 2), 1600);
      const imgH = Math.max(Math.ceil(bounds.height + pad * 2), 900);
      const vp = getViewportForBounds(bounds, imgW, imgH, 0.2, 2, 0.12);
      const dataUrl = await toPng(viewport, {
        backgroundColor: '#F5F3EE', pixelRatio: 2, width: imgW, height: imgH, cacheBust: true,
        style: {
          width: `${imgW}px`, height: `${imgH}px`,
          transform: `translate(${vp.x}px,${vp.y}px) scale(${vp.zoom})`,
          transformOrigin: '0 0', backgroundColor: '#F5F3EE',
        },
      });
      const a = document.createElement('a');
      a.download = `${flowId}-${version || state.data?.flowVersion || 'latest'}.png`;
      a.href = dataUrl; a.click();
    } catch (err) {
      console.error('Export failed', err);
    } finally {
      setIsExporting(false);
    }
  }

  const flowName = state.data?.name || flowId;
  const flowDesc = state.data?.description;
  const nodeCount = state.data?.nodes?.length || 0;
  const edgeCount = state.data?.edges?.length || 0;

  return (
    <div className="page graphPage">
      {/* toolbar */}
      <div className="toolbar">
        <a className="toolbarLogo" href="/flows">
          <Logo />
          Flow Viewer
        </a>
        <div className="toolbarSep" />
        <div className="toolbarBreadcrumb">
          <a href="/flows">Процессы</a>
          <span style={{ opacity: .4 }}>/</span>
          <span className="crumb-active">{flowName}</span>
        </div>
        <div className="toolbarRight">
          {version ? <span className="versionPill">v{version}</span> : null}
          {nodeCount ? (
            <span className="versionPill">{nodeCount} шагов · {edgeCount} переходов</span>
          ) : null}
          <button
            className="toolbarBtn"
            type="button"
            onClick={handleExport}
            disabled={isExporting || !nodes.length}
          >
            {isExporting ? '⏳ Сохранение...' : '↓ Экспорт PNG'}
          </button>
        </div>
      </div>

      {/* loading / error */}
      {state.loading ? <div className="stateBox">Загрузка графа...</div> : null}
      {state.error ? <div className="stateBox error">Ошибка: {state.error}</div> : null}

      {state.data ? (
        <>
          {flowDesc ? (
            <div className="canvasHeader">
              <div className="canvasHeaderText">
                <p>{flowDesc}</p>
              </div>
            </div>
          ) : null}

          <div className="layout">
            {/* canvas */}
            <div className="canvasWrap" ref={canvasRef}>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={handleNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={(_, node) => syncSelection(node.id)}
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
                minZoom={0.15}
                maxZoom={1.8}
                fitView={false}
                proOptions={{ hideAttribution: true }}
              >
                <InitialFitView token={fitToken} />
                <Background color="#D1C9B8" gap={24} size={1.5} variant="dots" />
                <Controls position="bottom-left" showInteractive={false} />
              </ReactFlow>
            </div>

            {/* sidebar */}
            <div className="sidebar">
              <div className="sidePanel">
                <div className="sidePanelHead">
                  <div className="sidePanelDot" />
                  <h2>Детали шага</h2>
                </div>
                <NodeDetail node={selectedNode} />
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

// ── root ───────────────────────────────────────────────────────────────────

export default function App() {
  const route = useRoute();
  if (route.kind === 'list') return <FlowListPage />;
  if (route.kind === 'graph') return <FlowGraphPage flowId={route.flowId} version={route.version} />;
  return (
    <div className="page listPage">
      <div className="stateBox">Неизвестный маршрут.</div>
    </div>
  );
}
