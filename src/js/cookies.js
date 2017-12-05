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

/* global µMatrix */

// rhill 2013-12-14: the whole cookie management has been rewritten so as
// to avoid having to call chrome API whenever a single cookie changes, and
// to record cookie for a web page *only* when its value changes.
// https://github.com/gorhill/httpswitchboard/issues/79

"use strict";

/******************************************************************************/

// Isolate from global namespace

// Use cached-context approach rather than object-based approach, as details
// of the implementation do not need to be visible

µMatrix.cookieHunter = (function() {

/******************************************************************************/

var µm = µMatrix;

var recordPageCookiesQueue = new Map();
var removePageCookiesQueue = new Map();
var removeCookieQueue = new Set();
var cookieDict = new Map();
var cookieEntryJunkyard = [];
var processRemoveQueuePeriod = 2 * 60 * 1000;
var processCleanPeriod = 10 * 60 * 1000;
var processPageRecordQueueTimer = null;
var processPageRemoveQueueTimer = null;

/******************************************************************************/

var CookieEntry = function(cookie) {
    this.usedOn = new Set();
    this.init(cookie);
};

CookieEntry.prototype.init = function(cookie) {
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
};

// Release anything which may consume too much memory

CookieEntry.prototype.dispose = function() {
    this.hostname = '';
    this.domain = '';
    this.path = '';
    this.name = '';
    this.value = '';
    this.usedOn.clear();
    return this;
};

/******************************************************************************/

var addCookieToDict = function(cookie) {
    var cookieKey = cookieKeyFromCookie(cookie),
        cookieEntry = cookieDict.get(cookieKey);
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

var addCookiesToDict = function(cookies) {
    var i = cookies.length;
    while ( i-- ) {
        addCookieToDict(cookies[i]);
    }
};

/******************************************************************************/

var removeCookieFromDict = function(cookieKey) {
    var cookieEntry = cookieDict.get(cookieKey);
    if ( cookieEntry === undefined ) { return false; }
    cookieDict.delete(cookieKey);
    if ( cookieEntryJunkyard.length < 25 ) {
        cookieEntryJunkyard.push(cookieEntry.dispose());
    }
    return true;
};

/******************************************************************************/

var cookieKeyBuilder = [
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

var cookieKeyFromCookie = function(cookie) {
    var cb = cookieKeyBuilder;
    cb[0] = cookie.secure ? 'https' : 'http';
    cb[2] = cookie.domain.charAt(0) === '.' ? cookie.domain.slice(1) : cookie.domain;
    cb[3] = cookie.path;
    cb[5] = cookie.session ? 'session' : 'persistent';
    cb[7] = cookie.name;
    return cb.join('');
};

var cookieKeyFromCookieURL = function(url, type, name) {
    var µmuri = µm.URI.set(url);
    var cb = cookieKeyBuilder;
    cb[0] = µmuri.scheme;
    cb[2] = µmuri.hostname;
    cb[3] = µmuri.path;
    cb[5] = type;
    cb[7] = name;
    return cb.join('');
};

/******************************************************************************/

var cookieURLFromCookieEntry = function(entry) {
    if ( !entry ) {
        return '';
    }
    return (entry.secure ? 'https://' : 'http://') + entry.hostname + entry.path;
};

/******************************************************************************/

var cookieMatchDomains = function(cookieKey, allHostnamesString) {
    var cookieEntry = cookieDict.get(cookieKey);
    if ( cookieEntry === undefined ) { return false; }
    if ( allHostnamesString.indexOf(' ' + cookieEntry.hostname + ' ') < 0 ) {
        if ( !cookieEntry.anySubdomain ) {
            return false;
        }
        if ( allHostnamesString.indexOf('.' + cookieEntry.hostname + ' ') < 0 ) {
            return false;
        }
    }
    return true;
};

/******************************************************************************/

// Look for cookies to record for a specific web page

var recordPageCookiesAsync = function(pageStats) {
    // Store the page stats objects so that it doesn't go away
    // before we handle the job.
    // rhill 2013-10-19: pageStats could be nil, for example, this can
    // happens if a file:// ... makes an xmlHttpRequest
    if ( !pageStats ) {
        return;
    }
    recordPageCookiesQueue.set(pageStats.pageUrl, pageStats);
    if ( processPageRecordQueueTimer === null ) {
        processPageRecordQueueTimer = vAPI.setTimeout(processPageRecordQueue, 1000);
    }
};

/******************************************************************************/

var cookieLogEntryBuilder = [
    '',
    '{',
    '',
    '-cookie:',
    '',
    '}'
];

var recordPageCookie = function(pageStore, cookieKey) {
    if ( vAPI.isBehindTheSceneTabId(pageStore.tabId) ) { return; }

    var cookieEntry = cookieDict.get(cookieKey);
    var pageHostname = pageStore.pageHostname;
    var block = µm.mustBlock(pageHostname, cookieEntry.hostname, 'cookie');

    cookieLogEntryBuilder[0] = cookieURLFromCookieEntry(cookieEntry);
    cookieLogEntryBuilder[2] = cookieEntry.session ? 'session' : 'persistent';
    cookieLogEntryBuilder[4] = encodeURIComponent(cookieEntry.name);

    var cookieURL = cookieLogEntryBuilder.join('');

    // rhill 2013-11-20:
    // https://github.com/gorhill/httpswitchboard/issues/60
    // Need to URL-encode cookie name
    pageStore.recordRequest('cookie', cookieURL, block);
    µm.logger.writeOne(pageStore.tabId, 'net', pageHostname, cookieURL, 'cookie', block);

    cookieEntry.usedOn.add(pageHostname);

    // rhill 2013-11-21:
    // https://github.com/gorhill/httpswitchboard/issues/65
    // Leave alone cookies from behind-the-scene requests if
    // behind-the-scene processing is disabled.
    if ( !block ) {
        return;
    }
    if ( !µm.userSettings.deleteCookies ) {
        return;
    }
    removeCookieAsync(cookieKey);
};

/******************************************************************************/

// Look for cookies to potentially remove for a specific web page

var removePageCookiesAsync = function(pageStats) {
    // Hold onto pageStats objects so that it doesn't go away
    // before we handle the job.
    // rhill 2013-10-19: pageStats could be nil, for example, this can
    // happens if a file:// ... makes an xmlHttpRequest
    if ( !pageStats ) {
        return;
    }
    removePageCookiesQueue.set(pageStats.pageUrl, pageStats);
    if ( processPageRemoveQueueTimer === null ) {
        processPageRemoveQueueTimer = vAPI.setTimeout(processPageRemoveQueue, 15 * 1000);
    }
};

/******************************************************************************/

// Candidate for removal

var removeCookieAsync = function(cookieKey) {
    removeCookieQueue.add(cookieKey);
};

/******************************************************************************/

var chromeCookieRemove = function(cookieEntry, name) {
    var url = cookieURLFromCookieEntry(cookieEntry);
    if ( url === '' ) {
        return;
    }
    var sessionCookieKey = cookieKeyFromCookieURL(url, 'session', name);
    var persistCookieKey = cookieKeyFromCookieURL(url, 'persistent', name);
    var callback = function(details) {
        var success = !!details;
        var template = success ? i18nCookieDeleteSuccess : i18nCookieDeleteFailure;
        if ( removeCookieFromDict(sessionCookieKey) ) {
            if ( success ) {
                µm.cookieRemovedCounter += 1;
            }
            µm.logger.writeOne('', 'info', 'cookie', template.replace('{{value}}', sessionCookieKey));
        }
        if ( removeCookieFromDict(persistCookieKey) ) {
            if ( success ) {
                µm.cookieRemovedCounter += 1;
            }
            µm.logger.writeOne('', 'info', 'cookie', template.replace('{{value}}', persistCookieKey));
        }
    };

    vAPI.cookies.remove({ url: url, name: name }, callback);
};

var i18nCookieDeleteSuccess = vAPI.i18n('loggerEntryCookieDeleted');
var i18nCookieDeleteFailure = vAPI.i18n('loggerEntryDeleteCookieError');

/******************************************************************************/

var processPageRecordQueue = function() {
    processPageRecordQueueTimer = null;

    for ( var pageStore of recordPageCookiesQueue.values() ) {
        findAndRecordPageCookies(pageStore);
    }
    recordPageCookiesQueue.clear();
};

/******************************************************************************/

var processPageRemoveQueue = function() {
    processPageRemoveQueueTimer = null;

    for ( var pageStore of removePageCookiesQueue.values() ) {
        findAndRemovePageCookies(pageStore);
    }
    removePageCookiesQueue.clear();
};

/******************************************************************************/

// Effectively remove cookies.

var processRemoveQueue = function() {
    var userSettings = µm.userSettings;
    var deleteCookies = userSettings.deleteCookies;

    // Session cookies which timestamp is *after* tstampObsolete will
    // be left untouched
    // https://github.com/gorhill/httpswitchboard/issues/257
    var tstampObsolete = userSettings.deleteUnusedSessionCookies ?
        Date.now() - userSettings.deleteUnusedSessionCookiesAfter * 60 * 1000 :
        0;

    var srcHostnames;
    var cookieEntry;

    for ( var cookieKey of removeCookieQueue ) {
        // rhill 2014-05-12: Apparently this can happen. I have to
        // investigate how (A session cookie has same name as a
        // persistent cookie?)
        cookieEntry = cookieDict.get(cookieKey);
        if ( cookieEntry === undefined ) { continue; }

        // Delete obsolete session cookies: enabled.
        if ( tstampObsolete !== 0 && cookieEntry.session ) {
            if ( cookieEntry.tstamp < tstampObsolete ) {
                chromeCookieRemove(cookieEntry, cookieEntry.name);
                continue;
            }
        }

        // Delete all blocked cookies: disabled.
        if ( deleteCookies === false ) {
            continue;
        }

        // Query scopes only if we are going to use them
        if ( srcHostnames === undefined ) {
            srcHostnames = µm.tMatrix.extractAllSourceHostnames();
        }

        // Ensure cookie is not allowed on ALL current web pages: It can
        // happen that a cookie is blacklisted on one web page while
        // being whitelisted on another (because of per-page permissions).
        if ( canRemoveCookie(cookieKey, srcHostnames) ) {
            chromeCookieRemove(cookieEntry, cookieEntry.name);
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

var processClean = function() {
    var us = µm.userSettings;
    if ( us.deleteCookies || us.deleteUnusedSessionCookies ) {
        var cookieKeys = Array.from(cookieDict.keys()),
            len = cookieKeys.length,
            step, offset, n;
        if ( len > 25 ) {
            step = len / 25;
            offset = Math.floor(Math.random() * len);
            n = 25;
        } else {
            step = 1;
            offset = 0;
            n = len;
        }
        var i = offset;
        while ( n-- ) {
            removeCookieAsync(cookieKeys[Math.floor(i % len)]);
            i += step;
        }
    }

    vAPI.setTimeout(processClean, processCleanPeriod);
};

/******************************************************************************/

var findAndRecordPageCookies = function(pageStore) {
    for ( var cookieKey of cookieDict.keys() ) {
        if ( cookieMatchDomains(cookieKey, pageStore.allHostnamesString) ) {
            recordPageCookie(pageStore, cookieKey);
        }
    }
};

/******************************************************************************/

var findAndRemovePageCookies = function(pageStore) {
    for ( var cookieKey of cookieDict.keys() ) {
        if ( cookieMatchDomains(cookieKey, pageStore.allHostnamesString) ) {
            removeCookieAsync(cookieKey);
        }
    }
};

/******************************************************************************/

var canRemoveCookie = function(cookieKey, srcHostnames) {
    var cookieEntry = cookieDict.get(cookieKey);
    if ( cookieEntry === undefined ) { return false; }

    var cookieHostname = cookieEntry.hostname;
    var srcHostname;

    for ( srcHostname of cookieEntry.usedOn ) {
        if ( µm.mustAllow(srcHostname, cookieHostname, 'cookie') ) {
            return false;
        }
    }
    // Maybe there is a scope in which the cookie is 1st-party-allowed.
    // For example, if I am logged in into `github.com`, I do not want to be 
    // logged out just because I did not yet open a `github.com` page after 
    // re-starting the browser.
    srcHostname = cookieHostname;
    var pos;
    for (;;) {
        if ( srcHostnames.has(srcHostname) ) {
            if ( µm.mustAllow(srcHostname, cookieHostname, 'cookie') ) {
                return false;
            }
        }
        if ( srcHostname === cookieEntry.domain ) {
            break;
        }
        pos = srcHostname.indexOf('.');
        if ( pos === -1 ) {
            break;
        }
        srcHostname = srcHostname.slice(pos + 1);
    }
    return true;
};

/******************************************************************************/

// Listen to any change in cookieland, we will update page stats accordingly.

vAPI.cookies.onChanged = function(cookie) {
    // rhill 2013-12-11: If cookie value didn't change, no need to record.
    // https://github.com/gorhill/httpswitchboard/issues/79
    var cookieKey = cookieKeyFromCookie(cookie);
    var cookieEntry = cookieDict.get(cookieKey);
    if ( cookieEntry === undefined ) {
        cookieEntry = addCookieToDict(cookie);
    } else {
        cookieEntry.tstamp = Date.now();
        if ( cookie.value === cookieEntry.value ) { return; }
        cookieEntry.value = cookie.value;
    }

    // Go through all pages and update if needed, as one cookie can be used
    // by many web pages, so they need to be recorded for all these pages.
    var pageStores = µm.pageStores;
    var pageStore;
    for ( var tabId in pageStores ) {
        if ( pageStores.hasOwnProperty(tabId) === false ) {
            continue;
        }
        pageStore = pageStores[tabId];
        if ( !cookieMatchDomains(cookieKey, pageStore.allHostnamesString) ) {
            continue;
        }
        recordPageCookie(pageStore, cookieKey);
    }
};

/******************************************************************************/

// Listen to any change in cookieland, we will update page stats accordingly.

vAPI.cookies.onRemoved = function(cookie) {
    var cookieKey = cookieKeyFromCookie(cookie);
    if ( removeCookieFromDict(cookieKey) ) {
        µm.logger.writeOne('', 'info', 'cookie', i18nCookieDeleteSuccess.replace('{{value}}', cookieKey));
    }
};

/******************************************************************************/

// Listen to any change in cookieland, we will update page stats accordingly.

vAPI.cookies.onAllRemoved = function() {
    for ( var cookieKey of cookieDict.keys() ) {
        if ( removeCookieFromDict(cookieKey) ) {
            µm.logger.writeOne('', 'info', 'cookie', i18nCookieDeleteSuccess.replace('{{value}}', cookieKey));
        }
    }
};

/******************************************************************************/

vAPI.cookies.getAll(addCookiesToDict);
vAPI.cookies.start();

vAPI.setTimeout(processRemoveQueue, processRemoveQueuePeriod);
vAPI.setTimeout(processClean, processCleanPeriod);

/******************************************************************************/

// Expose only what is necessary

return {
    recordPageCookies: recordPageCookiesAsync,
    removePageCookies: removePageCookiesAsync
};

/******************************************************************************/

})();

/******************************************************************************/

