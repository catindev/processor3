// ── constants ─────────────────────────────────────────────────────────────
const NODE_WIDTH = 270;
const NODE_HEIGHT = 64;
const TARGET_MIN_X = 100;
const TARGET_MIN_Y = 140;
const X_STEP = 420;
const Y_STEP = 170;
const FORWARD_BRANCH_GAP = 1.15;

// ── generic helpers ────────────────────────────────────────────────────────

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
function titleFromStep(step) {
  return step?.name || step?.id || 'Unnamed step';
}
function nodeKind(step) {
  if (step?.type === 'TERMINAL' && step?.subtype === 'COMPLETE') return 'TERMINAL_COMPLETE';
  if (step?.type === 'TERMINAL' && step?.subtype === 'FAIL') return 'TERMINAL_FAIL';
  return step?.type || 'UNKNOWN';
}

// ── path / expression helpers ──────────────────────────────────────────────

/**
 * Strip the common $.context. prefix so paths fit in compact UI.
 * "$.context.checks.validation" → "checks.validation"
 */
function shortenPath(path) {
  if (!path || typeof path !== 'string') return path;
  return path.replace(/^\$\.context\./, '');
}

/**
 * Convert a mappings output-field expression into a structured descriptor.
 * Returns { kind, field?, value?, entries?, fallback?, text }.
 */
function summarizeMappingExpr(expr) {
  if (expr == null || typeof expr !== 'object') {
    return { kind: 'literal', text: String(expr ?? '') };
  }
  const strip = (s) => (typeof s === 'string' ? s.replace(/^sources\.[^.]+\./, '') : s);

  if ('from' in expr) {
    const field = strip(expr.from);
    return { kind: 'from', field, text: field };
  }
  if ('equals' in expr && Array.isArray(expr.equals)) {
    const [src, val] = expr.equals;
    const field = strip(src);
    return { kind: 'equals', field, value: val, text: `${field} = "${val}"` };
  }
  if ('mapValue' in expr) {
    const mv = expr.mapValue || {};
    const field = strip(mv.from || '');
    const entries = Object.entries(mv.map || {}).map(([from, to]) => ({ from, to }));
    return { kind: 'mapValue', field, entries, fallback: mv.fallback ?? null, text: `mapValue(${field})` };
  }
  if ('coalesce' in expr) return { kind: 'other', text: 'coalesce(…)' };
  if ('concat' in expr) return { kind: 'other', text: 'concat(…)' };
  const key = Object.keys(expr)[0];
  return { kind: 'other', text: key || '…' };
}

/**
 * Summarise a decision-rule "when" object into a readable string.
 * { hasExceptions: true } → "hasExceptions"
 * { "waitResult.error.type": "NOT_FOUND" } → 'waitResult.error.type = "NOT_FOUND"'
 */
function summarizeWhenClause(when) {
  if (!when || typeof when !== 'object') return '?';
  return Object.entries(when)
    .map(([k, v]) => {
      if (v === true) return k;
      if (v === false) return `${k} = false`;
      return `${k} = "${v}"`;
    })
    .join(' AND ');
}

// ── branch / edge helpers ──────────────────────────────────────────────────

function normalizeToken(value) {
  return String(value || '').trim().toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '_').replace(/^_+|_+$/g, '');
}

function detectBranchKind(label) {
  const token = normalizeToken(label);
  if (!token) return 'case';
  if (token === 'next') return 'next';
  if (token === 'timeout' || token.startsWith('timeout_') || token.endsWith('_timeout')) return 'wait_timeout';
  if (['continue', 'success', 'found', 'true', 'ok'].includes(token)) return 'success';
  if (token === 'default' || /^default_/.test(token) || /_default$/.test(token)) return 'default';
  if (['error', 'fail', 'failure'].includes(token)) return 'error';
  if (token.startsWith('reject_') || token.endsWith('_reject') || token.includes('_reject_')) return 'error';
  if (/^error_/.test(token) || /_error$/.test(token)) return 'error';
  if (/^fail_/.test(token) || /_fail$/.test(token)) return 'error';
  return 'case';
}

