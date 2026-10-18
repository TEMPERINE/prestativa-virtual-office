type Size = { width: number; height: number };
type Point = { x: number; y: number };

/** Camera coordinates stay map-local; only the visible window changes on touch. */
export function mobileCameraPan(map: Size, viewport: Size, origin: Point, zoom: number, requested: Point): Point {
  const axis = (content: number, visible: number, offset: number, value: number) => {
    const scaled = content * zoom;
    if (scaled <= visible) return (visible - scaled) / 2 - offset;
    return Math.min(-offset, Math.max(visible - offset - scaled, value));
  };
  return {
    x: axis(map.width, viewport.width, origin.x, requested.x),
    y: axis(map.height, viewport.height, origin.y, requested.y),
  };
}

export function mobileCameraCenter(map: Size, viewport: Size, origin: Point, zoom: number, avatar: Point): Point {
  return mobileCameraPan(map, viewport, origin, zoom, {
    x: viewport.width / 2 - origin.x - avatar.x * map.width * zoom,
    y: viewport.height / 2 - origin.y - avatar.y * map.height * zoom,
  });
}