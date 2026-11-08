#!/usr/bin/env python3
"""
rom2font — builds the glyph table of app/spaceInvadersFonts8x8.js.

A ZXFonts8x8 table (96 glyphs in the order of ZXFonts8x8.fontsChars, 16 hex
digits each: 8 rows, one byte a row, bit 7 the left pixel) filled from:

  1. the character set of the Space Invaders ROM (data/font.json, hexRows,
     characters at 1E00h): 0-9, A-Z, < > = * ? - and the space. The ROM keeps
     the glyph in rows 1-7 under an empty row; here it is moved up one row to
     the rows 0-6 every ZX font uses, so both sources share one baseline.
  2. "The Island" (1984, Crystal Computing) from ~/sw/zx-fonts, the one font of
     the collection whose letters and digits are pixel for pixel the Space
     Invaders ones (tools: 0 differences over 36 glyphs, row shift 1); it
     supplies every other character (punctuation, lowercase).
  3. the copyright sign, drawn by hand in the same 5-pixel style: The Island
     has no glyph there (a fragment of game graphics).

The upside-down Y of the attract mode (the "y" of data/font.json) is printed
as an extra glyph after the table, for addGlyphs('⅄', ...).

Usage: python3 tools/rom2font.py [--show]
"""
import json, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ISLAND = os.path.expanduser('~/sw/zx-fonts/ch8/Island, The (1984)(Crystal Computing)#43256.ch8')
CH = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_£abcdefghijklmnopqrstuvwxyz{|}~©'

hexrows = json.load(open(os.path.join(ROOT, 'data/font.json')))['font']['hexRows']
island = open(ISLAND, 'rb').read()

def rom_rows(char):
    rows = [int(hexrows[char][i:i+2], 16) for i in range(0, 16, 2)]
    return rows[1:]+[0]                        # rows 1-7 -> 0-6

def island_rows(char):
    i = CH.index(char)*8
    return list(island[i:i+8])

COPYRIGHT = ['.####...', '#....#..', '#.##.#..', '#.#..#..', '#.##.#..', '#....#..', '.####...', '........']

glyphs, sources = [], {}
for c in CH:
    if c in hexrows and c != 'y':              # 'y' of the ROM is the upside-down Y, not a letter
        rows, src = rom_rows(c), 'ROM 1E00h'
    elif c == '©':
        rows, src = [int(r.replace('#', '1').replace('.', '0'), 2) for r in COPYRIGHT], 'hand-drawn'
    else:
        rows, src = island_rows(c), 'The Island'
    glyphs.append(rows)
    sources.setdefault(src, []).append(c)

hexdata = ''.join('%02X' % b for rows in glyphs for b in rows)
assert len(hexdata) == 96*16
print(hexdata)
print(''.join('%02X' % b for b in rom_rows('y')))   # the upside-down Y
for src, chars in sources.items():
    print('%-11s %s' % (src, ''.join(chars)), file=sys.stderr)
# proof that the shared characters agree
diff = [c for c in hexrows if c != 'y' and rom_rows(c) != island_rows(c)]
print('ROM vs The Island on shared characters: %d differences %s' % (len(diff), ''.join(diff)), file=sys.stderr)
if '--show' in sys.argv:
    for text in ('SPACE INVADERS 0123456789', '<>=*?-!"#$%&\'(),./:;@[\\]^_£{|}~©', 'abcdefghijklmnopqrstuvwxyz'):
        for y in range(8):
            print(' '.join(''.join('#' if glyphs[CH.index(c)][y] & (0x80 >> x) else '.' for x in range(8)) for c in text), file=sys.stderr)
        print(file=sys.stderr)
