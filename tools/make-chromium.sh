#!/bin/bash
#
# This script assumes a linux environment

echo "*** µMatrix(Chromium): Creating package"
echo "*** µMatrix(Chromium): Copying files"
mkdir -p ./dist/uMatrix.chromium
cp -R ./src/*           ./dist/uMatrix.chromium/
cp -R ./tools/_locales  ./dist/uMatrix.chromium/
cp -R ./assets          ./dist/uMatrix.chromium/
cp    ./meta/chromium/* ./dist/uMatrix.chromium/
echo "*** µMatrix(Chromium): Package done."
