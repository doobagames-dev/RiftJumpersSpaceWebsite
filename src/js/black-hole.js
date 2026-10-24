// The rift: a black hole fixed to the top of the page, with only the bottom
// third of its shadow on screen. Two WebGL layers share one fragment shader:
//   - .rift-bg (behind the page): a starfield ray-traced through the hole's
//     gravity, so stars bend around it.
//   - .rift-fg (in front of the page): the shadow, a faint horizon ring and
//     the almond-eye strands, drawn as flat anti-aliased shapes so they stay
//     crisp at full device resolution. Swallowed elements vanish behind them.
// Every [data-suck] block spirals into the hole as it scrolls up toward it
// and comes back out when you scroll back down: the transform is a pure
// function of scroll position.
//
// Performance budget (phones especially):
//   - The background is static, so it only re-renders when its size changes.
//   - The foreground is cheap analytic shapes, rendered every frame at device
//     resolution; it only drops a little resolution if frames run long.
//   - Block positions are measured once (and on resize/layout change), then
//     each frame only reads window.scrollY; transforms are written only when
//     the scroll position changes, and only transform/opacity are animated.

const ACCENT = [0 / 255, 244 / 255, 253 / 255];
const TILT = (-7 * Math.PI) / 180; // camera slightly below the hole's plane for the lensed starfield
const PULL = 1; // how early blocks start being pulled in

const MOBILE = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 768;
const QUALITY = MOBILE
	? { steps: 120, step: 0.08, fgBudget: 1400000, fgCap: 2, bgBudget: 700000, bgCap: 1 }
	: { steps: 220, step: 0.055, fgBudget: 3000000, fgCap: 2, bgBudget: 1600000, bgCap: 1 };

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

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

#if MODE == 1

// ---- Foreground: flat shapes in units of the shadow radius (y up). ----

// One almond strand: the lower half of an eye shape y = -h * (1 - (x/w)^2)^0.7.
// Returns its coverage at q with an anti-aliased ~1.2 css px core plus a soft glow.
float strand(vec2 q, float h, float w) {
  float u = q.x / w;
  if (abs(u) >= 0.98) return 0.0;
  float s = 1.0 - u * u;
  float g = pow(s, 0.7);
  float dg = -1.4 * u / w * pow(s, -0.3);
  // Distance to the curve, first-order: |F| / |grad F| with F = y + h g(x).
  float d = abs(q.y + h * g) / sqrt(1.0 + h * h * dg * dg) * u_R; // css px
  float aa = 1.0 / u_scale;                                       // one device px
  float core = clamp((0.6 - d) / aa + 0.5, 0.0, 1.0);
  float glow = exp(-d / 3.5) * 0.14;
  float fade = smoothstep(0.98, 0.7, abs(u)); // taper toward the eye's corners
  return (core + glow) * fade;
}

void main() {
  vec2 css = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y) / u_scale;
  vec2 q = (css - u_center) / u_R;
  q.y = -q.y;
  float r = length(q);
  float aa = 1.0 / (u_R * u_scale);

  // Shadow: a crisp black disc.
  float shadow = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);

  // Horizon: faint static white ring at the edge, soft rim inside, pale halo outside.
  float edge = (r - 1.0) * u_R; // css px from the shadow edge
  float ring = exp(-pow((edge - 1.2) / 1.1, 2.0)) * 0.24;
  float rim = r < 1.0 ? exp(edge / 7.0) * 0.12 : 0.0;
  float halo = r > 1.0 ? exp(-(r - 1.0) / 0.27) * 0.08 : 0.0;
  float glowI = (ring + rim + halo) * (1.0 + 0.25 * u_feed);

  // Strands: five nested arcs hugging the bottom of the shadow, brighter
  // innermost and on one side, with a slow highlight drifting along them.
  float strands = 0.0;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float h = 1.06 + 0.05 * fi;
    float w = 1.45 + 0.17 * fi;
    float amp = (1.0 - 0.15 * fi) * (0.9 + 0.12 * q.x / w);
    strands += strand(q, h, w) * amp;
  }
  float drift = 0.82 + 0.18 * sin(q.x * 2.4 - u_time * 0.5 - u_spin * 1.5);
  float strandI = strands * drift * (0.8 + 0.5 * u_feed);

  vec3 glowCol = mix(vec3(1.0), u_accent, 0.12);
  vec3 strandCol = mix(vec3(1.0), u_accent, 0.08);
  vec3 rgb = glowCol * glowI + strandCol * strandI;
  float alpha = shadow + (1.0 - shadow) * clamp(glowI + strandI, 0.0, 1.0);
  gl_FragColor = vec4(rgb, alpha);
}

