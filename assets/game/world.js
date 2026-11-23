// Builds the 3D arena: floor, walls, obstacles and the five portfolio stations.
// Everything here is plain three.js primitives (no external models).
import * as THREE from './vendor/three.module.min.js';

export const HALF = 20; // arena spans [-HALF, HALF] on x and z

// Pads are where the robot docks; each station's monument sits just north (-z) of
// its pad so the follow camera (south of the robot) never has it blocking the view.
export const STATIONS = [
	{ id: 'about',      label: 'About',      color: 0x38bdf8, pad: [-11, -4] },
	{ id: 'experience', label: 'Experience', color: 0xf59e0b, pad: [0, -11] },
	{ id: 'projects',   label: 'Projects',   color: 0x34d399, pad: [11, -4] },
	{ id: 'skills',     label: 'Skills',     color: 0xa78bfa, pad: [8, 10] },
	{ id: 'contact',    label: 'Contact',    color: 0xf472b6, pad: [-8, 10] },
];

export const START = { x: 0, z: 3, theta: Math.PI }; // facing north
export const PAD_RADIUS = 2;
const MONUMENT_OFFSET = 3.6;

/* ---------- material helpers ---------- */

const solid = (color, o = {}) =>
	new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.18, ...o });
const neon = (color, o = {}) =>
	new THREE.MeshBasicMaterial({ color, toneMapped: false, ...o });
const additive = (color, opacity) =>
	new THREE.MeshBasicMaterial({
		color, transparent: true, opacity, depthWrite: false,
		blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
	});

function shadowed(obj) {
	obj.traverse((o) => {
		if (o.isMesh && !(o.material && o.material.transparent)) {
			o.castShadow = true;
			o.receiveShadow = true;
		}
	});
	return obj;
}

function mesh(geo, material, x = 0, y = 0, z = 0) {
	const m = new THREE.Mesh(geo, material);
	m.position.set(x, y, z);
	return m;
}

/* ---------- world ---------- */

export function buildWorld(scene, { photoUrl, anisotropy = 1 } = {}) {
	const colliders = { boxes: [], circles: [] };
	const animators = [];
	const stations = [];

	const addBox = (cx, cz, w, d, h) =>
		colliders.boxes.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, h });
	const addCircle = (x, z, r, h) => colliders.circles.push({ x, z, r, h });

	buildFloor(scene, anisotropy);
	buildWalls(scene, addBox);
	buildObstacles(scene, addBox, addCircle);

	const photoTexture = new THREE.Texture();
	const builders = {
		about: () => buildAbout(photoTexture),
		experience: buildExperience,
		projects: buildProjects,
		skills: buildSkills,
		contact: buildContact,
	};

	for (const def of STATIONS) {
		const [px, pz] = def.pad;
		const mx = px, mz = pz - MONUMENT_OFFSET;

		const pad = buildPad(def.color);
		pad.group.position.set(px, 0, pz);
		scene.add(pad.group);

		const monument = builders[def.id](def.color);
		monument.group.position.set(mx, 0, mz);
		scene.add(shadowed(monument.group));

		const c = monument.collider;
		if (c.type === 'boxes') for (const b of c.list) addBox(mx + b.ox, mz, b.w, b.d, b.h);
		else addCircle(mx, mz, c.r, c.h);

		// Invisible hit volume for click/tap picking (kept out of the scene graph).
		const hit = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, monument.height + 1, 12));
		hit.position.set(mx, (monument.height + 1) / 2, mz);
		hit.updateMatrixWorld(true);
		hit.userData.station = def.id;

		const station = {
			...def,
			x: px, z: pz,
			labelAnchor: new THREE.Vector3(mx, monument.height + 0.6, mz),
			hit,
			active: false,
		};
		stations.push(station);
		animators.push((t, dt) => {
			pad.update(t, station.active);
			monument.update(t, dt, station.active);
		});
	}

	buildGuides(scene);

	if (photoUrl) {
		new THREE.TextureLoader().load(photoUrl, (tex) => {
			tex.colorSpace = THREE.SRGBColorSpace;
			tex.anisotropy = 4;
			photoTexture.image = tex.image;
			photoTexture.colorSpace = THREE.SRGBColorSpace;
			photoTexture.needsUpdate = true;
			photoTexture.dispatchEvent({ type: 'loaded' });
		});
	}

	return {
		colliders,
		stations,
		update(t, dt) { for (const a of animators) a(t, dt); },
	};
}

