// The rift: a ray-traced Schwarzschild black hole fixed to the top of the
// page, with only the bottom third of its shadow on screen. Two WebGL layers
// share one fragment shader:
//   - .rift-bg (behind the page): starfield bent by the hole's gravity.
//   - .rift-fg (in front of the page): the shadow, the faint horizon ring and
//     the thin disk strands, so swallowed elements vanish behind them.
// Every [data-suck] block spirals into the hole as it scrolls up toward it
// and comes back out when you scroll back down: the transform is a pure
// function of scroll position.

const ACCENT = [0 / 255, 244 / 255, 253 / 255];
const TILT = (-7 * Math.PI) / 180; // camera slightly below the disk: almond-eye arcs under the hole
const PULL = 1; // how early blocks start being pulled in

const FRAG = `
precision highp float;
uniform vec2 u_res;
uniform float u_scale;
uniform vec2 u_center;
uniform float u_R;
uniform float u_time;
uniform float u_tilt;
uniform vec3 u_accent;
uniform float u_feed;
uniform float u_spin;

// Units: Schwarzschild radius = 1. Shadow edge sits at b = 3*sqrt(3)/2.
const float DIST = 22.0;
const float TAN_SH = 0.1162;
const float BCRIT = 2.598;
const float RIN = 2.0;
const float ROUT = 4.4;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}

float fbm(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    s += a * vnoise(p);
    p = p * 2.07 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s / 0.875;
}

// Thin, white, tightly packed strands carrying dashes that orbit at Keplerian
// speed. Lensing bends the far side into the arcs hugging the shadow.
vec4 diskColor(vec3 p, vec3 rd) {
  float rr = length(p.xz);
  float om = pow(rr / RIN, -1.5);
  float k = 15.0;
  float idx = floor(rr * k / 6.2832 + 0.5);
  float strand = pow(0.5 + 0.5 * cos(rr * k), 5.0);
  float amp = 0.35 + 0.65 * hash13(vec3(idx, 3.7, 1.3));
  float a = atan(p.z, p.x) + (u_time * 0.6 + u_spin) * om;
  float dash = smoothstep(0.3, 0.6, vnoise(vec3(cos(a) * 5.0, sin(a) * 5.0, idx * 3.1)));
  float env = smoothstep(RIN, RIN + 0.25, rr) * (1.0 - smoothstep(ROUT - 1.2, ROUT, rr));
  float v = sqrt(0.5 / rr);
  vec3 vdir = normalize(vec3(-p.z, 0.0, p.x));
  float g = sqrt(1.0 - v * v) / (1.0 - v * dot(vdir, -rd)) * sqrt(1.0 - 1.0 / rr);
  float dop = mix(1.0, pow(g, 3.0), 0.45);
  float I = env * (strand * amp * (0.3 + 0.7 * dash) * 1.5 + 0.05) * dop * (1.0 + 0.6 * u_feed);
  vec3 col = mix(vec3(1.0), u_accent, 0.15 * (1.0 - strand)) * (0.85 + 0.5 * I);
  return vec4(col, clamp(I, 0.0, 0.95));
}

vec3 stars(vec3 d) {
  vec3 col = vec3(0.0);
  for (int L = 0; L < 2; L++) {
    float sc = L == 0 ? 150.0 : 60.0;
    float th = L == 0 ? 0.90 : 0.965;
    float rad = L == 0 ? 0.11 : 0.09;
    vec3 p = d * sc;
    vec3 c = floor(p);
    vec3 f = fract(p);
    float h = hash13(c + float(L) * 13.1);
    if (h > th) {
      vec3 sp = vec3(hash13(c + 1.7), hash13(c + 4.3), hash13(c + 9.1)) * 0.7 + 0.15;
      float b = smoothstep(rad, 0.0, length(f - sp));
      float tw = 0.7 + 0.3 * sin(u_time * (1.0 + h * 3.0) + h * 40.0);
      vec3 tint = mix(vec3(0.75, 0.85, 1.0), mix(vec3(1.0, 0.9, 0.8), u_accent, step(0.5, fract(h * 7.0))), fract(h * 13.0) * 0.6);
      col += tint * b * tw * (L == 0 ? 0.9 : 1.6);
    }
  }
  return col;
}

vec3 nebula(vec3 d) {
  float n = fbm(d * 2.2 + vec3(0.0, 0.0, u_time * 0.004));
  float m = fbm(d * 4.5 + 3.0);
  vec3 c = mix(vec3(0.010, 0.032, 0.028), vec3(0.05, 0.02, 0.09), smoothstep(0.35, 0.75, m));
  return c * smoothstep(0.3, 0.8, n) * 1.4;
}

void main() {
  vec2 css = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y) / u_scale;
  float F = u_R / TAN_SH;
  vec2 uv = (css - u_center) / F;
  uv.y = -uv.y;
  float ct = cos(u_tilt);
  float st = sin(u_tilt);
  vec3 cam = vec3(0.0, st, -ct) * DIST;
  vec3 fw = normalize(-cam);
  vec3 rt = vec3(1.0, 0.0, 0.0);
  vec3 up = cross(fw, rt);
  vec3 rd = normalize(fw + rt * uv.x + up * uv.y);
  float b = length(cross(cam, rd));

  vec4 acc = vec4(0.0);
  float captured = 0.0;
  float minR = b;
  vec3 outDir;

  if (b > 13.0) {
    // Far from the hole: weak-field deflection, no march needed.
    vec3 closest = cam - rd * dot(cam, rd);
    vec3 n = -normalize(closest);
    float defl = 2.0 / b;
    outDir = normalize(rd * cos(defl) + n * sin(defl));
  } else {
    vec3 pos = cam;
    vec3 vel = rd;
    float h2 = b * b;
    for (int i = 0; i < 220; i++) {
      float r = length(pos);
      float dt = clamp(0.055 * r, 0.015, 1.0);
      vec3 prev = pos;
      vel += -1.5 * h2 * pos / (r * r * r * r * r) * dt;
      pos += vel * dt;
#if MODE == 1
      if (prev.y * pos.y < 0.0) {
        float t = prev.y / (prev.y - pos.y);
        vec3 hit = mix(prev, pos, t);
        float rr = length(hit.xz);
        if (rr > RIN && rr < ROUT) {
          vec4 dc = diskColor(hit, normalize(vel));
          acc.rgb += (1.0 - acc.a) * dc.rgb * dc.a;
          acc.a += (1.0 - acc.a) * dc.a;
        }
      }
#endif
      r = length(pos);
      minR = min(minR, r);
      if (r < 1.0) { captured = 1.0; break; }
      if (r > 28.0 && dot(pos, vel) > 0.0) break;
      if (acc.a > 0.98) break;
    }
    outDir = normalize(vel);
  }

#if MODE == 1
  // Event-horizon ring: a faint, static white photon ring at the shadow edge,
  // a soft rim just inside it and a pale halo outside.
  float ang = atan(uv.y, uv.x);
  vec2 cs = vec2(cos(ang), sin(ang));
  float streak = 0.5 + 0.5 * vnoise(vec3(cs * 6.0, 0.5));
  float ringI = exp(-pow((b - 2.64) / 0.04, 2.0)) * 0.22 * (0.7 + 0.3 * streak);
  float rim = b < BCRIT ? exp(-(BCRIT - b) / 0.1) * 0.12 : 0.0;
  float halo = b > BCRIT ? exp(-(b - BCRIT) / 0.7) * 0.08 : 0.0;
  float glowI = (ringI + rim + halo) * (1.0 + 0.25 * u_feed);
  vec3 glowCol = mix(vec3(1.0), u_accent, 0.12);
  float alphaOut = captured > 0.5 ? 1.0 : acc.a;
  vec3 rgb = acc.rgb + glowCol * glowI * (1.0 - 0.5 * acc.a);
  alphaOut = alphaOut + (1.0 - alphaOut) * clamp(glowI, 0.0, 1.0);
  gl_FragColor = vec4(rgb, alphaOut);
#else
  vec3 col = vec3(0.0);
  if (captured < 0.5) {
    col = stars(outDir) + nebula(outDir);
    float glow = exp(-max(minR - 1.5, 0.0) * 0.9);
    col += vec3(0.85, 0.9, 1.0) * glow * (0.07 + 0.2 * u_feed);
  }
  gl_FragColor = vec4(col, 1.0);
#endif
}
`;

