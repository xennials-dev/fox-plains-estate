import { useEffect, useMemo, useState } from "react";
import DroneBadge from "./components/DroneBadge";
import DroneScene from "./components/DroneScene";
import InteriorShotLayer from "./components/InteriorShotLayer";
import RouteTimeline from "./components/RouteTimeline";
import ShotManager from "./components/ShotManager";
import { PROPERTY, WAYPOINTS } from "./data/house";
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
  const [selectedShot, setSelectedShot] = useState<InteriorShotView | null>(null);
  const [displayMode, setDisplayMode] = useState<InteriorDisplayMode>("inset");
  const [autoInteriorShots, setAutoInteriorShots] = useState(true);

  const currentIndex = nearestWaypointIndex(progress);
  const currentWaypoint = WAYPOINTS[currentIndex];

  const waypointForSelectedShot = useMemo(
    () => WAYPOINTS.find((wp) => wp.id === selectedShot?.waypointId),
    [selectedShot],
  );

  useEffect(() => {
    if (!autoInteriorShots || !selectedShot) return;

    // Keep a manually selected photo open. Automatic mode still lets the
    // photo stay attached to the selected room until the camera moves away.
    const shotIndex = WAYPOINTS.findIndex(
      (wp) => wp.id === selectedShot.waypointId,
    );

    if (Math.abs(shotIndex - currentIndex) > 1) {
      setSelectedShot(null);
    }
  }, [autoInteriorShots, currentIndex, selectedShot]);

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
          <div className="eyebrow">PROPERTY WALKTHROUGH</div>
          <h1>{PROPERTY.name}</h1>
          <p>{PROPERTY.city}</p>
          <div className="property-card__facts">
            <span>{PROPERTY.beds} BD</span>
            <span>{PROPERTY.baths} BA</span>
            <span>{PROPERTY.livingAreaSqFt.toLocaleString()} SQ FT</span>
          </div>
          <small>{PROPERTY.note}</small>
        </div>

        <div className="top-actions">
          <button
            className={`button ${autoInteriorShots ? "button--accent" : "button--dark"}`}
            onClick={() => setAutoInteriorShots((value) => !value)}
          >
            Auto Interior {autoInteriorShots ? "ON" : "OFF"}
          </button>
          <button
            className="button button--dark"
            onClick={() => setPlaying((value) => !value)}
          >
            {playing ? "Pause Drone" : "Play Drone"}
          </button>
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
              <strong>{selectedShot.name}</strong>
              <span>{waypointForSelectedShot?.label ?? "Interior shot"}</span>
            </div>

            <div className="shot-controls__buttons">
              <button
                className={`button ${displayMode === "inset" ? "button--accent" : "button--dark"}`}
                onClick={() => setDisplayMode("inset")}
              >
                Inset
              </button>
              <button
                className={`button ${displayMode === "focus" ? "button--accent" : "button--dark"}`}
                onClick={() => setDisplayMode("focus")}
              >
                Focus
              </button>
              <button
                className="button button--dark"
                onClick={() => setSelectedShot(null)}
              >
                Close
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
              Roof Deck
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
