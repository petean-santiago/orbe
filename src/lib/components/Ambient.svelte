<script lang="ts">
  /**
   * The backdrop the glass panels float over: deep, dim glows in the brand
   * hues, a faint orbit echoing the logo, and fine grain so gradients never band.
   *
   * It "breathes": each glow drifts and pulses on its own slow cycle and the
   * orbit turns almost imperceptibly. Only transform and opacity animate (cheap,
   * GPU-composited), and everything stops for reduced motion or when the user
   * turns it off in Settings → Appearance.
   */
  import { settings } from "../settings.svelte";

  const moving = $derived(settings.value.ambientMotion);
</script>

<div class={["pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-base", moving && "moving"]} aria-hidden="true">
  <div class="glow glow-a"></div>
  <div class="glow glow-b"></div>
  <div class="glow glow-c"></div>
  <div class="glow glow-d"></div>

  <div class="orbit absolute top-1/2 left-1/2 h-[140vmax] w-[140vmax]">
    <svg class="h-full w-full opacity-[0.07]" viewBox="-500 -500 1000 1000">
      <g transform="rotate(-22)">
        <ellipse rx="460" ry="140" fill="none" stroke="white" stroke-width="0.8" />
        <ellipse rx="330" ry="100" fill="none" stroke="white" stroke-width="0.5" />
      </g>
    </svg>
  </div>

  <div class="grain absolute inset-0"></div>
  <div class="vignette absolute inset-0"></div>
</div>

<style>
  .glow {
    position: absolute;
    inset: -12%;
    will-change: transform, opacity;
  }
  .glow-a {
    background: radial-gradient(42vmax 34vmax at 18% 6%, oklch(0.5 0.24 calc(var(--accent-h) + 2) / 0.55), transparent 70%);
  }
  .glow-b {
    background: radial-gradient(38vmax 30vmax at 86% 94%, oklch(0.42 0.2 calc(var(--accent-h) - 38) / 0.5), transparent 70%);
  }
  .glow-c {
    background: radial-gradient(30vmax 22vmax at 60% 40%, oklch(0.36 0.18 calc(var(--accent-h) + 15) / 0.22), transparent 72%);
  }
  .glow-d {
    background: radial-gradient(26vmax 20vmax at 26% 84%, oklch(0.32 0.15 calc(var(--accent-h) - 20) / 0.25), transparent 70%);
  }

  .orbit {
    transform: translate(-50%, -50%);
  }

  /* Breathing: long, out-of-sync cycles so the movement never feels like a loop. */
  .moving .glow-a {
    animation: drift-a 26s ease-in-out infinite alternate;
  }
  .moving .glow-b {
    animation: drift-b 32s ease-in-out infinite alternate;
  }
  .moving .glow-c {
    animation: drift-c 24s ease-in-out infinite alternate;
  }
  .moving .glow-d {
    animation: drift-d 38s ease-in-out infinite alternate;
  }
  .moving .orbit {
    animation: orbit-turn 240s linear infinite;
  }

  @keyframes drift-a {
    from {
      transform: translate3d(0, 0, 0) scale(1);
      opacity: 1;
    }
    to {
      transform: translate3d(4%, 3%, 0) scale(1.08);
      opacity: 0.78;
    }
  }
  @keyframes drift-b {
    from {
      transform: translate3d(0, 0, 0) scale(1.04);
      opacity: 0.85;
    }
    to {
      transform: translate3d(-5%, -3%, 0) scale(0.96);
      opacity: 1;
    }
  }
  @keyframes drift-c {
    from {
      transform: translate3d(-3%, 2%, 0) scale(0.94);
      opacity: 0.7;
    }
    to {
      transform: translate3d(3%, -2%, 0) scale(1.1);
      opacity: 1;
    }
  }
  @keyframes drift-d {
    from {
      transform: translate3d(0, 0, 0);
      opacity: 1;
    }
    to {
      transform: translate3d(3%, -4%, 0);
      opacity: 0.7;
    }
  }
  @keyframes orbit-turn {
    to {
      transform: translate(-50%, -50%) rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .moving .glow,
    .moving .orbit {
      animation: none;
    }
  }

  .grain {
    opacity: 0.07;
    mix-blend-mode: overlay;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  }
  .vignette {
    background: radial-gradient(120% 90% at 50% 40%, transparent 55%, oklch(0.04 0.01 320 / 0.7));
  }
</style>
