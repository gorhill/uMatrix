#!/usr/bin/env bash
#
# This script assumes a linux environment

DES=$1/assets

printf "*** Packaging assets in $DES... "

rm -rf $DES
mkdir $DES

cp ./assets/assets.json $DES/

if [ -n "${TRAVIS_TAG}" ]; then
  pushd .. > /dev/null
  git clone --depth 1 https://github.com/uBlockOrigin/uAssets.git
  popd > /dev/null
fi

mkdir $DES/thirdparties
cp -R ../uAssets/thirdparties/hosts-file.net             $DES/thirdparties/
cp -R ../uAssets/thirdparties/mirror1.malwaredomains.com $DES/thirdparties/
cp -R ../uAssets/thirdparties/pgl.yoyo.org               $DES/thirdparties/
cp -R ../uAssets/thirdparties/publicsuffix.org           $DES/thirdparties/
cp -R ../uAssets/thirdparties/someonewhocares.org        $DES/thirdparties/
cp -R ../uAssets/thirdparties/winhelp2002.mvps.org       $DES/thirdparties/
cp -R ../uAssets/thirdparties/www.malwaredomainlist.com  $DES/thirdparties/
mkdir $DES/umatrix
cp -R ../uAssets/recipes/*                               $DES/umatrix/

echo "done."
