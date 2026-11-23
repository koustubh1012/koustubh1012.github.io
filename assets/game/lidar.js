// Simulated 2D lidar (ray casting against the arena colliders) and a
// SLAM-style occupancy map built up from its scans.
import * as THREE from './vendor/three.module.min.js';

function rayBox(ox, oz, dx, dz, b) {
	let tmin = -Infinity, tmax = Infinity;
	if (Math.abs(dx) < 1e-9) { if (ox < b.minX || ox > b.maxX) return null; }
	else {
		let t1 = (b.minX - ox) / dx, t2 = (b.maxX - ox) / dx;
		if (t1 > t2) [t1, t2] = [t2, t1];
		tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
	}
	if (Math.abs(dz) < 1e-9) { if (oz < b.minZ || oz > b.maxZ) return null; }
	else {
		let t1 = (b.minZ - oz) / dz, t2 = (b.maxZ - oz) / dz;
		if (t1 > t2) [t1, t2] = [t2, t1];
		tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
	}
	if (tmax < Math.max(tmin, 0)) return null;
	return tmin >= 0 ? tmin : null;
}

function rayCircle(ox, oz, dx, dz, c) {
	const fx = ox - c.x, fz = oz - c.z;
	const b = fx * dx + fz * dz;
	const cc = fx * fx + fz * fz - c.r * c.r;
	const disc = b * b - cc;
	if (disc < 0) return null;
	const t = -b - Math.sqrt(disc);
	return t >= 0 ? t : null;
}

function dotTexture() {
	const c = document.createElement('canvas');
	c.width = c.height = 32;
	const ctx = c.getContext('2d');
	const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
	g.addColorStop(0, 'rgba(255,255,255,1)');
	g.addColorStop(0.45, 'rgba(255,255,255,0.9)');
	g.addColorStop(1, 'rgba(255,255,255,0)');
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, 32, 32);
	return new THREE.CanvasTexture(c);
}

export class Lidar {
	constructor(scene, colliders, { rays = 180, range = 9 } = {}) {
		this.n = rays;
		this.range = range;
		this.colliders = colliders;
		this.dist = new Float32Array(rays);
		this.angle0 = 0;
		this.pos = new Float32Array(rays * 3);
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
		this.points = new THREE.Points(geo, new THREE.PointsMaterial({
			color: 0xff4545, size: 0.3, map: dotTexture(), transparent: true,
			depthWrite: false, toneMapped: false, sizeAttenuation: true,
		}));
		this.points.frustumCulled = false;
		scene.add(this.points);
	}

	scan(ox, oz, theta) {
		const { n, range, colliders, dist, pos } = this;
		this.angle0 = theta;
		for (let k = 0; k < n; k++) {
			const a = theta + (k / n) * Math.PI * 2;
			const dx = Math.sin(a), dz = Math.cos(a);
			let best = range, h = 0;
			for (const b of colliders.boxes) {
				const t = rayBox(ox, oz, dx, dz, b);
				if (t !== null && t < best) { best = t; h = b.h; }
			}
			for (const c of colliders.circles) {
				const t = rayCircle(ox, oz, dx, dz, c);
				if (t !== null && t < best) { best = t; h = c.h; }
			}
			dist[k] = best;
			const i = k * 3;
			if (best < range) {
				pos[i] = ox + dx * best;
				pos[i + 1] = Math.min(0.95, Math.max(0.08, h - 0.08));
				pos[i + 2] = oz + dz * best;
			} else {
				pos[i] = 0; pos[i + 1] = -50; pos[i + 2] = 0;
			}
		}
		this.points.geometry.attributes.position.needsUpdate = true;
	}
}

const UNKNOWN = 0, FREE = 1, OCC = 2;

export class SlamMap {
	constructor(half, res = 0.25) {
		this.half = half;
		this.res = res;
		this.n = Math.ceil((2 * half) / res);
		this.state = new Uint8Array(this.n * this.n);
		this.known = 0;
		this.canvas = document.createElement('canvas');
		this.canvas.width = this.canvas.height = this.n;
		this.ctx = this.canvas.getContext('2d');
		this.img = this.ctx.createImageData(this.n, this.n);
		this.dirty = false;
	}

	get explored() {
		return this.known / (this.n * this.n);
	}

	_mark(x, z, val) {
		const n = this.n;
		const i = Math.floor((x + this.half) / this.res);
		const j = Math.floor((z + this.half) / this.res);
		if (i < 0 || j < 0 || i >= n || j >= n) return;
		const idx = j * n + i;
		const cur = this.state[idx];
		if (cur === OCC || cur === val) return;
		if (cur === UNKNOWN) this.known++;
		this.state[idx] = val;
		const p = idx * 4, d = this.img.data;
		if (val === FREE) { d[p] = 36; d[p + 1] = 56; d[p + 2] = 88; d[p + 3] = 255; }
		else { d[p] = 125; d[p + 1] = 211; d[p + 2] = 252; d[p + 3] = 255; }
		this.dirty = true;
	}

	integrate(ox, oz, lidar) {
		const step = this.res * 0.8;
		for (let k = 0; k < lidar.n; k++) {
			const a = lidar.angle0 + (k / lidar.n) * Math.PI * 2;
			const dx = Math.sin(a), dz = Math.cos(a);
			const d = lidar.dist[k];
			const steps = Math.floor(d / step);
			for (let s = 0; s < steps; s++) this._mark(ox + dx * s * step, oz + dz * s * step, FREE);
			if (d < lidar.range) this._mark(ox + dx * (d + 0.05), oz + dz * (d + 0.05), OCC);
		}
		if (this.dirty) {
			this.ctx.putImageData(this.img, 0, 0);
			this.dirty = false;
		}
	}
}
