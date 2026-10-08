import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { InteriorDisplayMode, InteriorShotView } from "../types";

interface Props {
  shot: InteriorShotView | null;
  displayMode: InteriorDisplayMode;
  onClose: () => void;
}

function Panorama({ shot }: { shot: InteriorShotView }) {
  const texture = useMemo(() => {
    const loader = new THREE.TextureLoader();
    return loader.load(shot.objectUrl);
  }, [shot.objectUrl]);

  useEffect(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;

    return () => texture.dispose();
  }, [texture]);

  return (
    <div className="panorama-shell">
      <img
        className="panorama-image"
        src={shot.objectUrl}
        alt={shot.name}
      />
    </div>
  );
}

export default function InteriorShotLayer({
  shot,
  displayMode,
  onClose,
}: Props) {
  if (!shot) return null;

  return (
    <div
      className={`interior-layer interior-layer--${displayMode}`}
      role="dialog"
      aria-label={`Interior shot: ${shot.name}`}
    >
      {shot.type === "panorama" ? (
        <Panorama shot={shot} />
      ) : (
        <img
          className="interior-shot-image"
          src={shot.objectUrl}
          alt={shot.name}
        />
      )}

      <div className="interior-layer__bar">
        <div>
          <strong>{shot.name}</strong>
          <span>{shot.type === "panorama" ? "360° INTERIOR" : "EXACT PHOTO"}</span>
        </div>

        <button className="button button--dark" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
