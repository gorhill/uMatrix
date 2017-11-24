#!/bin/bash
#
# This script assumes a linux environment

echo "*** uMatrix.firefox: Copying files"

DES=dist/build/uMatrix.firefox
rm -rf $DES
mkdir -p $DES

cp -R assets                            $DES/


cp -R src/*                             $DES/





mv    $DES/img/icon_128.png             $DES/icon.png
cp    platform/firefox/css/*            $DES/css/
cp    platform/firefox/polyfill.js      $DES/js/
cp    platform/firefox/vapi-*.js        $DES/js/
cp    platform/firefox/bootstrap.js     $DES/
cp    platform/firefox/frame*.js        $DES/
cp -R platform/chromium/img             $DES/
cp    platform/firefox/chrome.manifest  $DES/
cp    platform/firefox/install.rdf      $DES/
cp    platform/firefox/*.xul            $DES/
cp    LICENSE.txt                       $DES/

echo "*** uMatrix.firefox: Generating meta..."
python tools/make-firefox-meta.py $DES/

if [ "$1" = all ]; then
    echo "*** uMatrix.firefox: Creating package..."
    pushd $DES/
    zip ../uMatrix.firefox.xpi -qr *
    popd
fi

echo "*** uMatrix.firefox: Package done."
