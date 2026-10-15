/** Keep expensive optimization off the UI thread; discard obsolete requests. */
export class LayoutClient {
  cancel() {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending.worker.terminate();
    this.pending.resolve(null);
    this.pending = null;
  }

  compute(graph, options) {
    this.cancel();
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./layout-worker.js', import.meta.url), {type: 'module'});
      const finish = (result, error) => {
        if (this.pending?.worker !== worker) return;
        clearTimeout(this.pending.timer);
        worker.terminate();
        this.pending = null;
        if (error) reject(new Error(error)); else resolve(result);
      };
      const timer = setTimeout(() => finish(null, 'Layout took too long. Try two-layer crossing reduction or greedy coordinates.'), 15000);
      this.pending = {worker, timer, resolve};
      worker.onmessage = ({data}) => finish(data.result, data.error);
      worker.onerror = event => finish(null, event.message || 'Could not start the layout worker');
      worker.postMessage({graph, options});
    });
  }
}
