// Connect data, filters, graph layout, and the workbench UI.
import {Engine, selectFacts, groupFacts, factFieldKey, matchesFactFilters, toggleFactFilter, toggleSelection, toggleStatementSelection, factsForSelection} from './engine.js';
import {createGraph, NetworkRenderer} from './graph-render.js';
import {DEFAULT_LAYOUT, normalizeLayout, requestLayout} from './layout.js';
import {createUI, renderSources, renderFilterOptions, renderTable, renderInspector, renderSubjectInspector, renderSelectionInspector, renderStatements} from './ui.js';

const DEFAULT_SAMPLE = './samples/construction/engineering-smallest-2.json';

const engine = new Engine();
let layoutRevision = 0;
let layoutOptions = {...DEFAULT_LAYOUT};
let graphViewport;
let appearance = {edgeStyle: 'curved', subjectLabelSize: 12, valueLabelSize: 12, propertyLabelSize: 12, scaleLabelsWithZoom: false};
let network;
const ui = createUI(document.querySelector('#app'), {onViewChange() { network?.resize(); }});
let selection = [];
let inspectedFactId = null;
let page = 0;
let tableField = null;
const statementFields = new Set();
let snapshot = engine.getCollection();
let facts = [];
let tableFacts = [];
// Null means all, including future imports; an empty set explicitly means none.
let filterChoices = {subject: null, property: null, value: null, tag: null};
let referenceProperties = null;
const filterMenus = ['property', 'tag', 'references'];
let filterValues = {property: [], tag: [], references: []};
network = new NetworkRenderer(ui.network, {p5: window.p5, onSelect: select});

function showError(message = '') {
  ui.error.textContent = message;
  ui.error.hidden = !message;
}

function menuChoices(field) {
  return field === 'references' ? referenceProperties : filterChoices[field];
}

function setMenuChoices(field, choices) {
  if (field === 'references') referenceProperties = choices;
  else filterChoices = {...filterChoices, [field]: choices};
}

function select(next, multiple = false) {
  selection = toggleSelection(selection, next, multiple);
  inspectedFactId = null;
  if (next) ui.setSidebar('inspector');
  if (next?.factId) {
    const index = tableFacts.findIndex(fact => fact.id === next.factId);
    if (index >= 0) page = Math.floor(index / 100);
  }
  renderSelection();
}

// Sync the table, Inspector, and graph selection.
function renderSelection() {
  const highlighted = inspectedFactId ? [...selection, {factId: inspectedFactId}] : selection;
  for (const button of ui['statement-modes'].querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.field ? statementFields.has(button.dataset.field) : statementFields.size === 0));
  }
  renderStatements(ui.statements, facts, {selection, fields: [...statementFields], onSelect(ids, multiple) {
    const current = factsForSelection(snapshot.facts, selection).map(fact => ({factId: fact.id}));
    selection = toggleStatementSelection(current, ids, multiple);
    inspectedFactId = null;
    renderSelection();
  }});
  renderTable(ui.table, tableFacts, {
    filters: filterChoices, tableField,
    onColumn(field) { tableField = field; page = 0; renderSelection(); },
    onFilter(field, key, multiple) {
      filterChoices = toggleFactFilter(filterChoices, field, key, multiple);
      render();
    },
    onClearField(field) { filterChoices = {...filterChoices, [field]: null}; render(); },
    onClearFilters() {
      filterChoices = {subject: null, property: null, value: null, tag: null};
      ui.query.value = '';
      render();
    },
    page, selection: highlighted,
    onSelect(id, multiple) { select({factId: id}, multiple); },
    onPage(next) { page = next; renderSelection(); ui.table.scrollTop = 0; },
  });
  const selectedFact = snapshot.facts.find(fact => fact.id === selection[0]?.factId);
  const selectedSubject = snapshot.subjects.find(subject => subject.id === selection[0]?.subjectId);
  if (selection.length > 1) renderSelectionInspector(ui.inspector, selection, snapshot, {
    inspectedFactId,
    onRemove(item) { select(item, true); },
    onClear() { select(null); },
    onInspect(id, multiple) {
      if (multiple) select({factId: id}, true);
      else { inspectedFactId = id; renderSelection(); }
    },
    onBack() { inspectedFactId = null; renderSelection(); },
  });
  else if (selectedSubject) renderSubjectInspector(ui.inspector, selectedSubject, snapshot, select);
  else renderInspector(ui.inspector, selectedFact);
  ui['inspection-hint'].hidden = Boolean(selectedFact || selectedSubject);
  const hidden = selection.filter(item => !factsForSelection(facts, [item]).length).length;
  ui.notice.textContent = hidden ? hidden + ' selected item' + (hidden === 1 ? ' is' : 's are') + ' outside the current filters.' : '';
  network.setSelection(highlighted);
}

