/*******************************************************************************

    uMatrix - a browser extension to black/white list requests.
    Copyright (C) 2013-2018 Raymond Hill

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

/******************************************************************************/

var µm = µMatrix;

/******************************************************************************/

var BlockedCollapsibles = function() {
    this.boundPruneAsyncCallback = this.pruneAsyncCallback.bind(this);
    this.blocked = new Map();
    this.hash = 0;
    this.timer = null;
    this.tOrigin = Date.now();
};

BlockedCollapsibles.prototype = {

    shelfLife: 10 * 1000,

    add: function(type, url, isSpecific) {
        if ( this.blocked.size === 0 ) { this.pruneAsync(); }
        let tStamp = Date.now() - this.tOrigin;
        // The following "trick" is to encode the specifity into the lsb of the
        // time stamp so as to avoid to have to allocate a memory structure to
        // store both time stamp and specificity.
        if ( isSpecific ) {
            tStamp |= 0x00000001;
        } else {
            tStamp &= 0xFFFFFFFE;
        }
        this.blocked.set(type + ' ' + url, tStamp);
        this.hash += 1;
    },

    reset: function() {
        this.blocked.clear();
        this.hash = 0;
        if ( this.timer !== null ) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.tOrigin = Date.now();
    },

    pruneAsync: function() {
        if ( this.timer === null ) {
            this.timer = vAPI.setTimeout(
                this.boundPruneAsyncCallback,
                this.shelfLife * 2
            );
        }
    },

    pruneAsyncCallback: function() {
        this.timer = null;
        let tObsolete = Date.now() - this.tOrigin - this.shelfLife;
        for ( let entry of this.blocked ) {
            if ( entry[1] <= tObsolete ) {
                this.blocked.delete(entry[0]);
            }
        }
        if ( this.blocked.size !== 0 ) {
            this.pruneAsync();
        } else {
            this.tOrigin = Date.now();
        }
    }
};

/******************************************************************************/

// Ref: Given a URL, returns a (somewhat) unique 32-bit value
// Based on: FNV32a
// http://www.isthe.com/chongo/tech/comp/fnv/index.html#FNV-reference-source
// The rest is custom, suited for uMatrix.

var PageStore = function(tabContext) {
    this.hostnameTypeCells = new Map();
    this.domains = new Set();
    this.blockedCollapsibles = new BlockedCollapsibles();
    this.requestStats = µm.requestStatsFactory();
    this.off = false;
    this.init(tabContext);
};

PageStore.prototype = {

    collapsibleTypes: new Set([ 'image' ]),
    pageStoreJunkyard: [],

    init: function(tabContext) {
        this.tabId = tabContext.tabId;
        this.rawURL = tabContext.rawURL;
        this.pageUrl = tabContext.normalURL;
        this.pageHostname = tabContext.rootHostname;
        this.pageDomain =  tabContext.rootDomain;
        this.title = '';
        this.hostnameTypeCells.clear();
        this.domains.clear();
        this.allHostnamesString = ' ';
        this.blockedCollapsibles.reset();
        this.requestStats.reset();
        this.distinctRequestCount = 0;
        this.perLoadAllowedRequestCount = 0;
        this.perLoadBlockedRequestCount = 0;
        this.perLoadBlockedReferrerCount = 0;
        this.has3pReferrer = false;
        this.hasMixedContent = false;
        this.hasNoscriptTags = false;
        this.hasWebWorkers = false;
        this.incinerationTimer = null;
        this.mtxContentModifiedTime = 0;
        this.mtxCountModifiedTime = 0;
        return this;
    },

    dispose: function() {
        this.tabId = '';
        this.rawURL = '';
        this.pageUrl = '';
        this.pageHostname = '';
        this.pageDomain = '';
        this.title = '';
        this.hostnameTypeCells.clear();
        this.domains.clear();
        this.allHostnamesString = ' ';
        this.blockedCollapsibles.reset();
        if ( this.incinerationTimer !== null ) {
            clearTimeout(this.incinerationTimer);
            this.incinerationTimer = null;
        }
        if ( this.pageStoreJunkyard.length < 8 ) {
            this.pageStoreJunkyard.push(this);
        }
    },

    cacheBlockedCollapsible: function(type, url, specificity) {
        if ( this.collapsibleTypes.has(type) ) {
            this.blockedCollapsibles.add(
                type,
                url,
                specificity !== 0 && specificity < 5
            );
        }
    },

    lookupBlockedCollapsibles: function(request, response) {
        var tabContext = µm.tabContextManager.lookup(this.tabId);
        if ( tabContext === null ) { return; }

        if (
            Array.isArray(request.toFilter) &&
            request.toFilter.length !== 0
        ) {
            let roothn = tabContext.rootHostname,
                hnFromURI = µm.URI.hostnameFromURI,
                tMatrix = µm.tMatrix;
            for ( let entry of request.toFilter ) {
                if ( tMatrix.mustBlock(roothn, hnFromURI(entry.url), entry.type) ) {
                    this.blockedCollapsibles.add(
                        entry.type,
                        entry.url,
                        tMatrix.specificityRegister < 5
                    );
                }
            }
        }

        if ( this.blockedCollapsibles.hash === response.hash ) { return; }
        response.hash = this.blockedCollapsibles.hash;

        let collapseBlacklisted = µm.userSettings.collapseBlacklisted,
            collapseBlocked = µm.userSettings.collapseBlocked,
            blockedResources = response.blockedResources;

        for ( let entry of this.blockedCollapsibles.blocked ) {
            blockedResources.push([
                entry[0],
                collapseBlocked || collapseBlacklisted && (entry[1] & 1) !== 0
            ]);
        }
    },

    recordRequest: function(type, url, block) {
        if ( block ) {
            this.perLoadBlockedRequestCount++;
        } else {
            this.perLoadAllowedRequestCount++;
        }

        // Store distinct network requests. This is used to:
        // - remember which hostname/type were seen
        // - count the number of distinct URLs for any given
        //   hostname-type pair
        var hostname = µm.URI.hostnameFromURI(url),
            key = hostname + ' ' + type,
            uids = this.hostnameTypeCells.get(key);
        if ( uids === undefined ) {
            this.hostnameTypeCells.set(key, (uids = new Set()));
        } else if ( uids.size > 99 ) {
            return;
        }
        var uid = this.uidFromURL(url);
        if ( uids.has(uid) ) { return; }
        uids.add(uid);

        // Count blocked/allowed requests
        this.requestStats.record(type, block);

        // https://github.com/gorhill/httpswitchboard/issues/306
        // If it is recorded locally, record globally
        µm.requestStats.record(type, block);
        µm.updateBadgeAsync(this.tabId);

        this.distinctRequestCount++;
        this.mtxCountModifiedTime = Date.now();

        if ( this.domains.has(hostname) === false ) {
            this.domains.add(hostname);
            this.allHostnamesString += hostname + ' ';
            this.mtxContentModifiedTime = Date.now();
        }
    },

    uidFromURL: function(uri) {
        var hint = 0x811c9dc5,
            i = uri.length;
        while ( i-- ) {
            hint ^= uri.charCodeAt(i) | 0;
            hint += (hint<<1) + (hint<<4) + (hint<<7) + (hint<<8) + (hint<<24) | 0;
            hint >>>= 0;
        }
        return hint;
    }
};

/******************************************************************************/

return function pageStoreFactory(tabContext) {
    var entry = PageStore.prototype.pageStoreJunkyard.pop();
    if ( entry ) {
        return entry.init(tabContext);
    }
    return new PageStore(tabContext);
};

/******************************************************************************/

})();

/******************************************************************************/
