"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { BrainGraph, GraphNode } from "@/lib/brain/graph";

/**
 * A force-directed view of the Brain.
 *
 * The simulation is hand-rolled rather than pulled from d3-force: it is about
 * forty lines, it avoids a dependency for one screen, and it lets the cooling
 * schedule stop cleanly so an idle graph costs nothing.
 */

type Vec = { x: number; y: number; vx: number; vy: number };

const WIDTH = 900;
const HEIGHT = 620;

/** Nodes grow with how connected they are, so hubs read as hubs. */
const radiusOf = (node: GraphNode) => 5 + Math.sqrt(node.degree) * 2.6;

function scopeColor(scope: string): string {
  if (scope === "company") return "#7c5cf0";
  if (scope === "team") return "#3b82f6";
  return "#10b981";
}

/**
 * Phyllotaxis seeding. A deterministic, evenly-spread starting layout means the
 * graph settles into the same shape every time you open it, instead of
 * rearranging itself on each visit.
 */
function seedPositions(count: number): Vec[] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: count }, (_, i) => {
    const radius = 18 * Math.sqrt(i + 0.5);
    const angle = i * golden;
    return {
      x: WIDTH / 2 + radius * Math.cos(angle),
      y: HEIGHT / 2 + radius * Math.sin(angle),
      vx: 0,
      vy: 0,
    };
  });
}

