/*******************************************************************************

    uMatrix - a Chromium browser extension to black/white list requests.
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

/* global uDom */

'use strict';

/******************************************************************************/

(function() {

/******************************************************************************/

var listDetails = {},
    lastUpdateTemplateString = vAPI.i18n('hostsFilesLastUpdate'),
    hostsFilesSettingsHash,
    reValidExternalList = /^[a-z-]+:\/\/\S*\/\S+$/m;

/******************************************************************************/

vAPI.messaging.addListener(function onMessage(msg) {
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
});

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
    var listNameFromListKey = function(collection, listKey) {
        let list = collection.get(listKey);
        let listTitle = list ? list.title : '';
        if ( listTitle === '' ) { return listKey; }
        return listTitle;
    };

    var liFromListEntry = function(collection, listKey, li) {
        var entry = collection.get(listKey),
            elem;
        if ( !li ) {
            li = listEntryTemplate.clone().nodeAt(0);
        }
        if ( li.getAttribute('data-listkey') !== listKey ) {
            li.setAttribute('data-listkey', listKey);
            elem = li.querySelector('input[type="checkbox"]');
            elem.checked = entry.selected === true;
            elem = li.querySelector('a:nth-of-type(1)');
            elem.setAttribute('href', 'asset-viewer.html?url=' + encodeURI(listKey));
            elem.setAttribute('type', 'text/html');
            elem.textContent = listNameFromListKey(collection, listKey);
            li.classList.remove('toRemove');
            elem = li.querySelector('a.support');
            if ( entry.supportURL ) {
                elem.setAttribute(
                    'href',
                    entry.supportURL ? entry.supportURL : ''
                );
            }
            li.classList.toggle('external', entry.external === true);
        }
        // https://github.com/gorhill/uBlock/issues/1429
        if ( !soft ) {
            elem = li.querySelector('input[type="checkbox"]');
            elem.checked = entry.selected === true;
        }
        elem = li.querySelector('span.counts');
        var text = '';
        if ( !isNaN(+entry.entryUsedCount) && !isNaN(+entry.entryCount) ) {
            text = listStatsTemplate
                .replace('{{used}}', renderNumber(entry.selected ? entry.entryUsedCount : 0))
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
    var onRenderAssetFiles = function(collection, listSelector) {
        var assetKeys = Array.from(collection.keys());

        // Sort works this way:
        // - Send /^https?:/ items at the end (custom hosts file URL)
        assetKeys.sort(function(a, b) {
            var ta = collection.get(a).title || a,
                tb = collection.get(b).title || b;
            if ( reExternalHostFile.test(ta) === reExternalHostFile.test(tb) ) {
                return ta.localeCompare(tb);
            }
            return reExternalHostFile.test(tb) ? -1 : 1;
        });

        let ulList = document.querySelector(listSelector),
            liImport = ulList.querySelector('.importURL');
        if ( liImport.parentNode !== null ) {
            liImport.parentNode.removeChild(liImport);
        }
        for ( let i = 0; i < assetKeys.length; i++ ) {
            let liEntry = liFromListEntry(
                collection,
                assetKeys[i],
                ulList.children[i]
            );
            if ( liEntry.parentElement === null ) {
                ulList.appendChild(liEntry);
            }
        }

        ulList.appendChild(liImport);
    };

    var onAssetDataReceived = function(details) {
        // Preprocess.
        details.hosts = new Map(details.hosts);
        details.recipes = new Map(details.recipes);

        // Before all, set context vars
        listDetails = details;

        // Incremental rendering: this will allow us to easily discard unused
        // DOM list entries.
        uDom('#hosts .listEntry:not(.importURL)').addClass('discard');

        onRenderAssetFiles(details.hosts, '#hosts');
        onRenderAssetFiles(details.recipes, '#recipes');

        uDom('.listEntry.discard').remove();

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

    vAPI.messaging.send(
        'hosts-files.js',
        { what: 'getAssets' },
        onAssetDataReceived
    );
};

/******************************************************************************/

var renderWidgets = function() {
    uDom('#buttonUpdate').toggleClass('disabled', document.querySelector('body:not(.updating) .assets .listEntry.obsolete > input[type="checkbox"]:checked') === null);
    uDom('#buttonPurgeAll').toggleClass('disabled', document.querySelector('.assets .listEntry.cached') === null);
    uDom('#buttonApply').toggleClass('disabled', hostsFilesSettingsHash === hashFromCurrentFromSettings());
};

/******************************************************************************/

var updateAssetStatus = function(details) {
    var li = document.querySelector('.assets .listEntry[data-listkey="' + details.key + '"]');
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
        listEntries = document.querySelectorAll('.assets .listEntry[data-listkey]:not(.toRemove)'),
        i = listEntries.length;
    while ( i-- ) {
        let liEntry = listEntries[i];
        if ( liEntry.querySelector('input[type="checkbox"]:checked') !== null ) {
            listHash.push(liEntry.getAttribute('data-listkey'));
        }
    }
    let textarea1 = document.querySelector('.assets .importURL > input[type="checkbox"]:checked ~ textarea');
    let textarea2 = document.querySelector('#recipes .importURL > input[type="checkbox"]:checked ~ textarea');
    hash.push(
        listHash.sort().join(),
        textarea1 !== null && reValidExternalList.test(textarea1.value),
        textarea2 !== null && reValidExternalList.test(textarea2.value),
        document.querySelector('.listEntry.toRemove') !== null
    );
    return hash.join();
};

/******************************************************************************/

var onHostsFilesSettingsChanged = function() {
    renderWidgets();
};

/******************************************************************************/

var onRemoveExternalAsset = function(ev) {
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

    vAPI.messaging.send('hosts-files.js', { what: 'purgeCache', assetKey: listKey });
    liEntry.addClass('obsolete');
    liEntry.removeClass('cached');

    if ( liEntry.descendants('input').first().prop('checked') ) {
        renderWidgets();
    }
};

/******************************************************************************/

var selectAssets = function(callback) {
    var prepareChanges = function(listSelector) {
        var out = {
            toSelect: [],
            toImport: '',
            toRemove: []
        };

        let root = document.querySelector(listSelector);

        let liEntries = root.querySelectorAll('.listEntry[data-listkey]:not(.toRemove)'),
            i = liEntries.length;
        while ( i-- ) {
            let liEntry = liEntries[i];
            if ( liEntry.querySelector('input[type="checkbox"]:checked') !== null ) {
                out.toSelect.push(liEntry.getAttribute('data-listkey'));
            }
        }

        // External hosts files to remove
        liEntries = root.querySelectorAll('.listEntry.toRemove[data-listkey]');
        i = liEntries.length;
        while ( i-- ) {
            out.toRemove.push(liEntries[i].getAttribute('data-listkey'));
        }

        // External hosts files to import
        let input = root.querySelector('.importURL > input[type="checkbox"]:checked');
        if ( input !== null ) {
            let textarea = root.querySelector('.importURL textarea');
            out.toImport = textarea.value.trim();
            textarea.value = '';
            input.checked = false;
        }

        return out;
    };

    vAPI.messaging.send(
        'hosts-files.js',
        {
            what: 'selectAssets',
            hosts: prepareChanges('#hosts'),
            recipes: prepareChanges('#recipes')
        },
        callback
    );

    hostsFilesSettingsHash = hashFromCurrentFromSettings();
};

/******************************************************************************/

var buttonApplyHandler = function() {
    uDom('#buttonApply').removeClass('enabled');
    selectAssets(function(response) {
        if ( response && response.hostsChanged ) {
            vAPI.messaging.send('hosts-files.js', { what: 'reloadHostsFiles' });
        }
        if ( response && response.recipesChanged ) {
            vAPI.messaging.send('hosts-files.js', { what: 'reloadRecipeFiles' });
        }
    });
    renderWidgets();
};

/******************************************************************************/

var buttonUpdateHandler = function() {
    uDom('#buttonUpdate').removeClass('enabled');
    selectAssets(function() {
        document.body.classList.add('updating');
        vAPI.messaging.send('hosts-files.js', { what: 'forceUpdateAssets' });
        renderWidgets();
    });
    renderWidgets();
};

/******************************************************************************/

var buttonPurgeAllHandler = function() {
    uDom('#buttonPurgeAll').removeClass('enabled');
    vAPI.messaging.send(
        'hosts-files.js',
        { what: 'purgeAllCaches' },
        function() {
            renderHostsFiles(true);
        }
    );
};

/******************************************************************************/

var autoUpdateCheckboxChanged = function() {
    vAPI.messaging.send(
        'hosts-files.js',
        {
            what: 'userSettings',
            name: 'autoUpdate',
            value: this.checked
        }
    );
};

/******************************************************************************/

uDom('#autoUpdate').on('change', autoUpdateCheckboxChanged);
uDom('#buttonApply').on('click', buttonApplyHandler);
uDom('#buttonUpdate').on('click', buttonUpdateHandler);
uDom('#buttonPurgeAll').on('click', buttonPurgeAllHandler);
uDom('.assets').on('change', '.listEntry > input', onHostsFilesSettingsChanged);
uDom('.assets').on('input', '.listEntry.importURL textarea', onHostsFilesSettingsChanged);
uDom('.assets').on('click', '.listEntry > a.remove', onRemoveExternalAsset);
uDom('.assets').on('click', 'span.cache', onPurgeClicked);

renderHostsFiles();

/******************************************************************************/

})();

