#!/bin/bash
#
# This script assumes a linux environment

echo "*** µMatrix(Chromium): Creating package"
echo "*** µMatrix(Chromium): Copying files"
mkdir -p ./dist/chromium
cp -R ./src/*           ./dist/chromium/
cp -R ./tools/_locales  ./dist/chromium/
cp -R ./assets          ./dist/chromium/
cp    ./meta/chromium/* ./dist/chromium/
echo "*** µMatrix(Chromium): Package done."
