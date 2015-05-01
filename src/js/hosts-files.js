/*******************************************************************************

    µMatrix - a Chromium browser extension to black/white list requests.
    Copyright (C) 2014-2015 Raymond Hill

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

/* global vAPI, uDom */

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

var listDetails = {};
var externalHostsFiles = '';
var cacheWasPurged = false;
var needUpdate = false;
var hasCachedContent = false;

/******************************************************************************/

var onMessage = function(msg) {
    switch ( msg.what ) {
    case 'loadHostsFilesCompleted':
        renderHostsFiles();
        break;

    case 'forceUpdateAssetsProgress':
        renderBusyOverlay(true, msg.progress);
        if ( msg.done ) {
            messager.send({ what: 'reloadHostsFiles' });
        }
        break;

    default:
        break;
    }
};

var messager = vAPI.messaging.channel('hosts-files.js', onMessage);

/******************************************************************************/

var renderNumber = function(value) {
    return value.toLocaleString();
};

/******************************************************************************/

// TODO: get rid of background page dependencies

var renderHostsFiles = function() {
    var listEntryTemplate = uDom('#templates .listEntry');
    var listStatsTemplate = vAPI.i18n('hostsFilesPerFileStats');
    var lastUpdateString = vAPI.i18n('hostsFilesLastUpdate');
    var renderElapsedTimeToString = vAPI.i18n.renderElapsedTimeToString;

    // Assemble a pretty blacklist name if possible
    var listNameFromListKey = function(listKey) {
        var list = listDetails.current[listKey] || listDetails.available[listKey];
        var listTitle = list ? list.title : '';
        if ( listTitle === '' ) {
            return listKey;
        }
        return listTitle;
    };

    var liFromListEntry = function(listKey) {
        var elem, text;
        var entry = listDetails.available[listKey];
        var li = listEntryTemplate.clone();

        if ( entry.off !== true ) {
            li.descendants('input').attr('checked', '');
        }

        elem = li.descendants('a:nth-of-type(1)');
        elem.attr('href', encodeURI(listKey));
        elem.text(listNameFromListKey(listKey) + '\u200E');

        elem = li.descendants('a:nth-of-type(2)');
        if ( entry.homeDomain ) {
            elem.attr('href', 'http://' + encodeURI(entry.homeHostname));
            elem.text('(' + entry.homeDomain + ')');
            elem.css('display', '');
        }

        elem = li.descendants('span:nth-of-type(1)');
        text = listStatsTemplate
            .replace('{{used}}', renderNumber(!entry.off && !isNaN(+entry.entryUsedCount) ? entry.entryUsedCount : 0))
            .replace('{{total}}', !isNaN(+entry.entryCount) ? renderNumber(entry.entryCount) : '?');
        elem.text(text);

        // https://github.com/gorhill/uBlock/issues/78
        // Badge for non-secure connection
        var remoteURL = listKey;
        if ( remoteURL.lastIndexOf('http:', 0) !== 0 ) {
            remoteURL = entry.homeURL || '';
        }
        if ( remoteURL.lastIndexOf('http:', 0) === 0 ) {
            li.descendants('span.status.unsecure').css('display', '');
        }

        // https://github.com/chrisaljoudi/uBlock/issues/104
        var asset = listDetails.cache[listKey] || {};

        // Badge for update status
        if ( entry.off !== true ) {
            if ( asset.repoObsolete ) {
                li.descendants('span.status.new').css('display', '');
                needUpdate = true;
            } else if ( asset.cacheObsolete ) {
                li.descendants('span.status.obsolete').css('display', '');
                needUpdate = true;
            } else if ( entry.external && !asset.cached ) {
                li.descendants('span.status.obsolete').css('display', '');
                needUpdate = true;
            }
        }

        // In cache
        if ( asset.cached ) {
            elem = li.descendants('span.status.purge');
            elem.css('display', '');
            elem.attr('title', lastUpdateString.replace('{{ago}}', renderElapsedTimeToString(asset.lastModified)));
            hasCachedContent = true;
        }
        return li;
    };

    var onListsReceived = function(details) {
        // Before all, set context vars
        listDetails = details;
        needUpdate = false;
        hasCachedContent = false;

        var availableLists = details.available;
        var listKeys = Object.keys(details.available);
        listKeys.sort(function(a, b) {
            var ta = availableLists[a].title || '';
            var tb = availableLists[b].title || '';
            if ( ta !== '' && tb !== '' ) {
                return ta.localeCompare(tb);
            }
            if ( ta === '' && tb === '' ) {
                return a.localeCompare(b);
            }
            if ( tb === ''  ) {
                return -1;
            }
            return 1;
        });
        var ulList = uDom('#lists').empty();
        for ( var i = 0; i < listKeys.length; i++ ) {
            ulList.append(liFromListEntry(listKeys[i]));
        }

        uDom('#listsOfBlockedHostsPrompt').text(
            vAPI.i18n('hostsFilesStats').replace(
                '{{blockedHostnameCount}}',
                renderNumber(details.blockedHostnameCount)
            )
        );
        uDom('#autoUpdate').prop('checked', listDetails.autoUpdate === true);

        renderWidgets();
        renderBusyOverlay(details.manualUpdate, details.manualUpdateProgress);
    };

    messager.send({ what: 'getLists' }, onListsReceived);
};

