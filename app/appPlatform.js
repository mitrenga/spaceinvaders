const { ArcadePlatform } = await import('./svision/js/platform/canvas2D/arcade/arcadePlatform.js?ver='+window.srcVersion);
// begin code

/**
 * Space Invaders: 224x256 portrait raster, black bezel, cellophane overlay
 * (bands from MAME invaders.lay, GAME-DESIGN chap. 2.2: red UFO strip, green
 * player/shields strip, green lives corner). Overlay default: on [?].
 */
export function appPlatform() {
  return new ArcadePlatform({
    width: 224,
    height: 256,
    bezelColor: '#000000',
    screenColor: '#000000',
    minimalBorder: 0,
    overlay: {
      enabled: true,
      bands: [
        {x: 0, y: 32, width: 224, height: 30, color: '#ff2020'},
        {x: 0, y: 184, width: 224, height: 56, color: '#20ff20'},
        {x: 16, y: 240, width: 118, height: 20, color: '#20ff20'}
      ]
    }
  });
} // appPlatform