const UNIFORMS = ['u_res', 'u_scale', 'u_center', 'u_R', 'u_time', 'u_tilt', 'u_accent', 'u_feed', 'u_spin'];

function makeGL(canvas, mode) {
	if (!canvas) return null;
	let gl = null;
	try {
		gl = canvas.getContext('webgl', {
			alpha: mode === 1,
			premultipliedAlpha: true,
			antialias: false,
			depth: false,
			stencil: false,
		});
	} catch {
		gl = null;
	}
	if (!gl) return null;

	const compile = (type, src) => {
		const sh = gl.createShader(type);
		gl.shaderSource(sh, src);
		gl.compileShader(sh);
		if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
			console.warn('[rift] shader error', gl.getShaderInfoLog(sh));
			return null;
		}
		return sh;
	};
	const vs = compile(gl.VERTEX_SHADER, 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }');
	const fs = compile(gl.FRAGMENT_SHADER, `#define MODE ${mode}\n${FRAG}`);
	if (!vs || !fs) return null;

	const prog = gl.createProgram();
	gl.attachShader(prog, vs);
	gl.attachShader(prog, fs);
	gl.linkProgram(prog);
	if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
		console.warn('[rift] link error', gl.getProgramInfoLog(prog));
		return null;
	}
	gl.useProgram(prog);

	// One oversized triangle covers the viewport.
	gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
	const loc = gl.getAttribLocation(prog, 'p');
	gl.enableVertexAttribArray(loc);
	gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

	const u = {};
	for (const name of UNIFORMS) u[name] = gl.getUniformLocation(prog, name);
	return { canvas, gl, prog, u, mode };
}

