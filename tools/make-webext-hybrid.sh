#!/usr/bin/env bash
#
# This script assumes a linux environment

echo "*** uMatrix.webext-hybrid: Creating web store package"
echo "*** uMatrix.webext-hybrid: Copying files"

DES=dist/build/uMatrix.webext-hybrid
rm -rf $DES
mkdir -p $DES/webextension

cp -R ./assets                             $DES/webextension/
cp -R ./src/*                              $DES/webextension/
cp    platform/chromium/*.html             $DES/webextension/
cp    platform/chromium/*.js               $DES/webextension/js/
cp -R platform/chromium/img/*              $DES/webextension/img/
cp    LICENSE.txt                          $DES/webextension/

cp    platform/webext/background.html      $DES/webextension/
cp    platform/webext/polyfill.js          $DES/webextension/js/
cp    platform/webext/vapi-cachestorage.js $DES/webextension/js/
cp    platform/webext/from-legacy.js       $DES/webextension/js/
cp    platform/webext/manifest.json        $DES/webextension/
cp    platform/webext/bootstrap.js         $DES/
cp    platform/webext/chrome.manifest      $DES/
cp    platform/webext/install.rdf          $DES/
mv    $DES/webextension/img/icon_128.png   $DES/icon.png

echo "*** uMatrix.webext-hybrid: Generating meta..."
python tools/make-webext-hybrid-meta.py $DES/

if [ "$1" = all ]; then
    echo "*** uMatrix.webext-hybrid: Creating package..."
    pushd $DES > /dev/null
    zip ../$(basename $DES).xpi -qr *
    popd > /dev/null
fi

echo "*** uMatrix.webext-hybrid: Package done."
