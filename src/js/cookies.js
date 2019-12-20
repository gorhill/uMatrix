/*******************************************************************************

    uMatrix - a browser extension to black/white list requests.
    Copyright (C) 2013-present Raymond Hill

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

// rhill 2013-12-14: the whole cookie management has been rewritten so as
// to avoid having to call chrome API whenever a single cookie changes, and
// to record cookie for a web page *only* when its value changes.
// https://github.com/gorhill/httpswitchboard/issues/79

"use strict";

/******************************************************************************/

// Isolate from global namespace

// Use cached-context approach rather than object-based approach, as details
// of the implementation do not need to be visible

µMatrix.cookieHunter = (( ) => {

/******************************************************************************/

const µm = µMatrix;

const recordPageCookiesQueue = new Map();
const removeCookieQueue = new Set();
const cookieDict = new Map();
const cookieEntryJunkyard = [];
const processRemoveQueuePeriod = 2 * 60 * 1000;
const processCleanPeriod = 10 * 60 * 1000;
let processPageRecordQueueTimer = null;

/******************************************************************************/

const CookieEntry = class {
    constructor(cookie) {
        this.usedOn = new Set();
        this.init(cookie);
    }

    init(cookie) {
        this.secure = cookie.secure;
        this.session = cookie.session;
        this.anySubdomain = cookie.domain.charAt(0) === '.';
        this.hostname = this.anySubdomain ? cookie.domain.slice(1) : cookie.domain;
        this.domain = µm.URI.domainFromHostname(this.hostname) || this.hostname;
        this.path = cookie.path;
        this.name = cookie.name;
        this.value = cookie.value;
        this.tstamp = Date.now();
        this.usedOn.clear();
        return this;
    }

    // Reset any property which indirectly consumes memory
    dispose() {
        this.hostname = '';
        this.domain = '';
        this.path = '';
        this.name = '';
        this.value = '';
        this.usedOn.clear();
        return this;
    }
};

/******************************************************************************/

const addCookieToDict = function(cookie) {
    const cookieKey = cookieKeyFromCookie(cookie);
    let cookieEntry = cookieDict.get(cookieKey);
    if ( cookieEntry === undefined ) {
        cookieEntry = cookieEntryJunkyard.pop();
        if ( cookieEntry ) {
            cookieEntry.init(cookie);
        } else {
            cookieEntry = new CookieEntry(cookie);
        }
        cookieDict.set(cookieKey, cookieEntry);
    }
    return cookieEntry;
};

/******************************************************************************/

const removeCookieFromDict = function(cookieKey) {
    const cookieEntry = cookieDict.get(cookieKey);
    if ( cookieEntry === undefined ) { return false; }
    cookieDict.delete(cookieKey);
    if ( cookieEntryJunkyard.length < 25 ) {
        cookieEntryJunkyard.push(cookieEntry.dispose());
    }
    return true;
};

/******************************************************************************/

const cookieKeyBuilder = [
    '', // 0 = scheme
    '://',
    '', // 2 = domain
    '', // 3 = path
    '{',
    '', // 5 = persistent or session
    '-cookie:',
    '', // 7 = name
    '}'
];

const cookieKeyFromCookie = function(cookie) {
    const cb = cookieKeyBuilder;
    cb[0] = cookie.secure ? 'https' : 'http';
    cb[2] = cookie.domain.charAt(0) === '.' ? cookie.domain.slice(1) : cookie.domain;
    cb[3] = cookie.path;
    cb[5] = cookie.session ? 'session' : 'persistent';
    cb[7] = cookie.name;
    return cb.join('');
};

const cookieKeyFromCookieURL = function(url, type, name) {
    const µmuri = µm.URI.set(url);
    const cb = cookieKeyBuilder;
    cb[0] = µmuri.scheme;
    cb[2] = µmuri.hostname;
    cb[3] = µmuri.path;
    cb[5] = type;
    cb[7] = name;
    return cb.join('');
};

/******************************************************************************/

const cookieURLFromCookieEntry = function(entry) {
    if ( !entry ) {
        return '';
    }
    return (entry.secure ? 'https://' : 'http://') + entry.hostname + entry.path;
};

/******************************************************************************/

const cookieMatchDomains = function(cookieKey, allHostnamesString) {
    const cookieEntry = cookieDict.get(cookieKey);
    if ( cookieEntry === undefined ) { return false; }
    if ( allHostnamesString.indexOf(' ' + cookieEntry.hostname + ' ') < 0 ) {
        if ( !cookieEntry.anySubdomain ) { return false; }
        if ( allHostnamesString.indexOf('.' + cookieEntry.hostname + ' ') < 0 ) {
            return false;
        }
    }
    return true;
};

/******************************************************************************/

// Look for cookies to record for a specific web page

const recordPageCookiesAsync = function(pageStore) {
    // Store the page stats objects so that it doesn't go away
    // before we handle the job.
    // rhill 2013-10-19: pageStore could be nil, for example, this can
    // happens if a file:// ... makes an xmlHttpRequest
    if ( !pageStore ) { return; }
    recordPageCookiesQueue.set(pageStore.pageUrl, pageStore);
    if ( processPageRecordQueueTimer !== null ) { return; }
    processPageRecordQueueTimer = vAPI.setTimeout(processPageRecordQueue, 1000);
};

/******************************************************************************/

const recordPageCookie = (( ) => {
    const queue = new Map();
    const cookieLogEntryBuilder = [ '', '{', '', '-cookie:', '', '}' ];
    let queueTimer;

    const process = function() {
        queueTimer = undefined;
        for ( const qentry of queue ) {
            const pageStore = qentry[0];
            if ( pageStore.tabId === '' ) { continue; }
            for ( const cookieKey of qentry[1] ) {
                let cookieEntry = cookieDict.get(cookieKey);
                if ( cookieEntry === undefined ) { continue; }
                let blocked = µm.mustBlock(
                    pageStore.pageHostname,
                    cookieEntry.hostname,
                    'cookie'
                );
                // https://github.com/gorhill/httpswitchboard/issues/60
                //   Need to URL-encode cookie name
                cookieLogEntryBuilder[0] =
                    cookieURLFromCookieEntry(cookieEntry);
                cookieLogEntryBuilder[2] =
                    cookieEntry.session ? 'session' : 'persistent';
                cookieLogEntryBuilder[4] =
                    encodeURIComponent(cookieEntry.name);
                const cookieURL = cookieLogEntryBuilder.join('');
                pageStore.recordRequest('cookie', cookieURL, blocked);
                if ( µm.logger.enabled ) {
                    µm.filteringContext
                      .duplicate()
                      .fromTabId(pageStore.tabId)
                      .setType('cookie')
                      .setURL(cookieURL)
                      .setFilter(blocked)
                      .setRealm('network')
                      .toLogger();
                }
                cookieEntry.usedOn.add(pageStore.pageHostname);
                if ( !blocked ) { continue; }
                if ( µm.userSettings.deleteCookies ) {
                    removeCookieAsync(cookieKey);
                }
                µm.updateToolbarIcon(pageStore.tabId);
            }
        }
        queue.clear();
    };

    return function(pageStore, cookieKey) {
        if ( vAPI.isBehindTheSceneTabId(pageStore.tabId) ) { return; }
        let entry = queue.get(pageStore);
        if ( entry === undefined ) {
            queue.set(pageStore, (entry = new Set()));
        }
        if ( entry.has(cookieKey) ) { return; }
        entry.add(cookieKey);
        if ( queueTimer === undefined ) {
            queueTimer = vAPI.setTimeout(process, 277);
        }
    };
})();

/******************************************************************************/

// Candidate for removal

const removeCookieAsync = function(cookieKey) {
    removeCookieQueue.add(cookieKey);
};

/******************************************************************************/

const browserCookieRemove = function(cookieEntry, name) {
    const url = cookieURLFromCookieEntry(cookieEntry);
    if ( url === '' ) { return; }

    const sessionCookieKey = cookieKeyFromCookieURL(url, 'session', name);
    const persistCookieKey = cookieKeyFromCookieURL(url, 'persistent', name);

    vAPI.cookies.remove({ url, name }).then(details => {
        const success = !!details;
        const template = success ? i18nCookieDeleteSuccess : i18nCookieDeleteFailure;
        if ( removeCookieFromDict(sessionCookieKey) ) {
            if ( success ) {
                µm.cookieRemovedCounter += 1;
            }
            µm.logger.writeOne({
                realm: 'message',
                text: template.replace('{{value}}', sessionCookieKey)
            });
        }
        if ( removeCookieFromDict(persistCookieKey) ) {
            if ( success ) {
                µm.cookieRemovedCounter += 1;
            }
            µm.logger.writeOne({
                realm: 'message',
                text: template.replace('{{value}}', persistCookieKey)
            });
        }
    });
};

const i18nCookieDeleteSuccess = vAPI.i18n('loggerEntryCookieDeleted');
const i18nCookieDeleteFailure = vAPI.i18n('loggerEntryDeleteCookieError');

/******************************************************************************/

const processPageRecordQueue = function() {
    processPageRecordQueueTimer = null;

    for ( const pageStore of recordPageCookiesQueue.values() ) {
        findAndRecordPageCookies(pageStore);
    }
    recordPageCookiesQueue.clear();
};

/******************************************************************************/

// Effectively remove cookies.

const processRemoveQueue = function() {
    const userSettings = µm.userSettings;
    const deleteCookies = userSettings.deleteCookies;

    // Session cookies which timestamp is *after* tstampObsolete will
    // be left untouched
    // https://github.com/gorhill/httpswitchboard/issues/257
    const tstampObsolete = userSettings.deleteUnusedSessionCookies ?
        Date.now() - userSettings.deleteUnusedSessionCookiesAfter * 60 * 1000 :
        0;

    let srcHostnames;

    for ( const cookieKey of removeCookieQueue ) {
        // rhill 2014-05-12: Apparently this can happen. I have to
        // investigate how (A session cookie has same name as a
        // persistent cookie?)
        const cookieEntry = cookieDict.get(cookieKey);
        if ( cookieEntry === undefined ) { continue; }

        // Delete obsolete session cookies: enabled.
        if ( tstampObsolete !== 0 && cookieEntry.session ) {
            if ( cookieEntry.tstamp < tstampObsolete ) {
                browserCookieRemove(cookieEntry, cookieEntry.name);
                continue;
            }
        }

        // Delete all blocked cookies: disabled.
        if ( deleteCookies === false ) { continue; }

        // Query scopes only if we are going to use them
        if ( srcHostnames === undefined ) {
            srcHostnames = µm.tMatrix.extractAllSourceHostnames();
        }

        // Ensure cookie is not allowed on ALL current web pages: It can
        // happen that a cookie is blacklisted on one web page while
        // being whitelisted on another (because of per-page permissions).
        if ( canRemoveCookie(cookieKey, srcHostnames) ) {
            browserCookieRemove(cookieEntry, cookieEntry.name);
        }
    }

    removeCookieQueue.clear();

    vAPI.setTimeout(processRemoveQueue, processRemoveQueuePeriod);
};

/******************************************************************************/

// Once in a while, we go ahead and clean everything that might have been
// left behind.

// Remove only some of the cookies which are candidate for removal: who knows,
// maybe a user has 1000s of cookies sitting in his browser...

const processClean = function() {
    const us = µm.userSettings;
    if ( us.deleteCookies || us.deleteUnusedSessionCookies ) {
        const cookieKeys = Array.from(cookieDict.keys());
        const len = cookieKeys.length;
        let step, offset, n;
        if ( len > 25 ) {
            step = len / 25;
            offset = Math.floor(Math.random() * len);
            n = 25;
        } else {
            step = 1;
            offset = 0;
            n = len;
        }
        let i = offset;
        while ( n-- ) {
            removeCookieAsync(cookieKeys[Math.floor(i % len)]);
            i += step;
        }
    }

    vAPI.setTimeout(processClean, processCleanPeriod);
};

/******************************************************************************/

const findAndRecordPageCookies = function(pageStore) {
    for ( const cookieKey of cookieDict.keys() ) {
        if ( cookieMatchDomains(cookieKey, pageStore.allHostnamesString) ) {
            recordPageCookie(pageStore, cookieKey);
        }
    }
};

/******************************************************************************/

const canRemoveCookie = function(cookieKey, srcHostnames) {
    const cookieEntry = cookieDict.get(cookieKey);
    if ( cookieEntry === undefined ) { return false; }

    const cookieHostname = cookieEntry.hostname;

    for ( const srcHostname of cookieEntry.usedOn ) {
        if ( µm.mustAllow(srcHostname, cookieHostname, 'cookie') ) {
            return false;
        }
    }
    // Maybe there is a scope in which the cookie is 1st-party-allowed.
    // For example, if I am logged in into `github.com`, I do not want to be 
    // logged out just because I did not yet open a `github.com` page after 
    // re-starting the browser.
    let srcHostname = cookieHostname;
    for (;;) {
        if (
            srcHostnames.has(srcHostname) &&
            µm.mustAllow(srcHostname, cookieHostname, 'cookie')
        ) {
            return false;
        }
        if ( srcHostname === cookieEntry.domain ) { break; }
        const pos = srcHostname.indexOf('.');
        if ( pos === -1 ) { break; }
        srcHostname = srcHostname.slice(pos + 1);
    }
    return true;
};

/******************************************************************************/

// Listen to any change in cookieland, we will update page stats accordingly.
//
// https://github.com/gorhill/httpswitchboard/issues/79
//  If cookie value didn't change, no need to record.

vAPI.cookies.onChanged = (( ) => {
    const queue = new Map();
    let queueTimer;

    // Go through all pages and update if needed, as one cookie can be used
    // by many web pages, so they need to be recorded for all these pages.

    const process = function() {
        queueTimer = undefined;
        const now = Date.now();
        const cookieKeys = [];
        for ( const qentry of queue ) {
            if ( qentry[1] > now ) { continue; }
            if ( cookieDict.has(qentry[0]) === false ) { continue; }
            cookieKeys.push(qentry[0]);
            queue.delete(qentry[0]);
        }
        if ( cookieKeys.length !== 0 ) {
            for ( const pageStore of µm.pageStores.values() ) {
                const allHostnamesString = pageStore.allHostnamesString;
                for ( const cookieKey of cookieKeys ) {
                    if ( cookieMatchDomains(cookieKey, allHostnamesString) ) {
                        recordPageCookie(pageStore, cookieKey);
                    }
                }
            }
        }
        if ( queue.size !== 0 ) {
            queueTimer = vAPI.setTimeout(process, 797);
        }
    };

    return function(cookie) {
        const cookieKey = cookieKeyFromCookie(cookie);
        let cookieEntry = cookieDict.get(cookieKey);
        if ( cookieEntry === undefined ) {
            cookieEntry = addCookieToDict(cookie);
        } else {
            cookieEntry.tstamp = Date.now();
            if ( cookie.value === cookieEntry.value ) { return; }
            cookieEntry.value = cookie.value;
        }
        if ( queue.has(cookieKey) ) { return; }
        queue.set(cookieKey, Date.now() + 653);
        if ( queueTimer === undefined ) {
            queueTimer = vAPI.setTimeout(process, 727);
        }
    };
})();

/******************************************************************************/

// Listen to any change in cookieland, we will update page stats accordingly.

vAPI.cookies.onRemoved = function(cookie) {
    const cookieKey = cookieKeyFromCookie(cookie);
    if ( removeCookieFromDict(cookieKey) ) {
        µm.logger.writeOne({
            realm: 'message',
            text: i18nCookieDeleteSuccess.replace('{{value}}', cookieKey),
            prettify: 'cookie'
        });
    }
};

/******************************************************************************/

// Listen to any change in cookieland, we will update page stats accordingly.

vAPI.cookies.onAllRemoved = function() {
    for ( const cookieKey of cookieDict.keys() ) {
        if ( removeCookieFromDict(cookieKey) ) {
            µm.logger.writeOne({
                realm: 'message',
                text: i18nCookieDeleteSuccess.replace('{{value}}', cookieKey),
                prettify: 'cookie'
            });
        }
    }
};

/******************************************************************************/

vAPI.cookies.getAll().then(cookies => {
    for ( const cookie of cookies ) {
        addCookieToDict(cookie);
    }
});
vAPI.cookies.start();

vAPI.setTimeout(processRemoveQueue, processRemoveQueuePeriod);
vAPI.setTimeout(processClean, processCleanPeriod);

/******************************************************************************/

// Expose only what is necessary

return {
    recordPageCookies: recordPageCookiesAsync
};

/******************************************************************************/

})();

/******************************************************************************/

