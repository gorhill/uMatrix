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

/* global chrome, $ */

/******************************************************************************/

(function() {

/******************************************************************************/

var selectedBlacklistsHash = '';

/******************************************************************************/

messaging.start('ubiquitous-rules.js');

var onMessage = function(msg) {
    switch ( msg.what ) {
        case 'loadUbiquitousBlacklistCompleted':
            renderBlacklists();
            selectedBlacklistsChanged();
            break;

        default:
            break;
    }
};

messaging.listen(onMessage);

/******************************************************************************/

function getµm() {
    return chrome.extension.getBackgroundPage().µMatrix;
}

/******************************************************************************/

function changeUserSettings(name, value) {
    messaging.tell({
        what: 'userSettings',
        name: name,
        value: value
    });
}

/******************************************************************************/

// TODO: get rid of background page dependencies

function renderBlacklists() {
    // empty list first
    $('#blacklists .blacklistDetails').remove();

    var µm = getµm();

    $('#ubiquitousListsOfBlockedHostsPrompt2').text(
        chrome.i18n.getMessage('ubiquitousListsOfBlockedHostsPrompt2')
            .replace('{{ubiquitousBlacklistCount}}', µm.ubiquitousBlacklist.count.toLocaleString())
    );

    // Assemble a pretty blacklist name if possible
    var prettifyListName = function(blacklistTitle, blacklistHref) {
        if ( !blacklistTitle ) {
            return blacklistHref;
        }
        if ( blacklistHref.indexOf('assets/thirdparties/') !== 0 ) {
            return blacklistTitle;
        }
        var matches = blacklistHref.match(/^assets\/thirdparties\/([^\/]+)/);
        if ( matches === null || matches.length !== 2 ) {
            return blacklistTitle;
        }
        var hostname = matches[1];
        var domain = µm.URI.domainFromHostname(hostname);
        if ( domain === '' ) {
            return blacklistTitle;
        }
        var html = [
            blacklistTitle,
            ' <i>(<a href="http://',
            hostname,
            '" target="_blank">',
            domain,
            '</a>)</i>'
        ];
        return html.join('');
    };

    var blacklists = µm.remoteBlacklists;
    var ul = $('#blacklists');
    var keys = Object.keys(blacklists);
    var i = keys.length;
    var blacklist, blacklistHref;
    var liTemplate = $('#blacklistTemplate .blacklistDetails').first();
    var li, child, text;
    while ( i-- ) {
        blacklistHref = keys[i];
        blacklist = blacklists[blacklistHref];
        li = liTemplate.clone();
        child = $('input', li);
        child.prop('checked', !blacklist.off);
        child = $('a', li);
        child.attr('href', encodeURI(blacklistHref));
        child.html(prettifyListName(blacklist.title, blacklistHref));
        child = $('span', li);
        text = child.text()
            .replace('{{used}}', !blacklist.off && !isNaN(+blacklist.entryUsedCount) ? blacklist.entryUsedCount.toLocaleString() : '0')
            .replace('{{total}}', !isNaN(+blacklist.entryCount) ? blacklist.entryCount.toLocaleString() : '?')
            ;
        child.text(text);
        ul.prepend(li);
    }
    selectedBlacklistsHash = getSelectedBlacklistsHash();
}

/******************************************************************************/

// Create a hash so that we know whether the selection of preset blacklists
// has changed.

function getSelectedBlacklistsHash() {
    var hash = '';
    var inputs = $('#blacklists .blacklistDetails > input');
    var i = inputs.length;
    var input, entryHash;
    while ( i-- ) {
        input = $(inputs[i]);
        entryHash = input.prop('checked').toString();
        hash += entryHash;
    }

    return hash;
}

/******************************************************************************/

// This is to give a visual hint that the selection of blacklists has changed.

function selectedBlacklistsChanged() {
    $('#blacklistsApply').attr(
        'disabled',
        getSelectedBlacklistsHash() === selectedBlacklistsHash
    );
}

/******************************************************************************/

function blacklistsApplyHandler() {
    var newHash = getSelectedBlacklistsHash();
    if ( newHash === selectedBlacklistsHash ) {
        return;
    }
    // Reload blacklists
    var switches = [];
    var lis = $('#blacklists .blacklistDetails');
    var i = lis.length;
    var path;
    while ( i-- ) {
        path = $(lis[i]).children('a').attr('href');
        switches.push({
            location: path,
            off: $(lis[i]).children('input').prop('checked') === false
        });
    }
    messaging.tell({
        what: 'reloadPresetBlacklists',
        switches: switches
    });
    $('#blacklistsApply').attr('disabled', true );
}

/******************************************************************************/

$(function() {
    $('#blacklists').on('change', '.blacklistDetails', selectedBlacklistsChanged);
    $('#blacklistsApply').on('click', blacklistsApplyHandler);
    renderBlacklists();
});

/******************************************************************************/

})();