// Grid drawn into a mipmapped texture (1 m minor / 5 m major lines). Unlike
// GridHelper's 1px lines, this stays visible when lines run toward the camera.
function gridTexture(anisotropy) {
	const S = 512, cell = S / 5;
	const c = document.createElement('canvas');
	c.width = c.height = S;
	const g = c.getContext('2d');
	g.fillStyle = '#0c1526';
	g.fillRect(0, 0, S, S);
	g.strokeStyle = 'rgba(64, 104, 158, 0.2)';
	g.lineWidth = 2.5;
	g.beginPath();
	for (let i = 1; i < 5; i++) {
		g.moveTo(i * cell, 0); g.lineTo(i * cell, S);
		g.moveTo(0, i * cell); g.lineTo(S, i * cell);
	}
	g.stroke();
	g.strokeStyle = 'rgba(74, 128, 200, 0.38)';
	g.lineWidth = 6; // half of it lands on each neighbouring tile
	g.strokeRect(0, 0, S, S);
	const tex = new THREE.CanvasTexture(c);
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
	tex.repeat.set((HALF * 2) / 5, (HALF * 2) / 5);
	tex.anisotropy = anisotropy;
	tex.colorSpace = THREE.SRGBColorSpace;
	return tex;
}

function buildFloor(scene, anisotropy) {
	const floor = mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2), solid(0xffffff, { map: gridTexture(anisotropy), roughness: 0.9, metalness: 0.05 }));
	floor.rotation.x = -Math.PI / 2;
	floor.receiveShadow = true;
	scene.add(floor);

	const outside = mesh(new THREE.PlaneGeometry(400, 400), solid(0x05080f, { roughness: 1, metalness: 0 }), 0, -0.03, 0);
	outside.rotation.x = -Math.PI / 2;
	scene.add(outside);

	// Origin axes, RViz style (x red, "y" green pointing north).
	const axisX = mesh(new THREE.BoxGeometry(1.2, 0.02, 0.06), neon(0xef4444), 0.6, 0.01, 0);
	const axisY = mesh(new THREE.BoxGeometry(0.06, 0.02, 1.2), neon(0x22c55e), 0, 0.01, -0.6);
	scene.add(axisX, axisY);
}

function buildWalls(scene, addBox) {
	const T = 0.5, H = 1.0, L = HALF * 2 + T;
	const wallMat = solid(0x16233a, { roughness: 0.8 });
	const trimMat = neon(0x22d3ee, { transparent: true, opacity: 0.55 });
	const defs = [
		[0, -HALF - T / 2, L, T],
		[0, HALF + T / 2, L, T],
		[-HALF - T / 2, 0, T, L],
		[HALF + T / 2, 0, T, L],
	];
	for (const [x, z, w, d] of defs) {
		const wall = mesh(new THREE.BoxGeometry(w, H, d), wallMat, x, H / 2, z);
		wall.receiveShadow = true;
		wall.castShadow = true;
		const trim = mesh(new THREE.BoxGeometry(w, 0.04, d + 0.02), trimMat, x, H + 0.02, z);
		scene.add(wall, trim);
		addBox(x, z, w, d, H);
	}
}

