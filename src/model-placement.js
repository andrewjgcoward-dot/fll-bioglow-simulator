// Render registration is independent of the approximate 2D collision field.
// Packs without calibrated dock sites retain the legacy simulation transform.
export function modelPlacementTransform(placement, objects, dockSites = {}) {
  const dock = placement.dockModel && objects.find(o => o.dock && o.holds === placement.dockModel);
  if (!dock) return { position: placement.position, yaw: placement.yaw };
  const site = dockSites[dock.key];
  return {
    position: site ? [site.position[0], site.position[1], site.position[2] + placement.position[2]] : [dock.x, dock.y, placement.position[2]],
    yaw: (site ? site.yaw : dock.r) + (placement.dockYaw || 0)
  };
}
