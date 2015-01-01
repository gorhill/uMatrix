#!/bin/bash
#
# This script assumes a linux environment

echo "*** µMatrix(Opera): Creating package"
echo "*** µMatrix(Opera): Copying files"
DES=./dist/uMatrix.opera
rm -r $DES
mkdir -p $DES
cp -R ./src/*           $DES/
cp -R ./assets          $DES/
cp    ./meta/chromium/* $DES/
# Copy only locales with fully translated description
mkdir -p $DES/_locales
cp -R ./tools/_locales/de    $DES/_locales/
cp -R ./tools/_locales/en    $DES/_locales/
cp -R ./tools/_locales/es    $DES/_locales/
cp -R ./tools/_locales/fr    $DES/_locales/
cp -R ./tools/_locales/he    $DES/_locales/
cp -R ./tools/_locales/pt_BR $DES/_locales/
cp -R ./tools/_locales/tr    $DES/_locales/
echo "*** µMatrix(Opera): Package done."
