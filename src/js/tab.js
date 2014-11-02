/*******************************************************************************

    µMatrix - a Chromium browser extension to black/white list requests.
    Copyright (C) 2014  Raymond Hill

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

/* global chrome, µMatrix */

/******************************************************************************/

// Create a new page url stats store (if not already present)

µMatrix.createPageStore = function(pageURL) {
    // https://github.com/gorhill/httpswitchboard/issues/303
    // At this point, the URL has been page-URL-normalized

    // do not create stats store for urls which are of no interest
    if ( pageURL.search(/^https?/) !== 0 ) {
        return;
    }
    var pageStore = null;
    if ( this.pageStats.hasOwnProperty(pageURL) ) {
        pageStore = this.pageStats[pageURL];
    }
    if ( pageStore === null ) {
        pageStore = this.PageStore.factory(pageURL);
        // These counters are used so that icon presents an overview of how
        // much allowed/blocked.
        pageStore.perLoadAllowedRequestCount =
        pageStore.perLoadBlockedRequestCount = 0;
        this.pageStats[pageURL] = pageStore;
    }

    // TODO: revisit code, need to account for those web pages for which the
    // URL changes with the content only updated
    if ( pageStore.pageUrl !== pageURL ) {
        pageStore.init(pageURL);
    }

    return pageStore;
};

/******************************************************************************/

// https://github.com/gorhill/httpswitchboard/issues/303
// Some kind of trick going on here:
//   Any scheme other than 'http' and 'https' is remapped into a fake
//   URL which trick the rest of µMatrix into being able to process an
//   otherwise unmanageable scheme. µMatrix needs web pages to have a proper
//   hostname to work properly, so just like the 'chromium-behind-the-scene'
//   fake domain name, we map unknown schemes into a fake '{scheme}-scheme'
//   hostname. This way, for a specific scheme you can create scope with
//   rules which will apply only to that scheme.

µMatrix.normalizePageURL = function(pageURL) {
    var uri = this.URI.set(pageURL);
    if ( uri.scheme === 'https' || uri.scheme === 'http' ) {
        return uri.normalizedURI();
    }
    // If it is a scheme-based page URL, it is important it is crafted as a
    // normalized URL just like above.
    if ( uri.scheme !== '' ) {
        return 'http://' + uri.scheme + '-scheme/';
    }
    return '';
};

/******************************************************************************/

// Create an entry for the tab if it doesn't exist

µMatrix.bindTabToPageStats = function(tabId, pageURL, context) {
    // https://github.com/gorhill/httpswitchboard/issues/303
    // Don't rebind pages blocked by µMatrix.
    var blockedRootFramePrefix = this.webRequest.blockedRootFramePrefix;
    if ( pageURL.slice(0, blockedRootFramePrefix.length) === blockedRootFramePrefix ) {
        return null;
    }

    // https://github.com/gorhill/httpswitchboard/issues/303
    // Normalize to a page-URL.
    pageURL = this.normalizePageURL(pageURL);

    // The page URL, if any, currently associated with the tab
    var previousPageURL = this.tabIdToPageUrl[tabId];
    if ( previousPageURL === pageURL ) {
        return this.pageStats[pageURL];
    }

    // https://github.com/gorhill/uMatrix/issues/37
    // Just rebind: the URL changed, but the document itself is the same.
    // Example: Google Maps, Github
    var pageStore;
    if ( context === 'pageUpdated' && this.pageStats.hasOwnProperty(previousPageURL) ) {
        pageStore = this.pageStats[previousPageURL];
        pageStore.pageUrl = pageURL;
        delete this.pageStats[previousPageURL];
        this.pageStats[pageURL] = pageStore;
        delete this.pageUrlToTabId[previousPageURL];
        this.pageUrlToTabId[pageURL] = tabId;
        this.tabIdToPageUrl[tabId] = pageURL;
        return pageStore;
    }

    pageStore = this.createPageStore(pageURL, context);

    // console.debug('tab.js > bindTabToPageStats(): dispatching traffic in tab id %d to page store "%s"', tabId, pageUrl);

    // rhill 2013-11-24: Never ever rebind chromium-behind-the-scene
    // virtual tab.
    // https://github.com/gorhill/httpswitchboard/issues/67
    if ( tabId === this.behindTheSceneTabId ) {
        return pageStore;
    }

    // https://github.com/gorhill/uMatrix/issues/37
    this.updateBadgeAsync(pageURL);

    this.unbindTabFromPageStats(tabId);

    // rhill 2014-02-08: Do not create an entry if no page store
    // exists (like when visiting about:blank)
    // https://github.com/gorhill/httpswitchboard/issues/186
    if ( !pageStore ) {
        return null;
    }

    this.pageUrlToTabId[pageURL] = tabId;
    this.tabIdToPageUrl[tabId] = pageURL;
    pageStore.boundCount += 1;

    return pageStore;
};