function readLayout() {
  return normalizeLayout({
    algorithm: ui.layout.value, direction: ui.direction.value,
    layering: ui.layering.value, decross: ui.decross.value, coord: ui.coord.value,
    passes: ui.passes.disabled ? DEFAULT_LAYOUT.passes : Number(ui.passes.value), nodeGap: Number(ui['node-gap'].value), rankGap: Number(ui['rank-gap'].value),
    autoRankGap: ui['auto-rank-gap'].checked,
    longestTopDown: ui['longest-top-down'].checked, lane: ui.lane.value,
    compressed: ui.compressed.checked, bidirectional: ui.bidirectional.checked, laneTopDown: ui['lane-top-down'].checked,
  });
}

// Filter the collection, update views, and calculate graph geometry.
async function render({preserveCamera = false} = {}) {
  snapshot = engine.getCollection();
  snapshot.facts = groupFacts(snapshot.facts);
  filterValues = {
    property: snapshot.facts.map(fact => fact.property),
    tag: snapshot.facts.flatMap(fact => fact.tags),
    references: snapshot.facts.filter(fact => fact.targetId).map(fact => fact.property),
  };
  // Drop filter choices whose facts were removed.
  for (const field of Object.keys(filterChoices)) {
    if (filterChoices[field] === null) continue;
    const available = new Set(field === 'tag' ? filterValues.tag : snapshot.facts.map(fact => factFieldKey(fact, field)));
    const remaining = new Set([...filterChoices[field]].filter(key => available.has(key)));
    filterChoices[field] = filterChoices[field].size && !remaining.size ? null : remaining;
  }
  if (referenceProperties !== null) referenceProperties = new Set([...referenceProperties].filter(value => filterValues.references.includes(value)));
  for (const field of filterMenus) renderFilterOptions(ui[field], filterValues[field], menuChoices(field));
  // Search limits the browsable rows; all other fact filters dim rather than hide them.
  tableFacts = selectFacts(snapshot, {query: ui.query.value});
  facts = tableFacts.filter(fact => matchesFactFilters(fact, filterChoices));
  page = Math.min(page, Math.max(0, Math.ceil(tableFacts.length / 100) - 1));
  const factIds = new Set(snapshot.facts.map(fact => fact.id));
  const subjectIds = new Set(snapshot.subjects.map(subject => subject.id));
  selection = selection.filter(item => item.factId ? factIds.has(item.factId) : subjectIds.has(item.subjectId));
  if (selection.length < 2 || !factIds.has(inspectedFactId)) inspectedFactId = null;
  renderSources(ui.datasets, snapshot.sources, sourceId => { engine.remove(sourceId); render(); });
  const graph = createGraph(snapshot, facts, {view: ui['network-view'].value, includeLiterals: ui['network-view'].value === 'all',
    referenceProperties,
    filtered: Boolean(ui.query.value) || Object.values(filterChoices).some(choices => choices !== null)});
  renderSelection();
  const [subjectCount, propertyCount, valueCount] = ['subject', 'property', 'value']
    .map(field => new Set(facts.map(fact => factFieldKey(fact, field))).size);
  ui.counts.textContent = facts.length + ' / ' + snapshot.facts.length + ' statements · ' + subjectCount +
    ' subjects · ' + propertyCount + ' properties · ' + valueCount + ' values';
  const revision = ++layoutRevision;
  ui['layout-status'].textContent = 'Calculating layout…';
  try {
    const options = layoutOptions;
    network.setAppearance(appearance);
    if (ui.network.clientWidth > 0 && ui.network.clientHeight > 0) {
      graphViewport = {width: ui.network.clientWidth, height: ui.network.clientHeight};
    }
    const geometry = await requestLayout(graph, options, graphViewport);
    // Ignore results superseded by a newer render.
    if (!geometry || revision !== layoutRevision) return;
    network.setGraph(graph, geometry, {fit: !preserveCamera});
    ui['rank-gap-status'].textContent = options.autoRankGap && options.algorithm === 'sugiyama'
      ? 'Automatic rank separation: ' + geometry.settings.rankGap
      : 'Manual rank separation: ' + options.rankGap;
    const names = {sugiyama: 'Sugiyama', zherebko: 'Zherebko', grid: 'Grid'};
    const directions = {TB: 'top to bottom', BT: 'bottom to top', LR: 'left to right', RL: 'right to left'};
    ui['layout-summary'].textContent = names[options.algorithm] + ' · ' + directions[options.direction];
    ui['layout-status'].textContent = names[options.algorithm] + ' · ' + graph.nodes.length + ' nodes · ' + graph.edges.length + ' edges' +
      (geometry.cyclic ? ' · Cycles retained; some connections run against the layout direction.' : '');
  } catch (error) {
    if (revision !== layoutRevision) return;
    network.setGraph({nodes: [], edges: []}, {positions: new Map(), routes: new Map()});
    ui['layout-status'].textContent = 'Layout could not be calculated. Your facts are still available in Table.';
    showError(error.message);
  }
}

