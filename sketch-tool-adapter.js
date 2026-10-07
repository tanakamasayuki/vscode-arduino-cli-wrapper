'use strict';
const YAML = require('yaml');
const DEFAULT_LIBRARIES_SOURCE = 'https://downloads.arduino.cc/libraries/library_index.json';
let toolPromise;
const getTool = () => toolPromise || (toolPromise = import('arduino-sketch-tool'));

function profileTemplate(text, name) {
  const doc = YAML.parseDocument(text);
  if (doc.errors.length) throw doc.errors[0];
  const profiles = doc.get('profiles', true);
  if (!YAML.isMap(profiles) || !profiles.has(name)) throw new Error(`Unknown profile: ${name}`);
  const result = new YAML.Document();
  const selected = profiles.clone();
  selected.items = selected.items.filter(pair => String(pair.key.value) === name);
  result.set('profiles', selected);
  result.set('default_profile', name);
  return String(result);
}

async function report(text, catalog) {
  const tool = await getTool();
  const parsed = tool.listSketchProfiles(text);
  const checked = tool.checkSketchVersions(text, catalog);
  return { parsed, entries: checked.entries.filter(e => e.kind !== 'local').map(e => ({
    ...e, currentVersion: e.version || '', currentIndexUrl: e.indexUrl || '',
    status: e.status === 'unpinned' ? 'missing' : e.status === 'incomparable' ? 'unknown' : e.status,
    indexUrlStatus: e.indexUrlStatus === 'different' ? 'outdated' : e.indexUrlStatus,
    platformId: e.kind === 'platform' ? e.name : undefined,
    libraryName: e.kind === 'library' ? e.name : undefined,
    packageUrl: e.latestIndexUrl || '',
    updateEligible: !!e.latestVersion && (e.kind !== 'platform' || !!e.version),
  })) };
}

async function updateSelected(text, selections, kind, catalog) {
  const tool = await getTool();
  const checked = tool.checkSketchVersions(text, catalog);
  const selected = checked.entries.filter(e => e.kind === kind && selections.some(row =>
    row.profile === e.profile && (row.platformId || row.libraryName).toLowerCase() === e.name.toLowerCase() &&
    (row.index === undefined || row.index === e.index)));
  for (const entry of selected) {
    const row = selections.find(r => r.profile === entry.profile && (r.platformId || r.libraryName).toLowerCase() === entry.name.toLowerCase() && (r.index === undefined || r.index === entry.index));
    if (row.currentVersion !== undefined && row.currentVersion !== (entry.version || '') ||
        kind === 'platform' && row.currentIndexUrl !== undefined && row.currentIndexUrl !== (entry.indexUrl || '')) {
      throw Object.assign(new Error('YAML changed since the version report was generated'), { code: 'CONFLICT' });
    }
  }
  const changes = tool.createVersionUpdatePlan({ entries: selected }, { updateIndexUrls: kind === 'platform' });
  // Missing library pins are repaired explicitly; unversioned cores stay protected.
  for (const entry of selected.filter(e => e.kind === 'library' && e.status === 'unpinned' && e.latestVersion)) {
    changes.push(...tool.createSetVersionPlan(text, { profiles: [entry.profile], libraries: [entry.name], version: entry.latestVersion }).filter(c => c.index === entry.index));
  }
  const unique = [...new Map(changes.map(c => [`${c.profile}|${c.kind}|${c.index}`, c])).values()];
  return { content: tool.applySketchUpdates(text, unique).content, applied: new Set(unique.map(c => `${c.profile}|${c.kind === 'index-url' ? 'platform' : c.kind}|${c.index}`)).size };
}

