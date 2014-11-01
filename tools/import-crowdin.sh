#!/bin/bash
#
# This script assumes a linux environment

DLDIR=~/Downloads
SRCDIR=$DLDIR/crowdin
DESDIR=./tools/_locales

echo "*** uMatrix: Importing from Crowdin archive"
rm -r $SRCDIR
unzip -q $DLDIR/umatrix.zip -d $SRCDIR
cp $SRCDIR/am/messages.json    $DESDIR/am/messages.json
cp $SRCDIR/ar/messages.json    $DESDIR/ar/messages.json
cp $SRCDIR/bg/messages.json    $DESDIR/bg/messages.json
cp $SRCDIR/bn/messages.json    $DESDIR/bn/messages.json
cp $SRCDIR/ca/messages.json    $DESDIR/ca/messages.json
cp $SRCDIR/cs/messages.json    $DESDIR/cs/messages.json
cp $SRCDIR/da/messages.json    $DESDIR/da/messages.json
cp $SRCDIR/de/messages.json    $DESDIR/de/messages.json
cp $SRCDIR/el/messages.json    $DESDIR/el/messages.json
cp $SRCDIR/en-GB/messages.json $DESDIR/en_GB/messages.json
cp $SRCDIR/es-ES/messages.json $DESDIR/es/messages.json
cp $SRCDIR/et/messages.json    $DESDIR/et/messages.json
cp $SRCDIR/fa/messages.json    $DESDIR/fa/messages.json
cp $SRCDIR/fi/messages.json    $DESDIR/fi/messages.json
cp $SRCDIR/fil/messages.json   $DESDIR/fil/messages.json
cp $SRCDIR/fr/messages.json    $DESDIR/fr/messages.json
cp $SRCDIR/gu-IN/messages.json $DESDIR/gu/messages.json
cp $SRCDIR/he/messages.json    $DESDIR/he/messages.json
cp $SRCDIR/hi/messages.json    $DESDIR/hi/messages.json
cp $SRCDIR/hr/messages.json    $DESDIR/hr/messages.json
cp $SRCDIR/hu/messages.json    $DESDIR/hu/messages.json
cp $SRCDIR/id/messages.json    $DESDIR/id/messages.json
cp $SRCDIR/it/messages.json    $DESDIR/it/messages.json
cp $SRCDIR/ja/messages.json    $DESDIR/ja/messages.json
cp $SRCDIR/kn/messages.json    $DESDIR/kn/messages.json
cp $SRCDIR/ko/messages.json    $DESDIR/ko/messages.json
cp $SRCDIR/lt/messages.json    $DESDIR/lt/messages.json
cp $SRCDIR/lv/messages.json    $DESDIR/lv/messages.json
cp $SRCDIR/ml-IN/messages.json $DESDIR/ml/messages.json
cp $SRCDIR/mr/messages.json    $DESDIR/mr/messages.json
cp $SRCDIR/ms/messages.json    $DESDIR/ms/messages.json
cp $SRCDIR/nl/messages.json    $DESDIR/nl/messages.json
cp $SRCDIR/no/messages.json    $DESDIR/nb/messages.json
cp $SRCDIR/pl/messages.json    $DESDIR/pl/messages.json
cp $SRCDIR/pt-BR/messages.json $DESDIR/pt_BR/messages.json
cp $SRCDIR/pt-PT/messages.json $DESDIR/pt_PT/messages.json
cp $SRCDIR/ro/messages.json    $DESDIR/ro/messages.json
cp $SRCDIR/ru/messages.json    $DESDIR/ru/messages.json
cp $SRCDIR/sk/messages.json    $DESDIR/sk/messages.json
cp $SRCDIR/sl/messages.json    $DESDIR/sl/messages.json
cp $SRCDIR/sr-CS/messages.json $DESDIR/sr/messages.json
cp $SRCDIR/sv-SE/messages.json $DESDIR/sv/messages.json
cp $SRCDIR/sw/messages.json    $DESDIR/sw/messages.json
cp $SRCDIR/ta/messages.json    $DESDIR/ta/messages.json
cp $SRCDIR/te/messages.json    $DESDIR/te/messages.json
cp $SRCDIR/th/messages.json    $DESDIR/th/messages.json
cp $SRCDIR/tr/messages.json    $DESDIR/tr/messages.json
cp $SRCDIR/uk/messages.json    $DESDIR/uk/messages.json
cp $SRCDIR/vi/messages.json    $DESDIR/vi/messages.json
cp $SRCDIR/zh-CN/messages.json $DESDIR/zh_CN/messages.json

rm -r $SRCDIR
echo "*** uMatrix: Import done."
