#!/bin/bash
#
# This script assumes a linux environment

TEMPFILE=/tmp/umatrix-asset

echo "*** uMatrix: updating remote assets..."

THIRDPARTY_REMOTEURLS=(
    'http://mirror1.malwaredomains.com/files/justdomains'
    'http://pgl.yoyo.org/adservers/serverlist.php?hostformat=hosts&showintro=1&startdate%5Bday%5D=&startdate%5Bmonth%5D=&startdate%5Byear%5D=&mimetype=plaintext'
    'http://www.malwaredomainlist.com/hostslist/hosts.txt'
    'http://hosts-file.net/.%5Cad_servers.txt'
    'http://someonewhocares.org/hosts/hosts'
    'http://winhelp2002.mvps.org/hosts.txt'
    'http://publicsuffix.org/list/effective_tld_names.dat'
    )

THIRDPARTY_LOCALURLS=(
    'assets/thirdparties/mirror1.malwaredomains.com/files/justdomains'
    'assets/thirdparties/pgl.yoyo.org/as/serverlist'
    'assets/thirdparties/www.malwaredomainlist.com/hostslist/hosts.txt'
    'assets/thirdparties/hosts-file.net/ad-servers'
    'assets/thirdparties/someonewhocares.org/hosts/hosts'
    'assets/thirdparties/winhelp2002.mvps.org/hosts.txt'
    'assets/thirdparties/publicsuffix.org/list/effective_tld_names.dat'
    )

ENTRY_INDEX=0
for THIRDPARTY_REMOTEURL in ${THIRDPARTY_REMOTEURLS[@]}; do
    THIRDPARTY_LOCALURL=${THIRDPARTY_LOCALURLS[ENTRY_INDEX]}
    echo "*** Downloading" $THIRDPARTY_REMOTEURL
    if wget -q -T 30 -O $TEMPFILE -- $THIRDPARTY_REMOTEURL; then
        if [ -s $TEMPFILE ]; then
            if ! cmp -s $TEMPFILE $THIRDPARTY_LOCALURL; then
                echo "    New version found: $THIRDPARTY_LOCALURL"
                if [ "$1" != "dry" ]; then
                    mv $TEMPFILE $THIRDPARTY_LOCALURL
                fi
            fi
        fi
    fi
    let ENTRY_INDEX+=1
done

