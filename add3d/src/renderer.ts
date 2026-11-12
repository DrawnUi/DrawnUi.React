// The GPU side: one shader program and one copy of each model per WebGL context, shared by every control on that canvas.
// It draws on CanvasKit's own WebGL2 context: each control's objects in one pass into its own texture (an FBO), which
// CanvasKit then shows as an image; CanvasKit's GL state is reset after the GL calls, as CanvasKit does after its own
// texture uploads. The shaders are those of DrawnUI for Rust and .NET, so every engine draws the same.
import type { Image, Surface } from "canvaskit-wasm";
import { Super, type Canvas } from "drawnui-react/core";
import { Invert, MsaaSamples, Normalize, Transform4, type Mat4, type Vec3 } from "./math";
import type { Image3D, MaterialOverride, Scene3D } from "./scene";
import { Look } from "./types";

/** Joint matrices a skinned mesh may use (WebGL2 guarantees 256 vertex uniform vectors). */
const MAX_JOINTS = 64;

const VS = `#version 300 es
layout(location=0) in vec3 a_pos;
layout(location=1) in vec3 a_nrm;
layout(location=2) in vec2 a_uv;
layout(location=3) in vec4 a_joints;
layout(location=4) in vec4 a_weights;
layout(location=5) in vec3 a_outline_nrm;
uniform mat4 u_model;
uniform mat4 u_view_proj;
uniform mat4 u_joints[64];
uniform bool u_skinned;
uniform float u_outline;
uniform vec2 u_viewport;
out vec3 v_nrm;
out vec2 v_uv;
out vec3 v_wpos;
void main() {
    mat4 skin = mat4(1.0);
    if (u_skinned) {
        skin = a_weights.x * u_joints[int(a_joints.x)] + a_weights.y * u_joints[int(a_joints.y)]
             + a_weights.z * u_joints[int(a_joints.z)] + a_weights.w * u_joints[int(a_joints.w)];
    }
    mat4 m = u_model * skin;
    v_nrm = mat3(m) * a_nrm;
    v_uv = a_uv;
    vec4 world = m * vec4(a_pos, 1.0);
    v_wpos = world.xyz;
    gl_Position = u_view_proj * world;
    if (u_outline > 0.0) {
        // The outline pass: the back faces pushed out along their smoothed normals (one per
        // position, so hard edges do not split), a fixed number of pixels on screen.
        vec4 n = u_view_proj * vec4(mat3(m) * a_outline_nrm, 0.0);
        vec2 dir = normalize(n.xy + vec2(1e-6));
        gl_Position.xy += dir * u_outline * 2.0 / u_viewport * gl_Position.w;
        // A little behind: where it meets a surface at the same depth, the surface wins.
        gl_Position.z += 0.002 * gl_Position.w;
    }
}
`;

const FS = `#version 300 es
precision highp float;
in vec3 v_nrm;
in vec2 v_uv;
in vec3 v_wpos;
uniform vec4 u_color;
uniform float u_roughness;
uniform vec4 u_eye;
uniform bool u_textured;
uniform sampler2D u_texture;
uniform vec3 u_light;
uniform int u_look;
uniform bool u_outline_pass;
uniform vec4 u_outline_color;
out vec4 o_color;
void main() {
    if (u_outline_pass) { o_color = vec4(u_outline_color.rgb * u_outline_color.a, u_outline_color.a); return; }
    vec4 c = u_color;
    // glTF colors are linear; textures are sRGB: light in linear, show in sRGB.
    if (u_textured) { vec4 t = texture(u_texture, v_uv); c *= vec4(pow(t.rgb, vec3(2.2)), t.a); }
    if (c.a < 0.02) discard;
    vec3 n = normalize(v_nrm);
    if (!gl_FrontFacing) n = -n;
    float sun = max(dot(n, u_light), 0.0);
    float sky = 0.5 + 0.5 * n.y;
    vec3 lit;
    if (u_look == 2) lit = c.rgb;                                  // flat: the color as it is
    else if (u_look == 1) lit = c.rgb * (sun > 0.35 ? 1.0 : 0.62);  // toon: lit and shade, two tones
    else {
        // Lit (DrawnUI for Rust's render.rs): a key light, a soft fill from the other side, the sky, and a
        // highlight that only glossy materials get (roughness below 1).
        float fill = max(dot(n, normalize(vec3(-u_light.x, 0.3, -u_light.z))), 0.0);
        lit = c.rgb * (0.24 + 0.20 * sky + 0.68 * sun + 0.22 * fill);
        float gloss = 1.0 - clamp(u_roughness, 0.0, 1.0);
        if (gloss > 0.01 && sun > 0.0) {
            vec3 v = u_eye.w > 0.5 ? normalize(u_eye.xyz - v_wpos) : normalize(u_eye.xyz);
            float s = pow(max(dot(n, normalize(u_light + v)), 0.0), mix(6.0, 90.0, gloss * gloss));
            lit += 0.55 * gloss * gloss * s;
        }
    }
    o_color = vec4(pow(lit, vec3(1.0 / 2.2)) * c.a, c.a);
}
`;