function buildObstacles(scene, addBox, addCircle) {
	const crateMat = solid(0x1d2b42, { roughness: 0.7 });
	const edgeMat = new THREE.LineBasicMaterial({ color: 0x4f7cb3, transparent: true, opacity: 0.75 });
	const crate = (x, z, s = 1.2, h = s) => {
		const geo = new THREE.BoxGeometry(s, h, s);
		const m = mesh(geo, crateMat, x, h / 2, z);
		m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat));
		scene.add(shadowed(m));
		addBox(x, z, s, s, h);
	};

	const rackMat = solid(0x223250);
	const rack = (x, z, w, d, h) => {
		const g = new THREE.Group();
		g.position.set(x, 0, z);
		for (let i = 0; i < 3; i++) g.add(mesh(new THREE.BoxGeometry(w, 0.08, d), rackMat, 0, 0.3 + i * (h - 0.3) / 2, 0));
		for (const sx of [-1, 1]) for (const sz of [-1, 1])
			g.add(mesh(new THREE.BoxGeometry(0.08, h, 0.08), rackMat, sx * (w / 2 - 0.05), h / 2, sz * (d / 2 - 0.05)));
		const boxMat = solid(0x8a6a3d, { roughness: 0.85 });
		for (let i = 0; i < Math.floor(w / 0.9); i++)
			g.add(mesh(new THREE.BoxGeometry(0.6, 0.45, d * 0.7), boxMat, -w / 2 + 0.55 + i * 0.9, 0.57 + (i % 2) * (h - 0.3) / 2, 0));
		scene.add(shadowed(g));
		addBox(x, z, w, d, h);
	};

	const barrelMat = solid(0xc27c0e, { roughness: 0.5, metalness: 0.35 });
	const bandMat = solid(0x111827);
	const barrel = (x, z) => {
		const g = new THREE.Group();
		g.position.set(x, 0, z);
		g.add(mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.1, 24), barrelMat, 0, 0.55, 0));
		g.add(mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.08, 24), bandMat, 0, 0.35, 0));
		g.add(mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.08, 24), bandMat, 0, 0.8, 0));
		scene.add(shadowed(g));
		addCircle(x, z, 0.45, 1.1);
	};

	const coneMat = solid(0xf97316, { roughness: 0.5 });
	const stripeMat = solid(0xf1f5f9);
	const cone = (x, z) => {
		const g = new THREE.Group();
		g.position.set(x, 0, z);
		g.add(mesh(new THREE.BoxGeometry(0.7, 0.06, 0.7), coneMat, 0, 0.03, 0));
		g.add(mesh(new THREE.ConeGeometry(0.28, 0.75, 20), coneMat, 0, 0.42, 0));
		g.add(mesh(new THREE.CylinderGeometry(0.15, 0.19, 0.12, 20), stripeMat, 0, 0.45, 0));
		scene.add(shadowed(g));
		addCircle(x, z, 0.33, 0.75);
	};

	// Crate clusters
	crate(-6, -10); crate(-7.3, -10.2, 1.1); crate(-6.5, -11.5, 1.3);
	crate(6.6, -10.4); crate(7.9, -10, 1.0);
	crate(16, 2); crate(16, 3.3, 1.1); crate(17.3, 2.6, 1.3, 1.6);
	crate(-16.5, 1, 1.3); crate(-15.2, 1.6, 1.0);
	crate(0.6, 15.5, 1.2); crate(1.9, 15.8, 1.0); crate(1.2, 17, 1.4, 1.0);
	crate(-17, -6); crate(17.2, -7.5, 1.1);

	// Shelving along the walls
	rack(-12.5, -18, 5, 1.1, 2.2);
	rack(12.5, -18, 5, 1.1, 2.2);
	rack(15.5, 18, 5, 1.1, 2.2);
	rack(-17.8, 16, 1.1, 4, 2.2);

	barrel(-15, -12.5); barrel(-14, -13.4); barrel(14.6, -13.2);
	barrel(15.6, 13.6); barrel(-15.8, 13.2); barrel(-4.5, 17.5);

	cone(-3, 8.5); cone(3, 8.5); cone(0, 10.5);
	cone(-5.5, -4.8); cone(5.8, -5.2);
	cone(12.5, 3.5); cone(-12, 4);
}

/* ---------- dotted guide lanes from the start pad to each station ---------- */

