// Routes between buildings along the street graph.
//
// A shortest-path tree is grown from a street node the first time something needs to reach
// it, and kept. Destinations cluster (workplaces, bars, the station), so most queries are an
// array lookup. A real game would ask its own navigation system instead.

/** Speeds in metres per game minute, and fixed minutes at each end (parking, waiting). */
export const MODE = { NONE: 0, WALK: 1, CAR: 2, BUS: 3 };
export const MODE_NAMES = ['', 'walking', 'driving', 'by bus'];
const SPEED = [0, 78, 520, 270];
const OVERHEAD = [0, 0, 3, 6];

export function travelMinutes(metres, mode) {
  return metres / SPEED[mode] + OVERHEAD[mode];
}

export function createRouter(city) {
  const { nodes, edges, adjStart, adjNode, adjEdge, buildings } = city;
  const nn = nodes.n;
  const trees = new Array(nn);
  const heap = new Int32Array(nn * 4), heapKey = new Float32Array(nn * 4);

  /** Shortest-path tree toward `root`: dist[n] is metres from n, next[n] the node after n. */
  function tree(root) {
    let t = trees[root];
    if (t) return t;
    const dist = new Float32Array(nn).fill(Infinity);
    const next = new Int32Array(nn).fill(-1);
    let size = 0;
    const push = (n, k) => {
      let i = size++;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heapKey[p] <= k) break;
        heap[i] = heap[p]; heapKey[i] = heapKey[p]; i = p;
      }
      heap[i] = n; heapKey[i] = k;
    };
    const pop = () => {
      const top = heap[0];
      const n = heap[--size], k = heapKey[size];
      let i = 0;
      for (;;) {
        let c = i * 2 + 1;
        if (c >= size) break;
        if (c + 1 < size && heapKey[c + 1] < heapKey[c]) c++;
        if (heapKey[c] >= k) break;
        heap[i] = heap[c]; heapKey[i] = heapKey[c]; i = c;
      }
      heap[i] = n; heapKey[i] = k;
      return top;
    };
    dist[root] = 0;
    push(root, 0);
    while (size > 0) {
      const k = heapKey[0], n = pop();
      if (k > dist[n]) continue;
      for (let a = adjStart[n]; a < adjStart[n + 1]; a++) {
        const m = adjNode[a], d = k + edges.len[adjEdge[a]];
        if (d < dist[m]) { dist[m] = d; next[m] = n; push(m, d); }
      }
    }
    t = trees[root] = { dist, next };
    return t;
  }

  const NB = buildings.length;
  const distCache = new Map();
  const pathCache = new Map();
  const choice = { len: 0, from: -1, to: -1 };

  // Which street nodes to leave and arrive by. A door sits part-way along an edge, so there
  // are two ways out and two ways in.
  function choose(A, B) {
    const offA = Math.hypot(A.doorX - A.streetX, A.doorY - A.streetY);
    const offB = Math.hypot(B.doorX - B.streetX, B.doorY - B.streetY);
    if (A.edge === B.edge) {
      choice.len = offA + offB + Math.abs(A.t - B.t) * edges.len[A.edge];
      choice.from = choice.to = -1;
      return choice;
    }
    const la = edges.len[A.edge], lb = edges.len[B.edge];
    const a0 = edges.a[A.edge], a1 = edges.b[A.edge], b0 = edges.a[B.edge], b1 = edges.b[B.edge];
    const t0 = tree(b0).dist, t1 = tree(b1).dist;
    let best = Infinity;
    const tryPair = (x, dx, y, dy, tr) => {
      const d = dx + tr[x] + dy;
      if (d < best) { best = d; choice.from = x; choice.to = y; }
    };
    tryPair(a0, A.t * la, b0, B.t * lb, t0);
    tryPair(a1, (1 - A.t) * la, b0, B.t * lb, t0);
    tryPair(a0, A.t * la, b1, (1 - B.t) * lb, t1);
    tryPair(a1, (1 - A.t) * la, b1, (1 - B.t) * lb, t1);
    choice.len = offA + offB + best;
    return choice;
  }

  /** Metres from one building's door to another's, along the streets. */
  function distance(a, b) {
    if (a === b) return 0;
    const key = a * NB + b;
    let d = distCache.get(key);
    if (d === undefined) {
      d = choose(buildings[a], buildings[b]).len;
      distCache.set(key, d);
    }
    return d;
  }

  /**
   * The route as a polyline: `pts` is x,y pairs, `cum` the metres travelled at each point.
   * It starts and ends at the doors and runs along street centre lines between them.
   */
  function path(a, b) {
    const key = a * NB + b;
    let p = pathCache.get(key);
    if (p) return p;
    const A = buildings[a], B = buildings[b];
    const xs = [A.doorX, A.streetX], ys = [A.doorY, A.streetY];
    if (a !== b) {
      const c = choose(A, B);
      if (c.from >= 0) {
        const next = tree(c.to).next;
        for (let n = c.from; n !== -1; n = next[n]) {
          xs.push(nodes.x[n]); ys.push(nodes.y[n]);
          if (n === c.to) break;
        }
      }
    }
    xs.push(B.streetX, B.doorX); ys.push(B.streetY, B.doorY);
    const pts = new Float32Array(xs.length * 2), cum = new Float32Array(xs.length);
    for (let i = 0; i < xs.length; i++) {
      pts[i * 2] = xs[i]; pts[i * 2 + 1] = ys[i];
      if (i) cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
    }
    p = { pts, cum, len: cum[cum.length - 1], n: xs.length };
    if (pathCache.size > 60000) pathCache.clear();
    pathCache.set(key, p);
    return p;
  }

  /**
   * The point a fraction of the way along a path, pushed `side` metres to the right of the
   * direction of travel (pavements and lanes sit either side of the centre line).
   */
  function along(p, frac, side, out) {
    const target = Math.min(Math.max(frac, 0), 1) * p.len;
    let lo = 0, hi = p.n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (p.cum[mid] <= target) lo = mid; else hi = mid;
    }
    const x0 = p.pts[lo * 2], y0 = p.pts[lo * 2 + 1], x1 = p.pts[hi * 2], y1 = p.pts[hi * 2 + 1];
    const seg = p.cum[hi] - p.cum[lo];
    const f = seg > 0 ? (target - p.cum[lo]) / seg : 0;
    out.x = x0 + (x1 - x0) * f;
    out.y = y0 + (y1 - y0) * f;
    // only offset on the street itself, not on the hop between door and kerb
    if (side && seg > 0 && lo > 0 && hi < p.n - 1) {
      out.x += (-(y1 - y0) / seg) * side;
      out.y += ((x1 - x0) / seg) * side;
    }
    return out;
  }

  return { tree, distance, path, along, stats: () => ({ trees: trees.filter(Boolean).length, paths: pathCache.size }) };
}
