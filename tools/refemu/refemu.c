/*
 * refemu — headless reference emulator of the Space Invaders arcade board
 * (Intel 8080 @ 2 MHz, 2 interrupts/frame) built on the valleyco 8080 core
 * (sources/asm/valleyco-invaders/8080/src, GPL). Used to produce reference
 * data for the remake: VRAM snapshots (PBM P4, 224x256 as seen by the
 * player) and per-frame RAM traces (GAME-DESIGN chap. 9).
 *
 * usage: refemu <rom dir> [options]
 *   --frames N        total frames to run (default 600)
 *   --coin F          press CREDIT during frames F..F+4 (default 10)
 *   --start F         press 1P START during frames F..F+4 (default 40)
 *   --snap-start FILE write VRAM (PBM) at the first frame of the game where
 *                     all 55 aliens are drawn and the rack has not moved yet
 *   --snap-at F FILE  write VRAM at frame F
 *   --snap-cycle N FILE  write VRAM the N-th time the alien cursor reaches the last alien
 *                     (all 55 drawn at one rack position; N=1 equals --snap-start)
 *   --trace FILE      per-frame RAM trace (TSV) from the frame the game starts
 *   --left F1 F2 / --right F1 F2 / --fire F1 F2   hold a P1 control in frames [F1,F2)
 * frame = 33333 cycles; RST 1 after 16667 cycles (scanline 96), RST 2 at the end.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "emu-8080.h"

#define CYCLES_PER_FRAME 33333
#define CYCLES_HALF 16667

static unsigned char memory[0x4000];
static int shift_reg = 0, shift_amount = 0;
static int in_credit = 0, in_start = 0, in_left = 0, in_right = 0, in_fire = 0;

static int port_read(void *g, int p) {
  (void)g;
  switch (p) {
    case 0: return 0x0E;
    case 1: return 0x08 | (in_credit ? 1 : 0) | (in_start ? 4 : 0) | (in_fire ? 0x10 : 0) | (in_left ? 0x20 : 0) | (in_right ? 0x40 : 0);
    case 2: return 0x00;  /* DIP: 3 ships, bonus 1500, coin info on, no tilt */
    case 3: return (shift_reg >> (8 - shift_amount)) & 0xFF;
  }
  return 0;
}

static void port_write(void *g, int p, int v) {
  (void)g;
  switch (p) {
    case 2: shift_amount = v & 7; break;
    case 4: shift_reg = (shift_reg >> 8) | ((v & 0xFF) << 8); break;
    default: break; /* 3, 5 sound; 6 watchdog */
  }
}

static int load_rom(const char *dir) {
  const char *names[4] = {"invaders.h", "invaders.g", "invaders.f", "invaders.e"};
  char path[1024];
  for (int i = 0; i < 4; i++) {
    snprintf(path, sizeof(path), "%s/%s", dir, names[i]);
    FILE *f = fopen(path, "rb");
    if (!f) { fprintf(stderr, "cannot open %s\n", path); return 0; }
    if (fread(memory + i * 0x800, 1, 0x800, f) != 0x800) { fprintf(stderr, "short read %s\n", path); fclose(f); return 0; }
    fclose(f);
  }
  return 1;
}

/* VRAM 2400-3FFF: 224 raster rows x 32 bytes; raster x = byte*8+bit, screen (rotated
 * 90 deg CCW): screen_x = raster row, screen_y = 255 - raster x. */
static void write_pbm(const char *file) {
  FILE *f = fopen(file, "wb");
  if (!f) { fprintf(stderr, "cannot write %s\n", file); return; }
  fprintf(f, "P4\n224 256\n");
  for (int sy = 0; sy < 256; sy++) {
    int rx = 255 - sy;
    unsigned char row[28];
    memset(row, 0, sizeof(row));
    for (int sx = 0; sx < 224; sx++) {
      int byte = memory[0x2400 + sx * 32 + (rx >> 3)];
      int on = (byte >> (rx & 7)) & 1;
      if (on) row[sx >> 3] |= 0x80 >> (sx & 7);   /* PBM: 1 = black; we invert below */
    }
    for (int i = 0; i < 28; i++) row[i] = ~row[i]; /* lit pixel -> white */
    fwrite(row, 1, 28, f);
  }
  fclose(f);
}

