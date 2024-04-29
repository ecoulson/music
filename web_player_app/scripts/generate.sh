#!/bin/bash

BASE_DIR=$(dirname $0)
GENERATED_DIR=$BASE_DIR/../generated

rm -rf $GENERATED_DIR
mkdir -p $GENERATED_DIR
protoc -I=/home/ecoulson/Code/music/protos hub.proto \
    --js_out=import_style=commonjs,binary:$GENERATED_DIR \
    --grpc-web_out=import_style=typescript,mode=grpcweb:$GENERATED_DIR
