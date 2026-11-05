<!--
  The backdrop the glass panels float over: deep, dim glows in the brand hues,
  a faint orbit echoing the logo, and fine grain so gradients never band.
  Kept static on purpose — animating behind backdrop-filter is expensive.
-->
<div class="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-base" aria-hidden="true">
  <div class="glows absolute inset-0"></div>

  <svg
    class="absolute top-1/2 left-1/2 h-[140vmax] w-[140vmax] -translate-x-1/2 -translate-y-1/2 opacity-[0.07]"
    viewBox="-500 -500 1000 1000"
  >
    <g transform="rotate(-22)">
      <ellipse rx="460" ry="140" fill="none" stroke="white" stroke-width="0.8" />
      <ellipse rx="330" ry="100" fill="none" stroke="white" stroke-width="0.5" />
    </g>
  </svg>

  <div class="grain absolute inset-0"></div>
  <div class="vignette absolute inset-0"></div>
</div>

<style>
  .glows {
    background:
      radial-gradient(42vmax 34vmax at 8% -4%, oklch(0.5 0.24 calc(var(--accent-h) + 2) / 0.55), transparent 70%),
      radial-gradient(38vmax 30vmax at 96% 104%, oklch(0.42 0.2 calc(var(--accent-h) - 38) / 0.5), transparent 70%),
      radial-gradient(30vmax 22vmax at 62% 38%, oklch(0.36 0.18 calc(var(--accent-h) + 15) / 0.22), transparent 72%),
      radial-gradient(26vmax 20vmax at 20% 90%, oklch(0.32 0.15 calc(var(--accent-h) - 20) / 0.25), transparent 70%);
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
