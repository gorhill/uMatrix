/*******************************************************************************

    uMatrix - a browser extension to black/white list requests.
    Copyright (C) 2014-present Raymond Hill

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

{
// >>>>> start of local scope

/******************************************************************************/

const lastUpdateTemplateString = vAPI.i18n('hostsFilesLastUpdate');
const reValidExternalList = /^[a-z-]+:\/\/\S*\/\S+$/m;
let listDetails = {};
let hostsFilesSettingsHash;

/******************************************************************************/

vAPI.broadcastListener.add(msg => {
    switch ( msg.what ) {
    case 'assetUpdated':
        updateAssetStatus(msg);
        break;
    case 'assetsUpdated':
        document.body.classList.remove('updating');
        renderWidgets();
        break;
    case 'loadHostsFilesCompleted':
        renderHostsFiles();
        break;
    case 'loadRecipeFilesCompleted':
        renderHostsFiles();
        break;
    default:
        break;
    }
});

/******************************************************************************/

const renderNumber = function(value) {
    return value.toLocaleString();
};

/******************************************************************************/

const renderHostsFiles = function(soft) {
    const listEntryTemplate = uDom('#templates .listEntry');
    const listStatsTemplate = vAPI.i18n('hostsFilesPerFileStats');
    const renderElapsedTimeToString = vAPI.i18n.renderElapsedTimeToString;
    const reExternalHostFile = /^https?:/;

    // Assemble a pretty list name if possible
    const listNameFromListKey = function(collection, listKey) {
        let list = collection.get(listKey);
        return list && list.title || listKey;
    };

    const liFromListEntry = function(collection, listKey, li) {
        const entry = collection.get(listKey);
        let elem;
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
        let text = '';
        if ( !isNaN(+entry.entryUsedCount) && !isNaN(+entry.entryCount) ) {
            text = listStatsTemplate
                .replace('{{used}}', renderNumber(entry.selected ? entry.entryUsedCount : 0))
                .replace('{{total}}', renderNumber(entry.entryCount));
        }
        elem.textContent = text;
        // https://github.com/chrisaljoudi/uBlock/issues/104
        const asset = listDetails.cache[listKey] || {};
        const remoteURL = asset.remoteURL;
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
    const onRenderAssetFiles = function(collection, listSelector) {
        // Incremental rendering: this will allow us to easily discard unused
        // DOM list entries.
        uDom(listSelector + ' .listEntry:not(.notAnAsset)').addClass('discard');

        const assetKeys = Array.from(collection.keys());

        // Sort works this way:
        // - Send /^https?:/ items at the end (custom hosts file URL)
        assetKeys.sort(function(a, b) {
            const ea = collection.get(a);
            const eb = collection.get(b);
            if ( ea.submitter !== eb.submitter ) {
                return ea.submitter !== 'user' ? -1 : 1;
            }
            const ta = ea.title || a;
            const tb = eb.title || b;
            if ( reExternalHostFile.test(ta) === reExternalHostFile.test(tb) ) {
                return ta.localeCompare(tb);
            }
            return reExternalHostFile.test(tb) ? -1 : 1;
        });

        const ulList = document.querySelector(listSelector);
        const liLast = ulList.querySelector('.notAnAsset');

        for ( let i = 0; i < assetKeys.length; i++ ) {
            let liReuse = i < ulList.childElementCount
                ? ulList.children[i]
                : null;
            if (
                liReuse !== null &&
                liReuse.classList.contains('notAnAsset')
            ) {
                liReuse = null;
            }
            const liEntry = liFromListEntry(collection, assetKeys[i], liReuse);
            if ( liEntry.parentElement === null ) {
                ulList.insertBefore(liEntry, liLast);
            }
        }
    };

    const onAssetDataReceived = function(details) {
        // Preprocess.
        details.hosts = new Map(details.hosts);
        details.recipes = new Map(details.recipes);

        // Before all, set context vars
        listDetails = details;

        document.body.classList.toggle(
            'contributor',
            listDetails.contributor === true
        );

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

        uDom.nodeFromSelector('#recipes .toInline > input[type="checkbox"]').checked =
            listDetails.userRecipes.enabled === true;
        uDom.nodeFromSelector('#recipes .toInline > textarea').value =
            listDetails.userRecipes.content;


        if ( !soft ) {
            hostsFilesSettingsHash = hashFromCurrentFromSettings();
        }
        renderWidgets();
    };

    vAPI.messaging.send('dashboard', {
        what: 'getAssets',
    }).then(details => {
        onAssetDataReceived(details);
    });
};

/******************************************************************************/

const renderWidgets = function() {
    uDom('#buttonUpdate').toggleClass('disabled', document.querySelector('body:not(.updating) .assets .listEntry.obsolete > input[type="checkbox"]:checked') === null);
    uDom('#buttonPurgeAll').toggleClass('disabled', document.querySelector('.assets .listEntry.cached') === null);
    uDom('#buttonApply').toggleClass('disabled', hostsFilesSettingsHash === hashFromCurrentFromSettings());
};

/******************************************************************************/

const updateAssetStatus = function(details) {
    const li = document.querySelector('.assets .listEntry[data-listkey="' + details.key + '"]');
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

    Compute a hash from all the settings affecting how assets are loaded
    in memory.

**/

const hashFromCurrentFromSettings = function() {
    const listHash = [];
    const listEntries = document.querySelectorAll(
        '.assets .listEntry[data-listkey]:not(.toRemove)'
    );
    for ( const liEntry of listEntries ) {
        if ( liEntry.querySelector('input[type="checkbox"]:checked') !== null ) {
            listHash.push(liEntry.getAttribute('data-listkey'));
        }
    }
    return [
        listHash.join(),
        document.querySelector('.listEntry.toRemove') !== null,
        reValidExternalList.test(
            textFromTextarea(
                '#hosts .toImport > input[type="checkbox"]:checked ~ textarea'
            )
        ),
        textFromTextarea(
            '#hosts .toInline > input[type="checkbox"]:checked ~ textarea'
        ),
        reValidExternalList.test(
            textFromTextarea(
                '#recipes .toImport > input[type="checkbox"]:checked ~ textarea'
            )
        ),
        textFromTextarea(
            '#recipes .toInline > input[type="checkbox"]:checked ~ textarea'
        ),
    ].join('\n');
};

/******************************************************************************/

const textFromTextarea = function(textarea) {
    if ( typeof textarea === 'string' ) {
        textarea = document.querySelector(textarea);
    }
    return textarea !== null ? textarea.value.trim() : '';
};

/******************************************************************************/

const onHostsFilesSettingsChanged = function() {
    renderWidgets();
};

/******************************************************************************/

const onRemoveExternalAsset = function(ev) {
    const liEntry = uDom(this).ancestors('[data-listkey]');
    const listKey = liEntry.attr('data-listkey');
    if ( listKey ) {
        liEntry.toggleClass('toRemove');
        renderWidgets();
    }
    ev.preventDefault();
};

/******************************************************************************/

const onPurgeClicked = function(ev) {
    const button = uDom(ev.target);
    const liEntry = button.ancestors('[data-listkey]');
    const listKey = liEntry.attr('data-listkey');
    if ( !listKey ) { return; }

    vAPI.messaging.send('dashboard', {
        what: 'purgeCache',
        assetKey: listKey,
    });
    liEntry.addClass('obsolete');
    liEntry.removeClass('cached');

    if ( liEntry.descendants('input').first().prop('checked') ) {
        renderWidgets();
    }
};

/******************************************************************************/

const selectAssets = function() {
    const prepareChanges = function(listSelector) {
        const out = {
            toSelect: [],
            toImport: '',
            toRemove: [],
            toInline: {
                enabled: false,
                content: ''
            }
        };

        const root = document.querySelector(listSelector);

        // Lists to select or remove
        const liEntries = root.querySelectorAll(
            '.listEntry[data-listkey]:not(.notAnAsset)'
        );
        for ( const liEntry of liEntries ) {
            if ( liEntry.classList.contains('toRemove') ) {
                out.toRemove.push(liEntry.getAttribute('data-listkey'));
            } else if ( liEntry.querySelector('input[type="checkbox"]:checked') ) {
                out.toSelect.push(liEntry.getAttribute('data-listkey'));
            }
        }

        // External hosts files to import
        const input = root.querySelector(
            '.toImport > input[type="checkbox"]:checked'
        );
        if ( input !== null ) {
            const textarea = root.querySelector('.toImport textarea');
            out.toImport = textarea.value.trim();
            textarea.value = '';
            input.checked = false;
        }

        // Inline data
        out.toInline.enabled = root.querySelector(
            '.toInline > input[type="checkbox"]:checked'
        ) !== null;
        out.toInline.content = textFromTextarea('.toInline > textarea');

        return out;
    };

    hostsFilesSettingsHash = hashFromCurrentFromSettings();

    return vAPI.messaging.send('dashboard', {
        what: 'selectAssets',
        hosts: prepareChanges('#hosts'),
        recipes: prepareChanges('#recipes'),
    });
};

/******************************************************************************/

const buttonApplyHandler = function() {
    uDom('#buttonApply').removeClass('enabled');
    selectAssets().then(response => {
        if ( response instanceof Object === false ) { return; }
        if ( response.hostsChanged ) {
            vAPI.messaging.send('dashboard', { what: 'reloadHostsFiles' });
        }
        if ( response.recipesChanged ) {
            vAPI.messaging.send('dashboard', { what: 'reloadRecipeFiles' });
        }
    });
    renderWidgets();
};

/******************************************************************************/

const buttonUpdateHandler = function() {
    uDom('#buttonUpdate').removeClass('enabled');
    selectAssets().then(( ) => {
        document.body.classList.add('updating');
        vAPI.messaging.send('dashboard', { what: 'forceUpdateAssets' });
        renderWidgets();
    });
    renderWidgets();
};

/******************************************************************************/

const buttonPurgeAllHandler = function() {
    uDom('#buttonPurgeAll').removeClass('enabled');
    vAPI.messaging.send('dashboard', {
        what: 'purgeAllCaches',
    }).then(( ) => {
        renderHostsFiles(true);
    });
};

/******************************************************************************/

const autoUpdateCheckboxChanged = function(ev) {
    vAPI.messaging.send('dashboard', {
        what: 'userSettings',
        name: 'autoUpdate',
        value: ev.target.checked,
    });
};

/******************************************************************************/

uDom('#autoUpdate').on('change', autoUpdateCheckboxChanged);
uDom('#buttonApply').on('click', buttonApplyHandler);
uDom('#buttonUpdate').on('click', buttonUpdateHandler);
uDom('#buttonPurgeAll').on('click', buttonPurgeAllHandler);
uDom('.assets').on('change', '.listEntry > input', onHostsFilesSettingsChanged);
uDom('.assets').on('input', '.listEntry > textarea', onHostsFilesSettingsChanged);
uDom('.assets').on('click', '.listEntry > .remove', onRemoveExternalAsset);
uDom('.assets').on('click', '.status.cache', onPurgeClicked);

renderHostsFiles();

/******************************************************************************/

// <<<<< end of local scope
}
