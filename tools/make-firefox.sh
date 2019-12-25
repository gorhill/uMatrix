#!/usr/bin/env bash
#
# This script assumes a linux environment

echo "*** uMatrix.firefox: Creating web store package"
echo "*** uMatrix.firefox: Copying files"

BLDIR=dist/build
DES="$BLDIR"/uMatrix.firefox
rm -rf $DES
mkdir -p $DES

bash ./tools/make-assets.sh $DES

cp -R ./src/*                               $DES/
cp    platform/chromium/*.js                $DES/js/
cp -R platform/chromium/img/*               $DES/img/
cp    LICENSE.txt                           $DES/

cp    platform/firefox/*.js                 $DES/js/
cp    platform/firefox/manifest.json        $DES/

echo "*** uMatrix.firefox: Generating meta..."
python tools/make-firefox-meta.py           $DES/

if [ "$1" = all ]; then
    echo "*** uMatrix.firefox: Creating package..."
    pushd $DES > /dev/null
    zip ../$(basename $DES).xpi -qr *
    popd > /dev/null
elif [ -n "$1" ]; then
    echo "*** uMatrix.firefox: Creating versioned package..."
    pushd $DES > /dev/null
    zip ../$(basename $DES).xpi -qr *
    popd > /dev/null
    mv "$BLDIR"/uMatrix.firefox.xpi "$BLDIR"/uMatrix_"$1".firefox.xpi
fi

echo "*** uMatrix.firefox: Package done."