const LIGHT: Vec3 = Normalize([0.4, 0.8, 0.6]);

/** One object to draw: its scene, every node's world matrix (16 floats each, the object's place included), the nodes hidden and the materials changed. */
export interface RenderItem { Scene: Scene3D; Pose: Float32Array; Hidden: ArrayLike<boolean>; Materials: ArrayLike<MaterialOverride | undefined> }

/** How a control draws its objects: the look, and an outline around every shape. */
export interface RenderStyle {
  Look: Look;
  /** Outline width in pixels (0 = none). */
  Outline: number;
  /** Outline color, sRGB RGBA 0..1, premultiplied by the shader. */
  OutlineColor: [number, number, number, number];
  /** Samples per pixel asked for (smooth edges); 1 or 0 = none. The renderer uses at most what the GPU offers. */
  Samples: number;
}

/** A control's frame: the texture it draws into with its depth buffer, and the image CanvasKit shows of it. */
export class RenderTarget {
  /** The renderer its objects belong to; another one (a new canvas, a restored context) means they are gone. */
  Owner?: Renderer3D;
  Frame: WebGLFramebuffer | null = null;
  Color: WebGLTexture | null = null;
  Depth: WebGLRenderbuffer | null = null;
  /** Smooth edges on: the multisampled frame drawn into, resolved into Frame's texture. */
  MsaaFrame: WebGLFramebuffer | null = null;
  MsaaColor: WebGLRenderbuffer | null = null;
  Samples = 1;
  Width = 0;
  Height = 0;
  /** Owns `Color`: deleting it deletes the texture. */
  Image?: Image;
}

/**
 * Where the light's highlight is seen from, for the shader: the eye as a point (w = 1) for a perspective camera, else
 * the direction toward the viewer (w = 0, orthographic: SkiaScene3D). The same rule as DrawnUI for Rust.
 */
export function Eye(viewProj: Mat4): [number, number, number, number] {
  const inverse = new Float32Array(16);
  if (!Invert(inverse, viewProj)) return [0, 0, 1, 0];
  const e = Transform4(inverse, 0, 0, 1, 0);
  if (Math.abs(e[3]) > 1e-6) return [e[0] / e[3], e[1] / e[3], e[2] / e[3], 1];
  const t = Normalize([-e[0], -e[1], -e[2]]);
  return t[0] === 0 && t[1] === 0 && t[2] === 0 ? [0, 0, 1, 0] : [t[0], t[1], t[2], 0];
}

interface GpuModel { Vaos: WebGLVertexArrayObject[][]; Counts: number[][]; Textures: WebGLTexture[] }

type Uniforms = Record<"Model" | "ViewProj" | "Joints" | "Skinned" | "Color" | "Textured" | "Texture" | "Light" | "Look" | "Outline" | "Viewport" | "OutlinePass" | "OutlineColor" | "Roughness" | "Eye", WebGLUniformLocation | null>;

