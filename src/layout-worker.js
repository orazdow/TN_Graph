import {computeLayout} from './layout.js';

self.onmessage = ({data}) => {
  try { self.postMessage({result: computeLayout(data.graph, data.options)}); }
  catch (error) { self.postMessage({error: error.message}); }
};
