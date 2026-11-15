// The GL state a 3D pass changes, tracked in JavaScript as the calls are made (CanvasKit's own GL calls and ours go
// through the same WebGL context object), so a pass saves and restores it without asking the GPU process. A WebGL
// getParameter is a synchronous round trip to the GPU process in Chrome: the 30 a pass used to read cost 4-6 ms a
// frame on a desktop and held a Mali phone to every third vsync. Read from the context once, when tracking starts.

const TRACKED_CAPS = [0x0c11, 0x0b90, 0x0be2, 0x0b71, 0x0b44]; // SCISSOR_TEST, STENCIL_TEST, BLEND, DEPTH_TEST, CULL_FACE

/** What the context's state is now, kept up to date by the wrapped setters. */
export class GlState {
  drawFb: WebGLFramebuffer | null = null;
  readFb: WebGLFramebuffer | null = null;
  rb: WebGLRenderbuffer | null = null;
  viewport: [number, number, number, number] = [0, 0, 0, 0];
  readonly caps = new Map<number, boolean>();
  blend: [number, number, number, number] = [1, 0, 1, 0];
  equation: [number, number] = [0x8006, 0x8006];
  colorMask: [boolean, boolean, boolean, boolean] = [true, true, true, true];
  depthMask = true;
  clearColor: [number, number, number, number] = [0, 0, 0, 0];
  clearDepth = 1;
  depthFunc = 0x0201;
  frontFace = 0x0901;
  cullFace = 0x0405;
  program: WebGLProgram | null = null;
  vao: WebGLVertexArrayObject | null = null;
  arrayBuffer: WebGLBuffer | null = null;
  activeTexture = 0x84c0;
  /** The 2D texture bound to unit 0 (the only unit a 3D pass uses). */
  texture0: WebGLTexture | null = null;
  unpackAlignment = 4;
  unpackFlipY = false;
  unpackPremultiply = false;

  private static readonly states = new WeakMap<WebGL2RenderingContext, GlState>();

  /**
   * The tracked state of a context: reads it once and wraps its setters the first time; on a context restored after a
   * loss (GL state back to its defaults) only the values are read again.
   */
  static Of(gl: WebGL2RenderingContext, reread = false): GlState {
    let state = GlState.states.get(gl);
    if (!state) {
      state = new GlState();
      GlState.states.set(gl, state);
      state.Read(gl);
      state.Wrap(gl);
    } else if (reread) state.Read(gl);
    return state;
  }

  /** The values as the context has them now (getParameter: once, not per pass). */
  private Read(gl: WebGL2RenderingContext): void {
    this.drawFb = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
    this.readFb = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
    this.rb = gl.getParameter(gl.RENDERBUFFER_BINDING);
    const v = gl.getParameter(gl.VIEWPORT) as Int32Array;
    this.viewport = [v[0], v[1], v[2], v[3]];
    for (const cap of TRACKED_CAPS) this.caps.set(cap, gl.isEnabled(cap));
    this.blend = [gl.getParameter(gl.BLEND_SRC_RGB), gl.getParameter(gl.BLEND_DST_RGB), gl.getParameter(gl.BLEND_SRC_ALPHA), gl.getParameter(gl.BLEND_DST_ALPHA)];
    this.equation = [gl.getParameter(gl.BLEND_EQUATION_RGB), gl.getParameter(gl.BLEND_EQUATION_ALPHA)];
    const m = gl.getParameter(gl.COLOR_WRITEMASK) as boolean[];
    this.colorMask = [m[0], m[1], m[2], m[3]];
    this.depthMask = gl.getParameter(gl.DEPTH_WRITEMASK);
    const c = gl.getParameter(gl.COLOR_CLEAR_VALUE) as Float32Array;
    this.clearColor = [c[0], c[1], c[2], c[3]];
    this.clearDepth = gl.getParameter(gl.DEPTH_CLEAR_VALUE);
    this.depthFunc = gl.getParameter(gl.DEPTH_FUNC);
    this.frontFace = gl.getParameter(gl.FRONT_FACE);
    this.cullFace = gl.getParameter(gl.CULL_FACE_MODE);
    this.program = gl.getParameter(gl.CURRENT_PROGRAM);
    this.vao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
    this.arrayBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
    this.activeTexture = gl.getParameter(gl.ACTIVE_TEXTURE);
    if (this.activeTexture === gl.TEXTURE0) this.texture0 = gl.getParameter(gl.TEXTURE_BINDING_2D);
    else {
      gl.activeTexture(gl.TEXTURE0);
      this.texture0 = gl.getParameter(gl.TEXTURE_BINDING_2D);
      gl.activeTexture(this.activeTexture);
    }
    this.unpackAlignment = gl.getParameter(gl.UNPACK_ALIGNMENT);
    this.unpackFlipY = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
    this.unpackPremultiply = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
  }

