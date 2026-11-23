// Entry point: wires the 3D world, robot, lidar/SLAM, planner, HUD and content panels.
import * as THREE from './vendor/three.module.min.js';
import { buildWorld, HALF, START, STATIONS, PAD_RADIUS } from './world.js';
import { Robot, ROBOT_RADIUS, wrapAngle } from './robot.js';
import { NavGrid, blocked } from './nav.js';
import { Lidar, SlamMap } from './lidar.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const ORDER = STATIONS.map((s) => s.id);
const ALIASES = { banner: 'about', 'work-experience': 'experience' };
const KEYMAP = {
	ArrowUp: [0, -1], KeyW: [0, -1],
	ArrowDown: [0, 1], KeyS: [0, 1],
	ArrowLeft: [-1, 0], KeyA: [-1, 0],
	ArrowRight: [1, 0], KeyD: [1, 0],
};
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function fallback(err) {
	if (err) console.error('[robot-portfolio] falling back to static page:', err);
	document.documentElement.classList.add('fallback');
	$$('.panel').forEach((p) => { p.inert = false; p.removeAttribute('aria-hidden'); });
}

function hasWebGL() {
	try {
		const c = document.createElement('canvas');
		return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
	} catch {
		return false;
	}
}

const bootLog = $('#boot-log');
let bootLines = 0;
function log(msg) {
	if (!bootLog) return;
	const li = document.createElement('li');
	li.style.setProperty('--i', bootLines++);
	li.innerHTML = `<span class="ok">[ OK ]</span> ${msg}`;
	bootLog.appendChild(li);
}

if (!hasWebGL()) fallback(new Error('WebGL unavailable'));
else {
	try { init(); } catch (err) { fallback(err); }
}

