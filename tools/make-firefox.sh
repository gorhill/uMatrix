#!/usr/bin/env bash
#
# This script assumes a linux environment

echo "*** uMatrix.firefox: Creating web store package"
echo "*** uMatrix.firefox: Copying files"

DES=dist/build/uMatrix.firefox
rm -rf $DES
mkdir -p $DES

bash ./tools/make-assets.sh $DES

cp -R ./src/*                               $DES/
cp    platform/chromium/*.html              $DES/
cp    platform/chromium/*.js                $DES/js/
cp -R platform/chromium/img/*               $DES/img/
cp    LICENSE.txt                           $DES/

cp    platform/firefox/polyfill.js          $DES/js/
cp    platform/firefox/vapi-cachestorage.js $DES/js/
cp    platform/firefox/manifest.json        $DES/

echo "*** uMatrix.firefox: Generating meta..."
python tools/make-firefox-meta.py           $DES/

if [ "$1" = all ]; then
    echo "*** uMatrix.firefox: Creating package..."
    pushd $DES > /dev/null
    zip ../$(basename $DES).xpi -qr *
    popd > /dev/null
fi

echo "*** uMatrix.firefox: Package done."
