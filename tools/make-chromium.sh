#!/bin/bash
#
# This script assumes a linux environment

echo "*** µMatrix(Chromium): Creating package"
echo "*** µMatrix(Chromium): Copying files"
DES=./dist/uMatrix.chromium
rm -rf $DES
mkdir -p $DES
cp -R ./src/*           $DES
cp -R ./tools/_locales  $DES
cp -R ./assets          $DES
cp    ./meta/chromium/* $DES
echo "*** µMatrix(Chromium): Package done."