function draw(r, P) {
	const { gl, canvas: c, u } = r;
	const cw = c.clientWidth;
	const ch = c.clientHeight;
	if (!cw || !ch) return;
	// The background is soft starlight, so it renders at reduced resolution;
	// the foreground (horizon ring + disk strands) stays near 1:1 to keep lines crisp.
	const budget = r.mode === 1 ? 1100000 : 520000;
	const cap = r.mode === 1 ? Math.min(1, window.devicePixelRatio || 1) : 0.6;
	const s = Math.min(cap, Math.sqrt(budget / (cw * ch)));
	const W = Math.max(1, Math.round(cw * s));
	const H = Math.max(1, Math.round(ch * s));
	if (c.width !== W || c.height !== H) {
		c.width = W;
		c.height = H;
	}
	gl.viewport(0, 0, W, H);
	gl.useProgram(r.prog);
	gl.uniform2f(u.u_res, W, H);
	gl.uniform1f(u.u_scale, W / cw);
	gl.uniform2f(u.u_center, P.cx, P.cy);
	gl.uniform1f(u.u_R, P.R);
	gl.uniform1f(u.u_time, P.time);
	gl.uniform1f(u.u_tilt, TILT);
	gl.uniform3f(u.u_accent, ACCENT[0], ACCENT[1], ACCENT[2]);
	gl.uniform1f(u.u_feed, P.feed);
	gl.uniform1f(u.u_spin, P.spin);
	gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function release(child) {
	child.style.transform = '';
	child.style.transformOrigin = '';
	child.style.opacity = '';
	child.style.filter = '';
	child.__sucked = false;
}

export function initRift(root) {
	const bgEl = root.querySelector('.rift-bg');
	const fgEl = root.querySelector('.rift-fg');
	const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	const bg = makeGL(bgEl, 0);
	const fg = makeGL(fgEl, 1);
	if (!bg || !fg) root.classList.add('no-gl');

	const t0 = performance.now();
	let spin = 0;
	let vel = 0;
	let feed = 0;
	let prevTop = null;

	function frame(now) {
		requestAnimationFrame(frame);

		const vw = (bgEl && bgEl.clientWidth) || window.innerWidth;
		const R = fgEl && fgEl.clientHeight
			? fgEl.clientHeight / 2.2
			: Math.min(380, Math.max(80, Math.min(vw * 0.26, window.innerHeight * 0.21)));
		const cx = vw / 2;
		const cy = -R / 3; // center sits above the viewport: only the bottom third shows
		const yStart = cy + R * (1.35 + 0.5 * PULL);
		const yEnd = cy + R * 0.5;

		// Read every anchor first, then write transforms (no layout thrash).
		const items = root.querySelectorAll('[data-suck]');
		const rects = Array.from(items, (el) => el.getBoundingClientRect());

		if (rects.length) {
			const top = rects[0].top;
			if (prevTop !== null) vel += (prevTop - top - vel) * 0.15;
			prevTop = top;
		}

		let pulling = 0;
		items.forEach((el, i) => {
			const child = el.firstElementChild;
			if (!child) return;
			const r = rects[i];
			const anchorOff = Math.min(r.height * 0.5, 140);
			const ax = r.left + r.width / 2;
			const ay = r.top + anchorOff;
			const t = reduce ? 0 : Math.max(0, Math.min(1, (yStart - ay) / (yStart - yEnd)));
			if (t <= 0) {
				if (child.__sucked) release(child);
				return;
			}
			pulling += Math.sin(Math.PI * t);

			// Spiral the anchor toward the hole's center while shrinking,
			// stretching along the infall direction and dimming.
			const e = t * t;
			const rx = ax - cx;
			const ry = ay - cy;
			const th = e * 1.15;
			const s = 1 - e;
			const nx = (rx * Math.cos(th) - ry * Math.sin(th)) * s;
			const ny = (rx * Math.sin(th) + ry * Math.cos(th)) * s;
			const tx = cx + nx - ax;
			const ty = cy + ny - ay;
			const phi = Math.atan2(-ny, -nx);
			const k = Math.max(0.04, 1 - 0.94 * e);
			const sx = 1 + 0.9 * e * e;
			const sy = 1 - 0.45 * e;
			const fade = t < 0.8 ? 1 : 1 - (t - 0.8) / 0.2;

			child.style.transformOrigin = `${(r.width / 2).toFixed(1)}px ${anchorOff.toFixed(1)}px`;
			child.style.transform =
				`translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) ` +
				`rotate(${phi.toFixed(4)}rad) scale(${sx.toFixed(4)}, ${sy.toFixed(4)}) rotate(${(-phi).toFixed(4)}rad) ` +
				`rotate(${th.toFixed(4)}rad) scale(${k.toFixed(4)})`;
			child.style.opacity = Math.max(0, fade).toFixed(3);
			child.style.filter = `blur(${(e * 4).toFixed(2)}px) brightness(${(1 - 0.55 * e).toFixed(3)})`;
			child.__sucked = true;
		});

		// The disk brightens while it feeds and its dashes speed up with scroll.
		feed += (Math.min(1, pulling * 0.45) - feed) * 0.08;
		spin += vel * 0.0025;

		const P = {
			R,
			cx,
			cy,
			time: ((now - t0) / 1000) * (reduce ? 0.15 : 1),
			feed,
			spin,
		};
		if (bg) draw(bg, P);
		if (fg) draw(fg, P);
	}

	requestAnimationFrame(frame);
}

const root = document.querySelector('[data-rift]');
if (root) initRift(root);
