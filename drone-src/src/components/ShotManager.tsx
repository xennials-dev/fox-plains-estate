import { useEffect, useMemo, useState } from "react";
import type { InteriorShotType, InteriorShotView, Waypoint } from "../types";
import { deleteShot, listShots, saveShot } from "../lib/shotStore";

interface Props {
  waypoints: Waypoint[];
  onShotSelect: (shot: InteriorShotView | null) => void;
}

export default function ShotManager({
  waypoints,
  onShotSelect,
}: Props) {
  const [shots, setShots] = useState<InteriorShotView[]>([]);
  const [selectedWaypoint, setSelectedWaypoint] = useState(waypoints[0]?.id ?? "");
  const [shotType, setShotType] = useState<InteriorShotType>("flat");
  const [drawerOpen, setDrawerOpen] = useState(false);

  async function refresh() {
    const records = await listShots();
    setShots(records);
  }

  useEffect(() => {
    void refresh();

    return () => {
      for (const shot of shots) {
        if (!shot.isDefault && shot.objectUrl.startsWith("blob:")) {
          URL.revokeObjectURL(shot.objectUrl);
        }
      }
    };
    // refresh intentionally runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedWaypointData = useMemo(
    () => waypoints.find((wp) => wp.id === selectedWaypoint),
    [selectedWaypoint, waypoints],
  );

  async function handleFiles(files: FileList | null) {
    if (!files?.length || !selectedWaypointData) return;

    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;

      const shot = {
        id: crypto.randomUUID(),
        name: file.name.replace(/\.[^.]+$/, ""),
        roomKey: selectedWaypointData.roomKey,
        waypointId: selectedWaypointData.id,
        type: shotType,
        blob: file,
        createdAt: Date.now(),
      };

      await saveShot(shot);
    }

    await refresh();
  }

  async function remove(id: string) {
    const shot = shots.find((item) => item.id === id);
    if (shot && !shot.isDefault && shot.objectUrl.startsWith("blob:")) {
      URL.revokeObjectURL(shot.objectUrl);
    }

    await deleteShot(id);
    const next = shots.filter((item) => item.id !== id);
    setShots(next);
  }

  return (
    <>
      <button
        className="button button--accent shot-manager-toggle"
        onClick={() => setDrawerOpen((open) => !open)}
      >
        {drawerOpen ? "Hide Estate Gallery" : "Estate Photography Gallery"}
      </button>

      {drawerOpen && (
        <aside className="shot-manager">
          <div className="shot-manager__header">
            <div>
              <strong>Estate Photography Gallery</strong>
              <span>Verified high-resolution interior and aerial photographs synchronized with the drone path.</span>
            </div>
            <button className="button button--dark" onClick={() => setDrawerOpen(false)}>
              ×
            </button>
          </div>

          <label className="field">
            <span>Attach to room / waypoint</span>
            <select
              value={selectedWaypoint}
              onChange={(event) => setSelectedWaypoint(event.target.value)}
            >
              {waypoints.map((wp) => (
                <option key={wp.id} value={wp.id}>
                  {wp.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Shot type</span>
            <select
              value={shotType}
              onChange={(event) => setShotType(event.target.value as InteriorShotType)}
            >
              <option value="flat">Normal interior photo</option>
              <option value="panorama">2:1 equirectangular panorama</option>
            </select>
          </label>

          <label className="upload-zone">
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(event) => {
                void handleFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <strong>Upload additional photos</strong>
            <span>
              Upload extra kitchen, living room, bedrooms, bathrooms, basement, or roof-deck views.
            </span>
          </label>

          <div className="shot-list">
            {shots.length === 0 && (
              <div className="shot-list__empty">
                Loading estate photographs...
              </div>
            )}

            {shots.map((shot) => {
              const wp = waypoints.find((item) => item.id === shot.waypointId);

              return (
                <div key={shot.id} className="shot-card">
                  <img src={shot.objectUrl} alt={shot.name} />

                  <div className="shot-card__info">
                    <strong>{shot.name}</strong>
                    <span>{wp?.label ?? "Unmapped waypoint"}</span>
                    {shot.isDefault ? (
                      <small style={{ color: "#8cf5b7" }}>★ Official Listing Photo</small>
                    ) : (
                      <small>{shot.type === "panorama" ? "360°" : "User Photo"}</small>
                    )}
                  </div>

                  <div className="shot-card__actions">
                    <button
                      className="button button--accent"
                      onClick={() => onShotSelect(shot)}
                    >
                      View
                    </button>
                    {!shot.isDefault && (
                      <button
                        className="button button--dark"
                        onClick={() => void remove(shot.id)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </aside>
      )}
    </>
  );
}
