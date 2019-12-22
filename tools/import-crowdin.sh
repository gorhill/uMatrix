#!/bin/bash
#
# This script assumes a linux environment

DLDIR=~/Downloads
ARCDIR=$DLDIR/crowdin

echo "*** uMatrix: Importing from Crowdin archive"
rm -r $ARCDIR
unzip -q $DLDIR/uMatrix.zip -d $ARCDIR

# Add-on strings
LOCALEDIR=src/_locales
SRCDIR=$ARCDIR/$LOCALEDIR
DESDIR=./$LOCALEDIR
cp $SRCDIR/am_ET/messages.json  $DESDIR/am/messages.json
cp $SRCDIR/ar_SA/messages.json  $DESDIR/ar/messages.json
cp $SRCDIR/bg_BG/messages.json  $DESDIR/bg/messages.json
cp $SRCDIR/bn_BD/messages.json  $DESDIR/bn/messages.json
cp $SRCDIR/ca_ES/messages.json  $DESDIR/ca/messages.json
cp $SRCDIR/cs_CZ/messages.json  $DESDIR/cs/messages.json
cp $SRCDIR/da_DK/messages.json  $DESDIR/da/messages.json
cp $SRCDIR/de_DE/messages.json  $DESDIR/de/messages.json
cp $SRCDIR/el_GR/messages.json  $DESDIR/el/messages.json
cp $SRCDIR/eo_UY/messages.json  $DESDIR/eo/messages.json
cp $SRCDIR/es_ES/messages.json  $DESDIR/es/messages.json
cp $SRCDIR/et_EE/messages.json  $DESDIR/et/messages.json
cp $SRCDIR/fa_IR/messages.json  $DESDIR/fa/messages.json
cp $SRCDIR/fi_FI/messages.json  $DESDIR/fi/messages.json
cp $SRCDIR/fil_PH/messages.json $DESDIR/fil/messages.json
cp $SRCDIR/fr_FR/messages.json  $DESDIR/fr/messages.json
cp $SRCDIR/gu_IN/messages.json  $DESDIR/gu/messages.json
cp $SRCDIR/he_IL/messages.json  $DESDIR/he/messages.json
cp $SRCDIR/hi_IN/messages.json  $DESDIR/hi/messages.json
cp $SRCDIR/hr_HR/messages.json  $DESDIR/hr/messages.json
cp $SRCDIR/hu_HU/messages.json  $DESDIR/hu/messages.json
cp $SRCDIR/id_ID/messages.json  $DESDIR/id/messages.json
cp $SRCDIR/it_IT/messages.json  $DESDIR/it/messages.json
cp $SRCDIR/ja_JP/messages.json  $DESDIR/ja/messages.json
cp $SRCDIR/kn_IN/messages.json  $DESDIR/kn/messages.json
cp $SRCDIR/ko_KR/messages.json  $DESDIR/ko/messages.json
cp $SRCDIR/lt_LT/messages.json  $DESDIR/lt/messages.json
cp $SRCDIR/lv_LV/messages.json  $DESDIR/lv/messages.json
cp $SRCDIR/ml_IN/messages.json  $DESDIR/ml/messages.json
cp $SRCDIR/mr_IN/messages.json  $DESDIR/mr/messages.json
cp $SRCDIR/ms_MY/messages.json  $DESDIR/ms/messages.json
cp $SRCDIR/nl_NL/messages.json  $DESDIR/nl/messages.json
cp $SRCDIR/no_NO/messages.json  $DESDIR/nb/messages.json
cp $SRCDIR/pl_PL/messages.json  $DESDIR/pl/messages.json
cp $SRCDIR/pt_BR/messages.json  $DESDIR/pt_BR/messages.json
cp $SRCDIR/pt_PT/messages.json  $DESDIR/pt_PT/messages.json
cp $SRCDIR/ro_RO/messages.json  $DESDIR/ro/messages.json
cp $SRCDIR/ru_RU/messages.json  $DESDIR/ru/messages.json
cp $SRCDIR/sk_SK/messages.json  $DESDIR/sk/messages.json
cp $SRCDIR/sl_SI/messages.json  $DESDIR/sl/messages.json
cp $SRCDIR/sr_SP/messages.json  $DESDIR/sr/messages.json
cp $SRCDIR/sv_SE/messages.json  $DESDIR/sv/messages.json
cp $SRCDIR/sw_KE/messages.json  $DESDIR/sw/messages.json
cp $SRCDIR/ta_IN/messages.json  $DESDIR/ta/messages.json
cp $SRCDIR/te_IN/messages.json  $DESDIR/te/messages.json
cp $SRCDIR/th_TH/messages.json  $DESDIR/th/messages.json
cp $SRCDIR/tr_TR/messages.json  $DESDIR/tr/messages.json
cp $SRCDIR/uk_UA/messages.json  $DESDIR/uk/messages.json
cp $SRCDIR/vi_VN/messages.json  $DESDIR/vi/messages.json
cp $SRCDIR/zh_CN/messages.json  $DESDIR/zh_CN/messages.json
cp $SRCDIR/zh_TW/messages.json  $DESDIR/zh_TW/messages.json

rm -r $ARCDIR
echo "*** uMatrix: Import done."

git status
