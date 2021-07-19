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
  git checkout 84dc2761abb4193bb34290aa6d90266610f735f6
  popd > /dev/null
fi

mkdir $DES/thirdparties
pushd ../uAssets
git checkout 84dc2761abb4193bb34290aa6d90266610f735f6
popd
cp -R ../uAssets/thirdparties/mirror1.malwaredomains.com $DES/thirdparties/
cp -R ../uAssets/thirdparties/pgl.yoyo.org               $DES/thirdparties/
cp -R ../uAssets/thirdparties/publicsuffix.org           $DES/thirdparties/
cp -R ../uAssets/thirdparties/someonewhocares.org        $DES/thirdparties/
cp -R ../uAssets/thirdparties/winhelp2002.mvps.org       $DES/thirdparties/
cp -R ../uAssets/thirdparties/www.malwaredomainlist.com  $DES/thirdparties/
mkdir $DES/umatrix
cp -R ../uAssets/recipes/*                               $DES/umatrix/
pushd ../uAssets
git checkout master
popd

echo "done."