/** Map branch kind to a display-friendly category for pill coloring. */
function caseDisplayKind(branchKind) {
  if (['success', 'wait_success', 'next'].includes(branchKind)) return 'ok';
  if (['error', 'wait_error', 'effect_error'].includes(branchKind)) return 'fail';
  if (branchKind === 'wait_timeout') return 'warn';
  if (branchKind === 'default') return 'default';
  return 'case';
}

function branchPriority(kind) {
  switch (kind) {
    case 'next': case 'success': case 'wait_success': return 0;
    case 'case': return 1;
    case 'default': return 2;
    case 'error': case 'effect_error': case 'wait_error': return 3;
    case 'wait_timeout': return 4;
    default: return 5;
  }
}

function sortEdges(left, right) {
  const leftKinds = Array.isArray(left.kinds) && left.kinds.length ? left.kinds : [left.kind];
  const rightKinds = Array.isArray(right.kinds) && right.kinds.length ? right.kinds : [right.kind];
  const byPriority = Math.min(...leftKinds.map(branchPriority)) - Math.min(...rightKinds.map(branchPriority));
  if (byPriority !== 0) return byPriority;
  return String(left.label || '').localeCompare(String(right.label || ''), 'ru');
}

// ── step-level enrichment data builders ───────────────────────────────────

/**
 * For CONTROL/ROUTE and CONTROL/SWITCH:
 * Returns the routing metadata for display in the node card.
 * Includes all cases (both visible and hidden) so the card shows complete routing logic.
 */
function buildRoutingData(step, graph) {
  if (step.type !== 'CONTROL') return null;
  const titleOf = (id) => { const s = graph.stepsById.get(id); return s ? (s.name || s.id) : id; };

  if (step.subtype === 'ROUTE') {
    const cases = Object.entries(step.cases || {}).map(([value, targetId]) => ({
      value,
      targetName: titleOf(targetId),
      displayKind: caseDisplayKind(detectBranchKind(value)),
    }));
    if (step.defaultNextStepId) {
      cases.push({ value: 'default', targetName: titleOf(step.defaultNextStepId), displayKind: 'default' });
    }
    return {
      subtype: 'ROUTE',
      factRef: step.factRef || '',
      factRefShort: shortenPath(step.factRef || ''),
      cases,
    };
  }

  if (step.subtype === 'SWITCH') {
    const cases = Object.entries(step.cases || {}).map(([outcome, targetId]) => ({
      value: outcome,
      targetName: titleOf(targetId),
      displayKind: caseDisplayKind(detectBranchKind(outcome)),
    }));
    if (step.defaultNextStepId) {
      cases.push({ value: 'default', targetName: titleOf(step.defaultNextStepId), displayKind: 'default' });
    }
    return {
      subtype: 'SWITCH',
      decisionSetId: step.decisionSetId || '',
      cases,
    };
  }

  return null;
}

/**
 * For PROCESS steps: contract.input.ref / contract.output.ref paths.
 */
function buildContractData(step) {
  if (step.type !== 'PROCESS' || !step.contract) return null;
  const inputRef = step.contract.input?.ref;
  const outputRef = step.contract.output?.ref;
  return {
    inputRef: typeof inputRef === 'string' ? inputRef : (inputRef ? '(composed)' : null),
    inputRefShort: typeof inputRef === 'string' ? shortenPath(inputRef) : (inputRef ? '(composed)' : null),
    outputRef: typeof outputRef === 'string' ? outputRef : null,
    outputRefShort: typeof outputRef === 'string' ? shortenPath(outputRef) : null,
  };
}

/**
 * For TERMINAL steps: merchant-facing outcome fields pulled to top level for easy sidebar access.
 */
function buildTerminalData(step) {
  if (step.type !== 'TERMINAL' || !step.result) return null;
  return {
    outcome: step.result.outcome || null,
    merchantMessage: step.result.merchantMessage || null,
    reasonCode: step.result.reasonCode || null,
    responseMode: step.result.responseMode || null,
  };
}