function buildGuides(scene) {
	const dot = new THREE.CircleGeometry(0.09, 10);
	for (const s of STATIONS) {
		const mat = new THREE.MeshBasicMaterial({ color: s.color, transparent: true, opacity: 0.32, toneMapped: false, depthWrite: false });
		const [tx, tz] = s.pad;
		const dx = tx - START.x, dz = tz - START.z;
		const len = Math.hypot(dx, dz);
		const steps = Math.floor((len - PAD_RADIUS - 1.2) / 0.7);
		const dots = new THREE.InstancedMesh(dot, mat, steps);
		const m = new THREE.Matrix4();
		const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
		const one = new THREE.Vector3(1, 1, 1);
		for (let i = 0; i < steps; i++) {
			const d = 1.2 + i * 0.7;
			m.compose(new THREE.Vector3(START.x + (dx / len) * d, 0.012, START.z + (dz / len) * d), q, one);
			dots.setMatrixAt(i, m);
		}
		scene.add(dots);
	}
	// Start pad
	const ring = mesh(new THREE.RingGeometry(0.95, 1.05, 48), new THREE.MeshBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.35, toneMapped: false }), START.x, 0.011, START.z);
	ring.rotation.x = -Math.PI / 2;
	scene.add(ring);
}

/* ---------- station pads ---------- */

function buildPad(color) {
	const group = new THREE.Group();
	const ring = mesh(new THREE.RingGeometry(PAD_RADIUS - 0.14, PAD_RADIUS, 64), neon(color, { transparent: true, opacity: 0.9 }), 0, 0.015, 0);
	ring.rotation.x = -Math.PI / 2;
	const fillMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.08, depthWrite: false, toneMapped: false });
	const fill = mesh(new THREE.CircleGeometry(PAD_RADIUS - 0.14, 64), fillMat, 0, 0.013, 0);
	fill.rotation.x = -Math.PI / 2;

	// Rotating dashed inner ring
	const dashes = new THREE.Group();
	dashes.position.y = 0.017;
	const dashGeo = new THREE.PlaneGeometry(0.42, 0.07);
	const dashMat = neon(color, { transparent: true, opacity: 0.7 });
	for (let i = 0; i < 12; i++) {
		const a = (i / 12) * Math.PI * 2;
		const d = mesh(dashGeo, dashMat, Math.cos(a) * 1.35, 0, Math.sin(a) * 1.35);
		d.rotation.set(-Math.PI / 2, 0, -a + Math.PI / 2);
		dashes.add(d);
	}

	// Vertical light column shown while the robot is on the pad
	const column = mesh(new THREE.CylinderGeometry(PAD_RADIUS - 0.1, PAD_RADIUS - 0.1, 2.4, 48, 1, true), additive(color, 0), 0, 1.2, 0);

	group.add(ring, fill, dashes, column);
	let glow = 0;
	return {
		group,
		update(t, active) {
			glow += ((active ? 1 : 0) - glow) * 0.12;
			fillMat.opacity = 0.07 + glow * (0.16 + 0.06 * Math.sin(t * 5)) + 0.03 * Math.sin(t * 2);
			column.material.opacity = glow * 0.11;
			dashes.rotation.y = t * (0.35 + glow * 1.2);
		},
	};
}

/* ---------- station monuments ---------- */

