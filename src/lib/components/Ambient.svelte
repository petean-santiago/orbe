<script lang="ts">
  /**
   * The backdrop the glass panels float over: deep, dim glows in the brand
   * hues, a faint orbit echoing the logo, fine grain so gradients never band,
   * and a soft vignette.
   *
   * It "breathes": each glow drifts and pulses on its own slow cycle and the
   * orbit turns almost imperceptibly.
   *
   * Everything is painted into ONE canvas. As separate full-window CSS layers
   * (four oversized glows, a 140vmax orbit, a blended grain layer) the GPU kept
   * a texture for each — over 600 MB at full screen. One canvas is one texture.
   * The drawing reproduces the CSS it replaced exactly: same gradients, same
   * keyframes and easing, same blend.
   */
  import { onMount } from "svelte";
  import { settings } from "../settings.svelte";

  const moving = $derived(settings.value.ambientMotion);

  let canvas: HTMLCanvasElement;

  // ---- the scene (what the CSS used to say) ----------------------------------

  type Keyframe = { tx: number; ty: number; s: number; o: number };
  interface Glow {
    /** radial-gradient(<rx>vmax <ry>vmax at <px>% <py>%, <colour>, transparent <stop>%) */
    rx: number;
    ry: number;
    px: number;
    py: number;
    l: number;
    c: number;
    dh: number;
    a: number;
    stop: number;
    /** @keyframes drift-*: translate3d(tx%, ty%) scale(s), opacity o; ease-in-out, alternate. */
    duration: number;
    from: Keyframe;
    to: Keyframe;
  }

  const GLOWS: Glow[] = [
    { rx: 42, ry: 34, px: 18, py: 6, l: 0.5, c: 0.24, dh: 2, a: 0.55, stop: 0.7, duration: 26,
      from: { tx: 0, ty: 0, s: 1, o: 1 }, to: { tx: 4, ty: 3, s: 1.08, o: 0.78 } },
    { rx: 38, ry: 30, px: 86, py: 94, l: 0.42, c: 0.2, dh: -38, a: 0.5, stop: 0.7, duration: 32,
      from: { tx: 0, ty: 0, s: 1.04, o: 0.85 }, to: { tx: -5, ty: -3, s: 0.96, o: 1 } },
    { rx: 30, ry: 22, px: 60, py: 40, l: 0.36, c: 0.18, dh: 15, a: 0.22, stop: 0.72, duration: 24,
      from: { tx: -3, ty: 2, s: 0.94, o: 0.7 }, to: { tx: 3, ty: -2, s: 1.1, o: 1 } },
    { rx: 26, ry: 20, px: 26, py: 84, l: 0.32, c: 0.15, dh: -20, a: 0.25, stop: 0.7, duration: 38,
      from: { tx: 0, ty: 0, s: 1, o: 1 }, to: { tx: 3, ty: -4, s: 1, o: 0.7 } },
  ];
  const STILL: Keyframe = { tx: 0, ty: 0, s: 1, o: 1 };
  const ORBIT_PERIOD = 240;
  const GRAIN_SVG =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E";

  /** CSS `ease-in-out`: cubic-bezier(0.42, 0, 0.58, 1), solved for x. */
  function easeInOut(x: number) {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const cx = 3 * 0.42 * t * (1 - t) ** 2 + 3 * 0.58 * t ** 2 * (1 - t) + t ** 3 - x;
      const d = 3 * 0.42 * (1 - t) ** 2 + 6 * (0.58 - 0.42) * t * (1 - t) + 3 * (1 - 0.58) * t ** 2;
      if (Math.abs(cx) < 1e-6 || d === 0) break;
      t -= cx / d;
    }
    return 3 * t ** 2 * (1 - t) + t ** 3;
  }

  /** Where an `alternate` animation is at time `t` (seconds). */
  function frameAt(g: Glow, t: number): Keyframe {
    const cycle = t / g.duration;
    const n = Math.floor(cycle);
    const raw = cycle - n;
    const p = easeInOut(n % 2 ? 1 - raw : raw);
    const mix = (a: number, b: number) => a + (b - a) * p;
    return { tx: mix(g.from.tx, g.to.tx), ty: mix(g.from.ty, g.to.ty), s: mix(g.from.s, g.to.s), o: mix(g.from.o, g.to.o) };
  }

  // ---- painting ---------------------------------------------------------------

  let grain: CanvasPattern | null = null;
  let grainImage: HTMLImageElement | null = null;

  function loadGrain(ctx: CanvasRenderingContext2D, dpr: number) {
    // Rasterise the noise tile at device resolution, exactly as the CSS background did.
    const size = Math.round(160 * dpr);
    const tile = document.createElement("canvas");
    tile.width = tile.height = size;
    tile.getContext("2d")!.drawImage(grainImage!, 0, 0, size, size);
    grain = ctx.createPattern(tile, "repeat");
    grain?.setTransform(new DOMMatrix().scale(1 / dpr));
  }

  function paint(ctx: CanvasRenderingContext2D, w: number, h: number, t: number | null) {
    const root = getComputedStyle(document.documentElement);
    const hue = parseFloat(root.getPropertyValue("--accent-h")) || 330;
    const base = root.getPropertyValue("--color-base").trim() || "oklch(0.085 0.012 320)";
    const vmax = Math.max(w, h);

    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);

    // Glows: each lived in a box inset -12% (so 124% of the window), transformed about its centre.
    const bx = -0.12 * w;
    const by = -0.12 * h;
    const bw = 1.24 * w;
    const bh = 1.24 * h;
    for (const g of GLOWS) {
      const f = t === null ? STILL : frameAt(g, t);
      const colour = `oklch(${g.l} ${g.c} ${hue + g.dh}`;
      ctx.save();
      ctx.globalAlpha = f.o;
      ctx.translate(bx + bw / 2 + (f.tx / 100) * bw, by + bh / 2 + (f.ty / 100) * bh);
      ctx.scale(f.s, f.s);
      ctx.translate(-bw / 2, -bh / 2);
      // Each glow was painted only inside its own box.
      ctx.beginPath();
      ctx.rect(0, 0, bw, bh);
      ctx.clip();
      // An ellipse is a circle squashed vertically.
      const cx = (g.px / 100) * bw;
      const cy = (g.py / 100) * bh;
      const rx = (g.rx / 100) * vmax;
      const ry = (g.ry / 100) * vmax;
      ctx.translate(cx, cy);
      ctx.scale(1, ry / rx);
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      grad.addColorStop(0, `${colour} / ${g.a})`);
      // Fade to the same colour at zero alpha: CSS interpolates premultiplied,
      // so "transparent" never drags the colour toward black.
      grad.addColorStop(g.stop, `${colour} / 0)`);
      ctx.fillStyle = grad;
      // Cover the whole (unsquashed) box.
      ctx.fillRect(-cx - bw, (-cy - bh) * (rx / ry), bw * 3, bh * 3 * (rx / ry));
      ctx.restore();
    }

    // Orbit: two ellipses in a 140vmax square centred on the window, turning slowly.
    const scale = (1.4 * vmax) / 1000;
    const turn = t === null ? 0 : ((t % ORBIT_PERIOD) / ORBIT_PERIOD) * Math.PI * 2;
    ctx.save();
    ctx.globalAlpha = 0.07;
    ctx.strokeStyle = "white";
    ctx.translate(w / 2, h / 2);
    ctx.rotate(turn);
    ctx.scale(scale, scale);
    ctx.rotate((-22 * Math.PI) / 180);
    for (const [rx, ry, lw] of [
      [460, 140, 0.8],
      [330, 100, 0.5],
    ]) {
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.lineWidth = lw;
      ctx.stroke();
    }
    ctx.restore();

    // Grain, overlay-blended at 7%.
    if (grain) {
      ctx.save();
      ctx.globalCompositeOperation = "overlay";
      ctx.globalAlpha = 0.07;
      ctx.fillStyle = grain;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    // Vignette: radial-gradient(120% 90% at 50% 40%, transparent 55%, oklch(0.04 0.01 320 / 0.7)).
    ctx.save();
    ctx.translate(w / 2, h * 0.4);
    ctx.scale(1, (0.9 * h) / (1.2 * w));
    const vr = 1.2 * w;
    const vig = ctx.createRadialGradient(0, 0, 0, 0, 0, vr);
    vig.addColorStop(0.55, "oklch(0.04 0.01 320 / 0)");
    vig.addColorStop(1, "oklch(0.04 0.01 320 / 0.7)");
    ctx.fillStyle = vig;
    const k = (1.2 * w) / (0.9 * h);
    ctx.fillRect(-w, -h * k, w * 2, h * 2 * k);
    ctx.restore();
  }

  onMount(() => {
    const ctx = canvas.getContext("2d", { alpha: false })!;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let frame = 0;
    const started = performance.now();
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");

    const animating = () => moving && !reduced.matches;
    const now = () => (animating() ? (performance.now() - started) / 1000 : null);
    const draw = () => paint(ctx, w, h, now());

    function resize() {
      w = innerWidth;
      h = innerHeight;
      const nextDpr = devicePixelRatio || 1;
      canvas.width = Math.round(w * nextDpr);
      canvas.height = Math.round(h * nextDpr);
      if (nextDpr !== dpr || !grain) {
        dpr = nextDpr;
        if (grainImage?.complete) loadGrain(ctx, dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    }

    // The motion is very slow (a few px per second), so 30 fps is indistinguishable
    // from 60 and halves the work. Wait between frames with a timer so the page
    // isn't woken for frames we'd skip anyway.
    let timer = 0;
    function tick() {
      draw();
      timer = window.setTimeout(() => (frame = requestAnimationFrame(tick)), 1000 / 30 - 4);
    }
    function stop() {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    }
    function sync() {
      stop();
      if (animating()) frame = requestAnimationFrame(tick);
      else draw();
    }

    grainImage = new Image();
    grainImage.onload = () => {
      loadGrain(ctx, dpr);
      draw();
    };
    grainImage.src = GRAIN_SVG;

    resize();
    sync();
    addEventListener("resize", resize);
    reduced.addEventListener("change", sync);
    // Accent or theme changes repaint a still background.
    const observer = new MutationObserver(() => !animating() && draw());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class", "data-glass"] });

    syncMotion = sync;
    return () => {
      stop();
      removeEventListener("resize", resize);
      reduced.removeEventListener("change", sync);
      observer.disconnect();
      syncMotion = null;
    };
  });

  let syncMotion: (() => void) | null = null;
  $effect(() => {
    void moving;
    syncMotion?.();
  });
</script>

<canvas bind:this={canvas} class="pointer-events-none fixed inset-0 -z-10 h-full w-full" aria-hidden="true"></canvas>
