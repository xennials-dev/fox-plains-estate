interface Props {
  roomLabel: string;
  progress: number;
  interiorActive: boolean;
}

export default function DroneBadge({
  roomLabel,
  progress,
  interiorActive,
}: Props) {
  return (
    <div className="drone-badge">
      <div className="drone-badge__title">
        <span className="drone-badge__dot" />
        DRONE VIEW
      </div>

      <div className="drone-badge__sub">
        {interiorActive ? "INTERIOR SHOT" : roomLabel}
      </div>

      <div className="drone-badge__progress">
        <span style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
    </div>
  );
}
