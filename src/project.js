import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as semantics from '@processengine/semantics';
import * as mappings from '@processengine/mappings';
import * as rules from '@processengine/rules';
import { operatorPacks } from './operator-packs.js';
import { ProjectLoadError } from './errors.js';

const require = createRequire(import.meta.url);
const decisions = require('@processengine/decisions');

function stripPresentationFieldsDeep(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function stripFlowPresentationFields(flowSource) {
  if (!flowSource || typeof flowSource !== 'object' || Array.isArray(flowSource)) return flowSource;
  const out = stripPresentationFieldsDeep(flowSource);
  delete out.name;
  delete out.description;

  if (out.steps && typeof out.steps === 'object' && !Array.isArray(out.steps)) {
    for (const step of Object.values(out.steps)) {
      if (!step || typeof step !== 'object' || Array.isArray(step)) continue;
      delete step.name;
      delete step.description;
    }
  }

  return out;
}

function stripTopLevelPresentationFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const out = { ...value };
  delete out.name;
  delete out.description;
  return out;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new ProjectLoadError(`Failed to read JSON file: ${filePath}`, [
      `Failed to read JSON file: ${filePath}`,
      error?.message || 'Unknown JSON read error.'
    ], { filePath });
  }
}

function mustExist(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new ProjectLoadError(`${label} not found: ${filePath}`, [`${label} not found: ${filePath}`], { filePath, label });
  }
}

function rulesEntrypoints(rulesSource) {
  return new Set(Object.keys(rulesSource?.manifest?.catalog?.entrypoints || {}));
}

function decisionsEntrypoints(compiledDecisions) {
  if (compiledDecisions?.entrypoints?.keys) {
    return new Set([...compiledDecisions.entrypoints.keys()]);
  }
  return new Set();
}

function validateFlowDependencies(flowSource, context) {
  const errors = [];
  const steps = flowSource?.steps || {};
  for (const [stepId, step] of Object.entries(steps)) {
    if (!step || typeof step !== 'object') continue;
    if (step.type === 'PROCESS' && step.subtype === 'RULES') {
      if (!context.ruleEntrypoints.has(step.artefactId)) {
        errors.push(`Flow ${flowSource.id}@${flowSource.version} step ${stepId} references missing RULES artefactId: ${step.artefactId}`);
      }
    }
    if (step.type === 'PROCESS' && step.subtype === 'MAPPINGS') {
      if (!context.mappingIds.has(step.artefactId)) {
        errors.push(`Flow ${flowSource.id}@${flowSource.version} step ${stepId} references missing MAPPINGS artefactId: ${step.artefactId}`);
      }
    }
    if (step.type === 'PROCESS' && step.subtype === 'DECISIONS') {
      if (!context.decisionEntrypoints.has(step.artefactId)) {
        errors.push(`Flow ${flowSource.id}@${flowSource.version} step ${stepId} references missing DECISIONS artefactId: ${step.artefactId}`);
      }
    }
    if (step.type === 'EFFECT' && step.subtype === 'SUBFLOW') {
      if (!step.flowId || !step.flowVersion) {
        errors.push(`Flow ${flowSource.id}@${flowSource.version} step ${stepId} must define flowId and flowVersion for SUBFLOW.`);
      } else if (!context.hasFlow(step.flowId, step.flowVersion)) {
        errors.push(`Flow ${flowSource.id}@${flowSource.version} step ${stepId} references missing SUBFLOW ${step.flowId}@${step.flowVersion}`);
      }
    }
  }
  return errors;
}

