export const DEFAULT_LAYOUT = Object.freeze({
  algorithm: 'sugiyama', direction: 'TB', layering: 'simplex',
  decross: 'two-layer', coord: 'simplex', passes: 24,
  nodeGap: 45, rankGap: 70, longestTopDown: true,
  lane: 'greedy', compressed: true, bidirectional: false, laneTopDown: true,
});

export function normalizeLayout(options = {}) {
  const settings = {...DEFAULT_LAYOUT, ...options};
  for (const [key, values] of Object.entries({
    algorithm: ['sugiyama', 'zherebko', 'grid'], direction: ['TB', 'BT', 'LR', 'RL'],
    layering: ['simplex', 'longest-path', 'topological'], decross: ['two-layer', 'dfs', 'optimal'],
    coord: ['simplex', 'greedy', 'quadratic', 'topological'], lane: ['greedy', 'optimal'],
  })) if (!values.includes(settings[key])) throw new Error('Unknown layout ' + key + ': ' + settings[key]);
  for (const key of ['nodeGap', 'rankGap']) {
    if (!Number.isFinite(settings[key]) || settings[key] < 0 || settings[key] > 300) throw new Error(key + ' must be between 0 and 300');
  }
  if (!Number.isInteger(settings.passes) || settings.passes < 1 || settings.passes > 48) throw new Error('Crossing passes must be between 1 and 48');
  if (settings.layering === 'topological') settings.coord = 'topological';
  else if (settings.coord === 'topological') settings.coord = 'simplex';
  return settings;
}

