#!/bin/bash

trap 'exit' ERR

BASE_DIR=$(dirname $0)
GENERATED_DIR=$BASE_DIR/../generated
PROTOS_DIR=$BASE_DIR/../../protos
NODE_MODULES_DIR=$BASE_DIR/../node_modules

rm -rf $GENERATED_DIR
mkdir -p $GENERATED_DIR
$NODE_MODULES_DIR/.bin/protoc --ts_out $GENERATED_DIR --proto_path $PROTOS_DIR hub.proto
