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
var tableFriendlyTypeNames = {
   'main_frame': 'page',
   'stylesheet': 'css',
   'sub_frame': 'frame',
   'xmlhttprequest': 'xhr'
};

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
        $(key).text(renderNumber(set[key]));
    }
}

/******************************************************************************/

var renderLocalized = function(id, map) {
    var el = $('#' + id);
    var msg = chrome.i18n.getMessage(id);
    for ( var k in map ) {
        if ( map.hasOwnProperty(k) === false ) {
            continue;
        }
        msg = msg.replace('{{' + k + '}}', map[k]);
    }
    el.html(msg);
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
            '#blockedMainFrameCount': blockedStats.main_frame,
            '#blockedCookieCount': blockedStats.cookie,
            '#blockedStylesheetCount': blockedStats.stylesheet,
            '#blockedImageCount': blockedStats.image,
            '#blockedObjectCount': blockedStats.object,
            '#blockedScriptCount': blockedStats.script,
            '#blockedXHRCount': blockedStats.xmlhttprequest,
            '#blockedSubFrameCount': blockedStats.sub_frame,
            '#blockedOtherCount': blockedStats.other,
            '#allowedAllCount': allowedStats.all,
            '#allowedMainFrameCount': allowedStats.main_frame,
            '#allowedCookieCount': allowedStats.cookie,
            '#allowedStylesheetCount': allowedStats.stylesheet,
            '#allowedImageCount': allowedStats.image,
            '#allowedObjectCount': allowedStats.object,
            '#allowedScriptCount': allowedStats.script,
            '#allowedXHRCount': allowedStats.xmlhttprequest,
            '#allowedSubFrameCount': allowedStats.sub_frame,
            '#allowedOtherCount': allowedStats.other
        });

        // because some i18n messages may contain links
        $('a').attr('target', '_blank');
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
    var jqRow = $(row);
    row = jqRow[0];
    jqRow.attr('id', '');
    jqRow.css('display', '');
    jqRow.removeClass();
    if ( request.block !== false ) {
        jqRow.addClass('blocked-true');
    } else {
        jqRow.addClass('blocked-false');
    }
    jqRow.addClass('type-' + request.type);
    var cells = row.cells;

    // when
    var when = new Date(request.when);
    $(cells[0]).text(when.toLocaleTimeString());

    // request type
    var text = tableFriendlyTypeNames[request.type] || request.type;
    $(cells[1]).text(text);

    // Well I got back full control since not using Tempo.js, I can now
    // generate smarter hyperlinks, that is, not hyperlinking fake
    // request URLs, which are recognizable with their curly braces inside.
    var a = $('a', cells[2]);
    if ( request.url.search('{') < 0 ) {
        a.attr('href', request.url);
        a.css('display', '');
    } else {
        a.css('display', 'none');
    }

    // request URL
    $(cells[3]).text(request.url);
}

/*----------------------------------------------------------------------------*/

var renderRequests = function() {
    var onResponseReceived = function(requests) {
        var table = $('#requestsTable');
        var i, row;
        var rowTemplate = table.find('#requestRowTemplate').first();

        // Reuse whatever rows is already in there.
        var rows = table.find('tr:not(.ro)').toArray();
        var n = Math.min(requests.length, rows.length);
        for ( i = 0; i < n; i++ ) {
            renderRequestRow(rows[i], requests[i]);
        }

        // Hide extra rows
        $(rows.slice(0, i)).removeClass('unused');
        $(rows.slice(i)).addClass('unused');

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
    $('input[id^="show-"][type="checkbox"]').each(function() {
        var input = $(this);
        statsFilters[input.attr('id')] = !!input.prop('checked');
    });
    changeUserSettings('statsFilters', statsFilters);

    syncWithFilters();
}

/******************************************************************************/

// Synchronize list of net requests with filter states

function syncWithFilters() {
    var blocked = ['blocked','allowed'];
    var type = ['main_frame','cookie','stylesheet','image','object','script','xmlhttprequest','sub_frame','other'];
    var i = blocked.length;
    var j;
    var display, selector;
    while ( i-- ) {
        j = type.length;
        while ( j-- ) {
            display = $('#show-' + blocked[i]).prop('checked') &&
                      $('#show-' + type[j]).prop('checked') ? '' : 'none';
            selector = '.blocked-' + (blocked[i] === 'blocked') + '.type-' + type[j];
            $(selector).css('display', display);
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
    changeValueHandler($('#max-logged-requests'), 'maxLoggedRequests', 0, 999);
    $('input,button,select').off();
}

/******************************************************************************/

var installEventHandlers = function() {
    $('#refresh-requests').on('click', renderRequests);
    $('input[id^="show-"][type="checkbox"]').on('change', changeFilterHandler);
    $('#selectPageUrls').on('change', targetUrlChangeHandler);
    $('#max-logged-requests').on('change', function(){ changeValueHandler($(this), 'maxLoggedRequests', 0, 999); });

    // https://github.com/gorhill/httpswitchboard/issues/197
    $(window).one('beforeunload', prepareToDie);
};

/******************************************************************************/

$(function(){
    // Initialize request filters as per user settings:
    // https://github.com/gorhill/httpswitchboard/issues/49
    var onResponseReceived = function(userSettings) {
        // cache a copy
        cachedUserSettings = userSettings;
        // init ui as per user settings
        $('#max-logged-requests').val(userSettings.maxLoggedRequests);
        var statsFilters = userSettings.statsFilters;
        $('input[id^="show-"][type="checkbox"]').each(function() {
            var input = $(this);
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
