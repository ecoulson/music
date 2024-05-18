#!/bin/bash

BASE_DIR=$(dirname $0)
GENERATED_DIR=$BASE_DIR/../generated
PROTOS_DIR=$BASE_DIR/../../protos

rm -rf $GENERATED_DIR
mkdir -p $GENERATED_DIR
protoc -I=$PROTOS_DIR hub.proto \
    --js_out=import_style=commonjs,binary:$GENERATED_DIR \
    --grpc-web_out=import_style=typescript,mode=grpcweb:$GENERATED_DIR
