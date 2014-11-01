#!/bin/bash
#
# This script assumes a linux environment

echo "*** uMatrix: Importing from Crowdin archive"
rm -r ~/Downloads/crowdin
unzip -q ~/Downloads/umatrix.zip -d ~/Downloads/crowdin
cp ~/Downloads/crowdin/am/messages.json    ./tools/_locales/am/messages.json
cp ~/Downloads/crowdin/ar/messages.json    ./tools/_locales/ar/messages.json
cp ~/Downloads/crowdin/bg/messages.json    ./tools/_locales/bg/messages.json
cp ~/Downloads/crowdin/bn/messages.json    ./tools/_locales/bn/messages.json
cp ~/Downloads/crowdin/ca/messages.json    ./tools/_locales/ca/messages.json
cp ~/Downloads/crowdin/cs/messages.json    ./tools/_locales/cs/messages.json
cp ~/Downloads/crowdin/da/messages.json    ./tools/_locales/da/messages.json
cp ~/Downloads/crowdin/de/messages.json    ./tools/_locales/de/messages.json
cp ~/Downloads/crowdin/el/messages.json    ./tools/_locales/el/messages.json
cp ~/Downloads/crowdin/en-GB/messages.json ./tools/_locales/en_GB/messages.json
cp ~/Downloads/crowdin/es-ES/messages.json ./tools/_locales/es/messages.json
cp ~/Downloads/crowdin/et/messages.json    ./tools/_locales/et/messages.json
cp ~/Downloads/crowdin/fa/messages.json    ./tools/_locales/fa/messages.json
cp ~/Downloads/crowdin/fi/messages.json    ./tools/_locales/fi/messages.json
cp ~/Downloads/crowdin/fil/messages.json   ./tools/_locales/fil/messages.json
cp ~/Downloads/crowdin/fr/messages.json    ./tools/_locales/fr/messages.json
cp ~/Downloads/crowdin/gu-IN/messages.json ./tools/_locales/gu/messages.json
cp ~/Downloads/crowdin/he/messages.json    ./tools/_locales/he/messages.json
cp ~/Downloads/crowdin/hi/messages.json    ./tools/_locales/hi/messages.json
cp ~/Downloads/crowdin/hr/messages.json    ./tools/_locales/hr/messages.json
cp ~/Downloads/crowdin/hu/messages.json    ./tools/_locales/hu/messages.json
cp ~/Downloads/crowdin/id/messages.json    ./tools/_locales/id/messages.json
cp ~/Downloads/crowdin/it/messages.json    ./tools/_locales/it/messages.json
cp ~/Downloads/crowdin/ja/messages.json    ./tools/_locales/ja/messages.json
cp ~/Downloads/crowdin/kn/messages.json    ./tools/_locales/kn/messages.json
cp ~/Downloads/crowdin/ko/messages.json    ./tools/_locales/ko/messages.json
cp ~/Downloads/crowdin/lt/messages.json    ./tools/_locales/lt/messages.json
cp ~/Downloads/crowdin/lv/messages.json    ./tools/_locales/lv/messages.json
cp ~/Downloads/crowdin/ml-IN/messages.json ./tools/_locales/ml/messages.json
cp ~/Downloads/crowdin/mr/messages.json    ./tools/_locales/mr/messages.json
cp ~/Downloads/crowdin/ms/messages.json    ./tools/_locales/ms/messages.json
cp ~/Downloads/crowdin/nl/messages.json    ./tools/_locales/nl/messages.json
cp ~/Downloads/crowdin/no/messages.json    ./tools/_locales/nb/messages.json
cp ~/Downloads/crowdin/pl/messages.json    ./tools/_locales/pl/messages.json
cp ~/Downloads/crowdin/pt-BR/messages.json ./tools/_locales/pt_BR/messages.json
cp ~/Downloads/crowdin/pt-PT/messages.json ./tools/_locales/pt_PT/messages.json
cp ~/Downloads/crowdin/ro/messages.json    ./tools/_locales/ro/messages.json
cp ~/Downloads/crowdin/ru/messages.json    ./tools/_locales/ru/messages.json
cp ~/Downloads/crowdin/sk/messages.json    ./tools/_locales/sk/messages.json
cp ~/Downloads/crowdin/sl/messages.json    ./tools/_locales/sl/messages.json
cp ~/Downloads/crowdin/sr-CS/messages.json ./tools/_locales/sr/messages.json
cp ~/Downloads/crowdin/sv-SE/messages.json ./tools/_locales/sv/messages.json
cp ~/Downloads/crowdin/sw/messages.json    ./tools/_locales/sw/messages.json
cp ~/Downloads/crowdin/ta/messages.json    ./tools/_locales/ta/messages.json
cp ~/Downloads/crowdin/te/messages.json    ./tools/_locales/te/messages.json
cp ~/Downloads/crowdin/th/messages.json    ./tools/_locales/th/messages.json
cp ~/Downloads/crowdin/tr/messages.json    ./tools/_locales/tr/messages.json
cp ~/Downloads/crowdin/uk/messages.json    ./tools/_locales/uk/messages.json
cp ~/Downloads/crowdin/vi/messages.json    ./tools/_locales/vi/messages.json
cp ~/Downloads/crowdin/zh-CN/messages.json ./tools/_locales/zh_CN/messages.json

rm -r ~/Downloads/crowdin
echo "*** uMatrix: Import done."