// About: holographic portrait on a projector pedestal.
function buildAbout(photoTexture) {
	const color = 0x38bdf8;
	const group = new THREE.Group();
	group.add(mesh(new THREE.CylinderGeometry(1.0, 1.25, 0.6, 40), solid(0x1a2740), 0, 0.3, 0));
	const ring = mesh(new THREE.TorusGeometry(1.0, 0.04, 8, 64), neon(color), 0, 0.6, 0);
	ring.rotation.x = Math.PI / 2;
	group.add(ring);
	group.add(mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.12, 24), neon(color, { transparent: true, opacity: 0.8 }), 0, 0.66, 0));
	group.add(mesh(new THREE.CylinderGeometry(0.95, 0.35, 1.5, 40, 1, true), additive(color, 0.08), 0, 1.45, 0));

	const holo = new THREE.Group();
	holo.position.y = 3.0;
	const photoMat = new THREE.MeshBasicMaterial({ color: 0x0b1a2c, toneMapped: false });
	photoTexture.addEventListener('loaded', () => {
		photoMat.map = photoTexture;
		photoMat.color.set(0xffffff);
		photoMat.needsUpdate = true;
	});
	holo.add(mesh(new THREE.PlaneGeometry(1.95, 2.6), neon(color, { transparent: true, opacity: 0.85 }), 0, 0, -0.01));
	holo.add(mesh(new THREE.PlaneGeometry(1.8, 2.4), photoMat));

	// Scrolling scanlines over the photo
	const lines = document.createElement('canvas');
	lines.width = 4; lines.height = 16;
	const lctx = lines.getContext('2d');
	lctx.fillStyle = 'rgba(56,189,248,0.0)';
	lctx.fillRect(0, 0, 4, 16);
	lctx.fillStyle = 'rgba(56,189,248,0.35)';
	lctx.fillRect(0, 0, 4, 3);
	const linesTex = new THREE.CanvasTexture(lines);
	linesTex.wrapS = linesTex.wrapT = THREE.RepeatWrapping;
	linesTex.repeat.set(1, 28);
	const scan = mesh(new THREE.PlaneGeometry(1.8, 2.4), new THREE.MeshBasicMaterial({
		map: linesTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
	}), 0, 0, 0.01);
	holo.add(scan);
	group.add(holo);

	return {
		group, height: 4.4,
		collider: { type: 'circle', r: 1.3, h: 0.6 },
		update(t) {
			holo.position.y = 3.0 + Math.sin(t * 1.4) * 0.08;
			holo.rotation.y = Math.sin(t * 0.6) * 0.35;
			linesTex.offset.y = -t * 0.25;
		},
	};
}

// Experience: a staircase of six steps, one per role, topped with a flag.
function buildExperience(color) {
	const group = new THREE.Group();
	const stepMat = solid(0x1f2c45);
	const edge = neon(color);
	const N = 6, W = 0.86, D = 1.5;
	let topY = 0;
	const steps = [];
	for (let i = 0; i < N; i++) {
		const h = 0.35 + i * 0.32;
		const x = -2.2 + i * 0.88;
		group.add(mesh(new THREE.BoxGeometry(W, h, D), stepMat, x, h / 2, 0));
		group.add(mesh(new THREE.BoxGeometry(W, 0.05, 0.06), edge, x, h, D / 2));
		steps.push({ ox: x, w: 0.88, d: D, h });
		topY = h;
	}
	const flag = new THREE.Group();
	flag.position.set(-2.2 + (N - 1) * 0.88, topY, 0);
	flag.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.6, 10), solid(0xcbd5e1, { metalness: 0.6 }), 0, 0.8, 0));
	const shape = new THREE.Shape();
	shape.moveTo(0, 0); shape.lineTo(0.8, -0.22); shape.lineTo(0, -0.44); shape.lineTo(0, 0);
	const cloth = mesh(new THREE.ShapeGeometry(shape), neon(color, { side: THREE.DoubleSide }), 0.02, 1.58, 0);
	flag.add(cloth);
	group.add(flag);
	return {
		group, height: topY + 1.8,
		collider: { type: 'boxes', list: steps }, // one per step so lidar hits sit at the right height
		update(t) { cloth.rotation.y = Math.sin(t * 3) * 0.35; },
	};
}

