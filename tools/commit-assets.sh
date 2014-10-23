#!/bin/bash
#
# This script assumes a linux environment

echo "*** µMatrix: git adding changed assets..."
git add --update --ignore-removal --ignore-errors assets
echo "*** µMatrix: git committing assets..."
git commit -m 'update of third-party assets'
echo "*** µMatrix: git pushing assets to remote master..."
git push origin master

echo "*** µMatrix: git done."

