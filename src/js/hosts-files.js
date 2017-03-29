/*******************************************************************************

    uMatrix - a Chromium browser extension to black/white list requests.
    Copyright (C) 2014-2017 Raymond Hill

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

/* global uDom */

'use strict';

/******************************************************************************/

(function() {

/******************************************************************************/

var listDetails = {},
    lastUpdateTemplateString = vAPI.i18n('hostsFilesLastUpdate'),
    hostsFilesSettingsHash,
    reValidExternalList = /[a-z-]+:\/\/\S*\/\S+/;

/******************************************************************************/

var onMessage = function(msg) {
    switch ( msg.what ) {
    case 'assetUpdated':
        updateAssetStatus(msg);
        break;
    case 'assetsUpdated':
        document.body.classList.remove('updating');
        break;
    case 'loadHostsFilesCompleted':
        renderHostsFiles();
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

var renderHostsFiles = function(soft) {
    var listEntryTemplate = uDom('#templates .listEntry'),
        listStatsTemplate = vAPI.i18n('hostsFilesPerFileStats'),
        renderElapsedTimeToString = vAPI.i18n.renderElapsedTimeToString,
        reExternalHostFile = /^https?:/;

    // Assemble a pretty list name if possible
    var listNameFromListKey = function(listKey) {
        var list = listDetails.current[listKey] || listDetails.available[listKey];
        var listTitle = list ? list.title : '';
        if ( listTitle === '' ) { return listKey; }
        return listTitle;
    };

    var liFromListEntry = function(listKey, li) {
        var entry = listDetails.available[listKey],
            elem;
        if ( !li ) {
            li = listEntryTemplate.clone().nodeAt(0);
        }
        if ( li.getAttribute('data-listkey') !== listKey ) {
            li.setAttribute('data-listkey', listKey);
            elem = li.querySelector('input[type="checkbox"]');
            elem.checked = entry.off !== true;
            elem = li.querySelector('a:nth-of-type(1)');
            elem.setAttribute('href', 'asset-viewer.html?url=' + encodeURI(listKey));
            elem.setAttribute('type', 'text/html');
            elem.textContent = listNameFromListKey(listKey);
            li.classList.remove('toRemove');
            if ( entry.supportName ) {
                li.classList.add('support');
                elem = li.querySelector('a.support');
                elem.setAttribute('href', entry.supportURL);
                elem.setAttribute('title', entry.supportName);
            } else {
                li.classList.remove('support');
            }
            if ( entry.external ) {
                li.classList.add('external');
            } else {
                li.classList.remove('external');
            }
            if ( entry.instructionURL ) {
                li.classList.add('mustread');
                elem = li.querySelector('a.mustread');
                elem.setAttribute('href', entry.instructionURL);
            } else {
                li.classList.remove('mustread');
            }
        }
        // https://github.com/gorhill/uBlock/issues/1429
        if ( !soft ) {
            elem = li.querySelector('input[type="checkbox"]');
            elem.checked = entry.off !== true;
        }
        elem = li.querySelector('span.counts');
        var text = '';
        if ( !isNaN(+entry.entryUsedCount) && !isNaN(+entry.entryCount) ) {
            text = listStatsTemplate
                .replace('{{used}}', renderNumber(entry.off ? 0 : entry.entryUsedCount))
                .replace('{{total}}', renderNumber(entry.entryCount));
        }
        elem.textContent = text;
        // https://github.com/chrisaljoudi/uBlock/issues/104
        var asset = listDetails.cache[listKey] || {};
        var remoteURL = asset.remoteURL;
        li.classList.toggle(
            'unsecure',
            typeof remoteURL === 'string' && remoteURL.lastIndexOf('http:', 0) === 0
        );
        li.classList.toggle('failed', asset.error !== undefined);
        li.classList.toggle('obsolete', asset.obsolete === true);
        li.classList.toggle('cached', asset.cached === true && asset.writeTime > 0);
        if ( asset.cached ) {
            li.querySelector('.status.cache').setAttribute(
                'title',
                lastUpdateTemplateString.replace('{{ago}}', renderElapsedTimeToString(asset.writeTime))
            );
        }
        li.classList.remove('discard');
        return li;
    };

    var onListsReceived = function(details) {
        // Before all, set context vars
        listDetails = details;

        // Incremental rendering: this will allow us to easily discard unused
        // DOM list entries.
        uDom('#lists .listEntry').addClass('discard');

        var availableLists = details.available,
            listKeys = Object.keys(details.available);

        // Sort works this way:
        // - Send /^https?:/ items at the end (custom hosts file URL)
        listKeys.sort(function(a, b) {
            var ta = availableLists[a].title || a,
                tb = availableLists[b].title || b;
            if ( reExternalHostFile.test(ta) === reExternalHostFile.test(tb) ) {
                return ta.localeCompare(tb);
            }
            return reExternalHostFile.test(tb) ? -1 : 1;
        });

        var ulList = document.querySelector('#lists');
        for ( var i = 0; i < listKeys.length; i++ ) {
            var liEntry = liFromListEntry(listKeys[i], ulList.children[i]);
            if ( liEntry.parentElement === null ) {
                ulList.appendChild(liEntry);
            }
        }

        uDom('#lists .listEntry.discard').remove();
        uDom('#listsOfBlockedHostsPrompt').text(
            vAPI.i18n('hostsFilesStats').replace(
                '{{blockedHostnameCount}}',
                renderNumber(details.blockedHostnameCount)
            )
        );
        uDom('#autoUpdate').prop('checked', listDetails.autoUpdate === true);

        if ( !soft ) {
            hostsFilesSettingsHash = hashFromCurrentFromSettings();
        }
        renderWidgets();
    };

    messager.send({ what: 'getLists' }, onListsReceived);
};

/******************************************************************************/

var renderWidgets = function() {
    uDom('#buttonUpdate').toggleClass('disabled', document.querySelector('body:not(.updating) #lists .listEntry.obsolete > input[type="checkbox"]:checked') === null);
    uDom('#buttonPurgeAll').toggleClass('disabled', document.querySelector('#lists .listEntry.cached') === null);
    uDom('#buttonApply').toggleClass('disabled', hostsFilesSettingsHash === hashFromCurrentFromSettings());
};

/******************************************************************************/

var updateAssetStatus = function(details) {
    var li = document.querySelector('#lists .listEntry[data-listkey="' + details.key + '"]');
    if ( li === null ) { return; }
    li.classList.toggle('failed', !!details.failed);
    li.classList.toggle('obsolete', !details.cached);
    li.classList.toggle('cached', !!details.cached);
    if ( details.cached ) {
        li.querySelector('.status.cache').setAttribute(
            'title',
            lastUpdateTemplateString.replace(
                '{{ago}}',
                vAPI.i18n.renderElapsedTimeToString(Date.now())
            )
        );
    }
    renderWidgets();
};

/*******************************************************************************

    Compute a hash from all the settings affecting how filter lists are loaded
    in memory.

**/

var hashFromCurrentFromSettings = function() {
    var hash = [],
        listHash = [],
        listEntries = document.querySelectorAll('#lists .listEntry[data-listkey]:not(.toRemove)'),
        liEntry,
        i = listEntries.length;
    while ( i-- ) {
        liEntry = listEntries[i];
        if ( liEntry.querySelector('input[type="checkbox"]:checked') !== null ) {
            listHash.push(liEntry.getAttribute('data-listkey'));
        }
    }
    hash.push(
        listHash.sort().join(),
        reValidExternalList.test(document.getElementById('externalHostsFiles').value),
        document.querySelector('#lists .listEntry.toRemove') !== null
    );
    return hash.join();
};

/******************************************************************************/

var onHostsFilesSettingsChanged = function() {
    renderWidgets();
};

/******************************************************************************/

var onRemoveExternalHostsFile = function(ev) {
    var liEntry = uDom(this).ancestors('[data-listkey]'),
        listKey = liEntry.attr('data-listkey');
    if ( listKey ) {
        liEntry.toggleClass('toRemove');
        renderWidgets();
    }
    ev.preventDefault();
};

/******************************************************************************/

var onPurgeClicked = function() {
    var button = uDom(this),
        liEntry = button.ancestors('[data-listkey]'),
        listKey = liEntry.attr('data-listkey');
    if ( !listKey ) { return; }

    messager.send({ what: 'purgeCache', assetKey: listKey });
    liEntry.addClass('obsolete');
    liEntry.removeClass('cached');

    if ( liEntry.descendants('input').first().prop('checked') ) {
        renderWidgets();
    }
};

/******************************************************************************/

var selectHostsFiles = function(callback) {
    // Hosts files to select
    var toSelect = [],
        liEntries = document.querySelectorAll('#lists .listEntry[data-listkey]:not(.toRemove)'),
        i = liEntries.length,
        liEntry;
    while ( i-- ) {
        liEntry = liEntries[i];
        if ( liEntry.querySelector('input[type="checkbox"]:checked') !== null ) {
            toSelect.push(liEntry.getAttribute('data-listkey'));
        }
    }

    // External hosts files to remove
    var toRemove = [];
    liEntries = document.querySelectorAll('#lists .listEntry.toRemove[data-listkey]');
    i = liEntries.length;
    while ( i-- ) {
        toRemove.push(liEntries[i].getAttribute('data-listkey'));
    }

    // External hosts files to import
    var externalListsElem = document.getElementById('externalHostsFiles'),
        toImport = externalListsElem.value.trim();
    externalListsElem.value = '';

    messager.send({
            what: 'selectHostsFiles',
            toSelect: toSelect,
            toImport: toImport,
            toRemove: toRemove
        },
        callback
    );

    hostsFilesSettingsHash = hashFromCurrentFromSettings();
};

/******************************************************************************/

var buttonApplyHandler = function() {
    uDom('#buttonApply').removeClass('enabled');
    selectHostsFiles(function() {
        messager.send({ what: 'reloadHostsFiles' });
    });
    renderWidgets();
};

/******************************************************************************/

var buttonUpdateHandler = function() {
    uDom('#buttonUpdate').removeClass('enabled');
    selectHostsFiles(function() {
        document.body.classList.add('updating');
        messager.send({ what: 'forceUpdateAssets' });
        renderWidgets();
    });
    renderWidgets();
};

/******************************************************************************/

var buttonPurgeAllHandler = function() {
    uDom('#buttonPurgeAll').removeClass('enabled');
    messager.send({ what: 'purgeAllCaches' }, function() {
        renderHostsFiles(true);
    });
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

uDom('#autoUpdate').on('change', autoUpdateCheckboxChanged);
uDom('#buttonApply').on('click', buttonApplyHandler);
uDom('#buttonUpdate').on('click', buttonUpdateHandler);
uDom('#buttonPurgeAll').on('click', buttonPurgeAllHandler);
uDom('#lists').on('change', '.listEntry > input', onHostsFilesSettingsChanged);
uDom('#lists').on('click', '.listEntry > a.remove', onRemoveExternalHostsFile);
uDom('#lists').on('click', 'span.cache', onPurgeClicked);
uDom('#externalHostsFiles').on('input', onHostsFilesSettingsChanged);

renderHostsFiles();

/******************************************************************************/

})();

