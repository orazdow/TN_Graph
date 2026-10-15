import {nodeResolve} from '@rollup/plugin-node-resolve';
import serve from 'rollup-plugin-serve';
import livereload from 'rollup-plugin-livereload';

const development = process.env.ROLLUP_WATCH === 'true';

export default {
  input: {main: 'src/main.js', 'layout-worker': 'src/layout-worker.js'},
  output: {
    dir: 'dist',
    format: 'es',
    sourcemap: true,
  },
  plugins: [nodeResolve({browser: true}), ...(development ? [
    serve({contentBase: '.', host: '127.0.0.1', port: 5000}),
    livereload({watch: ['dist', 'index.html', 'src/ui.css'], host: '127.0.0.1'}),
  ] : [])],
  watch: {clearScreen: false},
};