/******************************************************************************/

µMatrix.unbindTabFromPageStats = function(tabId) {
    if ( this.tabIdToPageUrl.hasOwnProperty(tabId) === false ) {
        return;
    }
    var pageURL = this.tabIdToPageUrl[tabId];
    if ( this.pageStats.hasOwnProperty(pageURL) ) {
        var pageStore = this.pageStats[pageURL];
        pageStore.boundCount -= 1;
        if ( pageStore.boundCount === 0 ) {
            pageStore.obsoleteAfter = Date.now() + (5 * 60 * 1000);
        }
    }
    delete this.tabIdToPageUrl[tabId];
    delete this.pageUrlToTabId[pageURL];
};

/******************************************************************************/

// Log a request

µMatrix.recordFromTabId = function(tabId, type, url, blocked) {
    var pageStats = this.pageStatsFromTabId(tabId);
    if ( pageStats ) {
        pageStats.recordRequest(type, url, blocked);
    }
};

µMatrix.recordFromPageUrl = function(pageUrl, type, url, blocked, reason) {
    var pageStats = this.pageStatsFromPageUrl(pageUrl);
    if ( pageStats ) {
        pageStats.recordRequest(type, url, blocked, reason);
    }
};

/******************************************************************************/

µMatrix.onPageLoadCompleted = function(pageURL) {
    var pageStats = this.pageStatsFromPageUrl(pageURL);
    if ( !pageStats ) {
        return;
    }

    // https://github.com/gorhill/httpswitchboard/issues/181
    if ( pageStats.thirdpartyScript ) {
        pageStats.recordRequest('script', pageURL + '{3rd-party_scripts}', pageStats.pageScriptBlocked);
    }
};

/******************************************************************************/

// Reload content of a tabs.

µMatrix.smartReloadTabs = function(which, tabId) {
    if ( which === 'none' ) {
        return;
    }

    if ( which === 'current' && typeof tabId === 'number' ) {
        this.smartReloadTab(tabId);
        return;
    }

    // which === 'all'
    var reloadTabs = function(chromeTabs) {
        var µm = µMatrix;
        var tabId;
        var i = chromeTabs.length;
        while ( i-- ) {
            tabId = chromeTabs[i].id;
            if ( µm.tabExists(tabId) ) {
                µm.smartReloadTab(tabId);
            }
        }
    };

    var getTabs = function() {
        chrome.tabs.query({ status: 'complete' }, reloadTabs);
    };

    this.asyncJobs.add('smartReloadTabs', null, getTabs, 500);
};

/******************************************************************************/

// Reload content of a tab

µMatrix.smartReloadTab = function(tabId) {
    var pageStats = this.pageStatsFromTabId(tabId);
    if ( !pageStats ) {
        //console.error('HTTP Switchboard> µMatrix.smartReloadTab(): page stats for tab id %d not found', tabId);
        return;
    }

    // rhill 2013-12-23: Reload only if something previously blocked is now
    // unblocked.
    var blockRule;
    var oldState = pageStats.state;
    var newState = this.computeTabState(tabId);
    var mustReload = false;
    for ( blockRule in oldState ) {
        if ( !oldState.hasOwnProperty(blockRule) ) {
            continue;
        }
        // General rule, reload...
        // If something previously blocked is no longer blocked.
        if ( !newState[blockRule] ) {
            // console.debug('tab.js > µMatrix.smartReloadTab(): will reload because "%s" is no longer blocked', blockRule);
            mustReload = true;
            break;
        }
    }
    // Exceptions: blocking these previously unblocked types must result in a
    // reload:
    // - a script
    // - a frame
    // Related issues:
    // https://github.com/gorhill/httpswitchboard/issues/94
    // https://github.com/gorhill/httpswitchboard/issues/141
    if ( !mustReload ) {
        var reloadNewlyBlockedTypes = {
            'doc': true,
            'script' : true,
            'frame': true
        };
        var blockRuleType;
        for ( blockRule in newState ) {
            if ( !newState.hasOwnProperty(blockRule) ) {
                continue;
            }
            blockRuleType = blockRule.slice(0, blockRule.indexOf('|'));
            if ( !reloadNewlyBlockedTypes[blockRuleType] ) {
                continue;
            }
            if ( !oldState[blockRule] ) {
                // console.debug('tab.js > µMatrix.smartReloadTab(): will reload because "%s" is now blocked', blockRule);
                mustReload = true;
                break;
            }
        }
    }

    // console.log('old state: %o\nnew state: %o', oldState, newState);
    
    if ( mustReload ) {
        chrome.tabs.reload(tabId);
    }
    // pageStats.state = newState;
};

/******************************************************************************/