// Projects: a hovering quadcopter with a camera frustum (3D reconstruction nod).
function buildProjects(color) {
	const group = new THREE.Group();
	group.add(mesh(new THREE.CylinderGeometry(1.25, 1.35, 0.16, 40), solid(0x1a2740), 0, 0.08, 0));
	const ring = mesh(new THREE.TorusGeometry(1.0, 0.035, 8, 64), neon(color), 0, 0.17, 0);
	ring.rotation.x = Math.PI / 2;
	group.add(ring);
	const hBar = neon(color, { transparent: true, opacity: 0.8 });
	group.add(mesh(new THREE.BoxGeometry(0.08, 0.02, 0.7), hBar, -0.25, 0.17, 0));
	group.add(mesh(new THREE.BoxGeometry(0.08, 0.02, 0.7), hBar, 0.25, 0.17, 0));
	group.add(mesh(new THREE.BoxGeometry(0.5, 0.02, 0.08), hBar, 0, 0.17, 0));

	const drone = new THREE.Group();
	const frame = solid(0x2b3a55, { metalness: 0.4 });
	drone.add(mesh(new THREE.BoxGeometry(0.62, 0.2, 0.82), frame));
	drone.add(mesh(new THREE.BoxGeometry(0.46, 0.12, 0.56), solid(color, { roughness: 0.4 }), 0, 0.15, 0));
	const props = [];
	for (const a of [Math.PI / 4, -Math.PI / 4]) {
		const arm = mesh(new THREE.BoxGeometry(1.7, 0.06, 0.09), frame);
		arm.rotation.y = a;
		drone.add(arm);
	}
	const propGeo = new THREE.BoxGeometry(0.62, 0.012, 0.06);
	const propMat = solid(0xe2e8f0);
	for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
		const px = sx * 0.6, pz = sz * 0.6;
		drone.add(mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.14, 16), solid(0x0f172a), px, 0.06, pz));
		const p = new THREE.Group();
		p.position.set(px, 0.15, pz);
		p.add(new THREE.Mesh(propGeo, propMat));
		const p2 = new THREE.Mesh(propGeo, propMat);
		p2.rotation.y = Math.PI / 2;
		p.add(p2);
		p.add(mesh(new THREE.CircleGeometry(0.31, 24), additive(0xe2e8f0, 0.08)).rotateX(-Math.PI / 2));
		props.push({ p, dir: sx * sz });
		drone.add(p);
	}
	drone.add(mesh(new THREE.SphereGeometry(0.08, 12, 8), solid(0x0f172a), 0, -0.14, 0.32));
	drone.add(mesh(new THREE.SphereGeometry(0.04, 8, 6), neon(0x4ade80), 0.25, 0, 0.42));
	drone.add(mesh(new THREE.SphereGeometry(0.04, 8, 6), neon(0xef4444), -0.25, 0, -0.42));

	// Camera frustum projected onto the floor
	const h = 2.15;
	const apex = new THREE.Vector3(0, -0.18, 0.32);
	const c = [[-1.1, -h, -0.6], [1.1, -h, -0.6], [1.1, -h, 1.4], [-1.1, -h, 1.4]].map((v) => new THREE.Vector3(...v));
	const pts = [];
	for (const v of c) pts.push(apex, v);
	for (let i = 0; i < 4; i++) pts.push(c[i], c[(i + 1) % 4]);
	drone.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts),
		new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.45, toneMapped: false })));
	group.add(drone);

	return {
		group, height: 3.6,
		collider: { type: 'circle', r: 1.4, h: 0.16 },
		update(t, dt) {
			drone.position.y = 2.35 + Math.sin(t * 1.8) * 0.1;
			drone.rotation.y = Math.sin(t * 0.4) * 0.6;
			drone.rotation.z = Math.sin(t * 1.1) * 0.05;
			for (const { p, dir } of props) p.rotation.y += dir * dt * 40;
		},
	};
}