// ── artifact context enrichment (requires runtime data) ────────────────────

/**
 * Build mapping field descriptors from the raw mapping source artifact.
 * Returns { name, description, fields: [{outputField, expr}] }
 */
function buildMappingFields(source) {
  const fields = Object.entries(source.output || {}).map(([outputField, raw]) => ({
    outputField,
    expr: summarizeMappingExpr(raw),
  }));
  return {
    name: source.name || null,
    description: source.description || null,
    fields,
  };
}

/**
 * Build a decision rules descriptor for a given decision-set artefactId.
 * Returns { setId, mode, rules: [{whenSummary, decision, reason}], defaultDecision, defaultReason }
 */
function buildDecisionRules(setId, artifacts) {
  const set = artifacts.find((a) => a.id === setId && a.type === 'decision-set');
  if (!set) return null;
  const rules = (set.rules || []).map((ruleId) => {
    const rule = artifacts.find((a) => a.id === ruleId);
    if (!rule) return { id: ruleId, whenSummary: '?', decision: null, reason: null };
    return {
      id: ruleId,
      whenSummary: summarizeWhenClause(rule.when),
      decision: rule.then?.decision || null,
      reason: rule.then?.reason || null,
    };
  });
  return {
    setId,
    mode: set.mode || 'first_match_wins',
    defaultDecision: set.defaultDecision?.decision || null,
    defaultReason: set.defaultDecision?.reason || null,
    rules,
  };
}

// ── canonical graph ────────────────────────────────────────────────────────

function buildCanonicalGraph(flow) {
  const stepEntries = Array.isArray(flow.steps)
    ? flow.steps.map((step) => [step.id, step])
    : Object.entries(flow.steps || {});
  const stepsById = new Map();
  for (const [stepId, stepSource] of stepEntries) {
    if (!plainObject(stepSource)) continue;
    const step = { ...stepSource, id: stepSource.id || stepId };
    stepsById.set(step.id, step);
  }
  return {
    flowId: flow.id,
    flowVersion: flow.version || '',
    entryStepId: flow.entryStepId,
    name: flow.name || flow.id,
    description: flow.description || '',
    stepsById,
  };
}

// ── presentation graph ─────────────────────────────────────────────────────

function makeRawBranch(targetId, label, kind) {
  return { targetId, label: label || '', kind };
}

function collectRawBranchesForStep(step, graph) {
  const raw = [];
  const push = (targetId, label, kind) => {
    if (!targetId || !graph.stepsById.has(targetId)) return;
    raw.push(makeRawBranch(targetId, label, kind));
  };
  if (step.nextStepId) push(step.nextStepId, step.type === 'WAIT' ? 'success' : '', step.type === 'WAIT' ? 'wait_success' : 'next');
  if (step.onErrorStepId) push(step.onErrorStepId, 'error', step.type === 'WAIT' ? 'wait_error' : 'effect_error');
  if (step.onTimeoutStepId) push(step.onTimeoutStepId, 'timeout', 'wait_timeout');
  if (plainObject(step.cases)) {
    for (const [label, targetId] of Object.entries(step.cases)) push(targetId, label, detectBranchKind(label));
  }
  if (step.defaultNextStepId) push(step.defaultNextStepId, 'default', 'default');
  return raw;
}

function isWaitCollapseCandidate(step, graph) {
  if (step?.type !== 'EFFECT' || !step.nextStepId) return null;
  const waitStep = graph.stepsById.get(step.nextStepId);
  if (!waitStep || waitStep.type !== 'WAIT') return null;
  if (waitStep.sourceStepId !== step.id) return null;
  return waitStep;
}

function collectRawBranchesForInteraction(effectStep, waitStep, graph) {
  const raw = [];
  const push = (targetId, label, kind) => {
    if (!targetId || !graph.stepsById.has(targetId)) return;
    raw.push(makeRawBranch(targetId, label, kind));
  };
  if (waitStep.nextStepId) push(waitStep.nextStepId, 'success', 'wait_success');
  if (effectStep.onErrorStepId) push(effectStep.onErrorStepId, 'error', 'effect_error');
  if (waitStep.onErrorStepId) push(waitStep.onErrorStepId, 'error', 'wait_error');
  if (waitStep.onTimeoutStepId) push(waitStep.onTimeoutStepId, 'timeout', 'wait_timeout');
  return raw;
}

