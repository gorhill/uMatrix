#!/bin/bash
#
# This script assumes a linux environment

echo "*** µMatrix(Chromium): Creating package"
echo "*** µMatrix(Chromium): Copying files"

DES=./dist/build/uMatrix.chromium
rm -rf $DES
mkdir -p $DES

cp -R ./assets                          $DES/
cp -R ./src/*                           $DES/
cp -R $DES/_locales/nb                  $DES/_locales/no # Chrome store quirk
cp    ./platform/chromium/*.html        $DES/
cp    ./platform/chromium/*.js          $DES/js/
cp -R ./platform/chromium/img/*         $DES/img/
cp    ./platform/chromium/manifest.json $DES/
cp    LICENSE.txt                       $DES/

if [ "$1" = all ]; then
    echo "*** µMatrix.chromium: Creating package..."
    pushd $(dirname $DES/)
    zip uMatrix.chromium.zip -qr $(basename $DES/)/*
    popd
fi

echo "*** µMatrix(Chromium): Package done."
