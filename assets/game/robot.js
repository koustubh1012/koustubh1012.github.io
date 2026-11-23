// A TurtleBot-style differential-drive robot: model + simple unicycle kinematics.
import * as THREE from './vendor/three.module.min.js';

export const ROBOT_RADIUS = 0.6;
const V_MAX = 6.5;   // m/s (game units)
const W_MAX = 5.2;   // rad/s
const ACC = 16;      // m/s^2
const W_ACC = 30;    // rad/s^2
const WHEEL_R = 0.2;
const WHEEL_BASE = 1.04;

export const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const approach = (cur, target, step) =>
	cur < target ? Math.min(cur + step, target) : Math.max(cur - step, target);

export class Robot {
	constructor() {
		this.x = 0;
		this.z = 0;
		this.theta = Math.PI; // heading; forward = (sin θ, cos θ) in (x, z)
		this.v = 0;
		this.w = 0;
		this._pitch = 0;
		this.group = new THREE.Group();
		this.body = new THREE.Group();
		this.group.add(this.body);
		this._build();
	}

	_build() {
		const plateMat = new THREE.MeshStandardMaterial({ color: 0x55657e, roughness: 0.42, metalness: 0.35 });
		const metal = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.3, metalness: 0.8 });
		const tire = new THREE.MeshStandardMaterial({ color: 0x0b0f17, roughness: 0.9 });
		const add = (geo, mat, x, y, z, parent = this.body) => {
			const m = new THREE.Mesh(geo, mat);
			m.position.set(x, y, z);
			m.castShadow = true;
			parent.add(m);
			return m;
		};

		// Wheels (left = +x, right = -x when facing +z)
		this.wheels = [];
		for (const side of [1, -1]) {
			const wheel = new THREE.Group();
			wheel.position.set(side * 0.52, WHEEL_R, 0.05);
			const t = new THREE.Mesh(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.13, 28), tire);
			t.rotation.z = Math.PI / 2;
			t.castShadow = true;
			wheel.add(t);
			const hub = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.3, 0.06), metal);
			hub.position.x = side * 0.04;
			wheel.add(hub);
			this.group.add(wheel);
			this.wheels.push({ wheel, side, angle: 0 });
		}
		add(new THREE.SphereGeometry(0.07, 12, 8), metal, 0, 0.07, -0.36, this.group);

		// Stacked plates with standoffs
		const plateGeo = new THREE.CylinderGeometry(0.48, 0.48, 0.04, 48);
		for (const y of [0.26, 0.54, 0.82]) add(plateGeo, plateMat, 0, y, 0);
		const standoff = new THREE.CylinderGeometry(0.022, 0.022, 0.28, 8);
		for (let i = 0; i < 6; i++) {
			const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
			for (const y of [0.4, 0.68]) add(standoff, metal, Math.cos(a) * 0.38, y, Math.sin(a) * 0.38);
		}

		// Battery + controller board
		add(new THREE.BoxGeometry(0.38, 0.14, 0.2), new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6 }), 0, 0.35, -0.05);
		add(new THREE.BoxGeometry(0.42, 0.03, 0.32), new THREE.MeshStandardMaterial({ color: 0x14532d, roughness: 0.5 }), 0, 0.58, 0);
		for (let i = 0; i < 4; i++) {
			add(new THREE.BoxGeometry(0.03, 0.02, 0.03), new THREE.MeshBasicMaterial({ color: [0x22c55e, 0xf59e0b, 0x22c55e, 0x3b82f6][i], toneMapped: false }), -0.12 + i * 0.08, 0.605, 0.12);
		}

		// Front depth camera (shows heading)
		add(new THREE.BoxGeometry(0.34, 0.09, 0.07), new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4 }), 0, 0.66, 0.44);
		const lens = new THREE.MeshBasicMaterial({ color: 0x60a5fa, toneMapped: false });
		for (const x of [-0.1, 0.1]) {
			const l = add(new THREE.CylinderGeometry(0.025, 0.025, 0.02, 12), lens, x, 0.66, 0.48);
			l.rotation.x = Math.PI / 2;
		}

		// Status LED ring around the top plate
		this.ledMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee, toneMapped: false });
		const led = new THREE.Mesh(new THREE.TorusGeometry(0.49, 0.022, 8, 64), this.ledMat);
		led.rotation.x = Math.PI / 2;
		led.position.y = 0.82;
		this.body.add(led);

		// Front bumper light (makes the heading readable from above)
		const bumper = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.03, 6, 24, Math.PI * 0.55), this.ledMat);
		bumper.rotation.set(Math.PI / 2, 0, Math.PI / 2 - Math.PI * 0.275);
		bumper.position.y = 0.26;
		this.body.add(bumper);

		// Status glow on the floor
		this.glowMat = new THREE.MeshBasicMaterial({
			color: 0x22d3ee, transparent: true, opacity: 0.22, depthWrite: false,
			blending: THREE.AdditiveBlending, toneMapped: false,
		});
		const glow = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.9, 48), this.glowMat);
		glow.rotation.x = -Math.PI / 2;
		glow.position.y = 0.012;
		this.group.add(glow);

		// 2D lidar puck with spinning head
		add(new THREE.CylinderGeometry(0.19, 0.2, 0.08, 28), new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.5 }), 0, 0.88, 0);
		this.lidarHead = new THREE.Group();
		this.lidarHead.position.y = 0.98;
		const head = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.17, 0.13, 28), new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.35, metalness: 0.4 }));
		head.castShadow = true;
		this.lidarHead.add(head);
		const slit = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.03), new THREE.MeshBasicMaterial({ color: 0xff3b3b, toneMapped: false }));
		slit.position.set(0, 0, 0.165);
		this.lidarHead.add(slit);
		this.body.add(this.lidarHead);
	}

	setLed(color) {
		this.ledMat.color.set(color);
		this.glowMat.color.set(color);
	}

	/** Heading controller: turn toward `heading`, drive when roughly aligned. */
	steer(heading, speedScale = 1) {
		const e = wrapAngle(heading - this.theta);
		const w = Math.max(-W_MAX, Math.min(W_MAX, e * 7));
		const align = Math.cos(e);
		const v = align > 0.35 ? V_MAX * speedScale * align * align : 0;
		return { v, w };
	}

	/** Integrate unicycle kinematics with acceleration limits. */
	drive(dt, targetV, targetW) {
		const prevV = this.v;
		this.v = approach(this.v, targetV, ACC * dt);
		this.w = approach(this.w, targetW, W_ACC * dt);
		this.theta = wrapAngle(this.theta + this.w * dt);
		this.x += Math.sin(this.theta) * this.v * dt;
		this.z += Math.cos(this.theta) * this.v * dt;
		const accel = dt > 0 ? (this.v - prevV) / dt : 0;
		this._pitch += (-accel * 0.006 - this._pitch) * Math.min(1, dt * 10);
	}

	/** Push the pose into the scene graph and animate wheels / lidar. */
	sync(dt) {
		this.group.position.set(this.x, 0, this.z);
		this.group.rotation.y = this.theta;
		this.body.rotation.x = this._pitch;
		for (const w of this.wheels) {
			// positive ω turns left (CCW from above), so the left wheel (+x) runs slower: v - ωb/2
			const speed = this.v - w.side * this.w * WHEEL_BASE / 2;
			w.angle += (speed / WHEEL_R) * dt;
			w.wheel.rotation.x = w.angle;
		}
		this.lidarHead.rotation.y += dt * 18;
	}

	get speed() { return this.v; }
}
