#!/bin/bash
#
# This script assumes a linux environment

echo "*** uMatrix: git adding changed assets..."
git add --update --ignore-removal --ignore-errors assets
echo "*** uMatrix: git committing assets..."
git commit -m 'update of third-party assets'
echo "*** uMatrix: git pushing assets to remote master..."
git push origin master

echo "*** uMatrix: git done."