#else

// ---- Background: starfield ray-traced around a Schwarzschild hole. ----
// Units: Schwarzschild radius = 1. Shadow edge sits at b = 3*sqrt(3)/2.
const float DIST = 22.0;
const float TAN_SH = 0.1162;

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
      float tw = 0.7 + 0.3 * sin(h * 40.0);
      vec3 tint = mix(vec3(0.75, 0.85, 1.0), mix(vec3(1.0, 0.9, 0.8), u_accent, step(0.5, fract(h * 7.0))), fract(h * 13.0) * 0.6);
      col += tint * b * tw * (L == 0 ? 0.9 : 1.6);
    }
  }
  return col;
}

vec3 nebula(vec3 d) {
  float n = fbm(d * 2.2);
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
    for (int i = 0; i < MAX_STEPS; i++) {
      float r = length(pos);
      float dt = clamp(STEP * r, 0.015, 1.0);
      vel += -1.5 * h2 * pos / (r * r * r * r * r) * dt;
      pos += vel * dt;
      r = length(pos);
      minR = min(minR, r);
      if (r < 1.0) { captured = 1.0; break; }
      if (r > 28.0 && dot(pos, vel) > 0.0) break;
    }
    outDir = normalize(vel);
  }

  vec3 col = vec3(0.0);
  if (captured < 0.5) {
    col = stars(outDir) + nebula(outDir);
    float glow = exp(-max(minR - 1.5, 0.0) * 0.9);
    col += vec3(0.85, 0.9, 1.0) * glow * 0.08;
  }
  gl_FragColor = vec4(col, 1.0);
}

#endif
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
	const defines =
		`#define MODE ${mode}\n` +
		`#define MAX_STEPS ${QUALITY.steps}\n` +
		`#define STEP ${QUALITY.step.toFixed(3)}\n`;
	const fs = compile(gl.FRAGMENT_SHADER, defines + FRAG);
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
	// cssW/cssH are kept current by a ResizeObserver so drawing never forces layout.
	return { canvas, gl, prog, u, mode, cssW: canvas.clientWidth, cssH: canvas.clientHeight, dirty: true };
}

function draw(r, P, quality) {
	const { gl, canvas: c, u } = r;
	const cw = r.cssW;
	const ch = r.cssH;
	if (!cw || !ch) return;
	// Both layers render at device resolution (up to 2x), within a pixel budget.
	const budget = r.mode === 1 ? QUALITY.fgBudget : QUALITY.bgBudget;
	const cap = Math.min(r.mode === 1 ? QUALITY.fgCap : QUALITY.bgCap, window.devicePixelRatio || 1);
	const s = Math.min(cap, Math.sqrt(budget / (cw * ch))) * quality;
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
	child.style.willChange = '';
	child.__sucked = false;
}