// Required since not all tabs are of interests to HTTP Switchboard.
// Examples:
//      `chrome://extensions/`
//      `chrome-devtools://devtools/devtools.html`
//      etc.

µMatrix.tabExists = function(tabId) {
    return !!this.pageUrlFromTabId(tabId);
};

/******************************************************************************/

µMatrix.computeTabState = function(tabId) {
    var pageStats = this.pageStatsFromTabId(tabId);
    if ( !pageStats ) {
        //console.error('tab.js > µMatrix.computeTabState(): page stats for tab id %d not found', tabId);
        return {};
    }
    // Go through all recorded requests, apply filters to create state
    // It is a critical error for a tab to not be defined here
    var pageURL = pageStats.pageUrl;
    var srcHostname = this.scopeFromURL(pageURL);
    var requestDict = pageStats.requests.getRequestDict();
    var computedState = {};
    var desHostname, type;
    for ( var reqKey in requestDict ) {
        if ( !requestDict.hasOwnProperty(reqKey) ) {
            continue;
        }

        // The evaluation code here needs to reflect the evaluation code in
        // beforeRequestHandler()
        desHostname = this.PageRequestStats.hostnameFromRequestKey(reqKey);

        // rhill 2013-12-10: mind how stylesheets are to be evaluated:
        // `stylesheet` or `other`? Depends of domain of request.
        // https://github.com/gorhill/httpswitchboard/issues/85
        type = this.PageRequestStats.typeFromRequestKey(reqKey);
        if ( this.mustBlock(srcHostname, desHostname, type) ) {
            computedState[type +  '|' + desHostname] = true;
        }
    }
    return computedState;
};

/******************************************************************************/

µMatrix.tabIdFromPageUrl = function(pageURL) {
    // https://github.com/gorhill/httpswitchboard/issues/303
    // Normalize to a page-URL.
    return this.pageUrlToTabId[this.normalizePageURL(pageURL)];
};

µMatrix.tabIdFromPageStats = function(pageStats) {
    return this.tabIdFromPageUrl(pageStats.pageUrl);
};

µMatrix.pageUrlFromTabId = function(tabId) {
    return this.tabIdToPageUrl[tabId];
};

µMatrix.pageUrlFromPageStats = function(pageStats) {
    if ( pageStats ) {
        return pageStats.pageUrl;
    }
    return undefined;
};

µMatrix.pageStatsFromTabId = function(tabId) {
    var pageUrl = this.tabIdToPageUrl[tabId];
    if ( pageUrl ) {
        return this.pageStats[pageUrl];
    }
    return undefined;
};

µMatrix.pageStatsFromPageUrl = function(pageURL) {
    if ( pageURL ) {
        return this.pageStats[this.normalizePageURL(pageURL)];
    }
    return null;
};

/******************************************************************************/

µMatrix.forceReload = function(pageURL) {
    var tabId = this.tabIdFromPageUrl(pageURL);
    if ( tabId ) {
        chrome.tabs.reload(tabId, { bypassCache: true });
    }
};

/******************************************************************************/

// Garbage collect stale url stats entries
(function() {
    var µm = µMatrix;
    var gcPageStats = function() {
        var pageStore;
        var now = Date.now();
        for ( var pageURL in µm.pageStats ) {
            if ( µm.pageStats.hasOwnProperty(pageURL) === false ) {
                continue;
            }
            pageStore = µm.pageStats[pageURL];
            if ( pageStore.boundCount !== 0 ) {
                continue;
            }
            if ( pageStore.obsoleteAfter > now ) {
                continue;
            }
            µm.cookieHunter.removePageCookies(pageStore);
            pageStore.dispose();
            delete µm.pageStats[pageURL];
        }

        // Prune content of chromium-behind-the-scene virtual tab
        // When `suggest-as-you-type` is on in Chromium, this can lead to a
        // LOT of uninteresting behind the scene requests.
        pageStore = µm.pageStats[µm.behindTheSceneURL];
        if ( !pageStore ) {
            return;
        }
        var reqKeys = pageStore.requests.getRequestKeys();
        if ( reqKeys.length <= µm.behindTheSceneMaxReq ) {
            return;
        }
        reqKeys = reqKeys.sort(function(a,b){
            return pageStore.requests[b] - pageStore.requests[a];
        }).slice(µm.behindTheSceneMaxReq);
        var iReqKey = reqKeys.length;
        while ( iReqKey-- ) {
            pageStore.requests.disposeOne(reqKeys[iReqKey]);
        }
    };

    // Time somewhat arbitrary: If a web page has not been in a tab
    // for some time minutes, flush its stats.
    µMatrix.asyncJobs.add(
        'gcPageStats',
        null,
        gcPageStats,
        (2.5 * 60 * 1000) | 0,
        true
    );
})();
