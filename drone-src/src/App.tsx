import { useEffect, useMemo, useState } from "react";
import DroneBadge from "./components/DroneBadge";
import DroneScene from "./components/DroneScene";
import InteriorShotLayer from "./components/InteriorShotLayer";
import RouteTimeline from "./components/RouteTimeline";
import ShotManager from "./components/ShotManager";
import { PROPERTY, WAYPOINTS } from "./data/house";
import { listShots } from "./lib/shotStore";
import type { InteriorDisplayMode, InteriorShotView, Waypoint } from "./types";

const REVEAL_THRESHOLD = 0.012;

interface ApiPropertyScene {
  id: string;
  label: string;
  title: string;
  copy?: string;
  poster?: string;
}

interface ApiProperty {
  id: string;
  brand?: string;
  address?: string;
  city?: string;
  price?: string;
  headline?: string;
  specs?: Array<{ k: string; v: string }>;
  scenes?: ApiPropertyScene[];
}

const SCENE_TO_WAYPOINT: Record<string, string> = {
  orbit: "roof",
  fpv: "main-entry",
  living: "living",
  kitchen: "kitchen",
  bedroom: "primary",
  lower: "basement-rec",
  backyard: "rear-door",
  dusk: "main-entry",
};

export default function App() {
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [progress, setProgress] = useState(0);
  const [routeIndex, setRouteIndex] = useState(0);
  const [shots, setShots] = useState<InteriorShotView[]>([]);
  const [selectedShot, setSelectedShot] = useState<InteriorShotView | null>(null);
  const [displayMode, setDisplayMode] = useState<InteriorDisplayMode>("inset");
  const [autoInteriorShots, setAutoInteriorShots] = useState(true);
  const [propertyId, setPropertyId] = useState<string>("fox-plains");
  const [propertyMeta, setPropertyMeta] = useState({
    name: PROPERTY.name,
    city: PROPERTY.city,
    price: "$254,000",
    beds: String(PROPERTY.beds),
    baths: String(PROPERTY.baths),
    livingAreaSqFt: `${PROPERTY.livingAreaSqFt.toLocaleString()} SQ FT`,
    note: PROPERTY.note,
  });
  const [waypoints, setWaypoints] = useState<Waypoint[]>(WAYPOINTS);

  function nearestWaypointIndex(prog: number): number {
    return Math.round(prog * (waypoints.length - 1));
  }

  const currentIndex = nearestWaypointIndex(progress);
  const currentWaypoint = waypoints[currentIndex] || waypoints[0];

  const waypointForSelectedShot = useMemo(
    () => waypoints.find((wp) => wp.id === selectedShot?.waypointId),
    [selectedShot, waypoints],
  );

  // Option B: Dynamic Property & Scene Photo Synchronization from /api/properties/:id
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const idParam = params.get("id") || "fox-plains";
    setPropertyId(idParam);

    async function hydratePropertyAndShots() {
      const baseShots = await listShots();
      try {
        const res = await fetch(`/api/properties/${encodeURIComponent(idParam)}`);
        if (res.ok) {
          const data = (await res.json()) as { success?: boolean; property?: ApiProperty };
          if (data.success && data.property) {
            const p = data.property;
            const specs = p.specs || [];
            const findSpec = (match: string, fallback: string) =>
              specs.find((s) => s.k.toLowerCase().includes(match))?.v || fallback;

            setPropertyMeta({
              name: p.address || p.brand || PROPERTY.name,
              city: p.city || PROPERTY.city,
              price: p.price || "$254,000",
              beds: findSpec("bed", String(PROPERTY.beds)),
              baths: findSpec("bath", String(PROPERTY.baths)),
              livingAreaSqFt: findSpec("interior", `${PROPERTY.livingAreaSqFt.toLocaleString()} sq ft`).toUpperCase(),
              note: p.headline || PROPERTY.note,
            });

            document.title = `${p.address || p.brand} — 3D FPV Drone Twin`;

            if (p.scenes && p.scenes.length > 0) {
              // Map dynamic property scene posters onto 3D flight waypoints
              const wpPhotoOverrides: Record<string, { poster: string; title: string }> = {};
              p.scenes.forEach((sc) => {
                const wpId = SCENE_TO_WAYPOINT[sc.id];
                if (wpId && sc.poster) {
                  wpPhotoOverrides[wpId] = { poster: sc.poster, title: sc.title || sc.label };
                }
              });

              const updatedWaypoints = WAYPOINTS.map((wp) => {
                const ov = wpPhotoOverrides[wp.id];
                return ov ? { ...wp, photoUrl: ov.poster, label: ov.title || wp.label } : wp;
              });
              setWaypoints(updatedWaypoints);

              // Synchronize shot cards with property's custom scene images
              const syncedShots = baseShots.map((shot) => {
                const ov = wpPhotoOverrides[shot.waypointId];
                return ov
                  ? { ...shot, name: ov.title || shot.name, objectUrl: ov.poster }
                  : shot;
              });
              setShots(syncedShots);
              const firstShot = syncedShots.find((s) => s.waypointId === updatedWaypoints[0].id);
              if (firstShot) setSelectedShot(firstShot);
              return;
            }
          }
        }
      } catch (_) {
        // Fallback to embedded Fox Plains estate dataset
      }

      setShots(baseShots);
      const initialWp = WAYPOINTS[0];
      const initialShot = baseShots.find((s) => s.waypointId === initialWp.id);
      if (initialShot) setSelectedShot(initialShot);
    }

    void hydratePropertyAndShots();
  }, []);

  // Listen for query params e.g. ?room=kitchen or ?wp=living
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const targetRoom = params.get("room") || params.get("wp") || params.get("waypoint");
    if (targetRoom) {
      const idx = waypoints.findIndex(
        (wp) => wp.id === targetRoom || wp.roomKey === targetRoom,
      );
      if (idx >= 0) {
        jumpTo(idx);
      }
    }
  }, [waypoints]);

  // Auto-synchronize the high-res estate photograph as the drone flies through each room
  useEffect(() => {
    if (!autoInteriorShots || shots.length === 0) return;
    const currentWp = waypoints[currentIndex];
    if (!currentWp) return;

    const matchingShot = shots.find((s) => s.waypointId === currentWp.id);
    if (matchingShot) {
      setSelectedShot(matchingShot);
    }
  }, [autoInteriorShots, currentIndex, shots, waypoints]);

  function handleProgress(value: number) {
    setProgress(value);

    const idx = nearestWaypointIndex(value);

    if (Math.abs(value - idx / Math.max(1, waypoints.length - 1)) < REVEAL_THRESHOLD) {
      setRouteIndex(idx);
    }
  }

  function jumpTo(index: number) {
    setRouteIndex(index);
    setProgress(index / Math.max(1, waypoints.length - 1));

    if (shots.length > 0) {
      const targetWp = waypoints[index];
      const matchingShot = shots.find((s) => s.waypointId === targetWp?.id);
      if (matchingShot) {
        setSelectedShot(matchingShot);
      }
    }
  }

  return (
    <div className="app-shell">
      <DroneScene
        waypoints={waypoints}
        routeIndex={routeIndex}
        playing={playing}
        speed={speed}
        onRouteProgress={handleProgress}
      />

      <div className="hud">
        <DroneBadge
          roomLabel={currentWaypoint.label}
          progress={progress}
          interiorActive={Boolean(selectedShot)}
        />

        <div className="property-card glass">
          <div className="eyebrow">ESTATE DRONE TWIN · {propertyMeta.price}</div>
          <h1>{propertyMeta.name}</h1>
          <p>{propertyMeta.city}</p>
          <div className="property-card__facts">
            <span>{propertyMeta.beds} BD</span>
            <span>{propertyMeta.baths} BA</span>
            <span>{propertyMeta.livingAreaSqFt}</span>
            <span style={{ color: "#8cf5b7" }}>LIVE TWIN</span>
          </div>
          <small>{propertyMeta.note}</small>
        </div>

        <div className="top-actions">
          <a
            href={`/?id=${encodeURIComponent(propertyId)}`}
            className="button button--dark"
            style={{ textDecoration: "none" }}
            title="Return to Property Main Presentation"
          >
            ← Main Presentation
          </a>
          <button
            className={`button ${autoInteriorShots ? "button--accent" : "button--dark"}`}
            onClick={() => setAutoInteriorShots((value) => !value)}
            title="Toggle automated photo reveals as drone reaches each room"
          >
            Photo Synced {autoInteriorShots ? "ON" : "OFF"}
          </button>
          <button
            className="button button--dark"
            onClick={() => setPlaying((value) => !value)}
          >
            {playing ? "Pause Flight" : "Resume Flight"}
          </button>
        </div>

        {/* Room Photo Quick-Selector Strip */}
        <div className="room-strip glass">
          {waypoints.filter((wp) => Boolean(wp.photoUrl)).map((wp) => {
            const wpIndex = waypoints.findIndex((w) => w.id === wp.id);
            const isActive = currentIndex === wpIndex;
            return (
              <button
                key={wp.id}
                className={`room-chip ${isActive ? "room-chip--active" : ""}`}
                onClick={() => jumpTo(wpIndex)}
                title={`Fly directly to ${wp.label}`}
              >
                <img src={wp.photoUrl} alt={wp.shortLabel} className="room-chip__thumb" />
                <span>{wp.shortLabel}</span>
              </button>
            );
          })}
        </div>

        <ShotManager
          waypoints={waypoints}
          onShotSelect={(shot) => {
            setSelectedShot(shot);
            setDisplayMode("inset");

            const wpIndex = waypoints.findIndex(
              (wp) => wp.id === shot?.waypointId,
            );

            if (wpIndex >= 0) jumpTo(wpIndex);
          }}
        />

        <InteriorShotLayer
          shot={selectedShot}
          displayMode={displayMode}
          onClose={() => setSelectedShot(null)}
        />

        {selectedShot && (
          <div className="shot-controls glass">
            <div>
              <strong style={{ color: "#8cf5b7" }}>★ {selectedShot.name}</strong>
              <span>{waypointForSelectedShot?.label ?? "Estate Room Shot"}</span>
            </div>

            <div className="shot-controls__buttons">
              <button
                className={`button ${displayMode === "inset" ? "button--accent" : "button--dark"}`}
                onClick={() => setDisplayMode("inset")}
                title="Picture-in-picture floating overlay"
              >
                Inset View
              </button>
              <button
                className={`button ${displayMode === "focus" ? "button--accent" : "button--dark"}`}
                onClick={() => setDisplayMode("focus")}
                title="High-resolution full view"
              >
                Focus Mode
              </button>
              <button
                className="button button--dark"
                onClick={() => setSelectedShot(null)}
              >
                Hide
              </button>
            </div>
          </div>
        )}

        <div className="bottom-hud glass">
          <div className="playback-row">
            <button
              className="button button--accent"
              onClick={() => setPlaying((value) => !value)}
            >
              {playing ? "Pause" : "Play"}
            </button>

            <label className="speed-control">
              Speed
              <input
                type="range"
                min="0.25"
                max="2.5"
                step="0.25"
                value={speed}
                onChange={(event) => setSpeed(Number(event.target.value))}
              />
              <span>{speed.toFixed(2)}×</span>
            </label>

            <button
              className="button button--dark"
              onClick={() => jumpTo(0)}
            >
              Back Door
            </button>

            <button
              className="button button--dark"
              onClick={() => jumpTo(waypoints.length - 1)}
            >
              Aerial Orbit
            </button>
          </div>

          <RouteTimeline
            waypoints={waypoints}
            progress={progress}
            onSelect={jumpTo}
          />
        </div>
      </div>
    </div>
  );
}
