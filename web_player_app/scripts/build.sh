#!/bin/bash

trap 'exit' ERR

BASE_DIR=$(dirname $0)
LIB_DIR=$BASE_DIR/../lib
NODE_MODULES_DIR=$BASE_DIR/../node_modules

mkdir -p $LIB_DIR
$BASE_DIR/generate.sh
$NODE_MODULES_DIR/.bin/tsc --noEmit
$NODE_MODULES_DIR/.bin/esbuild ./src/main.ts --bundle --minify --sourcemap \
    --outfile=$LIB_DIR/web-player.js

