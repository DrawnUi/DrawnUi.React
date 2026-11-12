// The dungeon's mesh, drawn without a mesh API: CanvasKit has no SkMesh, so the frame's triangles go through
// drawVertices and one runtime shader that is the game's own MESH_FS (shaders.ts), word for word, with a small
// entry point in front of it (the same idea as the .NET port's mesh stand-in):
// - every triangle gets its own cell of texture coordinates, corners at +0.125 / +0.875, so the interpolated
//   coordinate gives the triangle (its cell) and the pixel's barycentrics (the fraction);
// - the three varyings (a, b, c) of every corner are written into a half-float image, each float split into a
//   high and a low half-float (hi = the float rounded to half precision, lo = the rest; their sum keeps about 22
//   bits), so GPUs that read textures at half precision still get the values the builder wrote;
// - the shader reads the three corners of its triangle, mixes them with the barycentrics (the builder divided the
//   values by depth, so a screen-space mix is the perspective-correct one) and runs MESH_FS.
// MESH_VS only hands the values on: the builder already projected the positions on the CPU.
import type { Canvas, Image, Paint, RuntimeEffect, Shader } from "canvaskit-wasm";
import { Super, type SKRect } from "drawnui-react/core";
import { MESH_FS } from "./shaders";

const FLOATS = 14; // per vertex: position x, y, then a, b, c (float4 each)
const TEXELS = 3; // per corner: a, b, c
const WIDTH = 1024; // texels per row of the varying image (a power of two)
const CELLS = 256; // triangle cells per row of the texture-coordinate grid
const LOW = 0.125, HIGH = 0.875;

const ENTRY = `
uniform shader _attr;
uniform float4 _grid; // x: cells per row, y: image width, z: 1 / width, w: rows of the high half block
float4 _t(float i) {
    float y = floor(i * _grid.z);
    float2 c = float2(i - y * _grid.y + 0.5, y + 0.5);
    return float4(_attr.eval(c)) + float4(_attr.eval(float2(c.x, c.y + _grid.w)));
}
half4 main(float2 p) {
    float cx = floor(p.x);
    float cy = floor(p.y);
    float b1 = (p.x - cx - ${LOW}) * ${1 / (HIGH - LOW)};
    float b2 = (p.y - cy - ${LOW}) * ${1 / (HIGH - LOW)};
    float3 w = float3(1.0 - b1 - b2, b1, b2);
    float i = (cy * _grid.x + cx) * ${TEXELS * 3}.0;
    Varyings v;
    v.position = p;
    v.a = _t(i) * w.x + _t(i + ${TEXELS}.0) * w.y + _t(i + ${TEXELS * 2}.0) * w.z;
    v.b = _t(i + 1.0) * w.x + _t(i + ${TEXELS + 1}.0) * w.y + _t(i + ${TEXELS * 2 + 1}.0) * w.z;
    v.c = _t(i + 2.0) * w.x + _t(i + ${TEXELS + 2}.0) * w.y + _t(i + ${TEXELS * 2 + 2}.0) * w.z;
    half4 color = half4(0.0);
    _mesh_fs(v, color);
    return color;
}
`;

const SOURCE = "struct Varyings { float2 position; float4 a; float4 b; float4 c; };\n"
  + MESH_FS.replace("float2 main(const Varyings v, out half4 color)", "float2 _mesh_fs(const Varyings v, out half4 color)")
  + ENTRY;

let effect: RuntimeEffect | null | undefined;
let paint: Paint | undefined;
let reported = false;
// reused between frames, grown when a frame has more triangles
let halfs = new Uint16Array(0);
let positions = new Float32Array(0);
let texs = new Float32Array(0);
const uniformData = new Float32Array(24);

