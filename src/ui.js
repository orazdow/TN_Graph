import {formatValue} from './engine.js';

export function createUI(host, {onViewChange = () => {}} = {}) {
  host.innerHTML = `
    <header class="header">
      <div class="brand">TN <span>/ Workbench</span></div>
    </header>
    <main>
      <section class="sources-bar" aria-label="Data sources">
        <strong>Sources</strong>
        <div id="datasets">No datasets loaded</div>
        <div class="actions">
          <button id="sample" type="button">Load sample</button>
          <button id="add-json" class="primary" type="button">Add JSON</button>
          <input id="files" type="file" accept=".json,application/json" multiple hidden>
        </div>
      </section>

      <section class="toolbar" aria-label="Views and filters">
        <div class="tabs" role="tablist" aria-label="View">
          <button id="network-tab" class="active" role="tab" aria-selected="true" aria-controls="network" type="button">Network</button>
          <button id="table-tab" role="tab" aria-selected="false" aria-controls="table" tabindex="-1" type="button">Table</button>
        </div>
        <input id="query" type="search" placeholder="Search facts…" aria-label="Search facts">
        <select id="property" aria-label="Filter property"><option value="">All properties</option></select>
        <select id="tag" aria-label="Filter tag"><option value="">All tags</option></select>
        <button id="reset" type="button">Reset filters</button>
      </section>

      <section class="workspace" aria-label="Workbench">
        <div class="primary-view">
          <div class="network-tools">
            <button id="fit" type="button">Fit view</button>
          </div>

          <div id="network" class="view-panel" role="tabpanel" aria-labelledby="network-tab">
            <div class="empty-state"><strong>No network to display</strong><p>Your network will appear here.</p></div>
          </div>
          <div id="table" class="view-panel" role="tabpanel" aria-labelledby="table-tab" hidden>
            <table>
              <thead><tr><th scope="col">Subject</th><th scope="col">Property</th><th scope="col">Value</th><th scope="col">Tags</th><th scope="col">Dataset</th></tr></thead>
              <tbody><tr><td colspan="5" class="empty-table">No facts to display.</td></tr></tbody>
            </table>
            <div class="pagination"><button type="button" disabled>Previous</button><button type="button" disabled>Next</button><span>Page 1 of 1 · 0 facts</span></div>
          </div>
          <footer><span id="counts">0 subjects · 0 facts</span><span>Drag to pan · Scroll to zoom · Click to inspect</span></footer>
        </div>
        <aside class="sidebar" aria-label="Workbench options">
          <div class="sidebar-selector">
            <select id="sidebar-view" aria-label="Side panel view">
              <option value="inspector">Inspector</option>
              <option value="layout" selected>Layout</option>
              <option value="statements">Statements</option>
            </select>
          </div>
          <div class="sidebar-content">
            <section id="statements-panel" aria-label="Statements" hidden>
              <h2>Statements</h2>
              <p id="statements-count">0 statements</p>
              <div id="statements"></div>
            </section>
            <section id="inspector-panel" aria-label="Inspector" hidden>
              <h2>Inspector</h2>
              <p id="inspection-hint">Select a subject, connection, literal value, or table row.</p>
              <div id="inspector"></div>
            </section>
          <section id="layout-panel" class="layout-panel" aria-label="Layout">
            <h2>Layout &amp; appearance</h2><p id="layout-summary">Sugiyama · top to bottom</p>
            <div class="layout-grid network-view-control">
              <label>Network view<select id="network-view">
                <option value="references">Reference connectivity</option>
                <option value="all" selected>All values</option>
                <option value="facts">Fact graph</option>
                <option value="facts-references">Fact graph + references</option>
              </select></label>
            </div>
            <form id="layout-form">
              <div class="layout-grid">
                <label>Layout<select id="layout"><option value="sugiyama">Sugiyama — layered</option><option value="zherebko">Zherebko — linear</option></select></label>
                <label>Direction<select id="direction"><option value="TB">Top to bottom</option><option value="LR">Left to right</option></select></label>
                <label>Node separation<input id="node-gap" type="number" required min="0" max="300" value="45" step="5"></label>
                <label>Rank separation<input id="rank-gap" type="number" required min="0" max="300" value="70" step="5"></label>
              </div>
              <fieldset id="sugiyama-options"><legend>Sugiyama stages</legend>
                <div class="layout-grid">
                  <label>Layering<select id="layering"><option value="simplex">Simplex — shorter edges</option><option value="longest-path">Longest path — fewer ranks</option><option value="topological">Topological — one node per rank</option></select></label>
                  <label>Crossing reduction<select id="decross"><option value="two-layer">Two-layer heuristic</option><option value="dfs">Depth-first — fast</option><option value="optimal">Optimal — small graphs</option></select></label>
                  <label>Coordinates<select id="coord"><option value="simplex">Simplex — straighter edges</option><option value="greedy" selected>Greedy — fast</option><option value="quadratic">Quadratic</option><option value="topological" disabled>Topological</option></select></label>
                  <label>Crossing passes<input id="passes" type="number" required min="1" max="48" value="24"></label>
                </div>
                <label class="check-option" id="longest-option"><input id="longest-top-down" type="checkbox" checked> Place longest-path ranks from the top</label>
                <p class="option-help">Layering chooses ranks; crossing reduction orders nodes; coordinates set their positions. Topological layering uses matching topological coordinates.</p>
              </fieldset>
              <fieldset id="grid-options" hidden disabled><legend>Grid lanes</legend>
                <div class="layout-grid"><label>Lane assignment<select id="lane"><option value="greedy">Greedy — fast</option><option value="optimal">Optimal — small graphs</option></select></label></div>
                <div class="check-options">
                  <label><input id="compressed" type="checkbox" checked> Compress lanes</label>
                  <label><input id="bidirectional" type="checkbox"> Expand lanes both ways</label>
                  <label><input id="lane-top-down" type="checkbox" checked> Assign lanes from the top</label>
                </div>
              </fieldset>
              <fieldset><legend>Drawing</legend><div class="layout-grid">
                <label>Edges<select id="edge-style"><option value="curved">Curved routes</option><option value="routed">Routed segments</option><option value="straight">Direct connections</option></select></label>
                <label>Subject label size<input id="subject-label-size" type="number" required min="7" max="32" value="12"></label>
                <label>Value label size<input id="value-label-size" type="number" required min="7" max="32" value="12"></label>
                <label>Property label size<input id="property-label-size" type="number" required min="7" max="32" value="12"></label>
              </div><label class="check-option"><input id="scale-labels-with-zoom" type="checkbox"> Scale labels with zoom</label><p class="option-help">Unchecked: all label sizes stay fixed on screen. Checked: all labels grow and shrink with the graph.</p><p class="option-help">Direct connections bypass routing bends. Separate facts remain separate connections. Labels avoid nodes and other labels.</p></fieldset>
              <div class="layout-actions"><button id="layout-reset" type="button">Reset layout</button></div>
            </form>
          </section>
          </div>
        </aside>
      </section>
      <div id="layout-status" role="status" aria-live="polite"></div>
      <div id="notice" role="status"></div>
      <div id="error" role="alert" hidden></div>
    </main>
  `;

  const get = id => host.querySelector('#' + id);
  const controls = Object.fromEntries([
    'sample', 'add-json', 'files', 'datasets', 'query', 'property', 'tag',
    'reset', 'layout', 'network-view', 'fit', 'network', 'table',
    'counts', 'notice', 'error', 'inspector', 'inspection-hint',
    'sidebar-view', 'statements', 'statements-count',
    'layout-panel', 'layout-form', 'layout-summary', 'layout-status', 'layout-reset',
    'direction', 'layering', 'decross', 'coord', 'passes', 'node-gap', 'rank-gap',
    'sugiyama-options', 'grid-options', 'longest-option', 'longest-top-down',
    'lane', 'compressed', 'bidirectional', 'lane-top-down', 'edge-style', 'subject-label-size', 'value-label-size', 'property-label-size', 'scale-labels-with-zoom',
  ].map(id => [id, get(id)]));

  function setView(view) {
    const network = view === 'network';
    get('network').hidden = !network;
    get('table').hidden = network;
    host.querySelector('.network-tools').hidden = !network;
    for (const name of ['network', 'table']) {
      const tab = get(name + '-tab');
      const active = name === view;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    }
    onViewChange(view);
  }

  for (const name of ['network', 'table']) {
    const tab = get(name + '-tab');
    tab.addEventListener('click', () => setView(name));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 'network' : event.key === 'End' ? 'table' : name === 'network' ? 'table' : 'network';
      setView(next);
      get(next + '-tab').focus();
    });
  }
  function setSidebar(view) {
    controls['sidebar-view'].value = view;
    for (const name of ['inspector', 'layout', 'statements']) {
      get(name + '-panel').hidden = name !== view;
    }
  }
  controls['sidebar-view'].addEventListener('change', () => setSidebar(controls['sidebar-view'].value));

  controls['add-json'].addEventListener('click', () => controls.files.click());
  controls.reset.addEventListener('click', () => {
    controls.query.value = '';
    controls.property.value = '';
    controls.tag.value = '';
  });

  function updateLayoutFields() {
    const sugiyama = controls.layout.value === 'sugiyama';
    const grid = controls.layout.value === 'grid';
    controls['sugiyama-options'].hidden = !sugiyama;
    controls['sugiyama-options'].disabled = !sugiyama;
    controls['grid-options'].hidden = !grid;
    controls['grid-options'].disabled = !grid;
    const topological = controls.layering.value === 'topological';
    controls.coord.querySelector('[value="topological"]').disabled = !topological;
    if (topological) controls.coord.value = 'topological';
    else if (controls.coord.value === 'topological') controls.coord.value = 'greedy';
    controls.coord.disabled = topological;
    controls.passes.disabled = controls.decross.value !== 'two-layer';
    controls['longest-option'].hidden = controls.layering.value !== 'longest-path';
    const greedy = controls.lane.value === 'greedy';
    controls.bidirectional.disabled = !greedy;
    controls['lane-top-down'].disabled = !greedy;
  }
  for (const name of ['layout', 'layering', 'decross', 'lane']) controls[name].addEventListener('change', updateLayoutFields);
  updateLayoutFields();
  return {...controls, setView, setSidebar, updateLayoutFields};
}