export function BrainGraph({ graph }: { graph: BrainGraph }) {
  const router = useRouter();
  const svgRef = useRef<SVGSVGElement>(null);

  const nodes = graph.nodes;
  // The simulation mutates `sim` in place — cheap, and no allocation per force
  // calculation. Rendering reads `frozen`, a snapshot published once per frame,
  // so a render never depends on a value that a ref mutated underneath it.
  const sim = useRef<Vec[]>([]);
  const [frozen, setFrozen] = useState<Vec[]>([]);
  const alpha = useRef(1);
  const frame = useRef<number | null>(null);
  const dragging = useRef<number | null>(null);

  const publish = useCallback(() => {
    setFrozen(sim.current.map((p) => ({ ...p })));
  }, []);

  const [hovered, setHovered] = useState<string | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const panning = useRef<{ x: number; y: number } | null>(null);

  const indexById = useMemo(
    () => new Map(nodes.map((node, i) => [node.id, i])),
    [nodes]
  );

  /** Adjacency, used to dim everything outside the hovered neighbourhood. */
  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const node of nodes) map.set(node.id, new Set([node.id]));
    for (const link of graph.links) {
      map.get(link.source)?.add(link.target);
      map.get(link.target)?.add(link.source);
    }
    return map;
  }, [nodes, graph.links]);

  const step = useCallback(() => {
    const pos = sim.current;
    const n = pos.length;
    if (n === 0) return;

    // Repulsion — every pair pushes apart, keeping labels from stacking.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = pos[j].x - pos[i].x;
        let dy = pos[j].y - pos[i].y;
        let distSq = dx * dx + dy * dy;
        if (distSq < 1) {
          // Coincident nodes have no direction to separate along; nudge them.
          dx = (i % 2 === 0 ? 1 : -1) * 0.5;
          dy = (j % 2 === 0 ? 1 : -1) * 0.5;
          distSq = dx * dx + dy * dy;
        }
        const dist = Math.sqrt(distSq);
        const force = 9000 / distSq;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        pos[i].vx -= fx;
        pos[i].vy -= fy;
        pos[j].vx += fx;
        pos[j].vy += fy;
      }
    }

    // Springs — linked docs pull together, explicit links harder than related
    // ones, so authored structure dominates the inferred kind.
    for (const link of graph.links) {
      const a = indexById.get(link.source);
      const b = indexById.get(link.target);
      if (a === undefined || b === undefined) continue;
      const dx = pos[b].x - pos[a].x;
      const dy = pos[b].y - pos[a].y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const rest = link.kind === "explicit" ? 90 : 150;
      const stiffness = link.kind === "explicit" ? 0.02 : 0.008 * link.weight;
      const force = (dist - rest) * stiffness;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      pos[a].vx += fx;
      pos[a].vy += fy;
      pos[b].vx -= fx;
      pos[b].vy -= fy;
    }

    // Gravity toward the centre keeps disconnected docs from drifting off.
    for (let i = 0; i < n; i++) {
      pos[i].vx += (WIDTH / 2 - pos[i].x) * 0.004;
      pos[i].vy += (HEIGHT / 2 - pos[i].y) * 0.004;
    }

    for (let i = 0; i < n; i++) {
      if (dragging.current === i) {
        pos[i].vx = 0;
        pos[i].vy = 0;
        continue;
      }
      pos[i].vx *= 0.82;
      pos[i].vy *= 0.82;
      pos[i].x += pos[i].vx * alpha.current;
      pos[i].y += pos[i].vy * alpha.current;
    }
  }, [graph.links, indexById]);

  // Reseed whenever the document set changes, not on every render.
  useEffect(() => {
    sim.current = seedPositions(nodes.length);
    alpha.current = 1;
    publish();
  }, [nodes, publish]);

  useEffect(() => {
    let stopped = false;

    const run = () => {
      if (stopped) return;
      // Cool down and stop: a settled graph should not burn a frame budget
      // forever just to sit still.
      if (alpha.current > 0.02) {
        step();
        alpha.current *= 0.985;
        publish();
        frame.current = requestAnimationFrame(run);
      } else if (dragging.current !== null) {
        step();
        publish();
        frame.current = requestAnimationFrame(run);
      } else {
        frame.current = null;
      }
    };

    frame.current = requestAnimationFrame(run);
    return () => {
      stopped = true;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [step, publish]);

  // Restarting the cooling schedule is enough to wake the loop, because the
  // effect re-runs whenever a new frame is requested from a settled state.
  const reheat = useCallback(() => {
    if (alpha.current < 0.35) alpha.current = 0.35;
    if (frame.current === null) {
      frame.current = requestAnimationFrame(function resume() {
        step();
        alpha.current *= 0.985;
        publish();
        frame.current =
          alpha.current > 0.02 || dragging.current !== null
            ? requestAnimationFrame(resume)
            : null;
      });
    }
  }, [step, publish]);

  /** Screen pixels → graph coordinates, accounting for pan and zoom. */
  const toGraph = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      const sx = ((clientX - rect.left) / rect.width) * WIDTH;
      const sy = ((clientY - rect.top) / rect.height) * HEIGHT;
      return { x: (sx - view.x) / view.scale, y: (sy - view.y) / view.scale };
    },
    [view]
  );

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    // Registered natively rather than via onWheel: React's wheel listener is
    // passive, so preventDefault there would be ignored and the page would
    // scroll instead of the graph zooming.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      const px = ((event.clientX - rect.left) / rect.width) * WIDTH;
      const py = ((event.clientY - rect.top) / rect.height) * HEIGHT;
      setView((prev) => {
        const next = Math.min(4, Math.max(0.35, prev.scale * (event.deltaY < 0 ? 1.12 : 1 / 1.12)));
        // Keep the point under the cursor fixed while scaling.
        return {
          scale: next,
          x: px - ((px - prev.x) / prev.scale) * next,
          y: py - ((py - prev.y) / prev.scale) * next,
        };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
    // Depends on the snapshot length because the <svg> is not mounted on the
    // first render — the component returns an empty frame until positions
    // exist, so an effect that ran only once would find a null ref and never
    // attach the listener.
  }, [frozen.length]);

  function handlePointerMove(event: React.PointerEvent) {
    if (dragging.current !== null) {
      const point = toGraph(event.clientX, event.clientY);
      const node = sim.current[dragging.current];
      if (node) {
        node.x = point.x;
        node.y = point.y;
      }
      reheat();
      return;
    }
    if (panning.current) {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const sx = ((event.clientX - rect.left) / rect.width) * WIDTH;
      const sy = ((event.clientY - rect.top) / rect.height) * HEIGHT;
      setView((prev) => ({ ...prev, x: sx - panning.current!.x, y: sy - panning.current!.y }));
    }
  }

  function endInteraction(event: React.PointerEvent) {
    if (dragging.current !== null) {
      dragging.current = null;
      reheat();
    }
    panning.current = null;
    (event.target as Element).releasePointerCapture?.(event.pointerId);
  }

  const pos = frozen;
  if (pos.length !== nodes.length) return <GraphFrame />;

  const dimmed = (id: string) => hovered !== null && !neighbours.get(hovered)?.has(id);

  return (
    <div className="relative">
      <GraphFrame>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-[620px] w-full touch-none select-none"
          onPointerMove={handlePointerMove}
          onPointerUp={endInteraction}
          onPointerLeave={endInteraction}
          onPointerDown={(event) => {
            if (event.target === svgRef.current) {
              const rect = svgRef.current.getBoundingClientRect();
              const sx = ((event.clientX - rect.left) / rect.width) * WIDTH;
              const sy = ((event.clientY - rect.top) / rect.height) * HEIGHT;
              panning.current = { x: sx - view.x, y: sy - view.y };
            }
          }}
        >
          <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
            {graph.links.map((link) => {
              const a = indexById.get(link.source);
              const b = indexById.get(link.target);
              if (a === undefined || b === undefined) return null;
              const faded = dimmed(link.source) || dimmed(link.target);
              const lit =
                hovered !== null && (link.source === hovered || link.target === hovered);
              return (
                <line
                  key={`${link.source}-${link.target}-${link.kind}`}
                  x1={pos[a].x}
                  y1={pos[a].y}
                  x2={pos[b].x}
                  y2={pos[b].y}
                  stroke={lit ? "#7c5cf0" : "currentColor"}
                  strokeWidth={lit ? 1.5 : link.kind === "explicit" ? 1 : 0.7}
                  strokeDasharray={link.kind === "related" ? "3 3" : undefined}
                  className="text-muted-foreground"
                  opacity={faded ? 0.04 : lit ? 0.9 : link.kind === "explicit" ? 0.4 : 0.18}
                />
              );
            })}

            {nodes.map((node, i) => {
              const radius = radiusOf(node);
              const color = scopeColor(node.scope);
              const awaiting = node.reviewState !== "approved";
              const faded = dimmed(node.id);

              return (
                <g
                  key={node.id}
                  transform={`translate(${pos[i].x} ${pos[i].y})`}
                  opacity={faded ? 0.18 : 1}
                  className="cursor-pointer"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    dragging.current = i;
                    (event.target as Element).setPointerCapture?.(event.pointerId);
                    reheat();
                  }}
                  onPointerEnter={() => setHovered(node.id)}
                  onPointerLeave={() => setHovered(null)}
                  onClick={() => router.push(`/brain/${node.slug}`)}
                >
                  {/* Knowledge docs get an outer ring; context docs stay plain. */}
                  {node.kind === "knowledge" && (
                    <circle
                      r={radius + 3.5}
                      fill="none"
                      stroke={color}
                      strokeWidth={1}
                      opacity={0.45}
                    />
                  )}
                  <circle
                    r={radius}
                    // Awaiting review reads as an outline: present in the graph,
                    // but visibly not yet serving agents.
                    fill={awaiting ? "var(--background)" : color}
                    stroke={color}
                    strokeWidth={awaiting ? 1.8 : 0}
                  />
                  <text
                    y={radius + 13}
                    textAnchor="middle"
                    className="pointer-events-none fill-foreground text-[10px]"
                    opacity={hovered === node.id ? 1 : 0.62}
                  >
                    {node.title.length > 42 ? `${node.title.slice(0, 40)}…` : node.title}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </GraphFrame>

      <Legend scopes={new Set(nodes.map((node) => node.scope))} />

      <button
        type="button"
        onClick={() => {
          setView({ x: 0, y: 0, scale: 1 });
          sim.current = seedPositions(nodes.length);
          alpha.current = 1;
          publish();
          reheat();
        }}
        className="absolute right-3 top-3 rounded-md border bg-background px-2.5 py-1 text-xs text-muted-foreground shadow-xs hover:text-foreground"
      >
        Reset layout
      </button>
    </div>
  );
}

function GraphFrame({ children }: { children?: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      {children ?? <div className="h-[620px]" />}
    </div>
  );
}

function Legend({ scopes }: { scopes: Set<string> }) {
  const items = [
    { label: "Company", color: "#7c5cf0", filled: true, ring: false, when: "company" },
    { label: "Team", color: "#3b82f6", filled: true, ring: false, when: "team" },
    { label: "Personal", color: "#10b981", filled: true, ring: false, when: "user" },
    { label: "Awaiting review", color: "#7c5cf0", filled: false, ring: false, when: null },
    { label: "Knowledge (ringed)", color: "#7c5cf0", filled: true, ring: true, when: null },
  ].filter((item) => item.when === null || scopes.has(item.when));
  return (
    <div className="absolute left-3 top-3 rounded-md border bg-background/95 p-3 shadow-xs">
      <ul className="flex flex-col gap-1.5">
        {items.map((item) => (
          <li key={item.label} className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <svg width="16" height="16" viewBox="0 0 16 16" className="shrink-0">
              {item.ring && (
                <circle cx="8" cy="8" r="6.5" fill="none" stroke={item.color} strokeWidth="1" opacity="0.45" />
              )}
              <circle
                cx="8"
                cy="8"
                r="4"
                fill={item.filled ? item.color : "var(--background)"}
                stroke={item.color}
                strokeWidth={item.filled ? 0 : 1.6}
              />
            </svg>
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
