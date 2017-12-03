/*******************************************************************************

    uMatrix - a Chromium browser extension to black/white list requests.
    Copyright (C) 2013-2017 Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uMatrix
*/

'use strict';

/******************************************************************************/

µMatrix.pageStoreFactory = (function() {

    var µm = µMatrix;
    var pageStoreJunkyard = [];

    // Ref: Given a URL, returns a (somewhat) unique 32-bit value
    // Based on: FNV32a
    // http://www.isthe.com/chongo/tech/comp/fnv/index.html#FNV-reference-source
    // The rest is custom, suited for µMatrix.
    var uidFromURL = function(uri) {
        var hint = 0x811c9dc5;
        var i = uri.length;
        while ( i-- ) {
            hint ^= uri.charCodeAt(i) | 0;
            hint += (hint<<1) + (hint<<4) + (hint<<7) + (hint<<8) + (hint<<24) | 0;
            hint >>>= 0;
        }
        return hint;
    };

    function PageStore(tabContext) {
        this.requestStats = µm.requestStatsFactory();
        this.off = false;
        this.init(tabContext);
    }

    PageStore.prototype = {
        init: function(tabContext) {
            this.tabId = tabContext.tabId;
            this.rawUrl = tabContext.rawURL;
            this.pageUrl = tabContext.normalURL;
            this.pageHostname = tabContext.rootHostname;
            this.pageDomain =  tabContext.rootDomain;
            this.title = '';
            this.hostnameTypeCells = new Map();
            this.domains = new Set();
            this.allHostnamesString = ' ';
            this.requestStats.reset();
            this.distinctRequestCount = 0;
            this.perLoadAllowedRequestCount = 0;
            this.perLoadBlockedRequestCount = 0;
            this.incinerationTimer = null;
            this.mtxContentModifiedTime = 0;
            this.mtxCountModifiedTime = 0;
            return this;
        },
        dispose: function() {
            this.hostnameTypeCells.clear();
            this.rawUrl = '';
            this.pageUrl = '';
            this.pageHostname = '';
            this.pageDomain = '';
            this.title = '';
            this.domains.clear();
            this.allHostnamesString = ' ';
            if ( this.incinerationTimer !== null ) {
                clearTimeout(this.incinerationTimer);
                this.incinerationTimer = null;
            }
            if ( pageStoreJunkyard.length < 8 ) {
                pageStoreJunkyard.push(this);
            }
        },
        recordRequest: function(type, url, block) {
            var hostname = µm.URI.hostnameFromURI(url);

            // Store distinct network requests. This is used to:
            // - remember which hostname/type were seen
            // - count the number of distinct URLs for any given
            //   hostname-type pair
            var key = hostname + ' ' + type,
                uids = this.hostnameTypeCells.get(key);
            if ( uids === undefined ) {
                this.hostnameTypeCells.set(key, (uids = new Set()));
            } else if ( uids.size > 99 ) {
                return;
            }
            var uid = uidFromURL(url);
            if ( uids.has(uid) ) { return; }
            uids.add(uid);

            // Count blocked/allowed requests
            this.requestStats.record(type, block);

            // https://github.com/gorhill/httpswitchboard/issues/306
            // If it is recorded locally, record globally
            µm.requestStats.record(type, block);
            µm.updateBadgeAsync(this.tabId);

            if ( block !== false ) {
                this.perLoadBlockedRequestCount++;
            } else {
                this.perLoadAllowedRequestCount++;
            }

            this.distinctRequestCount++;
            this.mtxCountModifiedTime = Date.now();

            if ( this.domains.has(hostname) === false ) {
                this.domains.add(hostname);
                this.allHostnamesString += hostname + ' ';
                this.mtxContentModifiedTime = Date.now();
            }
        }
    };

    return function pageStoreFactory(tabContext) {
        var entry = pageStoreJunkyard.pop();
        if ( entry ) {
            return entry.init(tabContext);
        }
        return new PageStore(tabContext);
    };
})();

/******************************************************************************/
