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

messaging.start('privacy.js');

var cachedUserSettings = {};

/******************************************************************************/

function changeUserSettings(name, value) {
    messaging.tell({
        what: 'userSettings',
        name: name,
        value: value
    });
}

/******************************************************************************/

function onChangeValueHandler(elem, setting, min, max) {
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

function prepareToDie() {
    onChangeValueHandler($('#delete-unused-session-cookies-after'), 'deleteUnusedSessionCookiesAfter', 15, 1440);
    onChangeValueHandler($('#clear-browser-cache-after'), 'clearBrowserCacheAfter', 15, 1440);
    onChangeValueHandler($('#spoof-user-agent-every'), 'spoofUserAgentEvery', 2, 999);
}

/******************************************************************************/

var installEventHandlers = function() {
    $('#delete-unused-session-cookies').on('change', function(){
        changeUserSettings('deleteUnusedSessionCookies', $(this).is(':checked'));
    });
    $('#delete-unused-session-cookies-after').on('change', function(){
        onChangeValueHandler($(this), 'deleteUnusedSessionCookiesAfter', 15, 1440);
    });
    $('#delete-blacklisted-cookies').on('change', function(){
        changeUserSettings('deleteCookies', $(this).is(':checked'));
    });
    $('#delete-blacklisted-localstorage').on('change', function(){
        changeUserSettings('deleteLocalStorage', $(this).is(':checked'));
    });
    $('#clear-browser-cache').on('change', function(){
        changeUserSettings('clearBrowserCache', $(this).is(':checked'));
    });
    $('#clear-browser-cache-after').on('change', function(){
        onChangeValueHandler($(this), 'clearBrowserCacheAfter', 15, 1440);
    });
    $('#process-referer').on('change', function(){
        changeUserSettings('processReferer', $(this).is(':checked'));
    });
    $('#process-hyperlink-auditing').on('change', function(){
        changeUserSettings('processHyperlinkAuditing', $(this).is(':checked'));
    });
    $('#spoof-user-agent').on('change', function(){
        changeUserSettings('spoofUserAgent', $(this).is(':checked'));
    });
    $('#spoof-user-agent-every').on('change', function(){
        onChangeValueHandler($(this), 'spoofUserAgentEvery', 2, 999);
    });
    $('#spoof-user-agent-with').on('change', function(){
        changeUserSettings('spoofUserAgentWith', $(this).val());
    });

    // https://github.com/gorhill/httpswitchboard/issues/197
    $(window).one('beforeunload', prepareToDie);
};

/******************************************************************************/

$(function() {
    var onUserSettingsReceived = function(userSettings) {
        // Cache copy
        cachedUserSettings = userSettings;

        $('#delete-unused-session-cookies').attr('checked', userSettings.deleteUnusedSessionCookies === true);
        $('#delete-unused-session-cookies-after').val(userSettings.deleteUnusedSessionCookiesAfter);
        $('#delete-blacklisted-cookies').attr('checked', userSettings.deleteCookies === true);
        $('#delete-blacklisted-localstorage').attr('checked', userSettings.deleteLocalStorage);
        $('#clear-browser-cache').attr('checked', userSettings.clearBrowserCache === true);
        $('#clear-browser-cache-after').val(userSettings.clearBrowserCacheAfter);
        $('#process-referer').attr('checked', userSettings.processReferer);
        $('#process-hyperlink-auditing').attr('checked', userSettings.processHyperlinkAuditing);
        $('#spoof-user-agent').attr('checked', userSettings.spoofUserAgent);
        $('#spoof-user-agent-every').val(userSettings.spoofUserAgentEvery);
        $('#spoof-user-agent-with').val(userSettings.spoofUserAgentWith);

        installEventHandlers();
    };
    messaging.ask({ what: 'getUserSettings' }, onUserSettingsReceived);
});

/******************************************************************************/

})();
