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

function onChangeValueHandler(uelem, setting, min, max) {
    var oldVal = cachedUserSettings[setting];
    var newVal = Math.round(parseFloat(uelem.val()));
    if ( typeof newVal !== 'number' ) {
        newVal = oldVal;
    } else {
        newVal = Math.max(newVal, min);
        newVal = Math.min(newVal, max);
    }
    uelem.val(newVal);
    if ( newVal !== oldVal ) {
        changeUserSettings(setting, newVal);
    }
}

/******************************************************************************/

function prepareToDie() {
    onChangeValueHandler(uDom('#delete-unused-session-cookies-after'), 'deleteUnusedSessionCookiesAfter', 15, 1440);
    onChangeValueHandler(uDom('#clear-browser-cache-after'), 'clearBrowserCacheAfter', 15, 1440);
    onChangeValueHandler(uDom('#spoof-user-agent-every'), 'spoofUserAgentEvery', 2, 999);
}

/******************************************************************************/

var installEventHandlers = function() {
    uDom('#delete-unused-session-cookies').on('change', function(){
        changeUserSettings('deleteUnusedSessionCookies', this.checked);
    });
    uDom('#delete-unused-session-cookies-after').on('change', function(){
        onChangeValueHandler(uDom(this), 'deleteUnusedSessionCookiesAfter', 15, 1440);
    });
    uDom('#delete-blacklisted-cookies').on('change', function(){
        changeUserSettings('deleteCookies', this.checked);
    });
    uDom('#delete-blacklisted-localstorage').on('change', function(){
        changeUserSettings('deleteLocalStorage', this.checked);
    });
    uDom('#clear-browser-cache').on('change', function(){
        changeUserSettings('clearBrowserCache', this.checked);
    });
    uDom('#clear-browser-cache-after').on('change', function(){
        onChangeValueHandler(uDom(this), 'clearBrowserCacheAfter', 15, 1440);
    });
    uDom('#process-referer').on('change', function(){
        changeUserSettings('processReferer', this.checked);
    });
    uDom('#process-hyperlink-auditing').on('change', function(){
        changeUserSettings('processHyperlinkAuditing', this.checked);
    });
    uDom('#spoof-user-agent').on('change', function(){
        changeUserSettings('spoofUserAgent', this.checked);
    });
    uDom('#spoof-user-agent-every').on('change', function(){
        onChangeValueHandler(uDom(this), 'spoofUserAgentEvery', 2, 999);
    });
    uDom('#spoof-user-agent-with').on('change', function(){
        changeUserSettings('spoofUserAgentWith', uDom(this).val());
    });

    // https://github.com/gorhill/httpswitchboard/issues/197
    uDom(window).on('beforeunload', prepareToDie);
};

/******************************************************************************/

uDom.onLoad(function() {
    var onUserSettingsReceived = function(userSettings) {
        // Cache copy
        cachedUserSettings = userSettings;

        uDom('#delete-unused-session-cookies').prop('checked', userSettings.deleteUnusedSessionCookies === true);
        uDom('#delete-unused-session-cookies-after').val(userSettings.deleteUnusedSessionCookiesAfter);
        uDom('#delete-blacklisted-cookies').prop('checked', userSettings.deleteCookies === true);
        uDom('#delete-blacklisted-localstorage').prop('checked', userSettings.deleteLocalStorage);
        uDom('#clear-browser-cache').prop('checked', userSettings.clearBrowserCache === true);
        uDom('#clear-browser-cache-after').val(userSettings.clearBrowserCacheAfter);
        uDom('#process-referer').prop('checked', userSettings.processReferer);
        uDom('#process-hyperlink-auditing').prop('checked', userSettings.processHyperlinkAuditing);
        uDom('#spoof-user-agent').prop('checked', userSettings.spoofUserAgent);
        uDom('#spoof-user-agent-every').val(userSettings.spoofUserAgentEvery);
        uDom('#spoof-user-agent-with').val(userSettings.spoofUserAgentWith);

        installEventHandlers();
    };
    messaging.ask({ what: 'getUserSettings' }, onUserSettingsReceived);
});

/******************************************************************************/

})();
