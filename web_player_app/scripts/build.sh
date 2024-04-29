#!/bin/bash

BASE_DIR=$(dirname $0)
LIB_DIR=$BASE_DIR/../lib
NODE_MODULES_DIR=$BASE_DIR/../node_modules

mkdir -p $LIB_DIR
$BASE_DIR/generate.sh
$NODE_MODULES_DIR/.bin/esbuild ./src/main.ts --bundle --minify --sourcemap \
    --target=chrome58,firefox57,safari11,edge16 --outfile=$LIB_DIR/web-player.js

