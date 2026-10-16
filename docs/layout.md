# Layout and appearance

The network uses d3-dag 1.2.2 for node placement and routed connection points. Graph preparation, connection paths, labels, p5 drawing, and interaction live together in src/graph-render.js. Facts and subject identities remain in Engine; changing a layout does not change the assertions.

Choose **Layout** at the top of the sidebar, change settings, and the view updates automatically. Numeric edits use a brief delay while typing. The Inspector tab displays selected facts in a field/value table, or incoming and outgoing facts for a selected subject. Selecting a connection, literal node, subject, or fact row opens Inspector; returning to Layout preserves the current layout controls. **Reset layout** restores the defaults without clearing data, filters, selection, or the literal-node checkbox.

## Layouts

- **Sugiyama** is the default layered layout. Layering assigns ranks, crossing reduction orders nodes within ranks, and coordinate assignment sets exact positions.
- **Zherebko** places nodes in a linear order and routes connections in side lanes.
- **Grid** places nodes in ordered rows and assigns lanes to route connections.

All three support top-to-bottom, bottom-to-top, left-to-right, and right-to-left drawing. Node separation changes spacing within a rank or between lanes; rank separation changes spacing along the layout direction.

## Sugiyama options

- Layering: simplex, longest path, or topological.
- Crossing reduction: two-layer heuristic, depth-first, or optimal.
- Coordinates: simplex, greedy, quadratic, or topological.
- Crossing passes apply to the two-layer heuristic.
- Longest-path layering can assign ranks from either end.

Topological layering automatically uses matching topological coordinates. The default is simplex layering, two-layer crossing reduction with 24 passes, and greedy coordinates.

## Grid options (currently hidden in the UI)

Choose greedy or optimal lane assignment. Compression is available for both; assignment from the top and expansion in both directions apply to the greedy method.

## Connections and labels

- Curved routes round bends in the library's routes.
- Routed segments join its routing points with straight lines.
- Direct connections bypass intermediate routing points. Parallel facts remain visually separate.

Drawing and picking use the same displayed path. Arrowheads follow its final direction and stop at node boundaries. Labels use measured text widths and try positions away from nodes, node captions, and other edge labels. If no position fits, the label is omitted; the fact remains inspectable by selecting its connection or table row.

These drawing choices are our renderer's responsibility. d3-dag does not place our edge labels.

## Data integrity and computation

Cycles, parallel facts, disconnected subjects, and self-links remain present. Some cyclic connections run against the apparent rank direction. Self-links are routed by our adapter. Grid can return coincident paths for parallel facts, so the adapter separates those paths while preserving their original IDs and direction.

Layout runs in a module worker. A newer request cancels the older one. Library checks for expensive optimal algorithms remain enabled; calculations that exceed 15 seconds are stopped with a visible error. The table and source facts remain available after layout failure.

Layout defaults, algorithms, worker handling, and request/cancellation functions live in src/layout.js. The Rollup build emits main.js and layout.js into dist; layout.js also serves as the module worker entry. Use the existing local server on port 5000.

The default sample is selected by DEFAULT_SAMPLE in src/main.js.

## Reference

- [Interactive examples](https://erikbrinkman.github.io/d3-dag/documents/examples.html?layout=sugiyama)
- [Sugiyama stages](https://erikbrinkman.github.io/d3-dag/interfaces/src.Sugiyama.html)
- [Zherebko](https://erikbrinkman.github.io/d3-dag/interfaces/src.Zherebko.html)
- [Grid](https://erikbrinkman.github.io/d3-dag/interfaces/src.Grid.html)
