const { RasterEntity } = await import('./svision/js/platform/canvas2D/rasterEntity.js?ver='+window.srcVersion);
// begin code

/**
 * Shows the 1-bpp VRAM of the game worker (7 KiB, the original's 0x2400-0x3FFF)
 * as the 224x256 monochrome picture of the arcade monitor: raster row = screen
 * x, raster column bit = screen y (bit 0 of the lowest byte at the bottom). The
 * picture is kept in {@link RasterEntity}'s frame at logical resolution and
 * painted scaled by the layout ratio; the cellophane overlay is multiplied over
 * it by the model (ArcadeLayout.paintOverlay).
 *
 * The VRAM is turned into pixels in {@link ScreenEntity#paintRaster}, so the
 * work happens once per game frame — the same place, and on the same terms, as
 * in every other game (R-014).
 */
export class ScreenEntity extends RasterEntity {

  constructor(parentEntity, x, y, width, height, penColor) {
    super(parentEntity, x, y, width, height);
    this.id = 'ScreenEntity';

    this.penColor = penColor;
    this.onValue = RasterEntity.rgbaValue(penColor);
    this.offValue = RasterEntity.rgbaValue('#000000');
    this.vram = null;
  } // constructor

  /**
   * Takes the newest VRAM (Uint8Array 0x1C00) and marks the picture as out of
   * date. The worker posts it without a transfer, so every frame arrives as its
   * own copy and there is nothing to clone here.
   * @param {Uint8Array} vram - The video memory of the frame.
   */
  setVRAM(vram) {
    this.vram = vram;
    this.invalidate();
  } // setVRAM

  /**
   * Converts the VRAM to pixels. Every pixel of the frame is written, so there
   * is nothing to clear first — and before the first frame arrives the picture
   * is the black the monitor shows, which is what the constructor used to fill
   * the buffer with.
   * @param {Uint8ClampedArray} data - The RGBA bytes of the frame.
   */
  paintRaster(data) {
    if (this.vram === null) {
      this.pixels.fill(this.offValue);
      return;
    }
    var width = this.width;
    var vram = this.vram;
    var on = this.onValue, off = this.offValue, px = this.pixels;
    for (var x = 0; x < width; x++) {
      var row = x*32;
      for (var c = 0; c < 32; c++) {
        var byte = vram[row+c];
        var yBase = 255-c*8;
        for (var b = 0; b < 8; b++) {
          px[(yBase-b)*width+x] = (byte & (1 << b)) ? on : off;
        }
      }
    }
  } // paintRaster

} // ScreenEntity
