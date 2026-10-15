import serve from 'rollup-plugin-serve';
import livereload from 'rollup-plugin-livereload';

const development = process.env.ROLLUP_WATCH === 'true';

export default {
  input: 'src/main.js',
  output: {
    file: 'dist/main.js',
    format: 'es',
    sourcemap: true,
  },
  plugins: development ? [
    serve({contentBase: '.', host: '127.0.0.1', port: 5000}),
    livereload({watch: ['dist', 'index.html', 'src/ui.css'], host: '127.0.0.1'}),
  ] : [],
  watch: {clearScreen: false},
};
