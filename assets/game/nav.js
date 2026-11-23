// Occupancy-grid A* global planner with line-of-sight path smoothing.

const SQRT2 = Math.SQRT2;
const NEIGHBORS = [
	[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
	[1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

/** Is (x, z) within `pad` of any collider? */
export function blocked(x, z, colliders, pad = 0) {
	for (const b of colliders.boxes) {
		const cx = Math.max(b.minX, Math.min(x, b.maxX));
		const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
		if ((x - cx) ** 2 + (z - cz) ** 2 < pad * pad || (cx === x && cz === z)) return true;
	}
	for (const c of colliders.circles) {
		if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + pad) ** 2) return true;
	}
	return false;
}

class MinHeap {
	constructor() { this.ids = []; this.keys = []; }
	get size() { return this.ids.length; }
	push(id, key) {
		const ids = this.ids, keys = this.keys;
		let i = ids.length;
		ids.push(id); keys.push(key);
		while (i > 0) {
			const p = (i - 1) >> 1;
			if (keys[p] <= key) break;
			ids[i] = ids[p]; keys[i] = keys[p];
			i = p;
		}
		ids[i] = id; keys[i] = key;
	}
	pop() {
		const ids = this.ids, keys = this.keys;
		const top = ids[0];
		const lastId = ids.pop(), lastKey = keys.pop();
		const n = ids.length;
		if (n) {
			let i = 0;
			for (;;) {
				const l = 2 * i + 1, r = l + 1;
				let m = i, mk = lastKey;
				if (l < n && keys[l] < mk) { m = l; mk = keys[l]; }
				if (r < n && keys[r] < mk) { m = r; }
				if (m === i) break;
				ids[i] = ids[m]; keys[i] = keys[m];
				i = m;
			}
			ids[i] = lastId; keys[i] = lastKey;
		}
		return top;
	}
}

export class NavGrid {
	constructor({ half, res, colliders, inflate }) {
		this.half = half;
		this.res = res;
		this.n = Math.ceil((2 * half) / res);
		const n = this.n;
		this.occ = new Uint8Array(n * n);
		for (let j = 0; j < n; j++) {
			for (let i = 0; i < n; i++) {
				const [x, z] = this.center(i, j);
				if (blocked(x, z, colliders, inflate)) this.occ[j * n + i] = 1;
			}
		}
		this.g = new Float32Array(n * n);
		this.parent = new Int32Array(n * n);
		this.closed = new Uint8Array(n * n);
	}

	center(i, j) {
		return [-this.half + (i + 0.5) * this.res, -this.half + (j + 0.5) * this.res];
	}

	cell(x, z) {
		const n = this.n;
		const i = Math.floor((x + this.half) / this.res);
		const j = Math.floor((z + this.half) / this.res);
		return [Math.max(0, Math.min(n - 1, i)), Math.max(0, Math.min(n - 1, j))];
	}

	free(i, j) {
		return i >= 0 && j >= 0 && i < this.n && j < this.n && !this.occ[j * this.n + i];
	}

	freeAt(x, z) {
		const [i, j] = this.cell(x, z);
		return this.free(i, j);
	}

	nearestFree(i, j, maxR = 24) {
		if (this.free(i, j)) return [i, j];
		for (let r = 1; r <= maxR; r++) {
			let best = null, bestD = Infinity;
			for (let dj = -r; dj <= r; dj++) {
				for (let di = -r; di <= r; di++) {
					if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
					if (!this.free(i + di, j + dj)) continue;
					const d = di * di + dj * dj;
					if (d < bestD) { bestD = d; best = [i + di, j + dj]; }
				}
			}
			if (best) return best;
		}
		return null;
	}

	lineFree(x0, z0, x1, z1) {
		const len = Math.hypot(x1 - x0, z1 - z0);
		const steps = Math.max(1, Math.ceil(len / (this.res * 0.4)));
		for (let s = 0; s <= steps; s++) {
			const t = s / steps;
			if (!this.freeAt(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)) return false;
		}
		return true;
	}

	/**
	 * Plan from (sx, sz) to (gx, gz). Returns smoothed waypoints [[x, z], ...]
	 * (first point is the actual start) or null if unreachable.
	 */
	plan(sx, sz, gx, gz) {
		const n = this.n;
		const s = this.nearestFree(...this.cell(sx, sz));
		const goalCell = this.cell(gx, gz);
		const goalFree = this.free(...goalCell);
		const gc = this.nearestFree(...goalCell);
		if (!s || !gc) return null;

		const start = s[1] * n + s[0];
		const goal = gc[1] * n + gc[0];
		const { g, parent, closed } = this;
		g.fill(Infinity);
		parent.fill(-1);
		closed.fill(0);
		const gi = gc[0], gj = gc[1];
		const h = (idx) => {
			const dx = Math.abs((idx % n) - gi), dy = Math.abs(((idx / n) | 0) - gj);
			return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
		};

		const heap = new MinHeap();
		g[start] = 0;
		heap.push(start, h(start));
		let found = start === goal;
		while (heap.size && !found) {
			const cur = heap.pop();
			if (closed[cur]) continue;
			closed[cur] = 1;
			if (cur === goal) { found = true; break; }
			const ci = cur % n, cj = (cur / n) | 0;
			for (const [di, dj, cost] of NEIGHBORS) {
				const ni = ci + di, nj = cj + dj;
				if (!this.free(ni, nj)) continue;
				if (di && dj && (!this.free(ci + di, cj) || !this.free(ci, cj + dj))) continue;
				const nid = nj * n + ni;
				if (closed[nid]) continue;
				const ng = g[cur] + cost;
				if (ng < g[nid]) {
					g[nid] = ng;
					parent[nid] = cur;
					heap.push(nid, ng + h(nid));
				}
			}
		}
		if (!found) return null;

		const cells = [];
		for (let c = goal; c !== -1; c = parent[c]) cells.push(c);
		cells.reverse();
		const pts = cells.map((c) => this.center(c % n, (c / n) | 0));
		if (goalFree) pts.push([gx, gz]);

		// String-pulling: keep only the waypoints needed to maintain line of sight.
		const out = [pts[0]];
		let a = 0;
		while (a < pts.length - 1) {
			let b = pts.length - 1;
			while (b > a + 1 && !this.lineFree(pts[a][0], pts[a][1], pts[b][0], pts[b][1])) b--;
			out.push(pts[b]);
			a = b;
		}
		out[0] = [sx, sz];
		return out;
	}
}
