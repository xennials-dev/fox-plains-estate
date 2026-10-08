import type { Waypoint } from "../types";

interface Props {
  waypoints: Waypoint[];
  progress: number;
  onSelect: (index: number) => void;
}

export default function RouteTimeline({
  waypoints,
  progress,
  onSelect,
}: Props) {
  const activeIndex = Math.min(
    waypoints.length - 1,
    Math.round(progress * (waypoints.length - 1)),
  );

  return (
    <div className="route-timeline">
      <div className="route-timeline__track">
        <div
          className="route-timeline__progress"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      <div className="route-timeline__points">
        {waypoints.map((wp, index) => (
          <button
            key={wp.id}
            className={`route-point ${index === activeIndex ? "route-point--active" : ""}`}
            onClick={() => onSelect(index)}
            title={wp.label}
          >
            <span />
            <small>{wp.shortLabel}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
