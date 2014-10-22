/*******************************************************************************

    µMatrix - a Chromium browser extension to block requests.
    Copyright (C) 2014 Raymond Hill

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

var cachedUserRules = '';

/******************************************************************************/

messaging.start('user-rules.js');

/******************************************************************************/

// This is to give a visual hint that the content of user blacklist has changed.

function userRulesChanged() {
    uDom('#userRulesApply').prop(
        'disabled',
        uDom('#userRules').val().trim() === cachedUserRules
    );
}

/******************************************************************************/

function renderUserRules() {
    var rulesRead = function(response) {
        cachedUserRules = response;
        uDom('#userRules').val(response);
    };
    messaging.ask({ what: 'getUserRules' }, rulesRead);
}

/******************************************************************************/

function handleImportFilePicker() {
    var fileReaderOnLoadHandler = function() {
        var textarea = uDom('#userRules');
        textarea.val([textarea.val(), this.result].join('\n').trim());
        userRulesChanged();
    };
    var file = this.files[0];
    if ( file === undefined || file.name === '' ) {
        return;
    }
    if ( file.type.indexOf('text') !== 0 ) {
        return;
    }
    var fr = new FileReader();
    fr.onload = fileReaderOnLoadHandler;
    fr.readAsText(file);
}

/******************************************************************************/

var startImportFilePicker = function() {
    var input = document.getElementById('importFilePicker');
    // Reset to empty string, this will ensure an change event is properly
    // triggered if the user pick a file, even if it is the same as the last
    // one picked.
    input.value = '';
    input.click();
};

/******************************************************************************/

function exportUserRulesToFile() {
    chrome.downloads.download({
        'url': 'data:text/plain,' + encodeURIComponent(uDom('#userRules').val()),
        'filename': chrome.i18n.getMessage('userRulesDefaultFileName'),
        'saveAs': true
    });
}

/******************************************************************************/

function userRulesApplyHandler() {
    var rules = uDom('#userRules').val();
    var rulesWritten = function(response) {
        cachedUserRules = rules;
        userRulesChanged();
    };
    var request = {
        what: 'setUserRules',
        rules: rules
    };
    messaging.ask(request, rulesWritten);
}

/******************************************************************************/

uDom.onLoad(function() {
    // Handle user interaction
    uDom('#importUserRulesFromFile').on('click', startImportFilePicker);
    uDom('#importFilePicker').on('change', handleImportFilePicker);
    uDom('#exportUserRulesToFile').on('click', exportUserRulesToFile);
    uDom('#userRules').on('input', userRulesChanged);
    uDom('#userRulesApply').on('click', userRulesApplyHandler);

    renderUserRules();
});

/******************************************************************************/

})();

