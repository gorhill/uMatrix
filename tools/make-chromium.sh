#!/bin/bash
#
# This script assumes a linux environment

echo "*** uMatrix(Chromium): Creating package"
echo "*** uMatrix(Chromium): Copying files"

DES=./dist/build/uMatrix.chromium
rm -rf $DES
mkdir -p $DES

bash ./tools/make-assets.sh $DES

cp -R ./src/*                           $DES/
cp -R $DES/_locales/nb                  $DES/_locales/no # Chrome store quirk
cp    ./platform/chromium/*.js          $DES/js/
cp -R ./platform/chromium/img/*         $DES/img/
cp    ./platform/chromium/manifest.json $DES/
cp    LICENSE.txt                       $DES/

echo "*** uMatrix.chromium: Generating meta..."
python tools/make-chromium-meta.py $DES/

if [ "$1" = all ]; then
    echo "*** uMatrix.chromium: Creating package..."
    pushd $(dirname $DES/)
    zip uMatrix.chromium.zip -qr $(basename $DES/)/*
    popd
fi

echo "*** uMatrix(Chromium): Package done."