int main(int argc, char **argv) {
  if (argc < 2) { fprintf(stderr, "usage: refemu <rom dir> [options]\n"); return 1; }
  int frames = 600, coin_f = 10, start_f = 40, snap_at[16], snap_n = 0;
  const char *snap_start = NULL, *snap_file[16], *trace_file = NULL, *snap_cycle_file = NULL; int snap_cycle = 0, cycles_seen = 0;
  int left1 = -1, left2 = -1, right1 = -1, right2 = -1, fire1 = -1, fire2 = -1;
  for (int i = 2; i < argc; i++) {
    if (!strcmp(argv[i], "--frames")) frames = atoi(argv[++i]);
    else if (!strcmp(argv[i], "--coin")) coin_f = atoi(argv[++i]);
    else if (!strcmp(argv[i], "--start")) start_f = atoi(argv[++i]);
    else if (!strcmp(argv[i], "--snap-start")) snap_start = argv[++i];
    else if (!strcmp(argv[i], "--snap-at") && snap_n < 16) { snap_at[snap_n] = atoi(argv[++i]); snap_file[snap_n++] = argv[++i]; }
    else if (!strcmp(argv[i], "--trace")) trace_file = argv[++i];
    else if (!strcmp(argv[i], "--snap-cycle")) { snap_cycle = atoi(argv[++i]); snap_cycle_file = argv[++i]; }
    else if (!strcmp(argv[i], "--left")) { left1 = atoi(argv[++i]); left2 = atoi(argv[++i]); }
    else if (!strcmp(argv[i], "--right")) { right1 = atoi(argv[++i]); right2 = atoi(argv[++i]); }
    else if (!strcmp(argv[i], "--fire")) { fire1 = atoi(argv[++i]); fire2 = atoi(argv[++i]); }
    else { fprintf(stderr, "unknown option %s\n", argv[i]); return 1; }
  }
  if (!load_rom(argv[1])) return 1;

  struct Context ctx;
  memset(&ctx, 0, sizeof(ctx));
  ctx.memory = memory;
  ctx.port_read = port_read;
  ctx.port_write = port_write;
  ctx.address_mask = 0x3FFF;
  ctx.rom_size = 0x2000;

  FILE *trace = trace_file ? fopen(trace_file, "w") : NULL;
  if (trace) fprintf(trace, "frame\tgameFrame\trefAlienYr\trefAlienXr\tcurIndex\tnumAliens\tplayerXr\tshotStatus\tshotYr\tshotXr\tsaucerXr\tscore\ttillSaucer\tgameMode\tplayerAlive\talienFrame\tobj0Timer\n");
  int game_frame = -1, snapped_start = 0, last_was_36 = 0;
  for (int frame = 0; frame < frames; frame++) {
    in_credit = (frame >= coin_f && frame < coin_f + 5);
    in_start = (frame >= start_f && frame < start_f + 5);
    in_left = (frame >= left1 && frame < left2);
    in_right = (frame >= right1 && frame < right2);
    in_fire = (frame >= fire1 && frame < fire2);
    long cycles = 0;
    int half_done = 0;
    while (cycles < CYCLES_PER_FRAME) {
      cycles += emu_8080_execute(&ctx);
      if (!half_done && cycles >= CYCLES_HALF) {
        half_done = 1;
        if (ctx.interrupt) cycles += emu_8080_rst(&ctx, 1);
      }
    }
    if (ctx.interrupt) emu_8080_rst(&ctx, 2);
    /* let the ISR body run so the frame's drawing is complete before we look */
    /* let the whole RST 2 handler finish (DrawAlien + RunGameObjs + TimeToSaucer take
       several thousand cycles) before sampling RAM; RST 1 is 16667 cycles away */
    long extra = 0;
    while (extra < 12000) extra += emu_8080_execute(&ctx);

    if (getenv("REFEMU_DEBUG") && frame % 50 == 0) fprintf(stderr, "f%d PC=%04X int=%d coins=%02X mode=%02X wait=%02X spl=%02X idx=%02X isrDelay=%02X\n", frame, ctx.PC, ctx.interrupt, memory[0x20EB], memory[0x20EF], memory[0x2093], memory[0x20C1], memory[0x2006], memory[0x20C0]);
    int game_mode = memory[0x20EF];
    if (game_mode && game_frame < 0) game_frame = 0;
    if (game_frame >= 0) {
      if (trace) fprintf(trace, "%d\t%d\t%02X\t%02X\t%02X\t%d\t%02X\t%d\t%02X\t%02X\t%02X\t%02X%02X\t%04X\t%d\t%02X\t%d\t%04X\n",
        frame, game_frame, memory[0x2009], memory[0x200A], memory[0x2006], memory[0x2082], memory[0x201B],
        memory[0x2025], memory[0x2029], memory[0x202A], memory[0x208A], memory[0x20F9], memory[0x20F8],
        memory[0x2091] | (memory[0x2092] << 8), game_mode, memory[0x2015], memory[0x2005], memory[0x2010] | (memory[0x2011] << 8));
      int idx = memory[0x2006];
      if (idx == 0x36 && !last_was_36) {
        cycles_seen++;
        if (snap_cycle_file && cycles_seen == snap_cycle) { write_pbm(snap_cycle_file); fprintf(stderr, "cycle %d snapshot at frame %d (game frame %d)\n", snap_cycle, frame, game_frame); }
      }
      last_was_36 = (idx == 0x36);
      if (snap_start && !snapped_start && idx == 0x36) {
        /* the cursor is on the last alien: all 55 aliens have been drawn once at the
           initial rack position, the reference alien has not moved yet */
        write_pbm(snap_start);
        snapped_start = 1;
        fprintf(stderr, "snapshot at frame %d (game frame %d)\n", frame, game_frame);
      }
      game_frame++;
    }
    for (int k = 0; k < snap_n; k++) if (frame == snap_at[k]) write_pbm(snap_file[k]);
  }
  if (trace) fclose(trace);
  if (snap_start && !snapped_start) fprintf(stderr, "warning: start snapshot condition never met\n");
  return 0;
}
