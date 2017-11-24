#!/usr/bin/env bash
#
# This script assumes a linux environment

echo "*** uMatrix.webext: Creating web store package"
echo "*** uMatrix.webext: Copying files"

DES=dist/build/uMatrix.webext
rm -rf $DES
mkdir -p $DES

cp -R ./assets                             $DES/
cp -R ./src/*                              $DES/
cp    platform/chromium/*.html             $DES/
cp    platform/chromium/*.js               $DES/js/
cp -R platform/chromium/img/*              $DES/img/
cp    LICENSE.txt                          $DES/

cp    platform/webext/polyfill.js          $DES/js/
cp    platform/webext/vapi-cachestorage.js $DES/js/
cp    platform/webext/manifest.json        $DES/

# webext-specific
rm $DES/options_ui.html
rm $DES/js/options_ui.js

echo "*** uMatrix.webext: Generating meta..."
python tools/make-webext-meta.py           $DES/

if [ "$1" = all ]; then
    echo "*** uMatrix.webext: Creating package..."
    pushd $DES > /dev/null
    zip ../$(basename $DES).xpi -qr *
    popd > /dev/null
fi

echo "*** uMatrix.webext: Package done."
