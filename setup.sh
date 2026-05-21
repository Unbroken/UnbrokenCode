#!/bin/bash

set -eo pipefail

if ! [ -e packages/xterm.js ]; then
	git submodule update --init
fi

cd packages/xterm.js

./localpackage.sh