function groupBranches(rawBranches) {
  const grouped = new Map();
  for (const branch of rawBranches) {
    if (!grouped.has(branch.targetId)) grouped.set(branch.targetId, { targetId: branch.targetId, labels: [], kinds: [] });
    const item = grouped.get(branch.targetId);
    if (branch.label) item.labels.push(branch.label);
    item.kinds.push(branch.kind);
  }
  return Array.from(grouped.values()).map((entry) => {
    const labels = Array.from(new Set(entry.labels));
    const kinds = Array.from(new Set(entry.kinds)).sort((a, b) => branchPriority(a) - branchPriority(b));
    return {
      targetId: entry.targetId,
      label: labels.join(' / '),
      kind: kinds.length > 1 ? 'mixed' : (kinds[0] || 'case'),
      kinds,
    };
  }).sort(sortEdges);
}

function isTerminalFailStep(step) {
  return step?.type === 'TERMINAL' && step?.subtype === 'FAIL';
}

function failureOriginTitle(branch) {
  switch (branch.kind) {
    case 'effect_error': return 'Ошибка вызова операции';
    case 'wait_error': return 'Ошибка ожидания результата';
    case 'wait_timeout': return 'Таймаут ожидания результата';
    case 'default': return 'Ветка по умолчанию';
    default: return branch.label ? String(branch.label).toUpperCase() : 'Ошибка';
  }
}

function summarizeFailure(rawBranch, graph) {
  const step = graph.stepsById.get(rawBranch.targetId);
  return {
    label: rawBranch.label || '',
    kind: rawBranch.kind,
    kinds: [rawBranch.kind],
    originTitle: failureOriginTitle(rawBranch),
    stepId: step?.id || rawBranch.targetId,
    name: titleFromStep(step),
    description: step?.description || '',
    type: step?.type || '',
    subtype: step?.subtype || '',
    result: step?.result != null ? cloneJson(step.result) : undefined,
  };
}

function resolvePresentationStep(step, graph) {
  const waitStep = isWaitCollapseCandidate(step, graph);
  const rawBranches = waitStep
    ? collectRawBranchesForInteraction(step, waitStep, graph)
    : collectRawBranchesForStep(step, graph);
  return {
    sourceStepId: step.id,
    stepIds: waitStep ? [step.id, waitStep.id] : [step.id],
    step,
    waitStep,
    name: titleFromStep(step),
    description: step.description || waitStep?.description || '',
    kind: waitStep ? 'WAIT' : nodeKind(step),
    type: step.type || '',
    subtype: step.subtype || '',
    artefactId: step.artefactId,
    operationId: step.operationId,
    subflow: step.flowId ? { flowId: step.flowId, flowVersion: step.flowVersion || '' } : undefined,
    result: step.result != null ? cloneJson(step.result) : undefined,
    interaction: waitStep ? {
      mode: 'effect_wait',
      waitStepId: waitStep.id,
      waitName: titleFromStep(waitStep),
      waitDescription: waitStep.description || '',
    } : undefined,
    rawBranches,
    groupedBranches: groupBranches(rawBranches),
    hiddenFailures: [],
  };
}

function splitVisibleBranches(presentation, graph) {
  const groupedFailures = presentation.groupedBranches.filter((branch) => isTerminalFailStep(graph.stepsById.get(branch.targetId)));
  const groupedForward = presentation.groupedBranches.filter((branch) => !isTerminalFailStep(graph.stepsById.get(branch.targetId)));
  const rawFailures = presentation.rawBranches.filter((branch) => isTerminalFailStep(graph.stepsById.get(branch.targetId)));
  if (groupedForward.length > 0) {
    presentation.hiddenFailures = rawFailures.map((branch) => summarizeFailure(branch, graph));
    return groupedForward;
  }
  presentation.hiddenFailures = [];
  return groupedFailures;
}

