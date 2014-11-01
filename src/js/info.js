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

/******************************************************************************/

(function() {

/******************************************************************************/

messaging.start('info.js');

var targetUrl = 'all';
var maxRequests = 500;
var cachedUserSettings = {};

/******************************************************************************/

// Get a list of latest net requests

function updateRequestData(callback) {
    var onResponseReceived = function(r) {
        var requests = [];
        for ( var pageURL in r ) {
            if ( r.hasOwnProperty(pageURL) === false ) {
                continue;
            }
            requests = requests.concat(r[pageURL]);
        }
        requests = requests
            .sort(function(a,b){return b.when-a.when;})
            .slice(0, maxRequests);
        callback(requests);
    };
    var request = {
        what: 'getRequestLogs',
        pageURL: targetUrl !== 'all' ? targetUrl : null
    };
    messaging.ask(request, onResponseReceived);
}

/******************************************************************************/

function renderNumber(value) {
    if ( isNaN(value) ) {
        return '0';
    }
    return value.toLocaleString();
}

/******************************************************************************/

function renderNumbers(set) {
    var keys = Object.keys(set);
    var i = keys.length;
    var key;
    while ( i-- ) {
        key = keys[i];
        uDom(key).text(renderNumber(set[key]));
    }
}

/******************************************************************************/

var renderLocalized = function(id, map) {
    var uElem = uDom('#' + id);
    var msg = chrome.i18n.getMessage(id);
    for ( var k in map ) {
        if ( map.hasOwnProperty(k) === false ) {
            continue;
        }
        msg = msg.replace('{{' + k + '}}', map[k]);
    }
    uElem.html(msg);
};

/******************************************************************************/

function renderPageUrls() {
    var onResponseReceived = function(r) {
        var i, n;
        var select = uDom('#selectPageUrls');

        // Remove whatever was put there in a previous call
        uDom('#selectPageUrls > option').remove();
        var builtinOptions = uDom('#selectPageUrlsTemplate > option');
        n = builtinOptions.length;
        for ( i = 0; i < n; i++ ) {
            option = builtinOptions.at(i).clone();
            if ( option.val() === targetUrl ) {
                option.attr('selected', true);
            }
            select.append(option);
        }

        var pageURLs = r.pageURLs.sort();
        var pageURL, option;
        n = pageURLs.length;
        for ( i = 0; i < n; i++ ) {
            pageURL = pageURLs[i];
            // Behind-the-scene entry is always present, no need to recreate it
            if ( pageURL === r.behindTheSceneURL ) {
                continue;
            }
            option = uDom('<option>');
            option.val(pageURL);
            option.text(pageURL);
            if ( pageURL === targetUrl ) {
                option.attr('selected', true);
            }
            select.append(option);
        }
        // Deselect whatever is currently selected
        //uDom('#selectPageUrls > option:selected').prop('selected', false);
        // Select whatever needs to be selected
        //uDom('#selectPageUrls > option[value="'+targetUrl+'"]').prop('selected', true);
    };
    messaging.ask({ what: 'getPageURLs' }, onResponseReceived);
}

/******************************************************************************/

function renderStats() {
    var onResponseReceived = function(r) {
        if ( !r.pageNetStats ) {
            targetUrl = 'all';
        }

        var requestStats = targetUrl === 'all' ? r.globalNetStats : r.pageNetStats;
        var blockedStats = requestStats.blocked;
        var allowedStats = requestStats.allowed;

        renderLocalized('statsPageCookieHeadersFoiled', { count: renderNumber(r.cookieHeaderFoiledCounter) });
        renderLocalized('statsPageRefererHeadersFoiled', { count: renderNumber(r.refererHeaderFoiledCounter) });
        renderLocalized('statsPageHyperlinkAuditingFoiled', { count: renderNumber(r.hyperlinkAuditingFoiledCounter) });
        renderLocalized('statsPageCookiesRemoved', { count: renderNumber(r.cookieRemovedCounter) });
        renderLocalized('statsPageLocalStoragesCleared', { count: renderNumber(r.localStorageRemovedCounter) });
        renderLocalized('statsPageBrowserCacheCleared', { count: renderNumber(r.browserCacheClearedCounter) });

        renderNumbers({
            '#blockedAllCount': requestStats.blocked.all,
            '#blockedMainFrameCount': blockedStats.doc,
            '#blockedCookieCount': blockedStats.cookie,
            '#blockedStylesheetCount': blockedStats.css,
            '#blockedImageCount': blockedStats.image,
            '#blockedObjectCount': blockedStats.plugin,
            '#blockedScriptCount': blockedStats.script,
            '#blockedXHRCount': blockedStats.xhr,
            '#blockedSubFrameCount': blockedStats.frame,
            '#blockedOtherCount': blockedStats.other,
            '#allowedAllCount': allowedStats.all,
            '#allowedMainFrameCount': allowedStats.doc,
            '#allowedCookieCount': allowedStats.cookie,
            '#allowedStylesheetCount': allowedStats.css,
            '#allowedImageCount': allowedStats.image,
            '#allowedObjectCount': allowedStats.plugin,
            '#allowedScriptCount': allowedStats.script,
            '#allowedXHRCount': allowedStats.xhr,
            '#allowedSubFrameCount': allowedStats.frame,
            '#allowedOtherCount': allowedStats.other
        });

        // because some i18n messages may contain links
        uDom('a').attr('target', '_blank');
    };

    messaging.ask({
            what: 'getStats',
            pageURL: targetUrl === 'all' ? null : targetUrl
        },
        onResponseReceived
    );
}

/******************************************************************************/

function renderRequestRow(row, request) {
    row.attr('id', '');
    row.css('display', '');
    row.removeClass();
    if ( request.block !== false ) {
        row.addClass('blocked-true');
    } else {
        row.addClass('blocked-false');
    }
    row.addClass('type-' + request.type);
    var cells = row.descendants('td');

    // when
    var when = new Date(request.when);
    cells.at(0).text(when.toLocaleTimeString());

    // request type
    cells.at(1).text(request.type);

    // Well I got back full control since not using Tempo.js, I can now
    // generate smarter hyperlinks, that is, not hyperlinking fake
    // request URLs, which are recognizable with their curly braces inside.
    var a = cells.at(2).descendants('a');
    if ( request.url.search('{') < 0 ) {
        a.attr('href', request.url);
        a.css('display', '');
    } else {
        a.css('display', 'none');
    }

    // request URL
    cells.at(3).text(request.url);
}

/*----------------------------------------------------------------------------*/

var renderRequests = function() {
    var onResponseReceived = function(requests) {
        var table = uDom('#requestsTable');
        var i, row;
        var rowTemplate = table.descendants('#requestRowTemplate').first();

        // Reuse whatever rows is already in there.
        var rows = table.descendants('tr:not(.ro)');
        var n = Math.min(requests.length, rows.length);
        for ( i = 0; i < n; i++ ) {
            renderRequestRow(rows.at(i), requests[i]);
        }

        // Hide extra rows
        rows.subset(0, i).removeClass('unused');
        rows.subset(i).addClass('unused');

        // Create new rows to receive what is left
        n = requests.length;
        for ( ; i < n; i++ ) {
            row = rowTemplate.clone();
            renderRequestRow(row, requests[i]);
            row.insertBefore(rowTemplate);
        }

        syncWithFilters();
    };
    updateRequestData(onResponseReceived);
};

/******************************************************************************/

function changeUserSettings(name, value) {
    cachedUserSettings[name] = value;
    messaging.tell({
        what: 'userSettings',
        name: name,
        value: value
    });
}

/******************************************************************************/

function changeValueHandler(elem, setting, min, max) {
    var oldVal = cachedUserSettings[setting];
    var newVal = Math.round(parseFloat(elem.val()));
    if ( typeof newVal !== 'number' ) {
        newVal = oldVal;
    } else {
        newVal = Math.max(newVal, min);
        newVal = Math.min(newVal, max);
    }
    elem.val(newVal);
    if ( newVal !== oldVal ) {
        changeUserSettings(setting, newVal);
    }
}

/******************************************************************************/

function changeFilterHandler() {
    // Save new state of filters in user settings
    // Initialize request filters as per user settings:
    // https://github.com/gorhill/httpswitchboard/issues/49
    var statsFilters = cachedUserSettings.statsFilters;
    uDom('input[id^="show-"][type="checkbox"]').toArray().forEach(function() {
        var input = uDom(this);
        statsFilters[input.attr('id')] = !!input.prop('checked');
    });
    changeUserSettings('statsFilters', statsFilters);

    syncWithFilters();
}

/******************************************************************************/

// Synchronize list of net requests with filter states

function syncWithFilters() {
    var blocked = ['blocked','allowed'];
    var type = ['doc','cookie','css','image','plugin','script','xhr','frame','other'];
    var i = blocked.length;
    var j;
    var display, selector;
    while ( i-- ) {
        j = type.length;
        while ( j-- ) {
            display = uDom('#show-' + blocked[i]).prop('checked') &&
                      uDom('#show-' + type[j]).prop('checked') ? '' : 'none';
            selector = '.blocked-' + (blocked[i] === 'blocked') + '.type-' + type[j];
            uDom(selector).css('display', display);
        }
    }
}

/******************************************************************************/

var renderTransientTimer;

function renderTransientData(internal) {
    // This is in case this function is not called from timeout event
    if ( internal && renderTransientTimer ) {
        clearTimeout(renderTransientTimer);
    }
    renderPageUrls();
    renderStats();
    renderTransientTimer = setTimeout(renderTransientData, 10000); // every 10s
}

/******************************************************************************/

function targetUrlChangeHandler() {
    targetUrl = this[this.selectedIndex].value;
    renderStats();
    renderRequests();
}

/******************************************************************************/

function prepareToDie() {
    changeValueHandler(uDom('#max-logged-requests'), 'maxLoggedRequests', 0, 999);
}

/******************************************************************************/

var installEventHandlers = function() {
    uDom('#refresh-requests').on('click', renderRequests);
    uDom('input[id^="show-"][type="checkbox"]').on('change', changeFilterHandler);
    uDom('#selectPageUrls').on('change', targetUrlChangeHandler);
    uDom('#max-logged-requests').on('change', function(){ changeValueHandler(uDom(this), 'maxLoggedRequests', 0, 999); });

    // https://github.com/gorhill/httpswitchboard/issues/197
    window.addEventListener('beforeunload', prepareToDie);
};

/******************************************************************************/

uDom.onLoad(function(){
    // Initialize request filters as per user settings:
    // https://github.com/gorhill/httpswitchboard/issues/49
    var onResponseReceived = function(userSettings) {
        // cache a copy
        cachedUserSettings = userSettings;
        // init ui as per user settings
        uDom('#max-logged-requests').val(userSettings.maxLoggedRequests);
        var statsFilters = userSettings.statsFilters;
        uDom('input[id^="show-"][type="checkbox"]').toArray().forEach(function() {
            var input = uDom(this);
            var filter = statsFilters[input.attr('id')];
            input.prop('checked', filter === undefined || filter === true);
        });

        installEventHandlers();
    };
    messaging.ask({ what: 'getUserSettings' }, onResponseReceived);

    renderTransientData(true);
    renderRequests();
});

/******************************************************************************/

})();
