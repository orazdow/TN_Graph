import {nodeResolve} from '@rollup/plugin-node-resolve';
import serve from 'rollup-plugin-serve';
import livereload from 'rollup-plugin-livereload';
import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';

const development = process.env.ROLLUP_WATCH === 'true';

// Emit the page and its local assets so dist can be served on its own.
function browserAssets() {
  return {
    name: 'browser-assets',
    async buildStart() {
      const emit = async (source, fileName, transform = value => value) => {
        this.addWatchFile(source);
        this.emitFile({type: 'asset', fileName, source: transform(await readFile(source))});
      };
      await emit('index.html', 'index.html', value => value.toString()
        .replace('./src/ui.css', './ui.css')
        .replace('./node_modules/p5/lib/p5.min.js', './p5.min.js')
        .replace('./dist/main.js', './main.js'));
      await emit('src/ui.css', 'ui.css');
      await emit('node_modules/p5/lib/p5.min.js', 'p5.min.js');
      const copySamples = async directory => {
        this.addWatchFile(directory);
        for (const entry of await readdir(directory, {withFileTypes: true})) {
          const source = path.join(directory, entry.name);
          if (entry.isDirectory()) await copySamples(source);
          else await emit(source, source.split(path.sep).join('/'));
        }
      };
      await copySamples('tn_generator/samples');
    },
  };
}

export default {
  input: {main: 'src/main.js', layout: 'src/layout.js'},
  output: {
    dir: 'dist',
    format: 'es',
    sourcemap: true,
  },
  plugins: [nodeResolve({browser: true}), browserAssets(), ...(development ? [
    serve({contentBase: 'dist', host: '127.0.0.1', port: 5000}),
    livereload({watch: 'dist', host: '127.0.0.1'}),
  ] : [])],
  watch: {clearScreen: false},
};
