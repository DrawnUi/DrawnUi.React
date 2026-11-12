// Vector math of the 3D add-on: column-major 4x4 matrices (WebGL's layout, column vectors: M = T * R * S), quaternions
// as [x, y, z, w], vectors as [x, y, z]. The same math as DrawnUI for Rust (glam) and .NET (System.Numerics).

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export type Mat4 = Float32Array;

export const Mat4Identity = (): Mat4 => { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; };

/** out = a * b (b applied first). `out` may be `a` or `b`. */
export function Mul(out: Mat4, a: Mat4, b: Mat4): Mat4 {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    out[c * 4] = a00 * b0 + a10 * b1 + a20 * b2 + a30 * b3;
    out[c * 4 + 1] = a01 * b0 + a11 * b1 + a21 * b2 + a31 * b3;
    out[c * 4 + 2] = a02 * b0 + a12 * b1 + a22 * b2 + a32 * b3;
    out[c * 4 + 3] = a03 * b0 + a13 * b1 + a23 * b2 + a33 * b3;
  }
  return out;
}

/** Translation, rotation, scale into `out` (scale first, then rotation, then translation). */
export function FromTRS(out: Mat4, t: Vec3, q: Quat, s: Vec3): Mat4 {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  out[0] = (1 - (yy + zz)) * s[0]; out[1] = (xy + wz) * s[0]; out[2] = (xz - wy) * s[0]; out[3] = 0;
  out[4] = (xy - wz) * s[1]; out[5] = (1 - (xx + zz)) * s[1]; out[6] = (yz + wx) * s[1]; out[7] = 0;
  out[8] = (xz + wy) * s[2]; out[9] = (yz - wx) * s[2]; out[10] = (1 - (xx + yy)) * s[2]; out[11] = 0;
  out[12] = t[0]; out[13] = t[1]; out[14] = t[2]; out[15] = 1;
  return out;
}

/** The inverse of `m` into `out`; false (out untouched) when it has none. */
export function Invert(out: Mat4, m: Mat4): boolean {
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3], a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11], a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det || !Number.isFinite(det)) return false;
  det = 1 / det;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return true;
}

/** A right-handed view from `eye` toward `center` (glam look_at_rh, System.Numerics CreateLookAt). */
export function LookAt(out: Mat4, eye: Vec3, center: Vec3, up: Vec3): Mat4 {
  let fx = eye[0] - center[0], fy = eye[1] - center[1], fz = eye[2] - center[2];
  let l = Math.hypot(fx, fy, fz) || 1; fx /= l; fy /= l; fz /= l; // z axis: from the center toward the eye
  let sx = up[1] * fz - up[2] * fy, sy = up[2] * fx - up[0] * fz, sz = up[0] * fy - up[1] * fx;
  l = Math.hypot(sx, sy, sz) || 1; sx /= l; sy /= l; sz /= l;
  const ux = fy * sz - fz * sy, uy = fz * sx - fx * sz, uz = fx * sy - fy * sx;
  out[0] = sx; out[1] = ux; out[2] = fx; out[3] = 0;
  out[4] = sy; out[5] = uy; out[6] = fy; out[7] = 0;
  out[8] = sz; out[9] = uz; out[10] = fz; out[11] = 0;
  out[12] = -(sx * eye[0] + sy * eye[1] + sz * eye[2]);
  out[13] = -(ux * eye[0] + uy * eye[1] + uz * eye[2]);
  out[14] = -(fx * eye[0] + fy * eye[1] + fz * eye[2]);
  out[15] = 1;
  return out;
}

/** A right-handed perspective with OpenGL's -1..1 depth. */
export function PerspectiveGl(out: Mat4, fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  out.fill(0);
  out[0] = f / aspect; out[5] = f; out[10] = (far + near) / (near - far); out[11] = -1; out[14] = (2 * far * near) / (near - far);
  return out;
}

/** A right-handed orthographic projection with OpenGL's -1..1 depth. */
export function OrthographicGl(out: Mat4, left: number, right: number, bottom: number, top: number, near: number, far: number): Mat4 {
  out.fill(0);
  out[0] = 2 / (right - left); out[5] = 2 / (top - bottom); out[10] = -2 / (far - near); out[15] = 1;
  out[12] = -(right + left) / (right - left); out[13] = -(top + bottom) / (top - bottom); out[14] = -(far + near) / (far - near);
  return out;
}

/** `m` x (x, y, z, w) as a 4-vector. */
export function Transform4(m: Mat4, x: number, y: number, z: number, w: number): [number, number, number, number] {
  return [m[0] * x + m[4] * y + m[8] * z + m[12] * w, m[1] * x + m[5] * y + m[9] * z + m[13] * w,
    m[2] * x + m[6] * y + m[10] * z + m[14] * w, m[3] * x + m[7] * y + m[11] * z + m[15] * w];
}

/** A point through an affine matrix (w = 1). */
export function TransformPoint(m: Mat4, p: Vec3): Vec3 {
  return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
}

/** A direction through a matrix (w = 0). */
export function TransformDir(m: Mat4, d: Vec3): Vec3 {
  return [m[0] * d[0] + m[4] * d[1] + m[8] * d[2], m[1] * d[0] + m[5] * d[1] + m[9] * d[2], m[2] * d[0] + m[6] * d[1] + m[10] * d[2]];
}