function buildPresentationTree(graph) {
  let occurrenceIndex = 0;
  function visit(stepId, seenInPath = new Set()) {
    const step = graph.stepsById.get(stepId);
    if (!step) return null;

    const presentation = resolvePresentationStep(step, graph);
    occurrenceIndex += 1;

    const node = {
      id: `${step.id}__occ_${occurrenceIndex}`,
      sourceStepId: presentation.sourceStepId,
      step,
      kind: presentation.kind,
      type: presentation.type,
      subtype: presentation.subtype,
      name: presentation.name,
      description: presentation.description,
      artefactId: presentation.artefactId,
      operationId: presentation.operationId,
      subflow: presentation.subflow,
      result: presentation.result,
      interaction: presentation.interaction,
      hiddenFailures: presentation.hiddenFailures,
      // ── enrichment data built from raw step + graph ──────────────
      routingData: buildRoutingData(step, graph),
      contractData: buildContractData(step),
      terminalData: buildTerminalData(step),
      visibleLinks: [],
      measure: null,
    };

    if (presentation.stepIds.some((id) => seenInPath.has(id))) return node;

    const nextSeen = new Set(seenInPath);
    for (const id of presentation.stepIds) nextSeen.add(id);

    const visibleBranches = splitVisibleBranches(presentation, graph);
    node.hiddenFailures = presentation.hiddenFailures;
    for (const branch of visibleBranches) {
      const child = visit(branch.targetId, nextSeen);
      if (!child) continue;
      node.visibleLinks.push({ branch, child });
    }
    return node;
  }
  return visit(graph.entryStepId);
}

// ── layout ─────────────────────────────────────────────────────────────────

function measureSubtree(node) {
  if (node.measure) return node.measure;
  const childMeasures = node.visibleLinks.map((link) => ({ link, child: link.child, measure: measureSubtree(link.child) }));
  const placements = [];
  let top = 0, bottom = 0;

  if (childMeasures.length === 1) {
    placements.push({ link: childMeasures[0].link, child: childMeasures[0].child, rowOffset: 0 });
    top = Math.min(top, childMeasures[0].measure.top);
    bottom = Math.max(bottom, childMeasures[0].measure.bottom);
  } else if (childMeasures.length > 1) {
    let cursor = 0;
    const provisional = [];
    for (const item of childMeasures) {
      const span = Math.max(item.measure.bottom - item.measure.top, 0);
      provisional.push({ link: item.link, child: item.child, rowOffset: cursor - item.measure.top, top: item.measure.top, bottom: item.measure.bottom, span });
      cursor += span + FORWARD_BRANCH_GAP;
    }
    const totalHeight = cursor - FORWARD_BRANCH_GAP;
    const shift = -totalHeight / 2;
    for (const item of provisional) {
      const rowOffset = item.rowOffset + shift;
      placements.push({ link: item.link, child: item.child, rowOffset });
      top = Math.min(top, item.top + rowOffset);
      bottom = Math.max(bottom, item.bottom + rowOffset);
    }
  }
  node.measure = { top, bottom, placements };
  return node.measure;
}

function describeEntry(entry) {
  const data = {
    id: entry.id,
    sourceStepId: entry.sourceStepId,
    name: entry.name,
    description: entry.description || '',
    kind: entry.kind,
    type: entry.type,
    subtype: entry.subtype,
    hiddenFailureCount: entry.hiddenFailures.length,
  };

  if (entry.hiddenFailures.length) data.hiddenFailures = cloneJson(entry.hiddenFailures);
  if (entry.artefactId) data.artefactId = entry.artefactId;
  if (entry.operationId) data.operationId = entry.operationId;
  if (entry.subflow) data.subflow = cloneJson(entry.subflow);
  if (entry.result != null) data.result = cloneJson(entry.result);
  if (entry.interaction) data.interaction = cloneJson(entry.interaction);

  // Routing enrichment (CONTROL/ROUTE and CONTROL/SWITCH)
  if (entry.routingData) data.routing = cloneJson(entry.routingData);

  // Contract enrichment (PROCESS steps)
  if (entry.contractData) data.contract = cloneJson(entry.contractData);

  // Terminal merchant data
  if (entry.terminalData) {
    data.outcome = entry.terminalData.outcome;
    data.merchantMessage = entry.terminalData.merchantMessage;
    data.reasonCode = entry.terminalData.reasonCode;
    data.responseMode = entry.terminalData.responseMode;
  }

  return data;
}