// float -> IEEE half bits, round to nearest even (no Float16Array in every engine the checks run on)
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
function toHalf(x: number): number {
  f32[0] = x;
  const b = u32[0];
  const sign = (b >>> 16) & 0x8000;
  const exp = (b >>> 23) & 0xff;
  let mant = b & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0);
  let e = exp - 127 + 15;
  if (e >= 0x1f) return sign | 0x7c00; // overflow: infinity
  if (e <= 0) {
    if (e < -10) return sign; // too small: zero
    mant |= 0x800000;
    const shift = 14 - e;
    let h = mant >>> shift;
    const rest = mant & ((1 << shift) - 1), halfway = 1 << (shift - 1);
    if (rest > halfway || (rest === halfway && (h & 1))) h++;
    return sign | h;
  }
  let h = (e << 10) | (mant >>> 13);
  const rest = mant & 0x1fff;
  if (rest > 0x1000 || (rest === 0x1000 && (h & 1))) h++; // may carry into the exponent: still the right half
  return sign | h;
}
function fromHalf(h: number): number {
  const s = h & 0x8000 ? -1 : 1, e = (h >>> 10) & 0x1f, m = h & 0x3ff;
  if (e === 0) return s * m * 5.960464477539063e-8;
  if (e === 0x1f) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * Math.pow(2, e - 15);
}

/** One draw of the frame's triangles (vertices: FLOATS per vertex, a triangle list) with MESH_FS. */
export function drawDungeonMesh(canvas: Canvas, vertices: Float32Array, floats: number, uniforms: Float32Array,
  left: number, top: number, right: number, bottom: number, clip: SKRect): void {
  const CK = Super.CK;
  if (effect === undefined) {
    let error = "";
    effect = CK.RuntimeEffect.Make(SOURCE, (e: string) => { error = e; });
    if (!effect && !reported) { reported = true; console.error("dungeon: mesh SkSL:", error); }
  }
  if (!effect) return;
  const count = Math.floor(floats / FLOATS);
  const tris = Math.floor(count / 3);
  if (tris === 0 || right <= left || bottom <= top) return;

  // the varying image: high halves in rows [0, rows), low halves in rows [rows, 2 rows)
  const used = tris * 3 * TEXELS;
  const rows = Math.ceil(used / WIDTH);
  const texels = rows * WIDTH;
  if (halfs.length < texels * 8) halfs = new Uint16Array(texels * 8 * 2);
  const lo = texels * 4;
  for (let v = 0, o = 0; v < count; v++) {
    const src = v * FLOATS + 2;
    for (let k = 0; k < 12; k++, o++) {
      const x = vertices[src + k];
      const h = toHalf(x);
      halfs[o] = h;
      halfs[lo + o] = toHalf(x - fromHalf(h));
    }
  }
  // positions and the per-triangle texture-coordinate cells
  if (positions.length < count * 2) { positions = new Float32Array(count * 4); texs = new Float32Array(count * 4); }
  for (let v = 0; v < count; v++) { positions[v * 2] = vertices[v * FLOATS]; positions[v * 2 + 1] = vertices[v * FLOATS + 1]; }
  for (let t = 0; t < tris; t++) {
    const cx = t % CELLS, cy = Math.floor(t / CELLS), o = t * 6;
    texs[o] = cx + LOW; texs[o + 1] = cy + LOW;
    texs[o + 2] = cx + HIGH; texs[o + 3] = cy + LOW;
    texs[o + 4] = cx + LOW; texs[o + 5] = cy + HIGH;
  }

  const image: Image | null = CK.MakeImage(
    { width: WIDTH, height: rows * 2, colorType: CK.ColorType.RGBA_F16, alphaType: CK.AlphaType.Premul, colorSpace: CK.ColorSpace.SRGB },
    new Uint8Array(halfs.buffer, 0, texels * 8 * 2), WIDTH * 8);
  if (!image) return;
  const attr: Shader = image.makeShaderOptions(CK.TileMode.Clamp, CK.TileMode.Clamp, CK.FilterMode.Nearest, CK.MipmapMode.None);
  uniformData.set(uniforms.subarray(0, 20), 0);
  uniformData[20] = CELLS; uniformData[21] = WIDTH; uniformData[22] = 1 / WIDTH; uniformData[23] = rows;
  const shader = effect.makeShaderWithChildren(uniformData, [attr]);
  const verts = CK.MakeVertices(CK.VertexMode.Triangles, positions.subarray(0, count * 2), texs.subarray(0, tris * 6), null, null, true);
  paint ??= new CK.Paint();
  paint.setColor(CK.WHITE);
  paint.setShader(shader);
  canvas.save();
  canvas.clipRect(CK.LTRBRect(clip.Left, clip.Top, clip.Right, clip.Bottom), CK.ClipOp.Intersect, false);
  canvas.drawVertices(verts, CK.BlendMode.Modulate, paint);
  canvas.restore();
  paint.setShader(null);
  verts.delete(); shader.delete(); attr.delete(); image.delete();
}
