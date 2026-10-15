export function createUI(host) {
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
            <select id="layout" aria-label="Layout">
              <option value="layered">d3-dag layered layout</option>
              <option value="force">Force layout</option>
              <option value="circular">Circular layout</option>
            </select>
            <label><input id="literals" type="checkbox" checked> Literal values</label>
            <label><input id="labels" type="checkbox"> Edge labels</label>
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
          <footer><span id="counts">0 subjects · 0 facts</span><span>Drag to move · Scroll to zoom · Click to inspect</span></footer>
        </div>
        <aside aria-label="Inspector">
          <h2>Inspector</h2>
          <p id="inspection-hint">Select a subject, connection, or table row.</p>
          <div id="inspector"></div>
        </aside>
      </section>
      <div id="notice" role="status"></div>
      <div id="error" role="alert" hidden></div>
    </main>
  `;

  const get = id => host.querySelector('#' + id);
  const controls = Object.fromEntries([
    'sample', 'add-json', 'files', 'datasets', 'query', 'property', 'tag',
    'reset', 'layout', 'literals', 'labels', 'fit', 'network', 'table',
    'inspector', 'counts', 'notice', 'error',
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
  controls['add-json'].addEventListener('click', () => controls.files.click());
  controls.reset.addEventListener('click', () => {
    controls.query.value = '';
    controls.property.value = '';
    controls.tag.value = '';
  });

  // Data loading, filtering, layout, and rendering will be connected separately.
  return controls;
}
