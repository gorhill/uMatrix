/*******************************************************************************

    uMatrix - a browser extension to black/white list requests.
    Copyright (C) 2014-2018 Raymond Hill

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
/******************************************************************************/

(( ) => {

/******************************************************************************/

const µm = µMatrix;

// https://github.com/gorhill/httpswitchboard/issues/303
// Some kind of trick going on here:
//   Any scheme other than 'http' and 'https' is remapped into a fake
//   URL which trick the rest of µMatrix into being able to process an
//   otherwise unmanageable scheme. µMatrix needs web page to have a proper
//   hostname to work properly, so just like the 'behind-the-scene'
//   fake domain name, we map unknown schemes into a fake '{scheme}-scheme'
//   hostname. This way, for a specific scheme you can create scope with
//   rules which will apply only to that scheme.

/******************************************************************************/
/******************************************************************************/

µm.normalizePageURL = function(tabId, pageURL) {
    if ( vAPI.isBehindTheSceneTabId(tabId) ) {
        return 'http://' + this.behindTheSceneScope + '/';
    }

    // https://github.com/gorhill/uMatrix/issues/992
    //   Firefox-specific quirk: some top documents are reported by Firefox API
    //   as loading from `wyciwyg://`, and this breaks uMatrix usability.
    //   Firefox should probably made such loading from cache seamless through
    //   its APIs, but since this is not the case, uMatrix inherits the duty to
    //   make it seamless on its side.
    if ( pageURL.startsWith('wyciwyg:') ) {
        const match = /^wyciwyg:\/\/\d+\//.exec(pageURL);
        if ( match !== null ) {
            pageURL = pageURL.slice(match[0].length);
        }
    }

    // If the URL is that of our "blocked page" document, return the URL of
    // the blocked page.
    if ( pageURL.startsWith(vAPI.getURL('main-blocked.html')) ) {
        const parsedURL = new URL(pageURL);
        const details = parsedURL.searchParams.get('details');
        if ( details ) {
            try {
                pageURL = JSON.parse(decodeURIComponent(details)).url;
            } catch (ex) {
            }
        }
    }

    const uri = this.URI.set(pageURL);
    const scheme = uri.scheme;
    if ( scheme === 'https' || scheme === 'http' ) {
        return uri.normalizedURI();
    }

    let fakeHostname = scheme + '-scheme';

    if ( uri.hostname !== '' ) {
        fakeHostname = uri.hostname + '.' + fakeHostname;
    } else if ( scheme === 'about' ) {
        fakeHostname = uri.path + '.' + fakeHostname;
    }

    return 'http://' + fakeHostname + '/';
};

/******************************************************************************/
/******************************************************************************

To keep track from which context *exactly* network requests are made. This is
often tricky for various reasons, and the challenge is not specific to one
browser.

The time at which a URL is assigned to a tab and the time when a network
request for a root document is made must be assumed to be unrelated: it's all
asynchronous. There is no guaranteed order in which the two events are fired.

Also, other "anomalies" can occur:

- a network request for a root document is fired without the corresponding
tab being really assigned a new URL
<https://github.com/chrisaljoudi/uBlock/issues/516>

- a network request for a secondary resource is labeled with a tab id for
which no root document was pulled for that tab.
<https://github.com/chrisaljoudi/uBlock/issues/1001>

- a network request for a secondary resource is made without the root
document to which it belongs being formally bound yet to the proper tab id,
causing a bad scope to be used for filtering purpose.
<https://github.com/chrisaljoudi/uBlock/issues/1205>
<https://github.com/chrisaljoudi/uBlock/issues/1140>

So the solution here is to keep a lightweight data structure which only
purpose is to keep track as accurately as possible of which root document
belongs to which tab. That's the only purpose, and because of this, there are
no restrictions for when the URL of a root document can be associated to a tab.

Before, the PageStore object was trying to deal with this, but it had to
enforce some restrictions so as to not descend into one of the above issues, or
other issues. The PageStore object can only be associated with a tab for which
a definitive navigation event occurred, because it collects information about
what occurred in the tab (for example, the number of requests blocked for a
page).

The TabContext objects do not suffer this restriction, and as a result they
offer the most reliable picture of which root document URL is really associated
to which tab. Moreover, the TabObject can undo an association from a root
document, and automatically re-associate with the next most recent. This takes
care of <https://github.com/chrisaljoudi/uBlock/issues/516>.

The PageStore object no longer cache the various information about which
root document it is currently bound. When it needs to find out, it will always
defer to the TabContext object, which will provide the real answer. This takes
case of <https://github.com/chrisaljoudi/uBlock/issues/1205>. In effect, the
master switch and dynamic filtering rules can be evaluated now properly even
in the absence of a PageStore object, this was not the case before.

Also, the TabContext object will try its best to find a good candidate root
document URL for when none exists. This takes care of 
<https://github.com/chrisaljoudi/uBlock/issues/1001>.

The TabContext manager is self-contained, and it takes care to properly
housekeep itself.

*/

µMatrix.tabContextManager = (( ) => {
    const µm = µMatrix;
    const tabContexts = new Map();

    // https://github.com/chrisaljoudi/uBlock/issues/1001
    // This is to be used as last-resort fallback in case a tab is found to not
    // be bound while network requests are fired for the tab.
    let mostRecentRootDocURL = '';
    let mostRecentRootDocURLTimestamp = 0;

    const onTabCreated = async function(/* createDetails */) {
    };

    const gcPeriod = 10 * 60 * 1000;

    // A pushed entry is removed from the stack unless it is committed with
    // a set time.
    const StackEntry = function(url, commit) {
        this.url = url;
        this.committed = commit;
        this.tstamp = Date.now();
    };

    const TabContext = function(tabId) {
        this.tabId = tabId;
        this.stack = [];
        this.rawURL =
        this.normalURL =
        this.scheme =
        this.origin =
        this.rootHostname =
        this.rootDomain = '';
        this.secure = false;
        this.commitTimer = null;
        this.gcTimer = null;
        this.onGCBarrier = false;
        this.netFiltering = true;
        this.netFilteringReadTime = 0;

        tabContexts.set(tabId, this);
    };

    TabContext.prototype.destroy = function() {
        if ( vAPI.isBehindTheSceneTabId(this.tabId) ) { return; }
        if ( this.gcTimer !== null ) {
            clearTimeout(this.gcTimer);
            this.gcTimer = null;
        }
        tabContexts.delete(this.tabId);
    };

    TabContext.prototype.onTab = function(tab) {
        if ( tab ) {
            this.gcTimer = vAPI.setTimeout(( ) => this.onGC(), gcPeriod);
        } else {
            this.destroy();
        }
    };

    TabContext.prototype.onGC = async function() {
        if ( vAPI.isBehindTheSceneTabId(this.tabId) ) { return; }
        // https://github.com/gorhill/uBlock/issues/1713
        // For unknown reasons, Firefox's setTimeout() will sometimes
        // causes the callback function to be called immediately, bypassing
        // the main event loop. For now this should prevent uBO from crashing
        // as a result of the bad setTimeout() behavior.
        if ( this.onGCBarrier ) { return; }
        this.onGCBarrier = true;
        this.gcTimer = null;
        const tab = await vAPI.tabs.get(this.tabId);
        this.onTab(tab);
        this.onGCBarrier = false;
    };

    // https://github.com/gorhill/uBlock/issues/248
    // Stack entries have to be committed to stick. Non-committed stack
    // entries are removed after a set delay.
    TabContext.prototype.onCommit = function() {
        if ( vAPI.isBehindTheSceneTabId(this.tabId) ) {
            return;
        }
        this.commitTimer = null;
        // Remove uncommitted entries at the top of the stack.
        let i = this.stack.length;
        while ( i-- ) {
            if ( this.stack[i].committed ) { break; }
        }
        // https://github.com/gorhill/uBlock/issues/300
        // If no committed entry was found, fall back on the bottom-most one
        // as being the committed one by default.
        if ( i === -1 && this.stack.length !== 0 ) {
            this.stack[0].committed = true;
            i = 0;
        }
        i += 1;
        if ( i < this.stack.length ) {
            this.stack.length = i;
            this.update();
        }
    };

    // This takes care of orphanized tab contexts. Can't be started for all
    // contexts, as the behind-the-scene context is permanent -- so we do not
    // want to flush it.
    TabContext.prototype.autodestroy = function() {
        if ( vAPI.isBehindTheSceneTabId(this.tabId) ) { return; }
        this.gcTimer = vAPI.setTimeout(( ) => this.onGC(), gcPeriod);
    };

    // Update just force all properties to be updated to match the most recent
    // root URL.
    TabContext.prototype.update = function() {
        this.netFilteringReadTime = 0;
        if ( this.stack.length === 0 ) {
            this.rawURL =
            this.normalURL =
            this.scheme =
            this.origin =
            this.rootHostname =
            this.rootDomain = '';
            this.secure = false;
            return;
        }
        const stackEntry = this.stack[this.stack.length - 1];
        this.rawURL = stackEntry.url;
        this.normalURL = µm.normalizePageURL(this.tabId, this.rawURL);
        this.scheme = µm.URI.schemeFromURI(this.rawURL);
        this.origin = µm.URI.originFromURI(this.normalURL);
        this.rootHostname = µm.URI.hostnameFromURI(this.origin);
        this.rootDomain =
            µm.URI.domainFromHostname(this.rootHostname) ||
            this.rootHostname;
         this.secure = µm.URI.isSecureScheme(this.scheme);
    };

    // Called whenever a candidate root URL is spotted for the tab.
    TabContext.prototype.push = function(url) {
        if ( vAPI.isBehindTheSceneTabId(this.tabId) ) {
            return;
        }
        const count = this.stack.length;
        if ( count !== 0 && this.stack[count - 1].url === url ) {
            return;
        }
        this.stack.push(new StackEntry(url));
        this.update();
        if ( this.commitTimer !== null ) {
            clearTimeout(this.commitTimer);
        }
        this.commitTimer = vAPI.setTimeout(( ) => this.onCommit(), 500);
    };

    // This tells that the url is definitely the one to be associated with the
    // tab, there is no longer any ambiguity about which root URL is really
    // sitting in which tab.
    TabContext.prototype.commit = function(url) {
        if ( vAPI.isBehindTheSceneTabId(this.tabId) ) { return; }
        if ( this.stack.length !== 0 ) {
            const top = this.stack[this.stack.length - 1];
            if ( top.url === url && top.committed ) { return false; }
        }
        this.stack = [new StackEntry(url, true)];
        this.update();
        return true;
    };

    TabContext.prototype.getNetFilteringSwitch = function() {
        if ( this.netFilteringReadTime > µm.netWhitelistModifyTime ) {
            return this.netFiltering;
        }
        // https://github.com/chrisaljoudi/uBlock/issues/1078
        // Use both the raw and normalized URLs.
        this.netFiltering = µm.getNetFilteringSwitch(this.normalURL);
        if (
            this.netFiltering &&
            this.rawURL !== this.normalURL &&
            this.rawURL !== ''
        ) {
            this.netFiltering = µm.getNetFilteringSwitch(this.rawURL);
        }
        this.netFilteringReadTime = Date.now();
        return this.netFiltering;
    };

    // These are to be used for the API of the tab context manager.

    const push = function(tabId, url) {
        let entry = tabContexts.get(tabId);
        if ( entry === undefined ) {
            entry = new TabContext(tabId);
            entry.autodestroy();
        }
        entry.push(url);
        mostRecentRootDocURL = url;
        mostRecentRootDocURLTimestamp = Date.now();
        return entry;
    };

    // Find a tab context for a specific tab.
    const lookup = function(tabId) {
        return tabContexts.get(tabId) || null;
    };

    // Find a tab context for a specific tab. If none is found, attempt to
    // fix this. When all fail, the behind-the-scene context is returned.
    const mustLookup = function(tabId) {
        const entry = tabContexts.get(tabId);
        if ( entry !== undefined ) {
            return entry;
        }
        // https://github.com/chrisaljoudi/uBlock/issues/1025
        // Google Hangout popup opens without a root frame. So for now we will
        // just discard that best-guess root frame if it is too far in the
        // future, at which point it ceases to be a "best guess".
        if (
            mostRecentRootDocURL !== '' &&
            mostRecentRootDocURLTimestamp + 500 < Date.now()
        ) {
            mostRecentRootDocURL = '';
        }
        // https://github.com/chrisaljoudi/uBlock/issues/1001
        // Not a behind-the-scene request, yet no page store found for the
        // tab id: we will thus bind the last-seen root document to the
        // unbound tab. It's a guess, but better than ending up filtering
        // nothing at all.
        if ( mostRecentRootDocURL !== '' ) {
            return push(tabId, mostRecentRootDocURL);
        }
        // If all else fail at finding a page store, re-categorize the
        // request as behind-the-scene. At least this ensures that ultimately
        // the user can still inspect/filter those net requests which were
        // about to fall through the cracks.
        // Example: Chromium + case #12 at
        //          http://raymondhill.net/ublock/popup.html
        return tabContexts.get(vAPI.noTabId);
    };

    const commit = function(tabId, url) {
        let entry = tabContexts.get(tabId);
        if ( entry === undefined ) {
            entry = push(tabId, url);
        } else {
            entry.commit(url);
        }
        return entry;
    };

    const exists = function(tabId) {
        return tabContexts.get(tabId) !== undefined;
    };

    // Behind-the-scene tab context
    {
        const entry = new TabContext(vAPI.noTabId);
        entry.stack.push(new StackEntry('', true));
        entry.rawURL = '';
        entry.normalURL = µm.normalizePageURL(entry.tabId);
        entry.origin = µm.URI.originFromURI(entry.normalURL);
        entry.rootHostname = µm.URI.hostnameFromURI(entry.origin);
        entry.rootDomain = µm.URI.domainFromHostname(entry.rootHostname);
    }

    // Context object, typically to be used to feed filtering engines.
    const contextJunkyard = [];
    const Context = class {
        constructor(tabId) {
            this.init(tabId);
        }
        init(tabId) {
            const tabContext = lookup(tabId);
            this.rootHostname = tabContext.rootHostname;
            this.rootDomain = tabContext.rootDomain;
            this.pageHostname =
            this.pageDomain =
            this.requestURL =
            this.origin =
            this.requestHostname =
            this.requestDomain = '';
            return this;
        }
        dispose() {
            contextJunkyard.push(this);
        }
    };

    const createContext = function(tabId) {
        if ( contextJunkyard.length ) {
            return contextJunkyard.pop().init(tabId);
        }
        return new Context(tabId);
    };

    return {
        push,
        commit,
        lookup,
        mustLookup,
        exists,
        createContext,
        onTabCreated,
    };
})();

/******************************************************************************/
/******************************************************************************/

vAPI.Tabs = class extends vAPI.Tabs {
    onActivated(details) {
        super.onActivated(details);
        if ( vAPI.isBehindTheSceneTabId(details.tabId) ) { return; }
        // https://github.com/uBlockOrigin/uBlock-issues/issues/680
        µMatrix.updateToolbarIcon(details.tabId);
        //µMatrix.contextMenu.update(details.tabId);
    }

    onClosed(tabId) {
        super.onClosed(tabId);
        if ( vAPI.isBehindTheSceneTabId(tabId) ) { return; }
        µMatrix.unbindTabFromPageStats(tabId);
        //µMatrix.contextMenu.update();
    }

    onCreated(details) {
        super.onCreated(details);
        µMatrix.tabContextManager.onTabCreated(details);
    }

    // When the DOM content of root frame is loaded, this means the tab
    // content has changed.
    //
    // The webRequest.onBeforeRequest() won't be called for everything
    // else than http/https. Thus, in such case, we will bind the tab as
    // early as possible in order to increase the likelihood of a context
    // properly setup if network requests are fired from within the tab.
    // Example: Chromium + case #6 at
    //          http://raymondhill.net/ublock/popup.html

    onNavigation(details) {
        super.onNavigation(details);
        const µm = µMatrix;
        if ( details.frameId === 0 ) {
            µm.tabContextManager.commit(details.tabId, details.url);
            µm.bindTabToPageStats(details.tabId, 'tabCommitted');
        }
        if ( µm.canInjectScriptletsNow ) {
            const pageStore = µm.pageStoreFromTabId(details.tabId);
            if ( pageStore !== null && pageStore.getNetFilteringSwitch() ) {
                µm.scriptletFilteringEngine.injectNow(details);
            }
        }
    }

    // It may happen the URL in the tab changes, while the page's document
    // stays the same (for instance, Google Maps). Without this listener,
    // the extension icon won't be properly refreshed.

    onUpdated(tabId, changeInfo, tab) {
        super.onUpdated(tabId, changeInfo, tab);
        if ( typeof tab.url !== 'string' || tab.url === '' ) { return; }
        if ( typeof changeInfo.url === 'string' && changeInfo.url !== '' ) {
            µMatrix.tabContextManager.commit(tabId, changeInfo.url);
            µMatrix.bindTabToPageStats(tabId, 'tabUpdated');
        }
        if ( typeof changeInfo.title === 'string' && changeInfo.title !== '' ) {
            µMatrix.setPageStoreTitle(tabId, changeInfo.title);
        }
    }
};

vAPI.tabs = new vAPI.Tabs();

/******************************************************************************/
/******************************************************************************/

// Create an entry for the tab if it doesn't exist

µm.bindTabToPageStats = function(tabId, context) {
    this.updateToolbarIcon(tabId);

    // Do not create a page store for URLs which are of no interests
    // Example: dev console
    const tabContext = this.tabContextManager.lookup(tabId);
    if ( tabContext === null ) { return null; }

    // rhill 2013-11-24: Never ever rebind behind-the-scene
    // virtual tab.
    // https://github.com/gorhill/httpswitchboard/issues/67
    if ( vAPI.isBehindTheSceneTabId(tabId) ) {
        return this.pageStores.get(tabId);
    }

    const normalURL = tabContext.normalURL;
    let pageStore = this.pageStores.get(tabId);

    // The previous page URL, if any, associated with the tab
    if ( pageStore !== undefined ) {
        // No change, do not rebind
        if ( pageStore.pageUrl === normalURL ) {
            return pageStore;
        }

        // https://github.com/gorhill/uMatrix/issues/37
        //   Just rebind whenever possible: the URL changed, but the document
        //   maybe is the same.
        //   Example: Google Maps, Github
        // https://github.com/gorhill/uMatrix/issues/72
        //   Need to double-check that the new scope is same as old scope
        if (
            context === 'tabUpdated' &&
            pageStore.pageHostname === tabContext.rootHostname
        ) {
            pageStore.rawURL = tabContext.rawURL;
            pageStore.pageUrl = normalURL;
            this.pageStoresToken = Date.now();
            return pageStore;
        }

        // We won't be reusing this page store.
        this.unbindTabFromPageStats(tabId);
    }

    // Try to resurrect first.
    pageStore = this.resurrectPageStore(tabId, normalURL);
    if ( pageStore === null ) {
        pageStore = this.pageStoreFactory(tabContext);
    }
    this.pageStores.set(tabId, pageStore);
    this.pageStoresToken = Date.now();

    return pageStore;
};

/******************************************************************************/

µm.unbindTabFromPageStats = function(tabId) {
    if ( vAPI.isBehindTheSceneTabId(tabId) ) { return; }

    const pageStore = this.pageStores.get(tabId);
    if ( pageStore === undefined ) { return; }

    this.pageStores.delete(tabId);
    this.pageStoresToken = Date.now();

    if ( pageStore.incinerationTimer ) {
        clearTimeout(pageStore.incinerationTimer);
        pageStore.incinerationTimer = null;
    }

    let pageStoreCrypt = this.pageStoreCemetery.get(tabId);
    if ( pageStoreCrypt === undefined ) {
        this.pageStoreCemetery.set(tabId, (pageStoreCrypt = new Map()));
    }

    const pageURL = pageStore.pageUrl;
    pageStoreCrypt.set(pageURL, pageStore);

    pageStore.incinerationTimer = vAPI.setTimeout(
        ( ) => {
            this.incineratePageStore(tabId, pageURL);
        },
        4 * 60 * 1000
    );
};

/******************************************************************************/

µm.resurrectPageStore = function(tabId, pageURL) {
    let pageStoreCrypt = this.pageStoreCemetery.get(tabId);
    if ( pageStoreCrypt === undefined ) { return null; }

    let pageStore = pageStoreCrypt.get(pageURL);
    if ( pageStore === undefined ) { return null; }


    if ( pageStore.incinerationTimer !== null ) {
        clearTimeout(pageStore.incinerationTimer);
        pageStore.incinerationTimer = null;
    }

    pageStoreCrypt.delete(pageURL);
    if ( pageStoreCrypt.size === 0 ) {
        this.pageStoreCemetery.delete(tabId);
    }

    return pageStore;
};

/******************************************************************************/

µm.incineratePageStore = function(tabId, pageURL) {
    let pageStoreCrypt = this.pageStoreCemetery.get(tabId);
    if ( pageStoreCrypt === undefined ) { return; }

    let pageStore = pageStoreCrypt.get(pageURL);
    if ( pageStore === undefined ) { return; }

    if ( pageStore.incinerationTimer !== null ) {
        clearTimeout(pageStore.incinerationTimer);
        pageStore.incinerationTimer = null;
    }

    pageStoreCrypt.delete(pageURL);
    if ( pageStoreCrypt.size === 0 ) {
        this.pageStoreCemetery.delete(tabId);
    }

    pageStore.dispose();
};

/******************************************************************************/

µm.pageStoreFromTabId = function(tabId) {
    return this.pageStores.get(tabId) || null;
};

// Never return null
µm.mustPageStoreFromTabId = function(tabId) {
    return this.pageStores.get(tabId) || this.pageStores.get(vAPI.noTabId);
};

/******************************************************************************/

µm.setPageStoreTitle = function(tabId, title) {
    const pageStore = this.pageStoreFromTabId(tabId);
    if ( pageStore === null ) { return; }
    if ( title === pageStore.title ) { return; }
    pageStore.title = title;
    this.pageStoresToken = Date.now();
};

/******************************************************************************/

µm.forceReload = function(tabId, bypassCache) {
    vAPI.tabs.reload(tabId, bypassCache);
};

/******************************************************************************/

µMatrix.updateToolbarIcon = (( ) => {
    const µm = µMatrix;
    const tabIdToDetails = new Map();

    const updateBadge = tabId => {
        let parts = tabIdToDetails.get(tabId);
        tabIdToDetails.delete(tabId);

        let badge = '';
        let color = '#666';
        let iconId = 'off';

        let pageStore = µm.pageStoreFromTabId(tabId);
        if ( pageStore !== null ) {
            const totalBlocked = pageStore.perLoadBlockedRequestCount;
            const total = pageStore.perLoadAllowedRequestCount + totalBlocked;
            const squareSize = 19;
            if ( total !== 0 ) {
                const greenSize = squareSize * Math.sqrt(
                    pageStore.perLoadAllowedRequestCount / total
                );
                iconId = greenSize < squareSize / 2 ?
                    Math.ceil(greenSize) :
                    Math.floor(greenSize);
            } else {
                iconId = squareSize;
            }
            if ( totalBlocked !== 0 && (parts & 0b0010) !== 0 ) {
                badge = µm.formatCount(totalBlocked);
            }
        }

        // https://www.reddit.com/r/uBlockOrigin/comments/d33d37/
        if ( µm.userSettings.iconBadgeEnabled === false ) {
            parts |= 0b1000;
        }

        vAPI.setIcon(tabId, {
            parts,
            src: `/img/browsericons/icon19-${iconId}.png`,
            badge,
            color
        });
    };

    // parts: bit 0 = icon
    //        bit 1 = badge text
    //        bit 2 = badge color
    //        bit 3 = hide badge

    return function(tabId, newParts = 0b0111) {
        if ( typeof tabId !== 'number' ) { return; }
        if ( vAPI.isBehindTheSceneTabId(tabId) ) { return; }
        const currentParts = tabIdToDetails.get(tabId);
        if ( currentParts === newParts ) { return; }
        if ( currentParts === undefined ) {
            self.requestIdleCallback(
                ( ) => updateBadge(tabId),
                { timeout: 701 }
            );
        } else {
            newParts |= currentParts;
        }
        tabIdToDetails.set(tabId, newParts);
    };
})();

/******************************************************************************/

// Stale page store entries janitor
// https://github.com/chrisaljoudi/uBlock/issues/455

{
    const cleanupPeriod = 7 * 60 * 1000;
    const cleanupSampleSize = 11;
    let cleanupSampleAt = 0;

    const cleanup = function() {
        const tabIds = Array.from(µm.pageStores.keys()).sort();
        const checkTab = function(tabId) {
            vAPI.tabs.get(tabId).then(tab => {
                if ( tab instanceof Object ) { return; }
                µm.unbindTabFromPageStats(tabId);
            });
        };
        if ( cleanupSampleAt >= tabIds.length ) {
            cleanupSampleAt = 0;
        }
        const n = Math.min(cleanupSampleAt + cleanupSampleSize, tabIds.length);
        for ( let i = cleanupSampleAt; i < n; i++ ) {
            const tabId = tabIds[i];
            if ( vAPI.isBehindTheSceneTabId(tabId) ) { continue; }
            checkTab(tabId);
        }
        cleanupSampleAt = n;

        vAPI.setTimeout(cleanup, cleanupPeriod);
    };

    vAPI.setTimeout(cleanup, cleanupPeriod);
}

/******************************************************************************/

})();