export function initRift(root) {
	const bgEl = root.querySelector('.rift-bg');
	const fgEl = root.querySelector('.rift-fg');
	const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	const bg = makeGL(bgEl, 0);
	const fg = makeGL(fgEl, 1);
	if (!bg || !fg) root.classList.add('no-gl');

	// Keep canvas sizes cached; any size change also means block positions moved.
	let layoutDirty = true;
	const sizeObserver = new ResizeObserver((entries) => {
		for (const entry of entries) {
			const layer = entry.target === bgEl ? bg : entry.target === fgEl ? fg : null;
			if (layer) {
				layer.cssW = entry.contentRect.width;
				layer.cssH = entry.contentRect.height;
				layer.dirty = true;
			}
		}
		layoutDirty = true;
	});
	if (bgEl) sizeObserver.observe(bgEl);
	if (fgEl) sizeObserver.observe(fgEl);
	sizeObserver.observe(root); // page height changes when images and fonts load
	if (document.fonts) document.fonts.ready.then(() => { layoutDirty = true; });

	// Block anchors in page coordinates. The [data-suck] wrappers are never
	// transformed, so measuring them is always exact.
	let boxes = [];
	function measure() {
		const scrollY = window.scrollY;
		boxes = Array.from(root.querySelectorAll('[data-suck]'), (el) => {
			const r = el.getBoundingClientRect();
			return {
				child: el.firstElementChild,
				x: r.left + r.width / 2,
				top: r.top + scrollY,
				w: r.width,
				anchorOff: Math.min(r.height * 0.5, 140),
			};
		});
	}

	// Foreground resolution backs off a little if frames run long and creeps
	// back up when there is headroom. The floor keeps strand edges smooth.
	// `refresh` tracks the display's frame interval.
	let quality = 1;
	let frameMs = 16.7;
	let refresh = 16.7;
	let lastFrame = 0;
	let lastAdjust = 0;
	document.addEventListener('visibilitychange', () => { lastFrame = 0; });

	const t0 = performance.now();
	let spin = 0;
	let vel = 0;
	let feed = 0;
	let pulling = 0;
	let lastScroll = null;

	function frame(now) {
		requestAnimationFrame(frame);

		if (lastFrame) {
			const d = Math.min(100, now - lastFrame);
			frameMs += (d - frameMs) * 0.1;
			refresh = Math.min(d, refresh + 0.02);
			if (frameMs > refresh * 1.35 && quality > 0.75 && now - lastAdjust > 400) {
				quality = Math.max(0.75, quality - 0.125);
				lastAdjust = now;
			} else if (frameMs < refresh * 1.1 && quality < 1 && now - lastAdjust > 2000) {
				quality = Math.min(1, quality + 0.125);
				lastAdjust = now;
			}
		}
		lastFrame = now;

		const vw = (bg && bg.cssW) || window.innerWidth;
		const R = fg && fg.cssH
			? fg.cssH / 2.2
			: Math.min(380, Math.max(80, Math.min(vw * 0.26, window.innerHeight * 0.21)));
		const cx = vw / 2;
		const cy = -R / 3; // center sits above the viewport: only the bottom third shows

		const relayout = layoutDirty;
		if (layoutDirty) {
			measure();
			layoutDirty = false;
		}
		const scrollY = window.scrollY;
		const scrolled = scrollY !== lastScroll;
		vel += ((lastScroll === null ? 0 : scrollY - lastScroll) - vel) * 0.15;
		lastScroll = scrollY;
		if (scrolled || relayout) pulling = applyPull(scrollY, R, cx, cy);

		// The strands brighten while the hole feeds and their highlight drifts with scroll.
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
		// The lensed starfield never changes on its own: draw it only when resized.
		if (bg && bg.dirty) {
			draw(bg, P, 1);
			bg.dirty = false;
		}
		if (fg) draw(fg, P, quality);
	}

	function applyPull(scrollY, R, cx, cy) {
		const yStart = cy + R * (1.35 + 0.5 * PULL);
		const yEnd = cy + R * 0.5;
		let total = 0;
		for (const box of boxes) {
			const child = box.child;
			if (!child) continue;
			const ax = box.x;
			const ay = box.top - scrollY + box.anchorOff;
			const t = reduce ? 0 : Math.max(0, Math.min(1, (yStart - ay) / (yStart - yEnd)));
			if (t <= 0) {
				if (child.__sucked) release(child);
				continue;
			}
			total += Math.sin(Math.PI * t);

			// Spiral the anchor toward the hole's center while shrinking and
			// stretching along the infall direction. Only transform and opacity
			// change, so the browser can composite without repainting.
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
			const fade = t < 0.65 ? 1 : 1 - (t - 0.65) / 0.35;

			if (!child.__sucked) {
				child.style.willChange = 'transform, opacity';
				child.__sucked = true;
			}
			child.style.transformOrigin = `${(box.w / 2).toFixed(1)}px ${box.anchorOff.toFixed(1)}px`;
			child.style.transform =
				`translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) ` +
				`rotate(${phi.toFixed(4)}rad) scale(${sx.toFixed(4)}, ${sy.toFixed(4)}) rotate(${(-phi).toFixed(4)}rad) ` +
				`rotate(${th.toFixed(4)}rad) scale(${k.toFixed(4)})`;
			child.style.opacity = Math.max(0, fade).toFixed(3);
		}
		return total;
	}

	requestAnimationFrame(frame);
}

const root = document.querySelector('[data-rift]');
if (root) initRift(root);
