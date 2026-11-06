<script lang="ts">
  /**
   * The Orbe mark: an orb with a tilted orbit carrying three commit nodes.
   *
   * With `animated`, the nodes travel along the orbit like real satellites:
   * they pass behind the orb (dimmer, smaller) and come round in front, while
   * the orbit itself slowly wobbles. Motion stops if the OS asks to reduce it.
   */
  let { size = 28, glow = false, animated = false }: { size?: number; glow?: boolean; animated?: boolean } = $props();

  const uid = $props.id();

  // Orbit geometry, in the mark's own coordinates (centre 512,512).
  const RX = 392;
  const RY = 120;
  const TILT = -22;
  /** Node starting angles (degrees); 90° is the front-most point. */
  const NODES = [
    { at: 35, r: 40, head: false },
    { at: 90, r: 46, head: true },
    { at: 145, r: 40, head: false },
  ];
  const PERIOD = 22; // seconds per orbit
  const WOBBLE = 3; // degrees of tilt swing
  const WOBBLE_PERIOD = 14;

  let t = $state(0);

  $effect(() => {
    if (!animated || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const start = performance.now() - t * 1000;
    const tick = (now: number) => {
      t = (now - start) / 1000;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  });

  const tilt = $derived(TILT + (animated ? WOBBLE * Math.sin((t / WOBBLE_PERIOD) * Math.PI * 2) : 0));

  const nodes = $derived(
    NODES.map((n) => {
      const a = ((n.at + (animated ? (t / PERIOD) * 360 : 0)) * Math.PI) / 180;
      const depth = Math.sin(a); // 1 = closest to the viewer, -1 = behind the orb
      return {
        ...n,
        x: RX * Math.cos(a),
        y: RY * depth,
        front: depth >= 0,
        scale: 0.8 + 0.2 * (depth + 1) / 2,
        opacity: depth >= 0 ? 1 : 0.45 + 0.35 * (depth + 1),
      };
    }),
  );
</script>

{#snippet node(n: (typeof nodes)[number])}
  <circle
    cx={n.x}
    cy={n.y}
    r={n.r * n.scale}
    fill={n.head ? "#f0abfc" : "#1c0a22"}
    stroke="#ffffff"
    stroke-width={18 * n.scale}
    opacity={n.opacity}
  />
{/snippet}

<span class="relative inline-flex shrink-0" style:width="{size}px" style:height="{size * 0.66}px">
  {#if glow}
    <!-- A round, soft halo that never gets clipped by the mark's box -->
    <span
      class="logo-glow pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
      style:width="{size * 1.5}px"
      style:height="{size * 1.5}px"
    ></span>
  {/if}
  <svg viewBox="96 236 832 552" width={size} height={size * 0.66} class="relative overflow-visible" aria-label="Orbe" role="img">
    <defs>
      <radialGradient id="{uid}-orb" cx="0.36" cy="0.3" r="0.78">
        <stop offset="0" stop-color="#fdf0ff" />
        <stop offset="0.2" stop-color="#f0abfc" />
        <stop offset="0.52" stop-color="#d946ef" />
        <stop offset="0.82" stop-color="#86198f" />
        <stop offset="1" stop-color="#3b0640" />
      </radialGradient>
      <linearGradient id="{uid}-ring" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#f5d0fe" />
        <stop offset="0.5" stop-color="#ffffff" />
        <stop offset="1" stop-color="#f0abfc" />
      </linearGradient>
      <clipPath id="{uid}-back"><rect x="-520" y="-320" width="1040" height="320" /></clipPath>
      <clipPath id="{uid}-front"><rect x="-520" y="0" width="1040" height="320" /></clipPath>
    </defs>

    <!-- Back half of the orbit and the nodes travelling behind the orb -->
    <g transform="translate(512 512) rotate({tilt})">
      <ellipse rx={RX} ry={RY} fill="none" stroke="url(#{uid}-ring)" stroke-width="24" opacity="0.4" clip-path="url(#{uid}-back)" />
      {#each nodes.filter((n) => !n.front) as n (n.at)}{@render node(n)}{/each}
    </g>

    <!-- The orb -->
    <circle cx="512" cy="512" r="232" fill="url(#{uid}-orb)" />
    <ellipse cx="452" cy="418" rx="86" ry="52" fill="#ffffff" opacity="0.22" transform="rotate(-30 452 418)" />

    <!-- Front half of the orbit and the nodes in front -->
    <g transform="translate(512 512) rotate({tilt})">
      <ellipse rx={RX} ry={RY} fill="none" stroke="url(#{uid}-ring)" stroke-width="24" clip-path="url(#{uid}-front)" />
      {#each nodes.filter((n) => n.front) as n (n.at)}{@render node(n)}{/each}
    </g>
  </svg>
</span>

<style>
  .logo-glow {
    background: radial-gradient(
      circle,
      oklch(0.68 0.25 var(--accent-h) / 0.42) 0%,
      oklch(0.6 0.24 var(--accent-h) / 0.16) 38%,
      transparent 68%
    );
    animation: glow-breathe 7s ease-in-out infinite;
  }
  @keyframes glow-breathe {
    50% {
      opacity: 0.7;
      transform: translate(-50%, -50%) scale(0.94);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .logo-glow {
      animation: none;
    }
  }
</style>