function loadArtifactSet(setDir, config) {
  const manifestPath = path.join(setDir, config.artifactSetFile);
  mustExist(manifestPath, 'Artifact manifest');
  const manifest = readJson(manifestPath);

  const flowPath = path.join(setDir, manifest.flowFile);
  const rulesPath = path.join(setDir, manifest.rulesFile);
  const decisionsPath = path.join(setDir, manifest.decisionsFile);
  mustExist(flowPath, 'Flow file');
  mustExist(rulesPath, 'Rules file');
  mustExist(decisionsPath, 'Decisions file');

  const flowSource = readJson(flowPath);
  const flowRuntimeSource = stripFlowPresentationFields(flowSource);
  if (manifest.flowId && manifest.flowId !== flowSource.id) {
    throw new ProjectLoadError(`Artifact manifest flowId ${manifest.flowId} does not match flow.id ${flowSource.id}.`, [
      `Artifact manifest flowId ${manifest.flowId} does not match flow.id ${flowSource.id} in ${flowPath}`
    ], {
      manifestFlowId: manifest.flowId,
      flowId: flowSource.id,
      filePath: flowPath
    });
  }

  const flowValidation = semantics.validateFlow(flowRuntimeSource);
  if (!flowValidation.isValid) {
    throw new ProjectLoadError(`Flow validation failed for ${flowSource.id}@${flowSource.version}.`, [
      `Flow validation failed for ${flowSource.id}@${flowSource.version}: ${semantics.formatValidationIssues(flowValidation.errors)}`
    ], {
      flowId: flowSource.id,
      flowVersion: flowSource.version
    });
  }
  let preparedFlow;
  try {
    preparedFlow = semantics.prepareFlow(flowRuntimeSource);
  } catch (error) {
    throw new ProjectLoadError(`Flow prepare failed for ${flowSource.id}@${flowSource.version}.`, [
      `Flow prepare failed for ${flowSource.id}@${flowSource.version}: ${error?.message || 'Unknown prepare error.'}`
    ], {
      flowId: flowSource.id,
      flowVersion: flowSource.version
    });
  }

  const rulesSource = readJson(rulesPath);
  const operatorPack = operatorPacks[manifest.operatorPackId] || { check: {}, predicate: {} };
  let preparedRules;
  try {
    preparedRules = rules.prepareRules(rulesSource, { operators: operatorPack });
  } catch (error) {
    throw new ProjectLoadError(`Rules prepare failed for ${flowSource.id}@${flowSource.version}.`, [
      `Rules prepare failed for ${flowSource.id}@${flowSource.version}: ${error?.message || 'Unknown rules prepare error.'}`
    ], {
      flowId: flowSource.id,
      flowVersion: flowSource.version
    });
  }

  const mappingRegistry = new Map();
  for (const [mappingId, relPath] of Object.entries(manifest.mappingFiles || {})) {
    const mappingPath = path.join(setDir, relPath);
    mustExist(mappingPath, `Mapping file for ${mappingId}`);
    const source = readJson(mappingPath);
    let prepared;
    try {
      prepared = mappings.prepareMappings(source);
    } catch (error) {
      throw new ProjectLoadError(`Mapping prepare failed for ${mappingId} in ${flowSource.id}@${flowSource.version}.`, [
        `Mapping prepare failed for ${mappingId} in ${flowSource.id}@${flowSource.version}: ${error?.message || 'Unknown mapping prepare error.'}`
      ], {
        mappingId,
        flowId: flowSource.id,
        flowVersion: flowSource.version
      });
    }
    mappingRegistry.set(mappingId, { source, prepared, sourceNames: Object.keys(source.sources || {}) });
  }

  const decisionsSource = readJson(decisionsPath);
  const decisionsRuntimeSource = stripTopLevelPresentationFields(decisionsSource);
  let compiledDecisions;
  try {
    compiledDecisions = decisions.compile(decisionsRuntimeSource);
  } catch (error) {
    throw new ProjectLoadError(`Decisions compile failed for ${flowSource.id}@${flowSource.version}.`, [
      `Decisions compile failed for ${flowSource.id}@${flowSource.version}: ${error?.message || 'Unknown decisions compile error.'}`
    ], {
      flowId: flowSource.id,
      flowVersion: flowSource.version
    });
  }

  return {
    config,
    setDir,
    manifest,
    flowInfo: { id: flowSource.id, version: flowSource.version },
    flowSource,
    flowRuntimeSource,
    preparedFlow,
    rulesSource,
    preparedRules,
    decisionsSource,
    compiledDecisions,
    mappings: mappingRegistry,
    ruleEntrypoints: rulesEntrypoints(rulesSource),
    decisionEntrypoints: decisionsEntrypoints(compiledDecisions),
    getMapping(mappingId) {
      const found = mappingRegistry.get(mappingId);
      if (!found) throw new Error(`Prepared mapping is not registered: ${mappingId}`);
      return found;
    }
  };
}

function versionKey(flowId, flowVersion) {
  return `${flowId}@${flowVersion}`;
}

