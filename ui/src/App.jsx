import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import ReactFlow, {
  applyNodeChanges, Background, Controls,
  getNodesBounds, getViewportForBounds,
  Handle, MarkerType, Position,
  useEdgesState, useNodesInitialized, useNodesState, useReactFlow
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

// ── node kind meta ─────────────────────────────────────────────────────────
const KIND_META = {
  PROCESS:          { css: 'process',          dot: '⬡' },
  CONTROL:          { css: 'control',          dot: '◈' },
  WAIT:             { css: 'wait',             dot: '◷' },
  EFFECT:           { css: 'effect',           dot: '⬡' },
  TERMINAL_COMPLETE:{ css: 'terminal-complete', dot: '✓' },
  TERMINAL_FAIL:    { css: 'terminal-fail',    dot: '✕' },
};
function nodeClass(kind, selected) {
  const meta = KIND_META[kind] || { css: String(kind || '').toLowerCase() };
  return `rfNode ${meta.css}${selected ? ' selected' : ''}`;
}

// ── routing inset — inline inside CONTROL nodes ────────────────────────────
const CASE_PILL_CLASS = {
  ok:      'casePill ok',
  fail:    'casePill fail',
  warn:    'casePill warn',
  default: 'casePill def',
  case:    'casePill case',
};

function RoutingInset({ routing, subtype }) {
  if (!routing) return null;
  return (
    <div className="routingInset">
      {subtype === 'ROUTE' && routing.factRefShort ? (
        <div className="routingSource">⬡ {routing.factRefShort}</div>
      ) : null}
      {subtype === 'SWITCH' && routing.decisionSetId ? (
        <div className="routingSource">⊕ {routing.decisionSetId}</div>
      ) : null}
      <div className="routingCases">
        {(routing.cases || []).map((c, i) => (
          <span key={i} className={CASE_PILL_CLASS[c.displayKind] || 'casePill case'}>
            {c.value}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── step node ──────────────────────────────────────────────────────────────
const StepNode = memo(({ data, selected }) => {
  const meta = KIND_META[data.kind] || { dot: '·' };
  const isControl = data.kind === 'CONTROL';
  return (
    <div className={nodeClass(data.kind, selected)}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div className="nodeTitle">{data.label}</div>
      <div className="nodeTag">
        <span>{meta.dot}</span>
        {data.type}/{data.subtype}
      </div>
      {isControl ? <RoutingInset routing={data.routing} subtype={data.subtype} /> : null}
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

// ── edge style ─────────────────────────────────────────────────────────────
function edgeStyle(kind) {
  switch (kind) {
    case 'mixed':           return { stroke: '#94A3B8', strokeWidth: 2, strokeDasharray: '6 4' };
    case 'wait_error':
    case 'effect_error':    return { stroke: '#F43F5E', strokeWidth: 2 };
    case 'wait_timeout':    return { stroke: '#F59E0B', strokeWidth: 2 };
    case 'wait_success':
    case 'success':         return { stroke: '#34D399', strokeWidth: 2 };
    case 'next':            return { stroke: '#94A3B8', strokeWidth: 2 };
    default:                return { stroke: '#A5B4FC', strokeWidth: 2 };
  }
}

// ── fit view ───────────────────────────────────────────────────────────────
function InitialFitView({ token }) {
  const { fitView } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const fittedRef = useRef('');
  useEffect(() => {
    if (!token || !nodesInitialized || fittedRef.current === token) return;
    fittedRef.current = token;
    let r1 = 0, r2 = 0, t = 0;
    r1 = requestAnimationFrame(() => {
      fitView({ padding: 0.36, duration: 0, minZoom: 0.15, maxZoom: 1.1 });
      t = setTimeout(() => { r2 = requestAnimationFrame(() => { fitView({ padding: 0.36, duration: 180, minZoom: 0.15, maxZoom: 1.1 }); }); }, 80);
    });
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); clearTimeout(t); };
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

// ── sidebar components ─────────────────────────────────────────────────────

function SectionHead({ children }) {
  return <div className="sectionHead">{children}</div>;
}

function PropRow({ label, children, mono }) {
  return (
    <div className="propRow">
      <div className="propLabel">{label}</div>
      <div className={mono ? 'propMono' : 'propValue'}>{children}</div>
    </div>
  );
}

/** CONTROL sidebar: full routing table with target names */
function RoutingSection({ routing, subtype }) {
  if (!routing) return null;
  return (
    <div className="detailSection">
      <SectionHead>Маршрутизация</SectionHead>
      {subtype === 'ROUTE' && routing.factRefShort ? (
        <div className="propRow" style={{ marginBottom: 8 }}>
          <div className="propLabel">Условие</div>
          <code className="codeSpan">{routing.factRefShort}</code>
        </div>
      ) : null}
      {subtype === 'SWITCH' && routing.decisionSetId ? (
        <div className="propRow" style={{ marginBottom: 8 }}>
          <div className="propLabel">Decision set</div>
          <code className="codeSpan">{routing.decisionSetId}</code>
        </div>
      ) : null}
      <div className="routingTable">
        {(routing.cases || []).map((c, i) => (
          <div key={i} className="routingTableRow">
            <span className={CASE_PILL_CLASS[c.displayKind] || 'casePill case'} style={{ flexShrink: 0 }}>
              {c.value}
            </span>
            <span className="routingTableArrow">→</span>
            <span className="routingTableTarget">{c.targetName}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** PROCESS contract: input/output path refs */
function ContractSection({ contract, artefactId, subtype }) {
  if (!contract) return null;
  return (
    <div className="detailSection">
      <SectionHead>Контракт данных</SectionHead>
      <div className="propGrid">
        {contract.inputRefShort ? (
          <div className="contractFlow">
            <span className="contractDir in">in</span>
            <code className="codeSpan flex1">{contract.inputRefShort}</code>
          </div>
        ) : null}
        {contract.outputRefShort ? (
          <div className="contractFlow">
            <span className="contractDir out">out</span>
            <code className="codeSpan flex1">{contract.outputRefShort}</code>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** PROCESS/MAPPINGS: field transformation table */
function MappingSection({ mappingFields }) {
  if (!mappingFields) return null;
  return (
    <div className="detailSection">
      <SectionHead>Маппинг полей ({mappingFields.fields?.length || 0})</SectionHead>
      {mappingFields.name ? <div className="sectionMeta">{mappingFields.name}</div> : null}
      <div className="mappingTable">
        {(mappingFields.fields || []).map((f, i) => (
          <div key={i} className="mappingRow">
            <code className="mappingField">{f.outputField}</code>
            <span className="mappingArrow">←</span>
            <div className="mappingExpr">
              <ExprDisplay expr={f.expr} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ExprDisplay({ expr }) {
  if (!expr) return null;
  if (expr.kind === 'from') return <code className="exprFrom">{expr.field}</code>;
  if (expr.kind === 'equals') return (
    <span className="exprEquals">
      <code>{expr.field}</code>
      <span className="exprOp">=</span>
      <code className="exprVal">"{expr.value}"</code>
    </span>
  );
  if (expr.kind === 'mapValue') return (
    <div className="exprMapValue">
      <div className="exprMapHead">
        <code>{expr.field}</code>
        <span className="exprOp">map</span>
      </div>
      <div className="exprMapEntries">
        {(expr.entries || []).map((e, i) => (
          <div key={i} className="exprMapEntry">
            <code className="exprMapFrom">{e.from}</code>
            <span>→</span>
            <code className="exprMapTo">{e.to}</code>
          </div>
        ))}
        {expr.fallback ? (
          <div className="exprMapEntry">
            <code className="exprMapFrom">default</code>
            <span>→</span>
            <code className="exprMapTo exprFallback">{expr.fallback}</code>
          </div>
        ) : null}
      </div>
    </div>
  );
  return <code className="exprOther">{expr.text}</code>;
}

/** PROCESS/DECISIONS: rule table */
function DecisionsSection({ decisionRules }) {
  if (!decisionRules) return null;
  return (
    <div className="detailSection">
      <SectionHead>Правила решения ({decisionRules.rules?.length || 0})</SectionHead>
      <div className="sectionMeta" style={{ marginBottom: 8 }}>
        <code className="codeSpan">{decisionRules.setId}</code>
        <span className="modePill">{decisionRules.mode}</span>
      </div>
      <div className="decisionTable">
        {(decisionRules.rules || []).map((r, i) => (
          <div key={i} className="decisionRow">
            <span className="decisionIndex">{i + 1}</span>
            <div className="decisionBody">
              <div className="decisionWhen">{r.whenSummary}</div>
              <div className="decisionThen">
                <span className="decisionOutcome">{r.decision}</span>
                {r.reason ? <span className="decisionReason">{r.reason}</span> : null}
              </div>
            </div>
          </div>
        ))}
        {decisionRules.defaultDecision ? (
          <div className="decisionRow default">
            <span className="decisionIndex">✦</span>
            <div className="decisionBody">
              <div className="decisionWhen">default</div>
              <div className="decisionThen">
                <span className="decisionOutcome">{decisionRules.defaultDecision}</span>
                {decisionRules.defaultReason ? <span className="decisionReason">{decisionRules.defaultReason}</span> : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** TERMINAL: merchant result */
function TerminalSection({ data }) {
  if (!data.outcome && !data.merchantMessage) return null;
  const isComplete = data.kind === 'TERMINAL_COMPLETE';
  return (
    <div className="detailSection">
      <SectionHead>Ответ мерчанту</SectionHead>
      <div className="terminalOutcome">
        <span className={`outcomePill ${isComplete ? 'ok' : 'fail'}`}>{data.outcome || data.kind}</span>
        {data.reasonCode ? <code className="codeSpan">{data.reasonCode}</code> : null}
      </div>
      {data.merchantMessage ? (
        <div className="merchantMessage">"{data.merchantMessage}"</div>
      ) : null}
      {data.responseMode ? (
        <div className="sectionMeta" style={{ marginTop: 6 }}>
          responseMode: <code>{data.responseMode}</code>
        </div>
      ) : null}
    </div>
  );
}

/** WAIT/EFFECT: interaction block */
function InteractionSection({ interaction }) {
  if (!interaction) return null;
  return (
    <div className="detailSection">
      <SectionHead>Ожидание результата</SectionHead>
      <PropRow label="WAIT шаг" mono>{interaction.waitStepId}</PropRow>
      {interaction.waitDescription ? (
        <div className="sectionMeta" style={{ marginTop: 6 }}>{interaction.waitDescription}</div>
      ) : null}
    </div>
  );
}

// ── full node detail panel ─────────────────────────────────────────────────
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
  const isControl = d.kind === 'CONTROL';
  const isProcess = d.kind === 'PROCESS';
  const isTerminal = d.kind === 'TERMINAL_COMPLETE' || d.kind === 'TERMINAL_FAIL';
  const isWait = d.kind === 'WAIT';

  return (
    <>
      <div className="nodeDetailName">{d.name || d.label}</div>
      <div className="nodeDetailBadge">
        <span className={`badge ${d.kind?.split('_')[0] || ''}`}>{d.type}/{d.subtype}</span>
        {d.interaction ? <span className="badge WAIT" style={{ marginLeft: 6 }}>◷ WAIT</span> : null}
      </div>
      {d.description ? <div className="nodeDetailDesc">{d.description}</div> : null}

      <div className="propGrid">
        <PropRow label="ID" mono>{d.sourceStepId || node.id}</PropRow>
        {d.artefactId  ? <PropRow label="Артефакт" mono>{d.artefactId}</PropRow> : null}
        {d.operationId ? <PropRow label="Операция" mono>{d.operationId}</PropRow> : null}
        {d.subflow ? (
          <div className="propRow">
            <div className="propLabel">Подпроцесс</div>
            <a className="propLink"
              href={`/flows/${encodeURIComponent(d.subflow.flowId)}?version=${encodeURIComponent(d.subflow.flowVersion || '')}`}
            >{d.subflow.flowId} @ {d.subflow.flowVersion || 'latest'} →</a>
          </div>
        ) : null}
      </div>

      {/* Type-specific sections */}
      {isControl  ? <RoutingSection routing={d.routing} subtype={d.subtype} /> : null}
      {isProcess  ? <ContractSection contract={d.contract} artefactId={d.artefactId} subtype={d.subtype} /> : null}
      {d.mappingFields  ? <MappingSection mappingFields={d.mappingFields} /> : null}
      {d.decisionRules  ? <DecisionsSection decisionRules={d.decisionRules} /> : null}
      {isWait     ? <InteractionSection interaction={d.interaction} /> : null}
      {isTerminal ? <TerminalSection data={d} /> : null}

      {/* Hidden failure outcomes */}
      {d.hiddenFailures?.length ? (
        <div className="detailSection">
          <SectionHead>Ошибочные исходы ({d.hiddenFailures.length})</SectionHead>
          <div className="failureList">
            {d.hiddenFailures.map((f, i) => (
              <div className="failureCard" key={`${f.stepId}:${i}`}>
                <div className="failureCardHead">
                  <div className="failureCardName">{f.name || f.stepId}</div>
                  <span className="badge TERMINAL_FAIL" style={{ fontSize: 10 }}>FAIL</span>
                </div>
                {f.originTitle ? <div className="failureCardMeta">{f.originTitle}</div> : null}
                {f.label ? <div className="failureCardOutcome">исход: {String(f.label).toUpperCase()}</div> : null}
                {f.result?.outcome ? <div className="failureCardOutcome">outcome: {f.result.outcome}</div> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

// ── flow list page ─────────────────────────────────────────────────────────
const FLOW_ICONS = {
  'beneficiary.registration': '🗂️',
  'abs.ensure': '🔗',
  default: '⚙️',
};
function flowIcon(flowId) {
  for (const [k, v] of Object.entries(FLOW_ICONS)) if (String(flowId).includes(k)) return v;
  return FLOW_ICONS.default;
}

function FlowListPage() {
  const [state, setState] = useState({ loading: true, data: [], error: '' });
  useEffect(() => {
    fetch(`${API}/flows`)
      .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d?.error?.message || `HTTP ${r.status}`); return d; })
      .then((d) => setState({ loading: false, data: d.flows || [], error: '' }))
      .catch((e) => setState({ loading: false, data: [], error: e.message }));
  }, []);

  return (
    <div className="page listPage">
      <div className="toolbar" style={{ marginBottom: 28 }}>
        <a className="toolbarLogo" href="/flows"><Logo />Flow Viewer</a>
      </div>
      <div className="listHeader"><h1>Процессы</h1><p>Выберите flow чтобы открыть визуальную схему</p></div>
      {state.loading ? <div className="stateBox">Загрузка...</div> : null}
      {state.error  ? <div className="stateBox error">Ошибка: {state.error}</div> : null}
      {!state.loading && !state.error ? (
        <div className="cards">
          {state.data.map((flow) => (
            <div className="flowCard" key={`${flow.flowId}@${flow.flowVersion}`}>
              <div className="flowCardTop">
                <div className="flowCardIcon">{flowIcon(flow.flowId)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <a className="flowCardTitle"
                    href={`/flows/${encodeURIComponent(flow.flowId)}?version=${encodeURIComponent(flow.flowVersion)}`}
                  >{flow.name || flow.flowId}</a>
                </div>
              </div>
              <div className="flowCardId">{flow.flowId} @ {flow.flowVersion}</div>
              <div className="flowCardDesc">{flow.description || 'Описание не задано.'}</div>
              <a className="flowCardArrow"
                href={`/flows/${encodeURIComponent(flow.flowId)}?version=${encodeURIComponent(flow.flowVersion)}`}
              >Открыть схему →</a>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── node/edge formatters ───────────────────────────────────────────────────
function mapNodes(dataNodes) {
  return (dataNodes || []).map((node) => ({
    id: node.id, type: 'step', position: node.position,
    data: { label: node.label, ...node.data },
    draggable: true, selectable: true, selected: false,
    sourcePosition: Position.Right, targetPosition: Position.Left,
  }));
}
function mapEdges(dataEdges) {
  return (dataEdges || []).map((edge) => ({
    id: edge.id, source: edge.source, target: edge.target,
    label: edge.label || undefined,
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: edgeStyle(edge.kind).stroke },
    style: edgeStyle(edge.kind),
    labelStyle: { fill: '#374151', fontSize: 11, fontWeight: 700, fontFamily: 'Inter, sans-serif' },
    labelBgStyle: { fill: '#fff', opacity: .95 },
    labelBgPadding: [5, 4], labelBgBorderRadius: 5,
    type: 'smoothstep', pathOptions: { borderRadius: 16, offset: 20 }, animated: false,
  }));
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
      .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d?.error?.message || `HTTP ${r.status}`); return d; })
      .then((d) => {
        setState({ loading: false, data: d, error: '' });
        const firstId = d.nodes?.[0]?.id || '';
        setNodes(mapNodes(d.nodes).map((n) => ({ ...n, selected: n.id === firstId })));
        setEdges(mapEdges(d.edges));
        setSelectedId(firstId);
      })
      .catch((e) => { setState({ loading: false, data: null, error: e.message }); setNodes([]); setEdges([]); setSelectedId(''); });
  }, [flowId, version, setNodes, setEdges]);

  const selectedNode = useMemo(() => state.data?.nodes?.find((n) => n.id === selectedId) || null, [state.data, selectedId]);
  const fitToken = useMemo(() => state.data ? `${state.data.flowId}@${state.data.flowVersion || ''}:${state.data.nodes?.length || 0}` : '', [state.data]);

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
      for (const c of children.get(id) || []) { result.add(c); for (const n of collect(c)) result.add(n); }
      memo.set(id, result); return result;
    }
    const out = new Map();
    for (const n of state.data?.nodes || []) out.set(n.id, Array.from(collect(n.id)));
    return out;
  }, [state.data]);

  function handleNodeDragStart(_, node) {
    syncSelection(node.id);
    const affectedIds = [node.id, ...(descendantsById.get(node.id) || [])];
    const positions = new Map();
    for (const n of nodes) if (affectedIds.includes(n.id)) positions.set(n.id, { ...n.position });
    dragRef.current = { rootId: node.id, startX: node.position.x, startY: node.position.y, positions };
  }
  function handleNodeDrag(_, node) {
    const drag = dragRef.current;
    if (!drag || drag.rootId !== node.id) return;
    const dx = node.position.x - drag.startX, dy = node.position.y - drag.startY;
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
        style: { width: `${imgW}px`, height: `${imgH}px`, transform: `translate(${vp.x}px,${vp.y}px) scale(${vp.zoom})`, transformOrigin: '0 0', backgroundColor: '#F5F3EE' },
      });
      const a = document.createElement('a');
      a.download = `${flowId}-${version || state.data?.flowVersion || 'latest'}.png`;
      a.href = dataUrl; a.click();
    } catch (e) { console.error('Export failed', e); }
    finally { setIsExporting(false); }
  }

  const nodeCount = state.data?.nodes?.length || 0;
  const edgeCount = state.data?.edges?.length || 0;

  return (
    <div className="page graphPage">
      <div className="toolbar">
        <a className="toolbarLogo" href="/flows"><Logo />Flow Viewer</a>
        <div className="toolbarSep" />
        <div className="toolbarBreadcrumb">
          <a href="/flows">Процессы</a>
          <span style={{ opacity: .4 }}>/</span>
          <span className="crumb-active">{state.data?.name || flowId}</span>
        </div>
        <div className="toolbarRight">
          {version ? <span className="versionPill">v{version}</span> : null}
          {nodeCount ? <span className="versionPill">{nodeCount} шагов · {edgeCount} переходов</span> : null}
          <button className="toolbarBtn" onClick={handleExport} disabled={isExporting || !nodes.length}>
            {isExporting ? '⏳ Сохранение...' : '↓ Экспорт PNG'}
          </button>
        </div>
      </div>

      {state.loading ? <div className="stateBox">Загрузка графа...</div> : null}
      {state.error   ? <div className="stateBox error">Ошибка: {state.error}</div> : null}

      {state.data ? (
        <>
          {state.data.description ? (
            <div className="canvasHeader">
              <div className="canvasHeaderText"><p>{state.data.description}</p></div>
            </div>
          ) : null}
          <div className="layout">
            <div className="canvasWrap" ref={canvasRef}>
              <ReactFlow
                nodes={nodes} edges={edges} nodeTypes={nodeTypes}
                onNodesChange={handleNodesChange} onEdgesChange={onEdgesChange}
                onNodeClick={(_, node) => syncSelection(node.id)}
                onNodeDragStart={handleNodeDragStart} onNodeDrag={handleNodeDrag} onNodeDragStop={handleNodeDragStop}
                nodesDraggable nodesConnectable={false} elementsSelectable={false}
                selectionOnDrag={false} selectNodesOnDrag={false}
                multiSelectionKeyCode={null} selectionKeyCode={null}
                panOnDrag panOnScroll zoomOnScroll zoomOnPinch
                minZoom={0.15} maxZoom={1.8} fitView={false}
                proOptions={{ hideAttribution: true }}
              >
                <InitialFitView token={fitToken} />
                <Background color="#D1C9B8" gap={24} size={1.5} variant="dots" />
                <Controls position="bottom-left" showInteractive={false} />
              </ReactFlow>
            </div>
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
  return <div className="page listPage"><div className="stateBox">Неизвестный маршрут.</div></div>;
}