ui.sample.addEventListener('click', async () => {
  ui.sample.disabled = true;
  try {
    const response = await fetch(DEFAULT_SAMPLE);
    if (!response.ok) throw new Error('Cannot load sample: HTTP ' + response.status);
    const sample = await response.json();
    engine.add(sample, {name: sample.name ?? 'Sample'});
    page = 0;
    showError();
    await render();
  } catch (error) {
    showError(error.message);
  } finally {
    ui.sample.disabled = false;
  }
});

// Import each file independently so one invalid file does not block the rest.
ui.files.addEventListener('change', async () => {
  const errors = [];
  for (const file of ui.files.files) {
    try {
      engine.add(await file.text(), {name: file.name, format: /\.tn$/i.test(file.name) ? 'tn' : 'json'});
    }
    catch (error) { errors.push(file.name + ': ' + error.message); }
  }
  ui.files.value = '';
  page = 0;
  await render();
  if (errors.length) showError(errors.join('\n'));
});

function filter() { page = 0; render(); }
ui.query.addEventListener('input', filter);
for (const field of filterMenus) {
  ui[field].addEventListener('change', event => {
    if (event.target.type !== 'checkbox') return;
    const available = new Set(filterValues[field]);
    const next = new Set(menuChoices(field) ?? available);
    if (event.target.checked) next.add(event.target.value);
    else next.delete(event.target.value);
    setMenuChoices(field, next.size === available.size ? null : next);
    filter();
  });
  ui[field].addEventListener('click', event => {
    const action = event.target.closest('button[data-filter-action]')?.dataset.filterAction;
    if (!action) return;
    setMenuChoices(field, action === 'all' ? null : new Set());
    filter();
  });
}
ui.reset.addEventListener('click', () => {
  filterChoices = {subject: null, property: null, value: null, tag: null};
  referenceProperties = null;
  for (const field of filterMenus) ui[field].open = false;
  filter();
});
let layoutTimer;
function applyLayout({appearanceOnly = false, preserveCamera = false} = {}) {
  clearTimeout(layoutTimer);
  ui.updateLayoutFields();
  if (!ui['layout-form'].checkValidity()) return;
  layoutOptions = readLayout();
  appearance = {
    edgeStyle: ui['edge-style'].value,
    subjectLabelSize: Number(ui['subject-label-size'].value),
    valueLabelSize: Number(ui['value-label-size'].value),
    propertyLabelSize: Number(ui['property-label-size'].value),
    scaleLabelsWithZoom: ui['scale-labels-with-zoom'].checked,
  };
  showError();
  // Manual spacing changes rebuild geometry without changing the camera.
  if (appearanceOnly) network.setAppearance(appearance);
  else render({preserveCamera});
}
ui['layout-form'].addEventListener('input', event => {
  clearTimeout(layoutTimer);
  const appearanceOnly = ['edge-style', 'subject-label-size', 'value-label-size',
    'property-label-size', 'scale-labels-with-zoom'].includes(event.target.id);
  const preserveCamera = ['node-gap', 'rank-gap'].includes(event.target.id);
  if (event.target.type === 'number') layoutTimer = setTimeout(() => applyLayout({appearanceOnly, preserveCamera}), 180);
  else applyLayout({appearanceOnly});
});
ui['layout-form'].addEventListener('submit', event => {
  event.preventDefault();
  applyLayout({preserveCamera: true});
});
ui['layout-reset'].addEventListener('click', () => {
  ui['layout-form'].reset();
  applyLayout();
});
ui['network-view'].addEventListener('change', render);
ui['statement-modes'].addEventListener('click', event => {
  const button = event.target.closest('button[data-field]');
  if (!button) return;
  const field = button.dataset.field;
  if (!field) statementFields.clear();
  else if (statementFields.has(field)) statementFields.delete(field);
  else statementFields.add(field);
  renderSelection();
});
ui.fit.addEventListener('click', () => network.fit());
let resizeTimer;
const layoutResizeObserver = new ResizeObserver(() => {
  if (!layoutOptions.autoRankGap || layoutOptions.algorithm !== 'sugiyama' ||
    !ui.network.clientWidth || !ui.network.clientHeight) return;
  if (graphViewport?.width === ui.network.clientWidth && graphViewport?.height === ui.network.clientHeight) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(render, 180);
});
layoutResizeObserver.observe(ui.network);
render();
