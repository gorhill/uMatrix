#!/bin/bash
#
# This script assumes a linux environment

echo "*** µMatrix(Opera): Creating package"
echo "*** µMatrix(Opera): Copying files"
mkdir -p ./dist/uMatrix.opera
cp -R ./src/*           ./dist/uMatrix.opera/
cp -R ./assets          ./dist/uMatrix.opera/
cp    ./meta/chromium/* ./dist/uMatrix.opera/
# Copy only locales with fully translated description
mkdir -p ./dist/uMatrix.opera/_locales
cp -R ./tools/_locales/de    ./dist/uMatrix.opera/_locales/
cp -R ./tools/_locales/en    ./dist/uMatrix.opera/_locales/
cp -R ./tools/_locales/es    ./dist/uMatrix.opera/_locales/
cp -R ./tools/_locales/fr    ./dist/uMatrix.opera/_locales/
cp -R ./tools/_locales/he    ./dist/uMatrix.opera/_locales/
cp -R ./tools/_locales/pt_BR ./dist/uMatrix.opera/_locales/
cp -R ./tools/_locales/tr    ./dist/uMatrix.opera/_locales/
echo "*** µMatrix(Opera): Package done."