export function validateProcessProject(config) {
  const rootDir = config.artifactDir;
  mustExist(rootDir, 'Artifact root dir');

  const runtimes = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const setDir = path.join(rootDir, entry.name);
    const manifestPath = path.join(setDir, config.artifactSetFile);
    // Skip directories that do not contain the expected manifest file.
    // This prevents accidental directories (e.g. .git, tmp, __MACOSX) from
    // failing the entire bootstrap.
    if (!fs.existsSync(manifestPath)) continue;
    runtimes.push(loadArtifactSet(setDir, config));
  }

  if (!runtimes.length) {
    throw new ProjectLoadError(`No artifact sets found under: ${rootDir}`, [`No artifact sets found under: ${rootDir}`], { artifactDir: rootDir });
  }

  const byVersionKey = new Map();
  const byFlowId = new Map();
  for (const runtime of runtimes) {
    const key = versionKey(runtime.flowInfo.id, runtime.flowInfo.version);
    if (byVersionKey.has(key)) {
      throw new ProjectLoadError(`Duplicate flow runtime registered for ${key}`, [`Duplicate flow runtime registered for ${key}`], { flowKey: key });
    }
    byVersionKey.set(key, runtime);
    if (!byFlowId.has(runtime.flowInfo.id)) byFlowId.set(runtime.flowInfo.id, []);
    byFlowId.get(runtime.flowInfo.id).push(runtime);
  }

  const diagnostics = [];
  for (const runtime of runtimes) {
    diagnostics.push(...validateFlowDependencies(runtime.flowSource, {
      ruleEntrypoints: runtime.ruleEntrypoints,
      decisionEntrypoints: runtime.decisionEntrypoints,
      mappingIds: new Set(runtime.mappings.keys()),
      hasFlow(flowId, flowVersion) {
        return byVersionKey.has(versionKey(flowId, flowVersion));
      }
    }));
  }

  return {
    runtimes,
    diagnostics,
    hasErrors: diagnostics.length > 0,
    flowVersions: [...byVersionKey.keys()].sort()
  };
}

export function prepareProcessProject(config) {
  const report = validateProcessProject(config);
  if (report.hasErrors) {
    throw new ProjectLoadError('Process project validation failed.', report.diagnostics, { diagnosticsCount: report.diagnostics.length });
  }

  const runtimesByVersionKey = new Map();
  const runtimesByFlowId = new Map();
  for (const runtime of report.runtimes) {
    const key = versionKey(runtime.flowInfo.id, runtime.flowInfo.version);
    runtimesByVersionKey.set(key, runtime);
    if (!runtimesByFlowId.has(runtime.flowInfo.id)) runtimesByFlowId.set(runtime.flowInfo.id, []);
    runtimesByFlowId.get(runtime.flowInfo.id).push(runtime);
  }

  const defaultCandidates = runtimesByFlowId.get(config.defaultFlowId) || [];
  let defaultRuntime = null;
  if (config.defaultFlowVersion) {
    defaultRuntime = runtimesByVersionKey.get(versionKey(config.defaultFlowId, config.defaultFlowVersion)) || null;
  } else if (defaultCandidates.length === 1) {
    defaultRuntime = defaultCandidates[0];
  } else if (defaultCandidates.length > 1) {
    throw new ProjectLoadError(`Multiple versions registered for default flowId ${config.defaultFlowId}.`, [
      `Multiple versions registered for default flowId ${config.defaultFlowId}. Set PROCESSOR_DEFAULT_FLOW_VERSION explicitly.`
    ], {
      flowId: config.defaultFlowId
    });
  }
  if (!defaultRuntime) {
    defaultRuntime = report.runtimes[0];
  }

  return {
    kind: 'prepared-process-project',
    config,
    diagnostics: report.diagnostics,
    defaultRuntime,
    getRuntime(flowId, flowVersion = undefined) {
      if (flowVersion) {
        const exact = runtimesByVersionKey.get(versionKey(flowId, flowVersion));
        if (!exact) throw new Error(`Artifact set is not registered for flowId=${flowId}, flowVersion=${flowVersion}`);
        return exact;
      }
      const candidates = runtimesByFlowId.get(flowId) || [];
      if (!candidates.length) {
        throw new Error(`Artifact set is not registered for flowId: ${flowId}`);
      }
      if (candidates.length > 1) {
        throw new Error(`Multiple versions registered for flowId ${flowId}. Flow version must be specified explicitly.`);
      }
      return candidates[0];
    },
    getRuntimeByState(state) {
      return this.getRuntime(String(state.id), String(state.version));
    },
    getFlowSource(flowId, flowVersion = undefined) {
      return this.getRuntime(flowId, flowVersion).flowSource;
    },
    listFlows() {
      return [...runtimesByVersionKey.values()].map((runtime) => ({
        flowId: runtime.flowInfo.id,
        flowVersion: runtime.flowInfo.version,
        artifactSetId: runtime.manifest.artifactSetId,
        artifactSetVersion: runtime.manifest.artifactSetVersion,
        name: runtime.flowSource.name || runtime.flowInfo.id,
        description: runtime.flowSource.description || ''
      }));
    }
  };
}