function init() {
	/* ---------- renderer / scene / camera ---------- */
	const host = $('#scene');
	const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
	renderer.setSize(innerWidth, innerHeight);
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.05;
	const canvas = renderer.domElement;
	canvas.setAttribute('aria-label', '3D arena. Use the station buttons, WASD or arrow keys to drive the robot.');
	canvas.tabIndex = -1;
	host.appendChild(canvas);
	log(`WebGL renderer online <span class="dim">three.js r${THREE.REVISION}</span>`);

	const scene = new THREE.Scene();
	scene.background = new THREE.Color(0x070b14);
	scene.fog = new THREE.Fog(0x070b14, 36, 75);

	const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 220);
	const camOffset = new THREE.Vector3();
	function layoutCamera() {
		const aspect = innerWidth / innerHeight;
		camera.aspect = aspect;
		camera.fov = aspect < 0.8 ? 58 : aspect < 1.2 ? 50 : 42;
		camera.updateProjectionMatrix();
		const k = aspect < 0.8 ? 1.3 : 1;
		camOffset.set(0, 9.5 * k, 10.5 * k);
	}
	layoutCamera();

	scene.add(new THREE.HemisphereLight(0xb4d4ff, 0x0b1220, 1.15));
	const sun = new THREE.DirectionalLight(0xffffff, 2.3);
	sun.position.set(10, 24, 9);
	sun.castShadow = true;
	sun.shadow.mapSize.set(2048, 2048);
	Object.assign(sun.shadow.camera, { left: -27, right: 27, top: 27, bottom: -27, near: 1, far: 80 });
	sun.shadow.bias = -0.0004;
	sun.shadow.normalBias = 0.03;
	scene.add(sun);
	const rim = new THREE.DirectionalLight(0x7dd3fc, 0.6);
	rim.position.set(-14, 9, -12);
	scene.add(rim);

	/* ---------- world, robot, sensors, planner ---------- */
	const world = buildWorld(scene, { photoUrl: 'images/kstb_small.jpg', anisotropy: renderer.capabilities.getMaxAnisotropy() });
	const stationById = Object.fromEntries(world.stations.map((s) => [s.id, s]));
	log(`Arena loaded <span class="dim">${STATIONS.length} stations, ${world.colliders.boxes.length + world.colliders.circles.length} obstacles</span>`);

	const robot = new Robot();
	robot.x = START.x; robot.z = START.z; robot.theta = START.theta;
	robot.sync(0);
	scene.add(robot.group);
	log('Spawned <b>kstb_bot</b> <span class="dim">differential drive</span>');

	const lidar = new Lidar(scene, world.colliders, { rays: 180, range: 9 });
	log('/scan lidar online <span class="dim">180 beams @ 2°</span>');

	const MAP_HALF = HALF + 0.5;
	const slam = new SlamMap(MAP_HALF, 0.25);
	{
		// Explored % is measured against cells that aren't inside an obstacle.
		let total = 0;
		for (let j = 0; j < slam.n; j++) for (let i = 0; i < slam.n; i++) {
			const x = -MAP_HALF + (i + 0.5) * slam.res, z = -MAP_HALF + (j + 0.5) * slam.res;
			if (Math.abs(x) < HALF && Math.abs(z) < HALF && !blocked(x, z, world.colliders, 0)) total++;
		}
		slam.total = total;
	}
	log('/map SLAM node started');

	const nav = new NavGrid({ half: HALF, res: 0.5, colliders: world.colliders, inflate: ROBOT_RADIUS + 0.12 });
	log('nav: A* global planner ready');

	/* ---------- path + goal visualization ---------- */
	const MAX_DOTS = 260;
	const pathDots = new THREE.InstancedMesh(
		new THREE.CircleGeometry(0.075, 8),
		new THREE.MeshBasicMaterial({ color: 0x4ade80, toneMapped: false }),
		MAX_DOTS,
	);
	pathDots.count = 0;
	pathDots.frustumCulled = false;
	scene.add(pathDots);
	const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
	const unit = new THREE.Vector3(1, 1, 1);
	const tmpM = new THREE.Matrix4();
	const tmpV = new THREE.Vector3();

	const goalMarker = new THREE.Group();
	const goalMat = new THREE.MeshBasicMaterial({ color: 0x4ade80, toneMapped: false });
	const goalRing = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.52, 40), goalMat);
	goalRing.rotation.x = -Math.PI / 2;
	goalRing.position.y = 0.02;
	const goalArrow = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.55, 16), goalMat);
	goalArrow.rotation.x = Math.PI;
	goalMarker.add(goalRing, goalArrow);
	goalMarker.visible = false;
	scene.add(goalMarker);

	/* ---------- state ---------- */
	let started = false;
	let introOpen = true;
	let openPanelId = null;
	let docked = null;
	let route = null; // active navigation goal
	let elapsed = 0;
	let frame = 0;
	const keys = new Set();
	const visited = new Set();
	let missionDone = false;

	/* ---------- DOM: labels, HUD, panels ---------- */
	const labelsHost = $('#labels');
	for (const [i, s] of world.stations.entries()) {
		const el = document.createElement('button');
		el.type = 'button';
		el.className = 'station-label';
		el.tabIndex = -1;
		el.style.setProperty('--c', hex(s.color));
		el.innerHTML = `<span class="k">${i + 1}</span>${s.label}`;
		el.addEventListener('click', () => { if (started && !introOpen) goToStation(s.id); });
		labelsHost.appendChild(el);
		s.labelEl = el;
	}

	const navButtons = $$('.station-btn');
	for (const btn of navButtons) {
		const s = stationById[btn.dataset.station];
		btn.style.setProperty('--c', hex(s.color));
		btn.addEventListener('click', () => {
			if (!started) start();
			goToStation(s.id);
		});
	}
	const countEl = $('#explored-count');

	const panels = $$('.panel');
	for (const p of panels) {
		const s = stationById[p.dataset.station];
		if (s) p.style.setProperty('--c', hex(s.color));
		p.inert = true;
		p.setAttribute('aria-hidden', 'true');
		$('.panel-close', p).addEventListener('click', () => closePanel());
	}
	$$('[data-goto]').forEach((b) => b.addEventListener('click', () => {
		closePanel();
		if (b.dataset.goto) goToStation(b.dataset.goto);
	}));

	const dockPrompt = $('#dock-prompt');
	const dockName = $('#dock-name');
	$('#dock-open').addEventListener('click', () => { if (docked) openPanel(docked.id); });

	const toastEl = $('#toast');
	let toastTimer = 0;
	function toast(html, ms = 2800) {
		toastEl.innerHTML = html;
		toastEl.classList.add('show');
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
	}

	/* ---------- intro / help ---------- */
	const intro = $('#intro');
	const startBtn = $('#start-btn');
	function showIntro() {
		introOpen = true;
		keys.clear();
		intro.classList.remove('is-hidden');
		intro.removeAttribute('aria-hidden');
		intro.inert = false;
		startBtn.textContent = started ? 'Back to driving' : 'Power on';
		startBtn.focus({ preventScroll: true });
	}
	function hideIntro() {
		introOpen = false;
		intro.classList.add('is-hidden');
		intro.setAttribute('aria-hidden', 'true');
		intro.inert = true;
		canvas.focus({ preventScroll: true });
	}
	function start(jumpTo) {
		const first = !started;
		started = true;
		hideIntro();
		if (jumpTo) {
			teleportTo(jumpTo);
			openPanel(jumpTo);
		} else if (first) {
			setTimeout(() => toast('Drive with <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>, or click the floor to set a nav goal'), 900);
		}
	}
	startBtn.addEventListener('click', () => start());
	$$('[data-jump]').forEach((b) => b.addEventListener('click', () => start(b.dataset.jump)));
	$('#help-btn').addEventListener('click', showIntro);

	function teleportTo(id) {
		const s = stationById[id];
		cancelRoute();
		robot.x = s.x; robot.z = s.z; robot.theta = Math.PI; robot.v = 0; robot.w = 0;
		robot.sync(0);
		focus.set(robot.x, 0, robot.z);
		camera.position.copy(focus).add(camOffset);
	}

	/* ---------- panels ---------- */
	let lastFocus = null;
	function openPanel(id) {
		const el = document.getElementById(id);
		if (!el || !el.classList.contains('panel')) return;
		if (openPanelId === id) return;
		if (openPanelId) closePanel(true);
		cancelRoute();
		keys.clear();
		openPanelId = id;
		lastFocus = document.activeElement;
		el.inert = false;
		el.removeAttribute('aria-hidden');
		el.classList.add('is-open');
		document.body.classList.add('panel-open');
		$('.panel-body', el).scrollTop = 0;
		$('.panel-close', el).focus({ preventScroll: true });
		history.replaceState(null, '', '#' + id);
		markVisited(id);
	}
	function closePanel(silent) {
		if (!openPanelId) return;
		const el = document.getElementById(openPanelId);
		el.classList.remove('is-open');
		el.inert = true;
		el.setAttribute('aria-hidden', 'true');
		openPanelId = null;
		document.body.classList.remove('panel-open');
		history.replaceState(null, '', location.pathname + location.search);
		if (!silent) {
			if (lastFocus && lastFocus.classList && lastFocus.classList.contains('station-btn')) lastFocus.focus({ preventScroll: true });
			else canvas.focus({ preventScroll: true });
		}
	}
	function markVisited(id) {
		if (visited.has(id)) return;
		visited.add(id);
		navButtons.forEach((b) => b.classList.toggle('visited', visited.has(b.dataset.station)));
		countEl.textContent = `${visited.size}/${ORDER.length}`;
		if (visited.size === ORDER.length && !missionDone) {
			missionDone = true;
			setTimeout(() => toast('🏁 Mission complete: every station visited. Thanks for driving by!', 4500), 600);
		}
	}

	/* ---------- navigation ---------- */
	function goToPoint(x, z, stationId = null) {
		if (openPanelId) closePanel(true);
		const path = nav.plan(robot.x, robot.z, x, z);
		if (!path) {
			toast('No path to that spot. Try somewhere else.');
			return;
		}
		const color = stationId ? stationById[stationId].color : 0x4ade80;
		goalMat.color.set(color);
		pathDots.material.color.set(color);
		const [gx, gz] = path[path.length - 1];
		goalMarker.position.set(gx, 0, gz);
		goalMarker.visible = !stationId;
		route = { path, idx: Math.min(1, path.length - 1), stationId, phase: 'drive', best: Infinity, lastImprove: elapsed, replans: 0 };
	}
	function goToStation(id) {
		const s = stationById[id];
		if (!s) return;
		if (docked === s && Math.hypot(robot.x - s.x, robot.z - s.z) < 1.2) {
			openPanel(id);
			return;
		}
		goToPoint(s.x, s.z, id);
	}
	function cancelRoute() {
		route = null;
		goalMarker.visible = false;
		pathDots.count = 0;
	}

	function routeControl() {
		const r = route;
		const p = r.path;
		const last = p.length - 1;
		const [gx, gz] = p[last];
		const dGoal = Math.hypot(gx - robot.x, gz - robot.z);

		if (r.phase === 'drive') {
			while (r.idx < last && Math.hypot(p[r.idx][0] - robot.x, p[r.idx][1] - robot.z) < 0.8) r.idx++;
			if (dGoal < 0.3) {
				r.phase = r.stationId ? 'align' : 'done';
			} else {
				if (dGoal < r.best - 0.15) { r.best = dGoal; r.lastImprove = elapsed; }
				else if (elapsed - r.lastImprove > 2) {
					// Stuck (e.g. pushed off the plan): replan a couple of times, then give up.
					if (r.replans++ >= 2) { cancelRoute(); toast('Path blocked. Try driving manually.'); return { v: 0, w: 0 }; }
					const np = nav.plan(robot.x, robot.z, gx, gz);
					if (np) { r.path = np; r.idx = Math.min(1, np.length - 1); }
					r.lastImprove = elapsed;
					return { v: 0, w: 0 };
				}
				const [tx, tz] = p[r.idx];
				const scale = r.idx === last ? clamp(dGoal / 2.2, 0.2, 1) : 1;
				return robot.steer(Math.atan2(tx - robot.x, tz - robot.z), scale);
			}
		}
		if (r.phase === 'align') {
			// Final "goal pose": face the station's monument (north).
			const e = wrapAngle(Math.PI - robot.theta);
			if (Math.abs(e) > 0.05) return { v: 0, w: clamp(e * 7, -4.5, 4.5) };
			r.phase = 'done';
		}
		const id = r.stationId;
		cancelRoute();
		if (id) openPanel(id);
		return { v: 0, w: 0 };
	}

	function drawPath() {
		if (!route || route.phase !== 'drive') { pathDots.count = 0; return; }
		let count = 0;
		let px = robot.x, pz = robot.z, carry = 0.5;
		for (let i = route.idx; i < route.path.length && count < MAX_DOTS; i++) {
			const [qx, qz] = route.path[i];
			const len = Math.hypot(qx - px, qz - pz);
			let d = carry;
			while (d < len && count < MAX_DOTS) {
				const t = d / len;
				tmpV.set(px + (qx - px) * t, 0.02, pz + (qz - pz) * t);
				tmpM.compose(tmpV, flat, unit);
				pathDots.setMatrixAt(count++, tmpM);
				d += 0.38;
			}
			carry = d - len;
			px = qx; pz = qz;
		}
		pathDots.count = count;
		pathDots.instanceMatrix.needsUpdate = true;
	}

	/* ---------- physics ---------- */
	function resolveCollisions() {
		const R = ROBOT_RADIUS;
		for (let iter = 0; iter < 2; iter++) {
			for (const b of world.colliders.boxes) {
				const cx = clamp(robot.x, b.minX, b.maxX), cz = clamp(robot.z, b.minZ, b.maxZ);
				const dx = robot.x - cx, dz = robot.z - cz;
				const d2 = dx * dx + dz * dz;
				if (d2 >= R * R) continue;
				if (d2 > 1e-8) {
					const d = Math.sqrt(d2), k = (R - d) / d;
					robot.x += dx * k; robot.z += dz * k;
				} else {
					// Centre inside the box: exit along the shallowest axis.
					const opts = [[b.minX - R - robot.x, 0], [b.maxX + R - robot.x, 0], [0, b.minZ - R - robot.z], [0, b.maxZ + R - robot.z]];
					opts.sort((a, c) => Math.abs(a[0] + a[1]) - Math.abs(c[0] + c[1]));
					robot.x += opts[0][0]; robot.z += opts[0][1];
				}
			}
			for (const c of world.colliders.circles) {
				const dx = robot.x - c.x, dz = robot.z - c.z;
				const d = Math.hypot(dx, dz), min = R + c.r;
				if (d >= min) continue;
				const k = d > 1e-6 ? (min - d) / d : 0;
				robot.x += dx * k; robot.z += dz * k;
			}
		}
	}

	function updateDock() {
		let near = null;
		for (const s of world.stations) {
			if (Math.hypot(s.x - robot.x, s.z - robot.z) < PAD_RADIUS - 0.25) near = s;
		}
		for (const s of world.stations) {
			s.active = s === near;
			s.labelEl.classList.toggle('is-active', s.active);
		}
		if (near !== docked) {
			docked = near;
			navButtons.forEach((b) => b.classList.toggle('is-docked', !!near && b.dataset.station === near.id));
			if (near) {
				dockPrompt.style.setProperty('--c', hex(near.color));
				dockName.textContent = near.label;
			}
		}
		const show = !!docked && !openPanelId && !introOpen && !(route && route.stationId === docked.id);
		if (show !== promptShown) {
			promptShown = show;
			dockPrompt.classList.toggle('show', show);
			dockPrompt.inert = !show;
		}
	}
	let promptShown = true;

	/* ---------- input ---------- */
	const isTyping = (t) => t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]');
	const isControl = (t) => t && t.closest && t.closest('button, a, input, textarea, select, summary');

	addEventListener('keydown', (e) => {
		if (isTyping(e.target)) return;
		if (e.key === 'Escape') {
			if (openPanelId) closePanel();
			else if (introOpen && started) hideIntro();
			return;
		}
		if (!started || introOpen || openPanelId) return;
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		if (e.key === '?') { showIntro(); return; }
		if (KEYMAP[e.code]) {
			keys.add(e.code);
			e.preventDefault();
			return;
		}
		if (isControl(e.target)) return; // let Enter/Space activate the focused button
		if ((e.key === 'Enter' || e.key === ' ' || e.code === 'KeyE') && docked) {
			e.preventDefault();
			openPanel(docked.id);
		} else if (/^Digit[1-5]$/.test(e.code)) {
			goToStation(ORDER[Number(e.code.slice(5)) - 1]);
		}
	});
	addEventListener('keyup', (e) => keys.delete(e.code));
	addEventListener('blur', () => keys.clear());

	const raycaster = new THREE.Raycaster();
	const ndc = new THREE.Vector2();
	const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
	const hitVolumes = world.stations.map((s) => s.hit);
	const groundHit = new THREE.Vector3();
	function pick(clientX, clientY) {
		ndc.set((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
		raycaster.setFromCamera(ndc, camera);
		const hit = raycaster.intersectObjects(hitVolumes, false)[0];
		if (hit) return { station: hit.object.userData.station };
		if (!raycaster.ray.intersectPlane(ground, groundHit)) return null;
		for (const s of world.stations) {
			if (Math.hypot(groundHit.x - s.x, groundHit.z - s.z) < PAD_RADIUS) return { station: s.id };
		}
		if (Math.abs(groundHit.x) > HALF || Math.abs(groundHit.z) > HALF) return null;
		return { x: groundHit.x, z: groundHit.z };
	}

	let drag = null;
	canvas.addEventListener('pointerdown', (e) => {
		if (!started || introOpen) return;
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		if (openPanelId) { closePanel(); return; }
		drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, last: 0 };
		canvas.setPointerCapture(e.pointerId);
		const r = pick(e.clientX, e.clientY);
		if (r && r.station) goToStation(r.station);
		else if (r) goToPoint(r.x, r.z);
	});
	canvas.addEventListener('pointermove', (e) => {
		if (drag && drag.id === e.pointerId) {
			if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 14) return;
			drag.moved = true;
			if (performance.now() - drag.last < 120) return;
			drag.last = performance.now();
			const r = pick(e.clientX, e.clientY);
			if (r && !r.station) goToPoint(r.x, r.z);
		} else if (e.pointerType === 'mouse' && started && !introOpen) {
			const r = pick(e.clientX, e.clientY);
			canvas.style.cursor = r && r.station ? 'pointer' : 'crosshair';
		}
	});
	const endDrag = (e) => { if (drag && drag.id === e.pointerId) drag = null; };
	canvas.addEventListener('pointerup', endDrag);
	canvas.addEventListener('pointercancel', endDrag);
	canvas.addEventListener('contextmenu', (e) => e.preventDefault());

	addEventListener('hashchange', () => {
		const id = resolveHash();
		if (id && started) openPanel(id);
	});
	function resolveHash() {
		const h = decodeURIComponent(location.hash.slice(1));
		const id = ALIASES[h] || h;
		return stationById[id] ? id : null;
	}

	/* ---------- minimap ---------- */
	const mm = $('#minimap');
	const mctx = mm.getContext('2d');
	let mmScale = 1;
	function sizeMinimap() {
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		const css = mm.clientWidth || 180;
		mm.width = mm.height = Math.round(css * dpr);
		mmScale = dpr;
	}
	sizeMinimap();
	const toMap = (x, z) => [((x + MAP_HALF) / (2 * MAP_HALF)) * mm.width, ((z + MAP_HALF) / (2 * MAP_HALF)) * mm.height];
	function drawMinimap() {
		const S = mm.width, k = mmScale;
		mctx.clearRect(0, 0, S, S);
		mctx.imageSmoothingEnabled = false;
		mctx.drawImage(slam.canvas, 0, 0, S, S);

		if (route) {
			mctx.strokeStyle = hex(route.stationId ? stationById[route.stationId].color : 0x4ade80);
			mctx.lineWidth = 1.5 * k;
			mctx.setLineDash([3 * k, 3 * k]);
			mctx.beginPath();
			mctx.moveTo(...toMap(robot.x, robot.z));
			for (let i = route.idx; i < route.path.length; i++) mctx.lineTo(...toMap(...route.path[i]));
			mctx.stroke();
			mctx.setLineDash([]);
		}
		for (const s of world.stations) {
			const [x, y] = toMap(s.x, s.z);
			mctx.fillStyle = hex(s.color);
			mctx.beginPath();
			mctx.arc(x, y, 4 * k, 0, Math.PI * 2);
			mctx.fill();
			if (visited.has(s.id)) {
				mctx.strokeStyle = '#ffffff';
				mctx.lineWidth = 1.2 * k;
				mctx.beginPath();
				mctx.arc(x, y, 6.5 * k, 0, Math.PI * 2);
				mctx.stroke();
			}
		}
		const [rx, ry] = toMap(robot.x, robot.z);
		mctx.save();
		mctx.translate(rx, ry);
		mctx.rotate(-robot.theta);
		mctx.fillStyle = '#ffffff';
		mctx.shadowColor = '#22d3ee';
		mctx.shadowBlur = 6 * k;
		mctx.beginPath();
		mctx.moveTo(0, 7 * k);
		mctx.lineTo(-4.5 * k, -4.5 * k);
		mctx.lineTo(0, -2 * k);
		mctx.lineTo(4.5 * k, -4.5 * k);
		mctx.closePath();
		mctx.fill();
		mctx.restore();
	}
	mm.addEventListener('click', (e) => {
		if (!started || introOpen) return;
		const rect = mm.getBoundingClientRect();
		const x = ((e.clientX - rect.left) / rect.width) * 2 * MAP_HALF - MAP_HALF;
		const z = ((e.clientY - rect.top) / rect.height) * 2 * MAP_HALF - MAP_HALF;
		const s = world.stations.find((st) => Math.hypot(st.x - x, st.z - z) < 2.2);
		if (s) goToStation(s.id);
		else goToPoint(clamp(x, -HALF + 1, HALF - 1), clamp(z, -HALF + 1, HALF - 1));
	});

	/* ---------- telemetry ---------- */
	const tel = {
		x: $('#t-x'), y: $('#t-y'), yaw: $('#t-yaw'), v: $('#t-v'), w: $('#t-w'), map: $('#t-map'),
	};
	const fmt = (n, d = 2) => (Math.abs(n) < 0.005 ? 0 : n).toFixed(d).padStart(d ? 6 : 4);
	function updateTelemetry() {
		// Reported in a ROS-style frame: x east, y north, yaw CCW from +x.
		tel.x.textContent = fmt(robot.x);
		tel.y.textContent = fmt(-robot.z);
		const yaw = Math.atan2(-Math.cos(robot.theta), Math.sin(robot.theta));
		tel.yaw.textContent = fmt((yaw * 180) / Math.PI, 0) + '°';
		tel.v.textContent = fmt(robot.v);
		tel.w.textContent = fmt(robot.w);
		tel.map.textContent = Math.min(100, Math.round((slam.known / slam.total) * 100)) + '%';
	}

	/* ---------- camera + labels ---------- */
	const focus = new THREE.Vector3(START.x, 0, START.z);
	const focusGoal = new THREE.Vector3();
	const camGoal = new THREE.Vector3();
	const lookAt = new THREE.Vector3();
	camera.position.set(0, 42, 38);
	camera.lookAt(0, 0, 0);

	function updateCamera(dt) {
		if (!started) {
			// Attract mode: slow orbit around the arena behind the intro card.
			const a = reducedMotion ? 0.6 : elapsed * 0.06;
			camGoal.set(Math.sin(a) * 30, 30, Math.cos(a) * 30);
			camera.position.lerp(camGoal, 1 - Math.exp(-dt * 1.5));
			camera.lookAt(0, 0, 0);
			return;
		}
		focusGoal.set(robot.x + Math.sin(robot.theta) * robot.v * 0.18, 0, robot.z + Math.cos(robot.theta) * robot.v * 0.18);
		if (openPanelId && innerWidth > 900) {
			// Keep the robot visible to the left of the open panel.
			const panelFrac = Math.min(640, innerWidth) / innerWidth;
			focusGoal.x += panelFrac * 14;
		}
		focus.lerp(focusGoal, 1 - Math.exp(-dt * 5));
		camGoal.copy(focus).add(camOffset);
		camera.position.lerp(camGoal, 1 - Math.exp(-dt * (reducedMotion ? 12 : 3.5)));
		lookAt.set(camera.position.x - camOffset.x, 0.4, camera.position.z - camOffset.z);
		camera.lookAt(lookAt);
	}

	function updateLabels() {
		const w = innerWidth, h = innerHeight;
		for (const s of world.stations) {
			tmpV.copy(s.labelAnchor).project(camera);
			const el = s.labelEl;
			if (tmpV.z > 1 || Math.abs(tmpV.x) > 1.1 || Math.abs(tmpV.y) > 1.1 || !started) {
				el.style.visibility = 'hidden';
				continue;
			}
			el.style.visibility = 'visible';
			el.style.transform = `translate(${((tmpV.x + 1) / 2) * w}px, ${((1 - tmpV.y) / 2) * h}px) translate(-50%, -100%)`;
		}
	}

	addEventListener('resize', () => {
		renderer.setSize(innerWidth, innerHeight);
		layoutCamera();
		sizeMinimap();
	});

	/* ---------- main loop ---------- */
	const clock = new THREE.Clock();
	const LED = { idle: 0x22d3ee, manual: 0x38bdf8, nav: 0x4ade80 };

	/* ---------- adaptive quality ---------- */
	// Every 2 s, if the frame rate is below target, apply the next downgrade step.
	// If a step doesn't actually help (e.g. the browser is capped at 30 fps in a
	// battery-saver mode), undo it and stop adapting.
	const QUALITY_STEPS = [
		() => {
			const pr = renderer.getPixelRatio();
			if (pr <= 1.25) return null;
			renderer.setPixelRatio(1.25);
			return () => renderer.setPixelRatio(pr);
		},
		() => {
			if (!sun.castShadow) return null;
			sun.castShadow = false;
			return () => { sun.castShadow = true; };
		},
		() => {
			const pr = renderer.getPixelRatio();
			if (pr <= 0.85) return null;
			renderer.setPixelRatio(0.85);
			return () => renderer.setPixelRatio(pr);
		},
	];
	const quality = { acc: 0, frames: 0, step: 0, undo: null, fpsBefore: 0, done: false };
	function adaptQuality(rawDt) {
		if (quality.done || elapsed < 2 || rawDt > 0.25) return; // skip warm-up and tab switches
		quality.acc += rawDt;
		quality.frames++;
		if (quality.acc < 2) return;
		const fps = quality.frames / quality.acc;
		quality.acc = 0;
		quality.frames = 0;
		if (quality.undo) {
			if (fps < quality.fpsBefore * 1.1) {
				quality.undo();
				quality.done = true;
				return;
			}
			quality.undo = null;
		}
		if (fps >= 40) return;
		while (quality.step < QUALITY_STEPS.length) {
			const undo = QUALITY_STEPS[quality.step++]();
			if (undo) {
				quality.undo = undo;
				quality.fpsBefore = fps;
				console.info(`[robot-portfolio] ${fps.toFixed(0)} fps: lowering render quality (step ${quality.step})`);
				return;
			}
		}
		quality.done = true;
	}

	function tick() {
		const rawDt = clock.getDelta();
		const dt = Math.min(rawDt, 0.1);
		elapsed += dt;
		frame++;

		// On phones an open panel covers the scene: skip rendering to save battery.
		const covered = !!openPanelId && innerWidth <= 720;
		if (!covered) adaptQuality(rawDt);

		let cmd = { v: 0, w: 0 };
		let mode = 'idle';
		if (started && !introOpen && !openPanelId) {
			let ix = 0, iz = 0;
			for (const k of keys) {
				const m = KEYMAP[k];
				if (m) { ix += m[0]; iz += m[1]; }
			}
			if (ix || iz) {
				if (route) cancelRoute();
				cmd = robot.steer(Math.atan2(ix, iz), 1);
				mode = 'manual';
			} else if (route) {
				cmd = routeControl();
				mode = 'nav';
			}
		}
		// Substep so slow frames don't tunnel the robot through thin obstacles.
		const steps = Math.ceil(dt / 0.02);
		for (let i = 0; i < steps; i++) {
			robot.drive(dt / steps, cmd.v, cmd.w);
			resolveCollisions();
		}
		robot.sync(dt);
		robot.setLed(docked && mode === 'idle' ? docked.color : LED[mode]);

		if (frame % 2 === 0) {
			lidar.scan(robot.x, robot.z, robot.theta + elapsed * 0.7);
			slam.integrate(robot.x, robot.z, lidar);
		}

		updateDock();
		world.update(elapsed, dt);
		drawPath();
		if (goalMarker.visible) {
			goalArrow.position.y = 0.75 + Math.sin(elapsed * 4) * 0.12;
			goalArrow.rotation.y = elapsed * 2;
		}
		updateCamera(dt);
		updateLabels();
		if (covered) return;
		if (frame % 2 === 0) drawMinimap();
		if (frame % 6 === 0) updateTelemetry();
		renderer.render(scene, camera);
	}
	renderer.setAnimationLoop(tick);

	/* ---------- ready ---------- */
	log('All systems nominal. Ready to drive.');
	startBtn.disabled = false;
	startBtn.textContent = 'Power on';
	document.documentElement.classList.add('game-ready');

	const deepLink = resolveHash();
	if (deepLink) start(deepLink);
	else startBtn.focus({ preventScroll: true });
}