  /** Every setter of the tracked state records what it sets (own properties of this context object, the original runs). */
  private Wrap(gl: WebGL2RenderingContext): void {
    const s = this;
    const g = gl as unknown as Record<string, (...a: any[]) => any>;
    const wrap = (name: string, after: (...a: any[]) => void) => {
      const original = g[name].bind(gl);
      g[name] = (...a: any[]) => { const r = original(...a); after(...a); return r; };
    };
    wrap("bindFramebuffer", (target: number, fb: WebGLFramebuffer | null) => {
      if (target === gl.FRAMEBUFFER) s.drawFb = s.readFb = fb;
      else if (target === gl.DRAW_FRAMEBUFFER) s.drawFb = fb;
      else if (target === gl.READ_FRAMEBUFFER) s.readFb = fb;
    });
    wrap("bindRenderbuffer", (_t: number, rb: WebGLRenderbuffer | null) => { s.rb = rb; });
    wrap("viewport", (x: number, y: number, w: number, h: number) => { s.viewport = [x, y, w, h]; });
    wrap("enable", (cap: number) => { if (s.caps.has(cap)) s.caps.set(cap, true); });
    wrap("disable", (cap: number) => { if (s.caps.has(cap)) s.caps.set(cap, false); });
    wrap("blendFunc", (src: number, dst: number) => { s.blend = [src, dst, src, dst]; });
    wrap("blendFuncSeparate", (a: number, b: number, c: number, d: number) => { s.blend = [a, b, c, d]; });
    wrap("blendEquation", (m: number) => { s.equation = [m, m]; });
    wrap("blendEquationSeparate", (a: number, b: number) => { s.equation = [a, b]; });
    wrap("colorMask", (r: boolean, g2: boolean, b: boolean, a: boolean) => { s.colorMask = [!!r, !!g2, !!b, !!a]; });
    wrap("depthMask", (f: boolean) => { s.depthMask = !!f; });
    wrap("clearColor", (r: number, g2: number, b: number, a: number) => { s.clearColor = [r, g2, b, a]; });
    wrap("clearDepth", (d: number) => { s.clearDepth = d; });
    wrap("depthFunc", (f: number) => { s.depthFunc = f; });
    wrap("frontFace", (m: number) => { s.frontFace = m; });
    wrap("cullFace", (m: number) => { s.cullFace = m; });
    wrap("useProgram", (p: WebGLProgram | null) => { s.program = p; });
    wrap("bindVertexArray", (v: WebGLVertexArrayObject | null) => { s.vao = v; });
    wrap("bindBuffer", (target: number, b: WebGLBuffer | null) => { if (target === gl.ARRAY_BUFFER) s.arrayBuffer = b; });
    wrap("activeTexture", (unit: number) => { s.activeTexture = unit; });
    wrap("bindTexture", (target: number, t: WebGLTexture | null) => { if (target === gl.TEXTURE_2D && s.activeTexture === gl.TEXTURE0) s.texture0 = t; });
    wrap("pixelStorei", (name: number, value: number | boolean) => {
      if (name === gl.UNPACK_ALIGNMENT) s.unpackAlignment = value as number;
      else if (name === gl.UNPACK_FLIP_Y_WEBGL) s.unpackFlipY = !!value;
      else if (name === gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL) s.unpackPremultiply = !!value;
    });
    // deleting a bound object unbinds it (the WebGL rules); a program in use stays current until replaced
    wrap("deleteFramebuffer", (fb: WebGLFramebuffer | null) => { if (fb && s.drawFb === fb) s.drawFb = null; if (fb && s.readFb === fb) s.readFb = null; });
    wrap("deleteRenderbuffer", (rb: WebGLRenderbuffer | null) => { if (rb && s.rb === rb) s.rb = null; });
    wrap("deleteVertexArray", (v: WebGLVertexArrayObject | null) => { if (v && s.vao === v) s.vao = null; });
    wrap("deleteBuffer", (b: WebGLBuffer | null) => { if (b && s.arrayBuffer === b) s.arrayBuffer = null; });
    wrap("deleteTexture", (t: WebGLTexture | null) => { if (t && s.texture0 === t) s.texture0 = null; });
  }
}
