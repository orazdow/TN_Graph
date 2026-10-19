TN graph connectivity tool

running:
From the lib folder:
  npm ci             Install dependencies.
  npm run build      Build the browser files into dist.
  npm run serve      Build, watch for changes, and serve at http://127.0.0.1:5000.
Stop any other server using port 5000 before serving.

function:

This graph library shows multiple views into a selected set of truenumbers.
This can include reference connectivity and interactive filters.
Other ways to slice and reduce the data into visualizations can be added,
including planar projection and different sorting topologies. These are not
currently implemented.

implementation:

This library uses three layers.
--graph construction: The selected facts become nodes and labeled edges for the
chosen view. d3-dag calculates node positions and edge routes using layered
Sugiyama or linear Zherebko layouts. Fact views arrange subject groups separately;
reference links can then be drawn between value nodes and their target subjects.

--acquisition: Native TN JSON and .tn statement files are imported through Add data.
Both formats become a private graph model of subjects and facts. Canonical
phrase paths join subjects across sources, while repeated matching facts are displayed
once with occurrence counts. Search, property/tag filters, and table selections
choose which facts appear in the graph and statement list.
(Set operations in data inclusion can be added later.)

TN input supports "subject has property = value", "property of subject is value",
and "and has" continuations. Separate statements with semicolons or newlines.
Numbers retain their units, quoted values become strings, and unquoted phrases
become subject references. Optional tags can follow the subject or value.
Original statements are retained. Invalid input reports a line number and leaves
that file unimported. Numeric tolerances and phrase paths are supported. Dates,
file objects, and unit conversion are not supported by the text parser.
Native JSON is read from its structured fields; original records and statements
are retained as metadata. The former simple JSON file format is no longer used.

--rendering: p5 draws the graph on an HTML canvas using the calculated geometry.
It handles panning, zooming, labels, and clicking nodes or edges for inspection.
Layout runs in a worker. The rendering library is p5, not d3.js; d3-dag supplies
the layout calculations.

concept:

A truenumber-style fact records a subject, property, typed value, and optional
context tags. Values can be numbers with units, text, or references to other
subjects. A graph tool lets these facts be explored both as individual assertions
and as a connected network, while filters help isolate relevant subjects,
properties, values, or contexts. Shared tags or equal numbers do not themselves
create reference connections.

For example

plate outer west bay has temperature = 347.33 K (design revision B, north bay);

bolt rear service bay has coupled shaft = shaft inner lower deck (design revision A, design revision B);

shaft inner lower deck has diameter = 41.3 mm;

plate outer west bay has fastener = bolt rear service bay (design revision B, workshop);

integration:

A Python application could pass JSON into the graph running in a webview, or
embed it in an iframe inside an ipynb notebook. A small embedding interface and
host bridge would let Python send new data and receive selection events, keeping
the display live as the data changes. This integration is not implemented yet;
the current entry point starts the standalone workbench. The host must support
the JavaScript modules, canvas, and layout worker used by the graph.