export class Renderer3D {
  private static readonly renderers = new WeakMap<Canvas, Renderer3D>();

  /** The renderer of this canvas's current WebGL context (a restored context gets a new one); undefined without WebGL2. */
  static Of(canvas: Canvas | undefined, start = true): Renderer3D | undefined {
    if (!canvas) return undefined;
    let r = Renderer3D.renderers.get(canvas);
    if (r && r.epoch === canvas.GpuEpoch && !r.gl.isContextLost()) return r;
    if (!start) return undefined;
    const gl = canvas.Element.getContext("webgl2");
    if (!gl || !canvas.Surface) return undefined;
    r = new Renderer3D(gl, canvas, canvas.GpuEpoch);
    Renderer3D.renderers.set(canvas, r);
    return r;
  }

  private program: WebGLProgram | null = null;
  private vs: WebGLShader | null = null;
  private fs: WebGLShader | null = null;
  private ready = false;
  private u!: Uniforms;
  private maxSamples = 1;
  private anisotropy = -1;
  private readonly models = new WeakMap<Scene3D, GpuModel>();
  private readonly images = new WeakMap<Image3D, WebGLTexture>();
  private readonly joints = new Float32Array(MAX_JOINTS * 16);
  private readonly identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  // GL state set during one draw, 0 = not set yet
  private stateCull = 0;
  private stateTexture: WebGLTexture | null | undefined = undefined;
  private stateSkinned = 0;

  private constructor(readonly gl: WebGL2RenderingContext, private readonly canvas: Canvas, private readonly epoch: number) {}

  private Shader(kind: number, source: string): WebGLShader | null {
    const s = this.gl.createShader(kind);
    if (!s) return null;
    this.gl.shaderSource(s, source);
    this.gl.compileShader(s);
    return s;
  }

  /**
   * Starts compiling and linking the shader program without asking for its status: the GPU process does the work in
   * parallel and the first draw finds it done (drawnui-cross 6bn). True when it started just now.
   */
  StartProgram(): boolean {
    if (this.program) return false;
    const gl = this.gl;
    // the compile runs in the GPU process; with this extension the page asks whether it is done without waiting
    this.parallel = gl.getExtension("KHR_parallel_shader_compile");
    this.vs = this.Shader(gl.VERTEX_SHADER, VS);
    this.fs = this.Shader(gl.FRAGMENT_SHADER, FS);
    this.program = gl.createProgram();
    if (!this.program || !this.vs || !this.fs) return false;
    gl.attachShader(this.program, this.vs);
    gl.attachShader(this.program, this.fs);
    gl.linkProgram(this.program);
    return true;
  }

  private parallel: { COMPLETION_STATUS_KHR: number } | null = null;

  /**
   * The program is compiled and linked: a 3D view draws its first frame only then, so no frame waits for the GPU's
   * compile (drawnui-cross 6bn). Starts the compile when it has not started. Without KHR_parallel_shader_compile the
   * browser cannot say: true (the first draw then collects it).
   */
  get ProgramReady(): boolean {
    this.StartProgram();
    if (this.ready || !this.program || !this.parallel) return true;
    return this.gl.getProgramParameter(this.program, this.parallel.COMPLETION_STATUS_KHR) === true;
  }

  /** Starts the 3D program on a canvas's context as early as a 3D control is there (it compiles while the app loads). */
  static Warm(canvas: Canvas | undefined): void { Renderer3D.Of(canvas)?.StartProgram(); }