/** A point through a projective matrix, divided by w. */
export function Project(m: Mat4, p: Vec3): Vec3 {
  const [x, y, z, w] = Transform4(m, p[0], p[1], p[2], 1);
  return [x / w, y / w, z / w];
}

export const Radians = (degrees: number): number => degrees * (Math.PI / 180);

export function QuatAxisAngle(axis: Vec3, angle: number): Quat {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}

/** a * b: b's rotation first, then a's. */
export function QuatMul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}

export function QuatNormalize(q: Quat): Quat {
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  return l > 0 ? [q[0] / l, q[1] / l, q[2] / l, q[3] / l] : [0, 0, 0, 1];
}

/** The shortest-arc spherical blend from a to b (glam / System.Numerics Slerp). */
export function QuatSlerp(a: Quat, b: Quat, t: number): Quat {
  let [bx, by, bz, bw] = b;
  let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  let k0: number, k1: number;
  if (cos > 1 - 1e-6) { k0 = 1 - t; k1 = t; }
  else {
    const angle = Math.acos(cos), sin = Math.sin(angle);
    k0 = Math.sin((1 - t) * angle) / sin; k1 = Math.sin(t * angle) / sin;
  }
  return [a[0] * k0 + bx * k1, a[1] * k0 + by * k1, a[2] * k0 + bz * k1, a[3] * k0 + bw * k1];
}

/**
 * The shortest-arc blend of quaternions a (at `ai` in `av`) and b (at `bi` in `bv`) written into `out` at `oi`, without
 * allocating: the per-frame path of animations (100 animated objects sample thousands of rotations a frame).
 */
export function SlerpInto(out: Float32Array, oi: number, av: ArrayLike<number>, ai: number, bv: ArrayLike<number>, bi: number, t: number): void {
  const ax = av[ai], ay = av[ai + 1], az = av[ai + 2], aw = av[ai + 3];
  let bx = bv[bi], by = bv[bi + 1], bz = bv[bi + 2], bw = bv[bi + 3];
  let cos = ax * bx + ay * by + az * bz + aw * bw;
  if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  let k0: number, k1: number;
  if (cos > 1 - 1e-6) { k0 = 1 - t; k1 = t; }
  else { const angle = Math.acos(cos), sin = Math.sin(angle); k0 = Math.sin((1 - t) * angle) / sin; k1 = Math.sin(t * angle) / sin; }
  out[oi] = ax * k0 + bx * k1; out[oi + 1] = ay * k0 + by * k1; out[oi + 2] = az * k0 + bz * k1; out[oi + 3] = aw * k0 + bw * k1;
}

/** Rotations around x, y, z in degrees, as glam's EulerRot::XYZ (x * y * z). */
export function Euler(x: number, y: number, z: number): Quat {
  return QuatMul(QuatMul(QuatAxisAngle([1, 0, 0], Radians(x)), QuatAxisAngle([0, 1, 0], Radians(y))), QuatAxisAngle([0, 0, 1], Radians(z)));
}

/** A vector turned by a unit quaternion. */
export function Rotate(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx];
}

/** A TRS matrix split back into translation, rotation, scale (a glTF node given as a matrix). */
export function Decompose(m: ArrayLike<number>): { T: Vec3; R: Quat; S: Vec3 } {
  let sx = Math.hypot(m[0], m[1], m[2]); const sy = Math.hypot(m[4], m[5], m[6]), sz = Math.hypot(m[8], m[9], m[10]);
  const det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
  if (det < 0) sx = -sx;
  const r00 = m[0] / sx, r01 = m[1] / sx, r02 = m[2] / sx, r10 = m[4] / sy, r11 = m[5] / sy, r12 = m[6] / sy, r20 = m[8] / sz, r21 = m[9] / sz, r22 = m[10] / sz;
  // rotation matrix (columns r0, r1, r2) to a quaternion
  const trace = r00 + r11 + r22;
  let q: Quat;
  if (trace > 0) { const s = Math.sqrt(trace + 1) * 2; q = [(r12 - r21) / s, (r20 - r02) / s, (r01 - r10) / s, s / 4]; }
  else if (r00 > r11 && r00 > r22) { const s = Math.sqrt(1 + r00 - r11 - r22) * 2; q = [s / 4, (r10 + r01) / s, (r20 + r02) / s, (r12 - r21) / s]; }
  else if (r11 > r22) { const s = Math.sqrt(1 + r11 - r00 - r22) * 2; q = [(r10 + r01) / s, s / 4, (r21 + r12) / s, (r20 - r02) / s]; }
  else { const s = Math.sqrt(1 + r22 - r00 - r11) * 2; q = [(r20 + r02) / s, (r21 + r12) / s, s / 4, (r01 - r10) / s]; }
  return { T: [m[12], m[13], m[14]], R: QuatNormalize(q), S: [sx, sy, sz] };
}

export const Sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const Length = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);
export function Normalize(v: Vec3): Vec3 { const l = Length(v); return l > 0 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 0]; }

/**
 * The samples per pixel smooth edges take on a GPU offering `max`: 4, or fewer when that is all it has; 0 when it has
 * fewer than 2 (no smoothing: the plain path). Same as DrawnUI for Rust's msaa_samples.
 */
export const MsaaSamples = (max: number): number => (max < 2 ? 0 : Math.min(max, 4));
