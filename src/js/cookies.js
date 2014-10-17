/*******************************************************************************

    µMatrix - a Chromium browser extension to black/white list requests.
    Copyright (C) 2013  Raymond Hill

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

/******************************************************************************/

// Isolate from global namespace

// Use cached-context approach rather than object-based approach, as details
// of the implementation do not need to be visible

µMatrix.cookieHunter = (function() {

/******************************************************************************/

var recordPageCookiesQueue = {};
var removePageCookiesQueue = {};
var removeCookieQueue = {};
var cookieDict = {};
var cookieEntryJunkyard = [];

/******************************************************************************/

var CookieEntry = function(cookie) {
    this.set(cookie);
};

CookieEntry.prototype.set = function(cookie) {
    this.secure = cookie.secure;
    this.session = cookie.session;
    this.anySubdomain = cookie.domain.charAt(0) === '.';
    this.domain = this.anySubdomain ? cookie.domain.slice(1) : cookie.domain;
    this.path = cookie.path;
    this.name = cookie.name;
    this.value = cookie.value;
    this.tstamp = Date.now();
    return this;
};

// Release anything which may consume too much memory

CookieEntry.prototype.unset = function() {
    this.domain = '';
    this.path = '';
    this.name = '';
    this.value = '';
    return this;
};

/******************************************************************************/

var addCookieToDict = function(cookie) {
    var cookieKey = cookieKeyFromCookie(cookie);
    if ( cookieDict.hasOwnProperty(cookieKey) === false ) {
        var cookieEntry = cookieEntryJunkyard.pop();
        if ( cookieEntry ) {
            cookieEntry.set(cookie);
        } else {
            cookieEntry = new CookieEntry(cookie);
        }
        cookieDict[cookieKey] = cookieEntry;
    }
    return cookieDict[cookieKey];
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
    if ( cookieDict.hasOwnProperty(cookieKey) === false ) {
        return false;
    }
    var cookieEntry = cookieDict[cookieKey];
    delete cookieDict[cookieKey];
    if ( cookieEntryJunkyard.length < 25 ) {
        cookieEntryJunkyard.push(cookieEntry.unset());
    }
    // console.log('cookies.js/removeCookieFromDict()> removed cookie key "%s"', cookieKey);
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
    var µmuri = µMatrix.URI.set(url);
    var cb = cookieKeyBuilder;
    cb[0] = µmuri.scheme;
    cb[2] = µmuri.hostname;
    cb[3] = µmuri.path;
    cb[5] = type;
    cb[7] = name;
    return cb.join('');
};

/******************************************************************************/

var cookieEntryFromCookie = function(cookie) {
    return cookieDict[cookieKeyFromCookie(cookie)];
};

/******************************************************************************/

var cookieURLFromCookieEntry = function(entry) {
    if ( !entry ) {
        return '';
    }
    return (entry.secure ? 'https://' : 'http://') + entry.domain + entry.path;
};

/******************************************************************************/

var cookieMatchDomains = function(cookieKey, domains) {
    var cookieEntry = cookieDict[cookieKey];
    if ( !cookieEntry ) {
        return false;
    }
    if ( domains.indexOf(' ' + cookieEntry.domain + ' ') < 0 ) {
        if ( !cookieEntry.anySubdomain ) {
            return false;
        }
        if ( domains.indexOf('.' + cookieEntry.domain + ' ') < 0 ) {
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
    var pageURL = µMatrix.pageUrlFromPageStats(pageStats);
    recordPageCookiesQueue[pageURL] = pageStats;
    µMatrix.asyncJobs.add(
        'cookieHunterPageRecord',
        null,
        processPageRecordQueue,
        1000,
        false
    );
};

/******************************************************************************/

var cookieLogEntryBuilder = [
    '',
    '{',
    '',
    '_cookie:',
    '',
    '}'
];

var recordPageCookie = function(pageStats, cookieKey) {
    var µm = µMatrix;
    var cookieEntry = cookieDict[cookieKey];
    var pageURL = pageStats.pageUrl;
    var block = µm.mustBlock(µm.scopeFromURL(pageURL), cookieEntry.domain, 'cookie');

    cookieLogEntryBuilder[0] = cookieURLFromCookieEntry(cookieEntry);
    cookieLogEntryBuilder[2] = cookieEntry.session ? 'session' : 'persistent';
    cookieLogEntryBuilder[4] = encodeURIComponent(cookieEntry.name);

    // rhill 2013-11-20:
    // https://github.com/gorhill/httpswitchboard/issues/60
    // Need to URL-encode cookie name
    pageStats.recordRequest(
        'cookie',
        cookieLogEntryBuilder.join(''),
        block
    );

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
    var pageURL = µMatrix.pageUrlFromPageStats(pageStats);
    removePageCookiesQueue[pageURL] = pageStats;
    µMatrix.asyncJobs.add(
        'cookieHunterPageRemove',
        null,
        processPageRemoveQueue,
        15 * 1000,
        false
    );
};

/******************************************************************************/

// Candidate for removal

var removeCookieAsync = function(cookieKey) {
    // console.log('cookies.js/removeCookieAsync()> cookie key = "%s"', cookieKey);
    removeCookieQueue[cookieKey] = true;
};

/******************************************************************************/

var chromeCookieRemove = function(url, name) {
    var callback = function(details) {
        if ( !details ) {
            return;
        }
        var cookieKey = cookieKeyFromCookieURL(details.url, 'session', details.name);
        if ( removeCookieFromDict(cookieKey) ) {
            µMatrix.cookieRemovedCounter += 1;
            return;
        }
        cookieKey = cookieKeyFromCookieURL(details.url, 'persistent', details.name);
        if ( removeCookieFromDict(cookieKey) ) {
            µMatrix.cookieRemovedCounter += 1;
        }
    };

    chrome.cookies.remove({ url: url, name: name }, callback);
};

/******************************************************************************/

var processPageRecordQueue = function() {
    for ( var pageURL in recordPageCookiesQueue ) {
        if ( !recordPageCookiesQueue.hasOwnProperty(pageURL) ) {
            continue;
        }
        findAndRecordPageCookies(recordPageCookiesQueue[pageURL]);
        delete recordPageCookiesQueue[pageURL];
    }
};

/******************************************************************************/

var processPageRemoveQueue = function() {
    for ( var pageURL in removePageCookiesQueue ) {
        if ( !removePageCookiesQueue.hasOwnProperty(pageURL) ) {
            continue;
        }
        findAndRemovePageCookies(removePageCookiesQueue[pageURL]);
        delete removePageCookiesQueue[pageURL];
    }
};

/******************************************************************************/

// Effectively remove cookies.

var processRemoveQueue = function() {
    var userSettings = µMatrix.userSettings;
    var deleteCookies = userSettings.deleteCookies;

    // Session cookies which timestamp is *after* tstampObsolete will
    // be left untouched
    // https://github.com/gorhill/httpswitchboard/issues/257
    var tstampObsolete = userSettings.deleteUnusedSessionCookies ?
        Date.now() - userSettings.deleteUnusedSessionCookiesAfter * 60 * 1000 :
        0;

    var cookieEntry;
    for ( var cookieKey in removeCookieQueue ) {
        if ( removeCookieQueue.hasOwnProperty(cookieKey) === false ) {
            continue;
        }
        delete removeCookieQueue[cookieKey];

        cookieEntry = cookieDict[cookieKey];

        // rhill 2014-05-12: Apparently this can happen. I have to
        // investigate how (A session cookie has same name as a
        // persistent cookie?)
        if ( !cookieEntry ) {
            console.error('HTTP Switchboard> cookies.js/processRemoveQueue(): no cookieEntry for "%s"', cookieKey);
            continue;
        }
        
        // Just in case setting was changed after cookie was put in queue.
        if ( cookieEntry.session === false && deleteCookies === false ) {
            continue;
        }

        // Ensure cookie is not allowed on ALL current web pages: It can
        // happen that a cookie is blacklisted on one web page while
        // being whitelisted on another (because of per-page permissions).
        if ( canRemoveCookie(cookieKey) === false ) {
            // Exception: session cookie may have to be removed even though
            // they are seen as being whitelisted.
            if ( cookieEntry.session === false || cookieEntry.tstamp > tstampObsolete ) {
                continue;
            }
        }

        var url = cookieURLFromCookieEntry(cookieEntry);
        if ( !url ) {
            continue;
        }

        console.debug('µMatrix> cookies.js/processRemoveQueue(): removing "%s" (age=%s min)', cookieKey, ((Date.now() - cookieEntry.tstamp) / 60000).toFixed(1));
        chromeCookieRemove(url, cookieEntry.name);
    }
};

/******************************************************************************/

// Once in a while, we go ahead and clean everything that might have been
// left behind.

var processClean = function() {
    // Remove only some of the cookies which are candidate for removal:
    // who knows, maybe a user has 1000s of cookies sitting in his
    // browser...
    var cookieKeys = Object.keys(cookieDict);
    if ( cookieKeys.length > 25 ) {
        cookieKeys = cookieKeys.sort(function(){return Math.random() < 0.5;}).splice(0, 50);
    }
    while ( cookieKeys.length ) {
        removeCookieAsync(cookieKeys.pop());
    }
};

/******************************************************************************/

var findAndRecordPageCookies = function(pageStats) {
    var domains = ' ' + Object.keys(pageStats.domains).join(' ') + ' ';
    for ( var cookieKey in cookieDict ) {
        if ( !cookieDict.hasOwnProperty(cookieKey) ) {
            continue;
        }
        if ( !cookieMatchDomains(cookieKey, domains) ) {
            continue;
        }
        recordPageCookie(pageStats, cookieKey);
    }
};

/******************************************************************************/

var findAndRemovePageCookies = function(pageStats) {
    var domains = ' ' + Object.keys(pageStats.domains).join(' ') + ' ';
    for ( var cookieKey in cookieDict ) {
        if ( !cookieDict.hasOwnProperty(cookieKey, domains) ) {
            continue;
        }
        if ( !cookieMatchDomains(cookieKey, domains) ) {
            continue;
        }
        removeCookieAsync(cookieKey);
    }
};

/******************************************************************************/

// Check all scopes to ensure none of them fulfill the following
// conditions:
// - The hostname of the target cookie matches the hostname of the scope
// - The target cookie is allowed in the scope
// Check all pages to ensure none of them fulfill both following
// conditions:
// - refers to the target cookie
// - the target cookie is is allowed
// If one of the above set of conditions is fulfilled at least once,
// the cookie can NOT be removed.
// TODO: cache the joining of hostnames into a single string for search
// purpose. 

var canRemoveCookie = function(cookieKey) {
    var entry = cookieDict[cookieKey];
    if ( !entry ) {
        return false;
    }
    var µm = µMatrix;
    var cookieHostname = entry.domain;
    var cookieDomain = µm.URI.domainFromHostname(cookieHostname);

    // rhill 2014-01-11: Do not delete cookies which are whitelisted
    // in at least one scope. Limitation: this can be done only
    // for cookies which domain matches domain of scope. This is
    // because a scope with whitelist *|* would cause all cookies to not
    // be removable.
    // https://github.com/gorhill/httpswitchboard/issues/126
    var srcHostnames = µm.tMatrix.extractAllSourceHostnames();
    var i = srcHostnames.length;
    var srcHostname;
    while ( i-- ) {
        // Cookie related to scope domain?
        srcHostname = µm.URI.domainFromHostname(srcHostnames[i]);
        if ( srcHostname === '' || srcHostname !== cookieDomain ) {
            continue;
        }
        if ( µm.mustBlock(srcHostname, cookieHostname, 'cookie') === false ) {
            // console.log('cookies.js/canRemoveCookie()> can NOT remove "%s" because of scope "%s"', cookieKey, scopeKey);
            return false;
        }
    }

    // If we reach this point, we will check whether the cookie is actually
    // in use for a currently opened web page. This is necessary to
    // prevent the deletion of 3rd-party cookies which might be whitelisted
    // for a currently opened web page.
    var pageStats = µm.pageStats;
    for ( var pageURL in pageStats ) {
        if ( pageStats.hasOwnProperty(pageURL) === false ) {
            continue;
        }
        if ( !cookieMatchDomains(cookieKey, ' ' + Object.keys(pageStats[pageURL].domains).join(' ') + ' ') ) {
            continue;
        }
        if ( µm.mustAllow(µm.scopeFromURL(pageURL), cookieHostname, 'cookie') ) {
            // console.log('cookies.js/canRemoveCookie()> can NOT remove "%s" because of scope "%s"', cookieKey, scopeKey);
            return false;
        }
    }

   // console.log('cookies.js/canRemoveCookie()> can remove "%s"', cookieKey);
   return true;
};

/******************************************************************************/

// Listen to any change in cookieland, we will update page stats accordingly.

var onChromeCookieChanged = function(changeInfo) {
    if ( changeInfo.removed ) {
        return;
    }

    var cookie = changeInfo.cookie;

    // rhill 2013-12-11: If cookie value didn't change, no need to record.
    // https://github.com/gorhill/httpswitchboard/issues/79
    var cookieKey = cookieKeyFromCookie(cookie);
    var cookieEntry = cookieDict[cookieKey];
    if ( !cookieEntry ) {
        cookieEntry = addCookieToDict(cookie);
    } else {
        cookieEntry.tstamp = Date.now();
        if ( cookie.value === cookieEntry.value ) {
            return;
        }
        cookieEntry.value = cookie.value;
    }

    // Go through all pages and update if needed, as one cookie can be used
    // by many web pages, so they need to be recorded for all these pages.
    var allPageStats = µMatrix.pageStats;
    var pageStats;
    for ( var pageURL in allPageStats ) {
        if ( !allPageStats.hasOwnProperty(pageURL) ) {
            continue;
        }
        pageStats = allPageStats[pageURL];
        if ( !cookieMatchDomains(cookieKey, ' ' + Object.keys(pageStats.domains).join(' ') + ' ') ) {
            continue;
        }
        recordPageCookie(pageStats, cookieKey);
    }
};

/******************************************************************************/

chrome.cookies.getAll({}, addCookiesToDict);
chrome.cookies.onChanged.addListener(onChromeCookieChanged);

// µMatrix.asyncJobs.add('cookieHunterRemove', null, processRemoveQueue, 2 * 60 * 1000, true);
// µMatrix.asyncJobs.add('cookieHunterClean', null, processClean, 10 * 60 * 1000, true);

/******************************************************************************/

// Expose only what is necessary

return {
    recordPageCookies: recordPageCookiesAsync,
    removePageCookies: removePageCookiesAsync
};

/******************************************************************************/

})();

/******************************************************************************/

