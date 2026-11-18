export const CONFIG = {
  TILE_SIZE: 1.0,
  TILE_HEIGHT: 0.22,
  BLOCK_BASE: 0.96,       // Slightly narrower than 1.0 for clean grid alignment
  BLOCK_LENGTH: 1.96,     // 2x height/length
  ROLL_DURATION: 0.16,    // Seconds per 90-degree tip animation
  ISO_FRUSTUM_SIZE: 11,   // Controls fixed isometric zoom level

  COLORS: {
    BG: 0x191923,
    TILE_TOP: 0xa0a0aa,
    TILE_EDGE: 0x6e6e78,
    SOFT_TILE: 0xe68232,
    HOLE_RIM: 0x1e1e28,
    BLOCK: 0xf06e32,
    BLOCK_EDGE: 0xffa678,
    SWITCH_SOFT: 0x3498db,
    SWITCH_HEAVY: 0x9b59b6,
    BRIDGE_ACTIVE: 0x7f8c9a
  }
};
