export type ViewMode = "drone" | "interior";
export type InteriorShotType = "flat" | "panorama";
export type InteriorDisplayMode = "inset" | "focus";

export type Vec3 = [number, number, number];

export interface Waypoint {
  id: string;
  label: string;
  shortLabel: string;
  floor: "basement" | "main" | "upper" | "roof";
  position: Vec3;
  lookAt: Vec3;
  description: string;
  roomKey: string;
}

export interface InteriorShot {
  id: string;
  name: string;
  roomKey: string;
  waypointId: string;
  type: InteriorShotType;
  blob: Blob;
  createdAt: number;
}

export interface InteriorShotView extends Omit<InteriorShot, "blob"> {
  objectUrl: string;
}
