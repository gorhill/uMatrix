#!/bin/bash
#
# This script assumes a linux environment

echo "*** uMatrix(Opera): Creating package"
echo "*** uMatrix(Opera): Copying files"

DES=./dist/build/uMatrix.opera
rm -r $DES
mkdir -p $DES

cp -R ./assets                          $DES/
cp -R ./src/*                           $DES/
cp    ./platform/chromium/*.html        $DES/
cp    ./platform/chromium/*.js          $DES/js/
cp -R ./platform/chromium/img/*         $DES/img/
cp    ./platform/chromium/manifest.json $DES/
cp    LICENSE.txt                       $DES/

# Copy only locales with fully translated description
rm   -rf $DES/_locales
mkdir -p $DES/_locales
cp -R ./src/_locales/de    $DES/_locales/
cp -R ./src/_locales/en    $DES/_locales/
cp -R ./src/_locales/es    $DES/_locales/
cp -R ./src/_locales/fr    $DES/_locales/
cp -R ./src/_locales/he    $DES/_locales/
cp -R ./src/_locales/id    $DES/_locales/
cp -R ./src/_locales/it    $DES/_locales/
cp -R ./src/_locales/nl    $DES/_locales/
cp -R ./src/_locales/pt_BR $DES/_locales/
cp -R ./src/_locales/pt_PT $DES/_locales/
cp -R ./src/_locales/tr    $DES/_locales/
cp -R ./src/_locales/zh_TW $DES/_locales/
echo "*** uMatrix(Opera): Package done."
