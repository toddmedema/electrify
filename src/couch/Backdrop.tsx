import { useEffect, useRef } from "react";

export interface CouchOverlayBackdrop {
  owner: string;
  version: number;
  captureId: number;
  viewport: { width: number; height: number };
  snapshots: {
    seatId: string;
    generation: number;
    bounds: { x: number; y: number; width: number; height: number };
    image: string;
  }[];
}

/** Actual paused company frames stay behind the shared modal while native input is gated. */
export default function CouchBackdrop({
  backdrop,
  onReady,
}: {
  backdrop: CouchOverlayBackdrop;
  onReady: (version: number, captureId: number) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    let frame: number | undefined;
    const images = Array.from(root.current!.querySelectorAll("img"));
    void Promise.all(
      images.map((image) => image.decode().catch(() => {})),
    ).then(() => {
      if (!live) return;
      // Leave a paint opportunity after decoding before native views are hidden.
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          if (live) onReady(backdrop.version, backdrop.captureId);
        });
      });
    });
    return () => {
      live = false;
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [backdrop, onReady]);

  return (
    <div className="couchBackdrop" ref={root} aria-hidden="true">
      {backdrop.snapshots.map(({ seatId, generation, bounds, image }) => (
        <img
          key={`${seatId}:${generation}`}
          data-couch-backdrop-seat={seatId}
          src={image}
          alt=""
          draggable={false}
          style={{
            left: `${(bounds.x / backdrop.viewport.width) * 100}%`,
            top: `${(bounds.y / backdrop.viewport.height) * 100}%`,
            width: `${(bounds.width / backdrop.viewport.width) * 100}%`,
            height: `${(bounds.height / backdrop.viewport.height) * 100}%`,
          }}
        />
      ))}
    </div>
  );
}
