import { useEffect, useMemo, useState } from "react";
import DroneBadge from "./components/DroneBadge";
import DroneScene from "./components/DroneScene";
import InteriorShotLayer from "./components/InteriorShotLayer";
import RouteTimeline from "./components/RouteTimeline";
import ShotManager from "./components/ShotManager";
import { PROPERTY, WAYPOINTS } from "./data/house";
import { listShots } from "./lib/shotStore";
import type { InteriorDisplayMode, InteriorShotView } from "./types";

const REVEAL_THRESHOLD = 0.012;

function nearestWaypointIndex(progress: number): number {
  return Math.round(progress * (WAYPOINTS.length - 1));
}

export default function App() {
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [progress, setProgress] = useState(0);
  const [routeIndex, setRouteIndex] = useState(0);
  const [shots, setShots] = useState<InteriorShotView[]>([]);
  const [selectedShot, setSelectedShot] = useState<InteriorShotView | null>(null);
  const [displayMode, setDisplayMode] = useState<InteriorDisplayMode>("inset");
  const [autoInteriorShots, setAutoInteriorShots] = useState(true);

  const currentIndex = nearestWaypointIndex(progress);
  const currentWaypoint = WAYPOINTS[currentIndex];

  const waypointForSelectedShot = useMemo(
    () => WAYPOINTS.find((wp) => wp.id === selectedShot?.waypointId),
    [selectedShot],
  );

  // Load pre-bundled official estate photos and custom shots on mount
  useEffect(() => {
    void listShots().then((loadedShots) => {
      setShots(loadedShots);
      // If we are at the initial waypoint, show its photo immediately
      const initialWp = WAYPOINTS[0];
      const initialShot = loadedShots.find((s) => s.waypointId === initialWp.id);
      if (initialShot) setSelectedShot(initialShot);
    });
  }, []);

  // Listen for query params e.g. ?room=kitchen or ?wp=living
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const targetRoom = params.get("room") || params.get("wp") || params.get("waypoint");
    if (targetRoom) {
      const idx = WAYPOINTS.findIndex(
        (wp) => wp.id === targetRoom || wp.roomKey === targetRoom,
      );
      if (idx >= 0) {
        jumpTo(idx);
      }
    }
  }, []);

  // Auto-synchronize the high-res estate photograph as the drone flies through each room
  useEffect(() => {
    if (!autoInteriorShots || shots.length === 0) return;
    const currentWp = WAYPOINTS[currentIndex];
    if (!currentWp) return;

    const matchingShot = shots.find((s) => s.waypointId === currentWp.id);
    if (matchingShot) {
      setSelectedShot(matchingShot);
    }
  }, [autoInteriorShots, currentIndex, shots]);

  function handleProgress(value: number) {
    setProgress(value);

    const idx = nearestWaypointIndex(value);

    if (Math.abs(value - idx / Math.max(1, WAYPOINTS.length - 1)) < REVEAL_THRESHOLD) {
      setRouteIndex(idx);
    }
  }

  function jumpTo(index: number) {
    setRouteIndex(index);
    setProgress(index / Math.max(1, WAYPOINTS.length - 1));

    if (shots.length > 0) {
      const targetWp = WAYPOINTS[index];
      const matchingShot = shots.find((s) => s.waypointId === targetWp?.id);
      if (matchingShot) {
        setSelectedShot(matchingShot);
      }
    }
  }

  return (
    <div className="app-shell">
      <DroneScene
        waypoints={WAYPOINTS}
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
          <div className="eyebrow">ESTATE DRONE TWIN · FLORISSANT, MO</div>
          <h1>{PROPERTY.name}</h1>
          <p>{PROPERTY.city}</p>
          <div className="property-card__facts">
            <span>{PROPERTY.beds} BD</span>
            <span>{PROPERTY.baths} BA</span>
            <span>{PROPERTY.livingAreaSqFt.toLocaleString()} SQ FT</span>
            <span style={{ color: "#8cf5b7" }}>11 ESTATE PHOTOS</span>
          </div>
          <small>{PROPERTY.note}</small>
        </div>

        <div className="top-actions">
          <a
            href="/"
            className="button button--dark"
            style={{ textDecoration: "none" }}
            title="Return to Fox Plains Estate Main Presentation"
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
          {WAYPOINTS.filter((wp) => Boolean(wp.photoUrl)).map((wp) => {
            const wpIndex = WAYPOINTS.findIndex((w) => w.id === wp.id);
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
          waypoints={WAYPOINTS}
          onShotSelect={(shot) => {
            setSelectedShot(shot);
            setDisplayMode("inset");

            const wpIndex = WAYPOINTS.findIndex(
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
              onClick={() => jumpTo(WAYPOINTS.length - 1)}
            >
              Aerial Orbit
            </button>
          </div>

          <RouteTimeline
            waypoints={WAYPOINTS}
            progress={progress}
            onSelect={jumpTo}
          />
        </div>
      </div>
    </div>
  );
}