  /** The program's status and uniform places, read at the first draw. */
  private FinishProgram(): void {
    this.StartProgram();
    this.ready = true;
    const gl = this.gl, p = this.program!;
    this.maxSamples = Math.max(1, gl.getParameter(gl.MAX_SAMPLES) as number);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.warn(`[SkiaModel3D] the shader program did not link: ${gl.getProgramInfoLog(p)} ${gl.getShaderInfoLog(this.vs!)} ${gl.getShaderInfoLog(this.fs!)}`);
    }
    const at = (name: string) => gl.getUniformLocation(p, name);
    this.u = {
      Model: at("u_model"), ViewProj: at("u_view_proj"), Joints: at("u_joints"), Skinned: at("u_skinned"), Color: at("u_color"),
      Textured: at("u_textured"), Texture: at("u_texture"), Light: at("u_light"), Look: at("u_look"), Outline: at("u_outline"),
      Viewport: at("u_viewport"), OutlinePass: at("u_outline_pass"), OutlineColor: at("u_outline_color"), Roughness: at("u_roughness"), Eye: at("u_eye"),
    };
  }

  /** How sharp a texture stays seen at a slant (anisotropic filtering, up to 8); 0 when the GPU has none. Asked once. */
  private Anisotropy(): number {
    if (this.anisotropy >= 0) return this.anisotropy;
    const ext = this.gl.getExtension("EXT_texture_filter_anisotropic");
    this.anisotropy = ext ? Math.min(Math.max(this.gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number, 0), 8) : 0;
    return this.anisotropy;
  }

  /** One RGBA image as a mipmapped texture. */
  private Texture(image: Image3D): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    // pixels as they are (Begin set no flip, no premultiplication, alignment 4)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, image.Width, image.Height, 0, gl.RGBA, gl.UNSIGNED_BYTE, image.Rgba);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    // text and fine lines on a surface at an angle (a tilted card) stay sharp
    const most = this.Anisotropy();
    if (most > 1) gl.texParameterf(gl.TEXTURE_2D, 0x84fe, most); // TEXTURE_MAX_ANISOTROPY_EXT
    return t;
  }

  /** The texture of an image put on a material, uploaded the first time it is drawn in this context. */
  private ImageTexture(image: Image3D): WebGLTexture {
    let t = this.images.get(image);
    if (!t) { t = this.Texture(image); this.images.set(image, t); this.stateTexture = undefined; }
    return t;
  }

  private Attribute(index: number, data: Float32Array, size: number): void {
    if (data.length === 0) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(index);
    gl.vertexAttribPointer(index, size, gl.FLOAT, false, 0, 0);
  }

  // ponytail: a model whose scene is gone keeps its GL buffers until the context goes; delete them when apps load and
  // drop many different models.
  private Model(scene: Scene3D): GpuModel {
    let model = this.models.get(scene);
    if (model) return model;
    const gl = this.gl;
    model = { Textures: scene.Images.map((i) => this.Texture(i)), Vaos: [], Counts: [] };
    for (const primitives of scene.Meshes) {
      const vaos: WebGLVertexArrayObject[] = [], counts: number[] = [];
      for (const p of primitives) {
        const vao = gl.createVertexArray()!;
        gl.bindVertexArray(vao);
        this.Attribute(0, p.Positions, 3);
        this.Attribute(1, p.Normals, 3);
        this.Attribute(2, p.Uvs, 2);
        this.Attribute(3, p.Joints, 4);
        this.Attribute(4, p.Weights, 4);
        this.Attribute(5, p.OutlineDirections(), 3);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, p.Indices, gl.STATIC_DRAW);
        gl.bindVertexArray(null);
        vaos.push(vao); counts.push(p.Indices.length);
      }
      model.Vaos.push(vaos); model.Counts.push(counts);
    }
    this.models.set(scene, model);
    this.stateTexture = undefined;
    return model;
  }

  /** Uploads a model ahead of its first draw (warming); GL state is reset after. */
  Upload(scene: Scene3D): void {
    if (this.models.has(scene) || this.gl.isContextLost()) return;
    this.Begin();
    this.Model(scene);
    this.End();
  }

  private EnsureTarget(target: RenderTarget, w: number, h: number, samplesWanted: number, surface: Surface): void {
    const gl = this.gl;
    if (target.Owner !== this) {
      // a new context: the old objects went with it (the old renderer is no longer drawn with)
      target.Image?.delete();
      target.Image = undefined;
      target.Owner = this;
      target.Frame = gl.createFramebuffer();
      target.Depth = gl.createRenderbuffer();
      target.MsaaFrame = target.MsaaColor = null;
      target.Width = target.Height = 0;
    }
    const samples = samplesWanted > 1 ? Math.max(1, MsaaSamples(this.maxSamples)) : 1;
    if (target.Width === w && target.Height === h && target.Samples === samples && target.Image) return;
    // the image owns its texture: a new size gets a new texture and a new image
    target.Image?.delete();
    target.Image = undefined;
    target.Color = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, target.Color);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindRenderbuffer(gl.RENDERBUFFER, target.Depth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.Frame);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.Color, 0);
    if (samples > 1) {
      // smooth edges: drawn into a multisampled color and depth, then resolved into the texture
      target.MsaaFrame ??= gl.createFramebuffer();
      target.MsaaColor ??= gl.createRenderbuffer();
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, null);
      gl.bindRenderbuffer(gl.RENDERBUFFER, target.MsaaColor);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.MsaaFrame);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, target.MsaaColor);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, target.Depth);
    } else {
      if (target.MsaaFrame) {
        // smooth edges turned off: the multisampled buffers go
        gl.deleteFramebuffer(target.MsaaFrame); gl.deleteRenderbuffer(target.MsaaColor);
        target.MsaaFrame = target.MsaaColor = null;
      }
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, target.Depth);
    }
    target.Width = w; target.Height = h; target.Samples = samples;
    const CK = Super.CK;
    // the texture keeps its identity: one image wraps it until the next resize (drawn flipped: GL rows go bottom up)
    target.Image = surface.makeImageFromTexture(target.Color!, { width: w, height: h, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Premul, colorSpace: CK.ColorSpace.SRGB }) ?? undefined;
  }

  /** Frees a control's texture and buffers (the context current: any time on the web). */
  static Release(target: RenderTarget): void {
    const owner = target.Owner;
    target.Image?.delete(); // its texture too
    target.Image = undefined;
    if (owner && !owner.gl.isContextLost()) {
      const gl = owner.gl;
      gl.deleteFramebuffer(target.Frame); gl.deleteRenderbuffer(target.Depth);
      if (target.MsaaFrame) { gl.deleteFramebuffer(target.MsaaFrame); gl.deleteRenderbuffer(target.MsaaColor); }
    }
    target.Owner = undefined;
    target.Frame = target.Depth = target.MsaaFrame = target.MsaaColor = target.Color = null;
    target.Width = target.Height = 0;
  }

  /** CanvasKit forgets the texture bindings it cached (its `_resetContext` resets only those). */
  private Reset(surface: Surface | undefined = this.canvas.Surface): void {
    (surface as unknown as { _resetContext?: () => void } | undefined)?._resetContext?.();
  }

  private saved: unknown[] = [];

  /**
   * Starts a GL session on CanvasKit's context: keeps every piece of state our calls change, since CanvasKit's own state
   * cache would not see them (it re-reads only texture bindings). End puts each back as it was.
   */
  private Begin(): void {
    const gl = this.gl;
    const active = gl.getParameter(gl.ACTIVE_TEXTURE);
    gl.activeTexture(gl.TEXTURE0);
    this.saved = [
      active, gl.getParameter(gl.TEXTURE_BINDING_2D),
      gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING), gl.getParameter(gl.READ_FRAMEBUFFER_BINDING), gl.getParameter(gl.RENDERBUFFER_BINDING),
      gl.getParameter(gl.VIEWPORT), gl.isEnabled(gl.SCISSOR_TEST), gl.isEnabled(gl.STENCIL_TEST), gl.isEnabled(gl.BLEND),
      gl.getParameter(gl.BLEND_SRC_RGB), gl.getParameter(gl.BLEND_DST_RGB), gl.getParameter(gl.BLEND_SRC_ALPHA), gl.getParameter(gl.BLEND_DST_ALPHA),
      gl.getParameter(gl.BLEND_EQUATION_RGB), gl.getParameter(gl.BLEND_EQUATION_ALPHA),
      gl.getParameter(gl.COLOR_WRITEMASK), gl.getParameter(gl.DEPTH_WRITEMASK), gl.getParameter(gl.COLOR_CLEAR_VALUE), gl.getParameter(gl.DEPTH_CLEAR_VALUE),
      gl.isEnabled(gl.DEPTH_TEST), gl.getParameter(gl.DEPTH_FUNC), gl.getParameter(gl.FRONT_FACE), gl.getParameter(gl.CULL_FACE_MODE), gl.isEnabled(gl.CULL_FACE),
      gl.getParameter(gl.CURRENT_PROGRAM), gl.getParameter(gl.VERTEX_ARRAY_BINDING), gl.getParameter(gl.ARRAY_BUFFER_BINDING),
      gl.getParameter(gl.UNPACK_ALIGNMENT), gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL), gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL),
    ];
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  }

  private End(surface?: Surface): void {
    const gl = this.gl;
    const [active, texture, drawFb, readFb, rb, viewport, scissor, stencil, blend, srcRgb, dstRgb, srcA, dstA, eqRgb, eqA,
      colorMask, depthMask, clearColor, clearDepth, depthTest, depthFunc, frontFace, cullMode, cull, program, vao, buffer, align, flip, premul] = this.saved as any[];
    const on = (cap: number, v: boolean) => (v ? gl.enable(cap) : gl.disable(cap));
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.useProgram(program);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.activeTexture(active);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, drawFb);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readFb);
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.viewport(viewport[0], viewport[1], viewport[2], viewport[3]);
    on(gl.SCISSOR_TEST, scissor); on(gl.STENCIL_TEST, stencil); on(gl.BLEND, blend); on(gl.DEPTH_TEST, depthTest); on(gl.CULL_FACE, cull);
    gl.blendFuncSeparate(srcRgb, dstRgb, srcA, dstA);
    gl.blendEquationSeparate(eqRgb, eqA);
    gl.colorMask(colorMask[0], colorMask[1], colorMask[2], colorMask[3]);
    gl.depthMask(depthMask);
    gl.clearColor(clearColor[0], clearColor[1], clearColor[2], clearColor[3]);
    gl.clearDepth(clearDepth);
    gl.depthFunc(depthFunc);
    gl.frontFace(frontFace);
    gl.cullFace(cullMode);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, align);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flip);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premul);
    this.saved = [];
    this.Reset(surface);
  }

  /**
   * Draws the objects into the control's texture in one pass and returns the image CanvasKit shows of it (undefined when
   * nothing could be drawn). The image's rows are bottom up: draw it flipped.
   */
  Draw(target: RenderTarget, items: RenderItem[], count: number, style: RenderStyle, viewProj: Mat4, w: number, h: number): Image | undefined {
    const surface = this.canvas.Surface;
    if (!surface || w <= 0 || h <= 0 || this.gl.isContextLost()) return undefined;
    const gl = this.gl;
    if (!this.ready) this.FinishProgram();
    this.Begin();
    this.EnsureTarget(target, w, h, style.Samples, surface);
    if (!target.Image) { this.End(surface); return undefined; }

    gl.bindFramebuffer(gl.FRAMEBUFFER, target.MsaaFrame ?? target.Frame);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.BLEND);
    gl.colorMask(true, true, true, true);
    gl.depthMask(true);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.frontFace(gl.CCW);
    gl.cullFace(gl.BACK);
    gl.useProgram(this.program);
    const u = this.u;
    gl.uniformMatrix4fv(u.ViewProj, false, viewProj);
    gl.uniform3fv(u.Light, LIGHT);
    gl.uniform4fv(u.Eye, Eye(viewProj));
    gl.uniform1i(u.Texture, 0);
    gl.uniform1i(u.Look, style.Look);
    gl.uniform2f(u.Viewport, w, h);
    gl.uniform4fv(u.OutlineColor, style.OutlineColor);
    gl.activeTexture(gl.TEXTURE0);
    // joints and weights of a primitive without a skin: no joint moves it
    gl.vertexAttrib4f(3, 0, 0, 0, 0);
    gl.vertexAttrib4f(4, 1, 0, 0, 0);
    this.stateCull = 0; this.stateTexture = undefined; this.stateSkinned = 0;

    // the outline first (back faces pushed out), then opaque, then blended, each in tree order
    for (let pass = style.Outline > 0 ? 0 : 1; pass < 3; pass++) {
      const outlinePass = pass === 0, blendPass = pass === 2;
      gl.uniform1i(u.OutlinePass, outlinePass ? 1 : 0);
      gl.uniform1f(u.Outline, outlinePass ? style.Outline : 0);
      gl.cullFace(outlinePass ? gl.FRONT : gl.BACK);
      if (blendPass) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); }
      for (let o = 0; o < count; o++) this.DrawItem(items[o], outlinePass, blendPass);
    }

    if (target.MsaaFrame) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target.MsaaFrame);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target.Frame);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    }
    this.End(surface);
    return target.Image;
  }

  private DrawItem(item: RenderItem, outlinePass: boolean, blendPass: boolean): void {
    const gl = this.gl, u = this.u;
    const scene = item.Scene, gpu = this.Model(scene), nodes = scene.Nodes;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.Mesh < 0 || node.Mesh >= gpu.Vaos.length || item.Hidden[i]) continue;
      const skinned = node.Skin >= 0 && node.Skin < scene.Skins.length;
      const primitives = scene.Meshes[node.Mesh], vaos = gpu.Vaos[node.Mesh], counts = gpu.Counts[node.Mesh];
      let jointsSet = false;
      for (let k = 0; k < primitives.length; k++) {
        const p = primitives[k];
        const mi = p.Material;
        const material = mi >= 0 && mi < scene.Materials.length ? scene.Materials[mi] : undefined;
        const changed = mi >= 0 ? item.Materials[mi] : undefined;
        if (changed?.Hidden || (material?.Blend ?? false) !== blendPass) continue;
        if (!jointsSet) {
          // a skinned mesh is placed by its joints only (glTF ignores its node's transform); the object's place is in
          // the joints' world matrices
          jointsSet = true;
          if (skinned) {
            const n = scene.JointMatrices(node.Skin, item.Pose, this.joints);
            gl.uniformMatrix4fv(u.Joints, false, this.joints, 0, n * 16);
            gl.uniformMatrix4fv(u.Model, false, this.identity);
          } else gl.uniformMatrix4fv(u.Model, false, item.Pose, i * 16, 16);
        }
        const color = changed?.Color ?? material?.Color ?? [0.8, 0.8, 0.8, 1];
        // an image put on the material from code, else the file's own
        const texture = changed?.Image ? this.ImageTexture(changed.Image)
          : material && material.Texture >= 0 && material.Texture < gpu.Textures.length ? gpu.Textures[material.Texture] : null;
        // GL state set only when it changes: a crowd of one model repeats the same state per object
        const cull = !((material?.DoubleSided ?? false) && !outlinePass);
        if (this.stateCull !== (cull ? 1 : 2)) { if (cull) gl.enable(gl.CULL_FACE); else gl.disable(gl.CULL_FACE); this.stateCull = cull ? 1 : 2; }
        gl.uniform4f(u.Color, color[0], color[1], color[2], color[3]);
        gl.uniform1f(u.Roughness, changed?.Roughness ?? material?.Roughness ?? 1);
        if (this.stateTexture !== texture) { gl.uniform1i(u.Textured, texture ? 1 : 0); gl.bindTexture(gl.TEXTURE_2D, texture); this.stateTexture = texture; }
        const skin = skinned && p.Skinned ? 1 : 2;
        if (this.stateSkinned !== skin) { gl.uniform1i(u.Skinned, skin === 1 ? 1 : 0); this.stateSkinned = skin; }
        gl.bindVertexArray(vaos[k]);
        gl.drawElements(gl.TRIANGLES, counts[k], gl.UNSIGNED_INT, 0);
      }
    }
  }
}
