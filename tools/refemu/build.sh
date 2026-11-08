#!/usr/bin/bash
# builds refemu against the valleyco 8080 core in sources/ (not in git)
cd "$(dirname "$0")"
CORE=../../sources/asm/valleyco-invaders/8080/src
gcc -O2 -I$CORE -o refemu refemu.c $CORE/emu-8080.c
