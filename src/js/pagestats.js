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

µMatrix.pageStoreFactory = (( ) => {

/******************************************************************************/

const µm = µMatrix;

/******************************************************************************/

const BlockedCollapsibles = class {
    constructor() {
        this.boundPruneAsyncCallback = this.pruneAsyncCallback.bind(this);
        this.blocked = new Map();
        this.hash = 0;
        this.timer = null;
        this.tOrigin = Date.now();
    }

    add(type, url, isSpecific) {
        if ( this.blocked.size === 0 ) { this.pruneAsync(); }
        let tStamp = Date.now() - this.tOrigin;
        // The following "trick" is to encode the specifity into the lsb of the
        // time stamp so as to avoid to have to allocate a memory structure to
        // store both time stamp and specificity.
        if ( isSpecific ) {
            tStamp |= 1;
        } else {
            tStamp &= ~1;
        }
        this.blocked.set(type + ' ' + url, tStamp);
        this.hash += 1;
    }

    reset() {
        this.blocked.clear();
        this.hash = 0;
        if ( this.timer !== null ) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.tOrigin = Date.now();
    }

    pruneAsync() {
        if ( this.timer === null ) {
            this.timer = vAPI.setTimeout(
                this.boundPruneAsyncCallback,
                this.shelfLife * 2
            );
        }
    }

    pruneAsyncCallback() {
        this.timer = null;
        const tObsolete = Date.now() - this.tOrigin - this.shelfLife;
        for ( const [ key, tStamp ] of this.blocked ) {
            if ( tStamp <= tObsolete ) {
                this.blocked.delete(key);
            }
        }
        if ( this.blocked.size !== 0 ) {
            this.pruneAsync();
        } else {
            this.tOrigin = Date.now();
        }
    }
};

BlockedCollapsibles.prototype.shelfLife = 10 * 1000;

/******************************************************************************/

// Ref: Given a URL, returns a (somewhat) unique 32-bit value
// Based on: FNV32a
// http://www.isthe.com/chongo/tech/comp/fnv/index.html#FNV-reference-source
// The rest is custom, suited for uMatrix.

const PageStore = class {
    constructor(tabContext) {
        this.hostnameTypeCells = new Map();
        this.domains = new Set();
        this.blockedCollapsibles = new BlockedCollapsibles();
        this.init(tabContext);
    }

    init(tabContext) {
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
        this.perLoadAllowedRequestCount = 0;
        this.perLoadBlockedRequestCount = 0;
        this.perLoadBlockedReferrerCount = 0;
        this.has3pReferrer = false;
        this.hasMixedContent = false;
        this.hasNoscriptTags = false;
        this.hasWebWorkers = false;
        this.hasHostnameAliases = false;
        this.incinerationTimer = null;
        this.mtxContentModifiedTime = 0;
        this.mtxCountModifiedTime = 0;
        return this;
    }

    dispose() {
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
    }

    cacheBlockedCollapsible(type, url, specificity) {
        if ( this.collapsibleTypes.has(type) ) {
            this.blockedCollapsibles.add(
                type,
                url,
                specificity !== 0 && specificity < 5
            );
        }
    }

    lookupBlockedCollapsibles(request, response) {
        const tabContext = µm.tabContextManager.lookup(this.tabId);
        if ( tabContext === null ) { return; }

        if (
            Array.isArray(request.toFilter) &&
            request.toFilter.length !== 0
        ) {
            const roothn = tabContext.rootHostname;
            const hnFromURI = vAPI.hostnameFromURI;
            const tMatrix = µm.tMatrix;
            for ( const entry of request.toFilter ) {
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

        const collapseBlacklisted = µm.userSettings.collapseBlacklisted;
        const collapseBlocked = µm.userSettings.collapseBlocked;
        const blockedResources = response.blockedResources;

        for ( const entry of this.blockedCollapsibles.blocked ) {
            blockedResources.push([
                entry[0],
                collapseBlocked || collapseBlacklisted && (entry[1] & 1) !== 0
            ]);
        }
    }

    recordRequest(type, url, block) {
        if ( this.tabId <= 0 ) { return; }

        if ( block ) {
            this.perLoadBlockedRequestCount++;
        } else {
            this.perLoadAllowedRequestCount++;
        }

        // Store distinct network requests. This is used to:
        // - remember which hostname/type were seen
        // - count the number of distinct URLs for any given
        //   hostname-type pair
        const hostname = vAPI.hostnameFromURI(url);
        const key = hostname + ' ' + type;
        let uids = this.hostnameTypeCells.get(key);
        if ( uids === undefined ) {
            this.hostnameTypeCells.set(key, (uids = new Set()));
        } else if ( uids.size > 99 ) {
            return;
        }
        const uid = this.uidFromURL(url);
        if ( uids.has(uid) ) { return; }
        uids.add(uid);

        µm.updateToolbarIcon(this.tabId);

        this.mtxCountModifiedTime = Date.now();

        if ( this.domains.has(hostname) === false ) {
            this.domains.add(hostname);
            this.allHostnamesString += hostname + ' ';
            this.mtxContentModifiedTime = Date.now();
        }
    }

    uidFromURL(uri) {
        let hint = 0x811c9dc5;
        let i = uri.length;
        while ( i-- ) {
            hint ^= uri.charCodeAt(i);
            hint += (hint<<1) + (hint<<4) + (hint<<7) + (hint<<8) + (hint<<24);
            hint >>>= 0;
        }
        return hint;
    }
};

PageStore.prototype.collapsibleTypes = new Set([ 'image' ]);
PageStore.prototype.pageStoreJunkyard = [];

/******************************************************************************/

return function pageStoreFactory(tabContext) {
    const entry = PageStore.prototype.pageStoreJunkyard.pop();
    if ( entry ) {
        return entry.init(tabContext);
    }
    return new PageStore(tabContext);
};

/******************************************************************************/

})();

/******************************************************************************/