/******************************************************************************/

// Progress must be normalized to [0, 1], or can be undefined.

var renderBusyOverlay = function(state, progress) {
    progress = progress || {};
    var showProgress = typeof progress.value === 'number';
    if ( showProgress ) {
        uDom('#busyOverlay > div:nth-of-type(2) > div:first-child').css(
            'width',
            (progress.value * 100).toFixed(1) + '%'
        );
        var text = progress.text || '';
        if ( text !== '' ) {
            uDom('#busyOverlay > div:nth-of-type(2) > div:last-child').text(text);
        }
    }
    uDom('#busyOverlay > div:nth-of-type(2)').css('display', showProgress ? '' : 'none');
    uDom('body').toggleClass('busy', !!state);
};

/******************************************************************************/

// This is to give a visual hint that the selection of blacklists has changed.

var renderWidgets = function() {
    uDom('#buttonApply').toggleClass('disabled', !listsSelectionChanged());
    uDom('#buttonUpdate').toggleClass('disabled', !listsContentChanged());
    uDom('#buttonPurgeAll').toggleClass('disabled', !hasCachedContent);
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
    messager.send({
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
    messager.send({ what: 'purgeCache', path: href });
    button.remove();
    if ( li.descendants('input').first().prop('checked') ) {
        cacheWasPurged = true;
        updateWidgets();
    }
};

/******************************************************************************/

var selectHostsFiles = function(callback) {
    var switches = [];
    var lis = uDom('#lists .listEntry'), li;
    var i = lis.length;
    while ( i-- ) {
        li = lis.at(i);
        switches.push({
            location: li.descendants('a').attr('href'),
            off: li.descendants('input').prop('checked') === false
        });
    }

    messager.send({
        what: 'selectHostsFiles',
        switches: switches
    }, callback);
};

/******************************************************************************/

var buttonApplyHandler = function() {
    uDom('#buttonApply').removeClass('enabled');

    renderBusyOverlay(true);

    var onSelectionDone = function() {
        messager.send({ what: 'reloadHostsFiles' });
    };

    selectHostsFiles(onSelectionDone);

    cacheWasPurged = false;
};

/******************************************************************************/

var buttonUpdateHandler = function() {
    uDom('#buttonUpdate').removeClass('enabled');

    if ( needUpdate ) {
        renderBusyOverlay(true);

        var onSelectionDone = function() {
            messager.send({ what: 'forceUpdateAssets' });
        };

        selectHostsFiles(onSelectionDone);

        cacheWasPurged = false;
    }
};

/******************************************************************************/

var buttonPurgeAllHandler = function() {
    uDom('#buttonPurgeAll').removeClass('enabled');

    renderBusyOverlay(true);

    var onCompleted = function() {
        cacheWasPurged = true;
        renderHostsFiles();
    };

    messager.send({ what: 'purgeAllCaches' }, onCompleted);
};

/******************************************************************************/

var autoUpdateCheckboxChanged = function() {
    messager.send({
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
    messager.send({ what: 'userSettings', name: 'externalHostsFiles' }, onReceived);
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
    messager.send({
        what: 'userSettings',
        name: 'externalHostsFiles',
        value: externalHostsFiles
    });
    renderHostsFiles();
    uDom('#externalListsParse').prop('disabled', true);
};

/******************************************************************************/

uDom.onLoad(function() {
    uDom('#autoUpdate').on('change', autoUpdateCheckboxChanged);
    uDom('#buttonApply').on('click', buttonApplyHandler);
    uDom('#buttonUpdate').on('click', buttonUpdateHandler);
    uDom('#buttonPurgeAll').on('click', buttonPurgeAllHandler);
    uDom('#lists').on('change', '.listEntry > input', onListCheckboxChanged);
    uDom('#lists').on('click', '.listEntry > a:nth-of-type(1)', onListLinkClicked);
    uDom('#lists').on('click', 'span.purge', onPurgeClicked);
    uDom('#externalHostsFiles').on('input', externalListsChangeHandler);
    uDom('#externalListsParse').on('click', externalListsApplyHandler);

    renderHostsFiles();
    renderExternalLists();
});

/******************************************************************************/

})();