async function preview(text, options, catalog) {
  const tool = await getTool();
  if (!text.trim()) return tool.createSketchYaml({ profile: options.profile, fqbn: options.fqbn,
    platformVersion: options.version || undefined, platformIndexUrl: options.indexUrl || undefined,
    libraries: options.libraries.map(l => `${l.name} (${l.version})`),
  }, catalog).content;
  const parsed = tool.listSketchProfiles(text);
  const profile = parsed.profiles.find(p => p.name === options.profile) || parsed.profiles[0];
  const platform = profile.platforms.find(p => p.name === options.fqbn.split(':').slice(0, 2).join(':'));
  const edit = { profiles: [profile.name], fqbn: options.fqbn,
    platformVersion: options.version || undefined,
    localCore: !!platform && !platform.version && !options.version,
    pinUnversioned: options.pinUnversioned === true,
  };
  // Preserve project index URLs on the same platform; use the catalog URL for a new platform.
  if (!platform && options.indexUrl) edit.platformIndexUrl = options.indexUrl;
  if (options.updateLibraries) {
    const existing = profile.libraries.filter(l => l.kind === 'library');
    edit.removeLibraries = existing.filter(l => !options.libraries.some(s => s.name.toLowerCase() === l.name.toLowerCase())).map(l => l.name);
    edit.addLibraries = options.libraries.filter(l => !existing.some(e => e.name.toLowerCase() === l.name.toLowerCase())).map(l => `${l.name} (${l.version})`);
    for (const library of options.libraries.filter(l => existing.some(e => e.name.toLowerCase() === l.name.toLowerCase()))) {
      text = tool.applySketchUpdates(text, tool.createSetVersionPlan(text, { profiles: [profile.name], libraries: [library.name], version: library.version })).content;
    }
  }
  const plan = tool.createSketchEditPlan(text, edit, catalog);
  return tool.applySketchEditPlan(text, plan).content;
}

async function merge(text, payload, pinUnversioned = false) {
  const tool = await getTool();
  const parsed = tool.listSketchProfiles(payload);
  if (parsed.profiles.length !== 1) throw new Error('The helper requires exactly one profile');
  const name = parsed.profiles[0].name;
  const plan = tool.upsertSketchProfile(text, name, payload, { pinUnversioned });
  let content = tool.applySketchEditPlan(text, plan).content;
  // The helper textarea represents the full profile, so omitted fields are intentional removals.
  // The shared upsert validates/protects cores; only GUI-specific field removal is handled here.
  const supplied = YAML.parseDocument(payload).getIn(['profiles', name], true);
  const body = YAML.parseDocument(content, { keepSourceTokens: true }).getIn(['profiles', name], true);
  const removals = body.items.filter(pair => !supplied.has(pair.key.value)).map(pair => ({
    start: content.lastIndexOf('\n', pair.key.range[0] - 1) + 1, end: pair.value.range[2],
  })).sort((a, b) => b.start - a.start);
  for (const removal of removals) content = content.slice(0, removal.start) + content.slice(removal.end);
  const validation = tool.validateSketchConfiguration(content);
  if (!validation.valid) throw Object.assign(new Error(validation.diagnostics.filter(d => d.severity === 'error').map(d => d.message).join('; ')), { code: 'INVALID_YAML' });
  return { name, content };
}
async function setDefaultProfile(text, name) {
  const tool = await getTool();
  try {
    const plan = tool.createSketchEditPlan(text, { defaultProfile: name });
    return tool.applySketchEditPlan(text, plan).content;
  } catch (error) {
    if (error.code !== 'INVALID_YAML') throw error;
    // Profile selection must still repair a stale default or work with an incomplete sibling profile.
    const doc = YAML.parseDocument(text, { keepSourceTokens: true });
    if (doc.errors.length) throw error;
    const profiles = doc.get('profiles', true);
    if (!YAML.isMap(profiles) || !profiles.has(name)) throw error;
    const value = doc.get('default_profile', true);
    if (value?.anchor || YAML.isAlias(value)) throw error;
    if (value) return text.slice(0, value.range[0]) + JSON.stringify(name) + text.slice(value.range[1]);
    return text + (text.endsWith('\n') ? '' : '\n') + 'default_profile: ' + JSON.stringify(name) + '\n';
  }
}
async function libraryCatalog(data, source) {
  const tool = await getTool();
  const catalog = tool.createVersionCatalog(undefined, data);
  return { ...catalog, librarySource: source, retrievedAt: Date.now() };
}
async function libraryCatalogFromSource(input, source = input, options = {}) {
  const tool = await getTool();
  const catalog = await tool.loadLibraryCatalog(input, options);
  return { ...catalog, librarySource: source, retrievedAt: Date.now() };
}
const libraryCatalogFromFile = (filePath, source = filePath) => libraryCatalogFromSource(filePath, source);
module.exports = { DEFAULT_LIBRARIES_SOURCE, libraryCatalogFromSource, libraryCatalogFromFile, libraryCatalog, setDefaultProfile, getTool, profileTemplate, report, updateSelected, preview, merge };