export function renderSources(host, sources, onRemove) {
  host.replaceChildren();
  if (!sources.length) host.textContent = 'No datasets loaded';
  for (const source of sources) {
    const item = document.createElement('span');
    item.className = 'source';
    item.append(document.createTextNode(source.name + ' · ' + source.facts));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', 'Remove ' + source.name);
    remove.addEventListener('click', () => onRemove(source.id));
    item.append(remove);
    host.append(item);
  }
}

export function renderOptions(select, values, placeholder) {
  const previous = select.value;
  const options = [...new Set(values)].sort();
  select.replaceChildren(new Option(placeholder, ''), ...options.map(value => new Option(value, value)));
  select.value = options.includes(previous) ? previous : '';
}

export function renderTable(host, facts, {page = 0, selectedId, selectedSubjectId, onSelect, onPage}) {
  const pageSize = 100;
  const pages = Math.max(1, Math.ceil(facts.length / pageSize));
  page = Math.min(page, pages - 1);
  const body = host.querySelector('tbody');
  body.replaceChildren();
  if (!facts.length) {
    const cell = body.insertRow().insertCell();
    cell.colSpan = 5;
    cell.className = 'empty-table';
    cell.textContent = 'No facts to display.';
  }
  for (const fact of facts.slice(page * pageSize, (page + 1) * pageSize)) {
    const row = body.insertRow();
    row.tabIndex = 0;
    const selected = fact.id === selectedId || Boolean(selectedSubjectId && [fact.subjectId, fact.targetId].includes(selectedSubjectId));
    row.classList.toggle('selected', selected);
    row.setAttribute('aria-selected', String(selected));
    for (const value of [fact.subject, fact.property, formatValue(fact.value), fact.tags.join(', '), fact.sourceName]) {
      row.insertCell().textContent = value;
    }
    row.addEventListener('click', () => onSelect(fact.id));
    row.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onSelect(fact.id);
      }
    });
  }
  const nav = host.querySelector('.pagination');
  nav.replaceChildren();
  for (const [label, delta] of [['Previous', -1], ['Next', 1]]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.disabled = page + delta < 0 || page + delta >= pages;
    button.addEventListener('click', () => onPage(page + delta));
    nav.append(button);
  }
  nav.append(document.createTextNode('Page ' + (page + 1) + ' of ' + pages + ' · ' + facts.length + ' facts'));
}

