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

/* global chrome, messaging, uDom */

/******************************************************************************/

(function() {

/******************************************************************************/

var listDetails = {};
var externalHostsFiles = '';
var cacheWasPurged = false;
var needUpdate = false;
var hasCachedContent = false;

var re3rdPartyExternalAsset = /^https?:\/\/[a-z0-9]+/;
var re3rdPartyRepoAsset = /^assets\/thirdparties\/([^\/]+)/;

/******************************************************************************/

messaging.start('hosts-files.js');

var onMessage = function(msg) {
    switch ( msg.what ) {
        case 'loadHostsFilesCompleted':
            renderBlacklists();
            break;

        default:
            break;
    }
};

messaging.listen(onMessage);

/******************************************************************************/

// TODO: get rid of background page dependencies

var renderBlacklists = function() {
    uDom('body').toggleClass('busy', true);

    // Assemble a pretty blacklist name if possible
    var listNameFromListKey = function(listKey) {
        var list = listDetails.current[listKey] || listDetails.available[listKey];
        var listTitle = list ? list.title : '';
        if ( listTitle === '' ) {
            return listKey;
        }
        return listTitle;
    };

    // Assemble a pretty blacklist name if possible
    var htmlFromHomeURL = function(blacklistHref) {
        if ( blacklistHref.indexOf('assets/thirdparties/') !== 0 ) {
            return '';
        }
        var matches = re3rdPartyRepoAsset.exec(blacklistHref);
        if ( matches === null || matches.length !== 2 ) {
            return '';
        }
        var hostname = matches[1];
        var domain = hostname;
        if ( domain === '' ) {
            return '';
        }
        var html = [
            ' <a href="http://',
            hostname,
            '" target="_blank">(',
            domain,
            ')</a>'
        ];
        return html.join('');
    };

    var purgeButtontext = chrome.i18n.getMessage('hostsFilesExternalListPurge');
    var updateButtontext = chrome.i18n.getMessage('hostsFilesExternalListNew');
    var obsoleteButtontext = chrome.i18n.getMessage('hostsFilesExternalListObsolete');
    var liTemplate = [
        '<li class="listDetails">',
        '<input type="checkbox" {{checked}}>',
        ' ',
        '<a href="{{URL}}" type="text/plain">',
        '{{name}}',
        '\u200E</a>',
        '{{homeURL}}',
        ': ',
        '<span class="dim">',
        chrome.i18n.getMessage('hostsFilesPerFileStats'),
        '</span>'
    ].join('');

    var htmlFromLeaf = function(listKey) {
        var html = [];
        var hostsEntry = listDetails.available[listKey];
        var li = liTemplate
            .replace('{{checked}}', hostsEntry.off ? '' : 'checked')
            .replace('{{URL}}', encodeURI(listKey))
            .replace('{{name}}', listNameFromListKey(listKey))
            .replace('{{homeURL}}', htmlFromHomeURL(listKey))
            .replace('{{used}}', !hostsEntry.off && !isNaN(+hostsEntry.entryUsedCount) ? hostsEntry.entryUsedCount.toLocaleString() : '0')
            .replace('{{total}}', !isNaN(+hostsEntry.entryCount) ? hostsEntry.entryCount.toLocaleString() : '?');
        html.push(li);
        // https://github.com/gorhill/uBlock/issues/104
        var asset = listDetails.cache[listKey];
        if ( asset === undefined ) {
            return html.join('\n');
        }
        // Update status
        if ( hostsEntry.off !== true ) {
            var obsolete = asset.repoObsolete ||
                       asset.cacheObsolete ||
                       asset.cached !== true && re3rdPartyExternalAsset.test(listKey);
            if ( obsolete ) {
                html.push(
                    '&ensp;',
                    '<span class="status obsolete">',
                    asset.repoObsolete ? updateButtontext : obsoleteButtontext,
                    '</span>'
                );
                needUpdate = true;
            }
        }
        // In cache
        if ( asset.cached ) {
            html.push(
                '&ensp;',
                '<span class="status purge">',
                purgeButtontext,
                '</span>'
            );
            hasCachedContent = true;
        }
        return html.join('\n');
    };

    var onListsReceived = function(details) {
        // Before all, set context vars
        listDetails = details;
        needUpdate = false;
        hasCachedContent = false;

        // Visually split the filter lists in two groups: built-in and external
        var htmlBuiltin = [];
        var htmlExternal = [];
        var hostsPaths = Object.keys(details.available);
        var hostsPath, hostsEntry;
        for ( var i = 0; i < hostsPaths.length; i++ ) {
            hostsPath = hostsPaths[i];
            hostsEntry = details.available[hostsPath];
            if ( hostsEntry.external ) {
                htmlExternal.push(htmlFromLeaf(hostsPath, hostsEntry));
            } else {
                htmlBuiltin.push(htmlFromLeaf(hostsPath, hostsEntry));
            }
        }
        if ( htmlExternal.length !== 0 ) {
            htmlBuiltin.push('<li>&nbsp;');
        }
        var html = htmlBuiltin.concat(htmlExternal);

        uDom('#listsOfBlockedHostsPrompt').text(
            chrome.i18n.getMessage('hostsFilesStats')
                .replace('{{blockedHostnameCount}}', details.blockedHostnameCount.toLocaleString())
        );
        uDom('#autoUpdate').prop('checked', listDetails.autoUpdate === true);
        uDom('#lists').html(html.join(''));
        uDom('a').attr('target', '_blank');

        updateWidgets();
    };

    messaging.ask({ what: 'getLists' }, onListsReceived);
};

/******************************************************************************/

// Return whether selection of lists changed.

var listsSelectionChanged = function() {
    if ( cacheWasPurged ) {
        return true;
    }
    var availableLists = listDetails.available;
    var currentLists = listDetails.current;
    var location, availableOff, currentOff;
    // This check existing entries
    for ( location in availableLists ) {
        if ( availableLists.hasOwnProperty(location) === false ) {
            continue;
        }
        availableOff = availableLists[location].off === true;
        currentOff = currentLists[location] === undefined || currentLists[location].off === true;
        if ( availableOff !== currentOff ) {
            return true;
        }
    }
    // This check removed entries
    for ( location in currentLists ) {
        if ( currentLists.hasOwnProperty(location) === false ) {
            continue;
        }
        currentOff = currentLists[location].off === true;
        availableOff = availableLists[location] === undefined || availableLists[location].off === true;
        if ( availableOff !== currentOff ) {
            return true;
        }
    }
    return false;
};

/******************************************************************************/

// Return whether content need update.

var listsContentChanged = function() {
    return needUpdate;
};

/******************************************************************************/

// This is to give a visual hint that the selection of blacklists has changed.

var updateWidgets = function() {
    uDom('#buttonApply').toggleClass('disabled', !listsSelectionChanged());
    uDom('#buttonUpdate').toggleClass('disabled', !listsContentChanged());
    uDom('#buttonPurgeAll').toggleClass('disabled', !hasCachedContent);
    uDom('body').toggleClass('busy', false);
};

/******************************************************************************/

var onListCheckboxChanged = function() {
    var href = uDom(this).parent().descendants('a').first().attr('href');
    if ( typeof href !== 'string' ) {
        return;
    }
    if ( listDetails.available[href] === undefined ) {
        return;
    }
    listDetails.available[href].off = !this.checked;
    updateWidgets();
};

/******************************************************************************/

var onListLinkClicked = function(ev) {
    messaging.tell({
        what: 'gotoExtensionURL',
        url: 'asset-viewer.html?url=' + uDom(this).attr('href')
    });
    ev.preventDefault();
};

/******************************************************************************/

var onPurgeClicked = function() {
    var button = uDom(this);
    var li = button.parent();
    var href = li.descendants('a').first().attr('href');
    if ( !href ) {
        return;
    }
    messaging.tell({ what: 'purgeCache', path: href });
    button.remove();
    if ( li.descendants('input').first().prop('checked') ) {
        cacheWasPurged = true;
        updateWidgets();
    }
};

/******************************************************************************/

var reloadAll = function(update) {
    // Loading may take a while when resources are fetched from remote
    // servers. We do not want the user to force reload while we are reloading.
    uDom('body').toggleClass('busy', true);

    // Reload blacklists
    var switches = [];
    var lis = uDom('#lists .listDetails');
    var i = lis.length;
    var path;
    while ( i-- ) {
        path = lis
            .subset(i, 1)
            .descendants('a')
            .attr('href');
        switches.push({
            location: path,
            off: lis.subset(i, 1).descendants('input').prop('checked') === false
        });
    }
    messaging.tell({
        what: 'reloadHostsFiles',
        switches: switches,
        update: update
    });
    cacheWasPurged = false;
};

/******************************************************************************/

var buttonApplyHandler = function() {
    reloadAll(false);
    uDom('#buttonApply').toggleClass('enabled', false);
};

/******************************************************************************/

var buttonUpdateHandler = function() {
    if ( needUpdate ) {
        reloadAll(true);
    }
};

/******************************************************************************/

var buttonPurgeAllHandler = function() {
    var onCompleted = function() {
        renderBlacklists();
    };
    messaging.ask({ what: 'purgeAllCaches' }, onCompleted);
};

/******************************************************************************/

var autoUpdateCheckboxChanged = function() {
    messaging.tell({
        what: 'userSettings',
        name: 'autoUpdate',
        value: this.checked
    });
};

/******************************************************************************/

var renderExternalLists = function() {
    var onReceived = function(details) {
        uDom('#externalHostsFiles').val(details);
        externalHostsFiles = details;
    };
    messaging.ask({ what: 'userSettings', name: 'externalHostsFiles' }, onReceived);
};

/******************************************************************************/

var externalListsChangeHandler = function() {
    uDom('#externalListsParse').prop(
        'disabled',
        this.value.trim() === externalHostsFiles
    );
};

/******************************************************************************/

var externalListsApplyHandler = function() {
    externalHostsFiles = uDom('#externalHostsFiles').val();
    messaging.tell({
        what: 'userSettings',
        name: 'externalHostsFiles',
        value: externalHostsFiles
    });
    renderBlacklists();
    uDom('#externalListsParse').prop('disabled', true);
};

/******************************************************************************/

uDom.onLoad(function() {
    uDom('#autoUpdate').on('change', autoUpdateCheckboxChanged);
    uDom('#buttonApply').on('click', buttonApplyHandler);
    uDom('#buttonUpdate').on('click', buttonUpdateHandler);
    uDom('#buttonPurgeAll').on('click', buttonPurgeAllHandler);
    uDom('#lists').on('change', '.listDetails > input', onListCheckboxChanged);
    uDom('#lists').on('click', '.listDetails > a:nth-of-type(1)', onListLinkClicked);
    uDom('#lists').on('click', 'span.purge', onPurgeClicked);
    uDom('#externalHostsFiles').on('input', externalListsChangeHandler);
    uDom('#externalListsParse').on('click', externalListsApplyHandler);

    renderBlacklists();
    renderExternalLists();
});

/******************************************************************************/

})();

