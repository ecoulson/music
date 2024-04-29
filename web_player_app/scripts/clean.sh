#!/bin/bash

BASE_DIR=$(dirname $0)
GENERATED_DIR=$BASE_DIR/../generated
NODE_MODULES_DIR=$BASE_DIR/../node_modules
LIB_DIR=$BASE_DIR/../lib

rm -rf $GENERATED_DIR $NODE_MODULES_DIR $LIB_DIR
