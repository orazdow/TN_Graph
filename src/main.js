import {Engine, selectFacts, groupFacts} from './engine.js';
import {createGraph, NetworkRenderer} from './graph-render.js';
import {DEFAULT_LAYOUT, normalizeLayout, requestLayout} from './layout.js';
import {createUI, renderSources, renderOptions, renderTable, renderInspector, renderSubjectInspector, renderStatements} from './ui.js';

const DEFAULT_SAMPLE = './samples/construction/engineering-smallest-2.json';

const engine = new Engine();
let layoutRevision = 0;
let layoutOptions = {...DEFAULT_LAYOUT};
let appearance = {edgeStyle: 'curved', subjectLabelSize: 12, valueLabelSize: 12, propertyLabelSize: 12, scaleLabelsWithZoom: false};
let network;
const ui = createUI(document.querySelector('#app'), {onViewChange() { network?.resize(); }});
let selection = null;
let page = 0;
let snapshot = engine.snapshot();
let facts = [];
network = new NetworkRenderer(ui.network, {p5: window.p5, onSelect: select});

function showError(message = '') {
  ui.error.textContent = message;
  ui.error.hidden = !message;
}

function select(next) {
  selection = next;
  if (next) ui.setSidebar('inspector');
  if (next?.factId) {
    const index = facts.findIndex(fact => fact.id === next.factId);
    if (index >= 0) page = Math.floor(index / 100);
  }
  renderSelection();
}

function renderSelection() {
  renderTable(ui.table, facts, {
    page, selectedId: selection?.factId, selectedSubjectId: selection?.subjectId,
    onSelect(id) { select({factId: id}); },
    onPage(next) { page = next; renderSelection(); ui.table.scrollTop = 0; },
  });
  const selectedFact = snapshot.facts.find(fact => fact.id === selection?.factId);
  const selectedSubject = snapshot.subjects.find(subject => subject.id === selection?.subjectId);
  if (selectedSubject) renderSubjectInspector(ui.inspector, selectedSubject, snapshot, select);
  else renderInspector(ui.inspector, selectedFact);
  ui['inspection-hint'].hidden = Boolean(selectedFact || selectedSubject);
  const hiddenSelection = selection && !facts.some(fact => fact.id === selection.factId || [fact.subjectId, fact.targetId].includes(selection.subjectId));
  ui.notice.textContent = hiddenSelection ? 'The selection is outside the current filters.' : '';
  network.setSelection(selection);
}

function readLayout() {
  return normalizeLayout({
    algorithm: ui.layout.value, direction: ui.direction.value,
    layering: ui.layering.value, decross: ui.decross.value, coord: ui.coord.value,
    passes: ui.passes.disabled ? DEFAULT_LAYOUT.passes : Number(ui.passes.value), nodeGap: Number(ui['node-gap'].value), rankGap: Number(ui['rank-gap'].value),
    longestTopDown: ui['longest-top-down'].checked, lane: ui.lane.value,
    compressed: ui.compressed.checked, bidirectional: ui.bidirectional.checked, laneTopDown: ui['lane-top-down'].checked,
  });
}

async function render() {
  snapshot = engine.snapshot();
  snapshot.facts = groupFacts(snapshot.facts);
  renderOptions(ui.property, snapshot.facts.map(fact => fact.property), 'All properties');
  renderOptions(ui.tag, snapshot.facts.flatMap(fact => fact.tags), 'All tags');
  const filters = {query: ui.query.value, property: ui.property.value, tag: ui.tag.value};
  facts = selectFacts(snapshot, filters);
  renderStatements(ui.statements, facts);
  ui['statements-count'].textContent = facts.length + ' / ' + snapshot.facts.length + ' unique statements · current filters';
  page = Math.min(page, Math.max(0, Math.ceil(facts.length / 100) - 1));
  if (selection?.factId && !snapshot.facts.some(fact => fact.id === selection.factId)) selection = null;
  if (selection?.subjectId && !snapshot.subjects.some(subject => subject.id === selection.subjectId)) selection = null;
  renderSources(ui.datasets, snapshot.sources, sourceId => { engine.remove(sourceId); render(); });
  const graph = createGraph(snapshot, facts, {view: ui['network-view'].value, includeLiterals: ui['network-view'].value === 'all', filtered: Object.values(filters).some(Boolean)});
  renderSelection();
  ui.counts.textContent = snapshot.subjects.length + ' subjects · ' + facts.length + ' / ' + snapshot.facts.length + ' facts · ' + graph.edges.length + ' edges';
  const revision = ++layoutRevision;
  ui['layout-status'].textContent = 'Calculating layout…';
  try {
    const options = layoutOptions;
    network.setAppearance(appearance);
    const geometry = await requestLayout(graph, options);
    if (!geometry || revision !== layoutRevision) return;
    network.setGraph(graph, geometry);
    network.setSelection(selection);
    const names = {sugiyama: 'Sugiyama', zherebko: 'Zherebko', grid: 'Grid'};
    const directions = {TB: 'top to bottom', BT: 'bottom to top', LR: 'left to right', RL: 'right to left'};
    ui['layout-summary'].textContent = names[options.algorithm] + ' · ' + directions[options.direction];
    ui['layout-status'].textContent = names[options.algorithm] + ' · ' + graph.nodes.length + ' nodes · ' + graph.edges.length + ' edges · ' + geometry.elapsed.toFixed(1) + ' ms' +
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

ui.files.addEventListener('change', async () => {
  const errors = [];
  for (const file of ui.files.files) {
    try { engine.add(JSON.parse(await file.text()), {name: file.name}); }
    catch (error) { errors.push(file.name + ': ' + error.message); }
  }
  ui.files.value = '';
  page = 0;
  await render();
  if (errors.length) showError(errors.join('\n'));
});

function filter() { page = 0; render(); }
ui.query.addEventListener('input', filter);
ui.property.addEventListener('change', filter);
ui.tag.addEventListener('change', filter);
ui.reset.addEventListener('click', filter);
let layoutTimer;
function applyLayout({appearanceOnly = false} = {}) {
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
  if (appearanceOnly) network.setAppearance(appearance);
  else render();
}
ui['layout-form'].addEventListener('input', event => {
  clearTimeout(layoutTimer);
  const appearanceOnly = ['edge-style', 'subject-label-size', 'value-label-size',
    'property-label-size', 'scale-labels-with-zoom'].includes(event.target.id);
  if (event.target.type === 'number') layoutTimer = setTimeout(() => applyLayout({appearanceOnly}), 180);
  else applyLayout({appearanceOnly});
});
ui['layout-form'].addEventListener('submit', event => {
  event.preventDefault();
  applyLayout();
});
ui['layout-reset'].addEventListener('click', () => {
  ui['layout-form'].reset();
  applyLayout();
});
ui['network-view'].addEventListener('change', render);
ui.fit.addEventListener('click', () => network.fit());
render();