// Skills: a 3-joint manipulator arm going through a pick motion.
function buildSkills(color) {
	const group = new THREE.Group();
	const dark = solid(0x1f2c45);
	const armMat = solid(0xdbe3ee, { roughness: 0.35, metalness: 0.3 });
	const jointMat = solid(0x312e81, { roughness: 0.4 });
	group.add(mesh(new THREE.CylinderGeometry(0.8, 0.95, 0.4, 32), dark, 0, 0.2, 0));
	const ring = mesh(new THREE.TorusGeometry(0.82, 0.035, 8, 64), neon(color), 0, 0.4, 0);
	ring.rotation.x = Math.PI / 2;
	group.add(ring);

	const turret = new THREE.Group();
	turret.position.y = 0.4;
	turret.add(mesh(new THREE.CylinderGeometry(0.38, 0.42, 0.5, 24), jointMat, 0, 0.25, 0));
	const shoulder = new THREE.Group();
	shoulder.position.y = 0.55;
	const sj = mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.5, 20), jointMat);
	sj.rotation.z = Math.PI / 2;
	shoulder.add(sj);
	shoulder.add(mesh(new THREE.BoxGeometry(0.24, 1.5, 0.24), armMat, 0, 0.75, 0));
	const elbow = new THREE.Group();
	elbow.position.y = 1.5;
	const ej = mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.4, 20), jointMat);
	ej.rotation.z = Math.PI / 2;
	elbow.add(ej);
	elbow.add(mesh(new THREE.BoxGeometry(0.18, 1.15, 0.18), armMat, 0, 0.575, 0));
	const wrist = new THREE.Group();
	wrist.position.y = 1.15;
	wrist.add(mesh(new THREE.BoxGeometry(0.42, 0.08, 0.16), jointMat));
	const fingerGeo = new THREE.BoxGeometry(0.05, 0.28, 0.12);
	const f1 = mesh(fingerGeo, armMat, -0.15, 0.17, 0);
	const f2 = mesh(fingerGeo, armMat, 0.15, 0.17, 0);
	wrist.add(f1, f2);
	wrist.add(mesh(new THREE.SphereGeometry(0.05, 10, 8), neon(color), 0, 0.08, 0.1));
	elbow.add(wrist);
	shoulder.add(elbow);
	turret.add(shoulder);
	group.add(turret);

	return {
		group, height: 3.7,
		collider: { type: 'circle', r: 1.0, h: 0.4 },
		update(t) {
			turret.rotation.y = Math.sin(t * 0.55) * 1.3;
			shoulder.rotation.x = -0.35 + Math.sin(t * 0.9) * 0.35;
			elbow.rotation.x = 1.0 + Math.sin(t * 0.9 + 0.8) * 0.45;
			wrist.rotation.x = 0.4 + Math.sin(t * 1.3) * 0.3;
			const open = 0.11 + (Math.sin(t * 1.8) * 0.5 + 0.5) * 0.06;
			f1.position.x = -open; f2.position.x = open;
		},
	};
}

// Contact: a radio mast with a dish and expanding signal rings.
function buildContact(color) {
	const group = new THREE.Group();
	group.add(mesh(new THREE.BoxGeometry(1.5, 0.3, 1.5), solid(0x1f2c45), 0, 0.15, 0));
	const metal = solid(0xa8b5c7, { metalness: 0.6, roughness: 0.35 });
	group.add(mesh(new THREE.CylinderGeometry(0.07, 0.16, 3.3, 12), metal, 0, 1.95, 0));
	for (const y of [1.1, 1.9, 2.7]) {
		const bar = mesh(new THREE.BoxGeometry(0.7 - y * 0.12, 0.05, 0.05), metal, 0, y, 0);
		group.add(bar);
	}
	const dish = mesh(new THREE.SphereGeometry(0.62, 28, 10, 0, Math.PI * 2, 0, Math.PI / 3.2), solid(0xe2e8f0, { side: THREE.DoubleSide, metalness: 0.3 }), 0, 2.4, 0.25);
	dish.rotation.x = -Math.PI / 2 - 0.5; // open side tilted toward the viewer
	group.add(dish);
	group.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6), metal, 0, 2.55, 0.5).rotateX(Math.PI / 2 - 0.5));
	const beacon = mesh(new THREE.SphereGeometry(0.11, 16, 12), neon(color), 0, 3.65, 0);
	group.add(beacon);

	const rings = [];
	for (let i = 0; i < 3; i++) {
		const r = mesh(new THREE.TorusGeometry(0.35, 0.025, 6, 48), additive(color, 0.8), 0, 3.65, 0);
		r.rotation.x = Math.PI / 2;
		rings.push(r);
		group.add(r);
	}
	return {
		group, height: 4.2,
		collider: { type: 'circle', r: 1.05, h: 0.3 },
		update(t) {
			beacon.visible = (t * 1.5) % 1 < 0.6;
			rings.forEach((r, i) => {
				const p = (t * 0.45 + i / 3) % 1;
				const s = 1 + p * 3.2;
				r.scale.set(s, s, s);
				r.position.y = 3.65 - p * 0.5;
				r.material.opacity = (1 - p) * 0.55;
			});
		},
	};
}
