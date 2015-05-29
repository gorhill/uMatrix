#!/bin/bash
#
# This script assumes a linux environment

echo "*** uMatrix: generating checksums.txt file..."
truncate -s 0 assets/checksums.txt
LIST="$(find assets/umatrix assets/thirdparties -type f)"
for ENTRY in $LIST; do
    echo `md5sum $ENTRY` >> assets/checksums.txt
done

echo "*** uMatrix: checksums updated."