function makeNode(entry, x, y) {
  const data = describeEntry(entry);
  return {
    id: entry.id,
    label: data.name,
    sourceStepId: entry.sourceStepId,
    position: { x, y },
    data,
  };
}

function makeEdge(sourceEntry, targetEntry, branch) {
  return {
    id: `${sourceEntry.id}__${targetEntry.id}`,
    source: sourceEntry.id,
    target: targetEntry.id,
    label: branch.label || '',
    kind: branch.kind,
    kinds: Array.isArray(branch.kinds) ? [...branch.kinds] : [branch.kind],
  };
}

function placeSubtree(entry, x, row, out) {
  out.nodes.push(makeNode(entry, x, row * Y_STEP));
  const measure = measureSubtree(entry);
  for (const item of measure.placements) {
    const childRow = row + item.rowOffset;
    out.edges.push(makeEdge(entry, item.child, item.link.branch));
    placeSubtree(item.child, x + X_STEP, childRow, out);
  }
}

function normalizePositions(nodes) {
  if (!nodes.length) return;
  const minX = Math.min(...nodes.map((n) => n.position.x));
  const minY = Math.min(...nodes.map((n) => n.position.y));
  const dx = TARGET_MIN_X - minX;
  const dy = TARGET_MIN_Y - minY;
  for (const node of nodes) {
    node.position.x = Math.round(node.position.x + dx);
    node.position.y = Math.round(node.position.y + dy);
  }
}

// ── public API ─────────────────────────────────────────────────────────────

/**
 * @param {object} flow - Flow3 source (with name/description, stripped by caller)
 * @param {object|null} artifactContext - Optional runtime artifact data for MAPPINGS/DECISIONS enrichment
 *   artifactContext.getMappingSource(artefactId) → raw mapping source object
 *   artifactContext.getDecisionArtifacts()       → array of all decision artifact entries
 */
export async function buildFlowGraphDocument(flow, artifactContext = null) {
  const graph = buildCanonicalGraph(flow);
  const root = buildPresentationTree(graph);

  if (!root) {
    return {
      flowId: graph.flowId, flowVersion: graph.flowVersion,
      name: graph.name, description: graph.description,
      entryStepId: graph.entryStepId, nodes: [], edges: [],
    };
  }

  measureSubtree(root);
  const out = { nodes: [], edges: [] };
  placeSubtree(root, 0, 0, out);
  normalizePositions(out.nodes);

  // Post-process: enrich MAPPINGS and DECISIONS nodes with artifact data
  if (artifactContext) {
    for (const node of out.nodes) {
      const d = node.data;
      if (d.type === 'PROCESS' && d.subtype === 'MAPPINGS' && d.artefactId) {
        const src = artifactContext.getMappingSource(d.artefactId);
        if (src) d.mappingFields = buildMappingFields(src);
      }
      if (d.type === 'PROCESS' && d.subtype === 'DECISIONS' && d.artefactId) {
        const arts = artifactContext.getDecisionArtifacts();
        const rules = buildDecisionRules(d.artefactId, arts);
        if (rules) d.decisionRules = rules;
      }
    }
  }

  return {
    flowId: graph.flowId, flowVersion: graph.flowVersion,
    name: graph.name, description: graph.description,
    entryStepId: graph.entryStepId,
    nodeSize: { width: NODE_WIDTH, height: NODE_HEIGHT },
    nodes: out.nodes, edges: out.edges,
  };
}