export function renderInspector(host, fact) {
  host.replaceChildren();
  if (!fact) return;
  const table = document.createElement('table');
  table.className = 'inspection-details';
  table.setAttribute('aria-label', 'Selected fact details');
  const body = table.createTBody();
  for (const [label, value] of [
    ['Subject', fact.subject], ['Property', fact.property], ['Value', formatValue(fact.value)],
    ['Value type', fact.value.type], ['Tags', fact.tags.join(', ') || 'None'],
    ['Occurrences', fact.occurrenceCount ?? 1],
    ['Source', fact.occurrences ? [...new Set(fact.occurrences.map(item => item.sourceName))].join(', ') : fact.sourceName], ['Source ID', fact.sourceId],
    ['Original fact ID', fact.originalId], ['Original subject ID', fact.subject_id],
    ['Original statement', fact.statement ?? 'Not supplied'],
  ]) {
    const row = body.insertRow();
    const title = document.createElement('th');
    title.scope = 'row';
    title.textContent = label;
    row.append(title);
    row.insertCell().textContent = value;
  }
  host.append(table);
}

export function renderSubjectInspector(host, subject, snapshot, onSelect) {
  host.replaceChildren();
  const heading = document.createElement('h3');
  heading.textContent = subject.phrase;
  const incident = snapshot.facts.filter(fact => fact.subjectId === subject.id || fact.targetId === subject.id);
  const summary = document.createElement('p');
  const sources = new Set(subject.contributions.map(item => item.sourceId)).size;
  summary.textContent = incident.length + ' incident facts · ' + sources + ' sources';
  const table = document.createElement('table');
  table.className = 'inspection-facts';
  table.setAttribute('aria-label', 'Facts involving ' + subject.phrase);
  const head = table.createTHead().insertRow();
  for (const label of ['Direction', 'Property', 'Value']) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = label;
    head.append(cell);
  }
  const body = table.createTBody();
  for (const fact of incident) {
    const row = body.insertRow();
    row.tabIndex = 0;
    row.title = 'Inspect fact from ' + fact.sourceName;
    const outgoing = fact.subjectId === subject.id;
    row.insertCell().textContent = outgoing ? 'Outgoing' : 'Incoming';
    const property = row.insertCell();
    property.append(document.createTextNode(fact.property));
    if (!outgoing) {
      const from = document.createElement('small');
      from.textContent = 'from ' + fact.subject;
      property.append(from);
    }
    const value = row.insertCell();
    value.append(document.createTextNode(formatValue(fact.value)));
    const source = document.createElement('small');
    source.textContent = fact.sourceName;
    value.append(source);
    row.addEventListener('click', () => onSelect({factId: fact.id}));
    row.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onSelect({factId: fact.id});
      }
    });
  }
  host.append(heading, summary, table);
}

export function renderStatements(host, facts) {
  host.replaceChildren();
  if (!facts.length) {
    const empty = document.createElement('p');
    empty.textContent = 'No statements to display.';
    host.append(empty);
    return;
  }
  const table = document.createElement('table');
  table.className = 'statement-list';
  table.setAttribute('aria-label', 'Raw Statements');
  const body = table.createTBody();
  for (const fact of facts) {
    const cell = body.insertRow().insertCell();
    cell.append(document.createTextNode(fact.statement ?? 'Original statement not supplied.'));
    if (fact.occurrenceCount > 1) {
      const count = document.createElement('span');
      count.className = 'occurrence-count';
      count.textContent = ' (' + fact.occurrenceCount + ')';
      count.title = fact.occurrenceCount + ' imported occurrences';
      cell.append(count);
    }
  }
  host.append(table);
}
